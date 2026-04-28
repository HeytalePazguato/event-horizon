/**
 * Per-workspace lifecycle for the project graph database.
 *
 * Two distinct entry points enforce the user-triggered rule:
 *
 *   - `attachIfExists(folder)` — called on extension activation and on
 *     workspace-folder change. ONLY opens an existing `<folder>/.eh/graph.db`
 *     if one is already on disk (built by a prior `/eh:optimize-context` run).
 *     **Creates nothing** — no `.eh/` directory, no `.gitignore`, no empty
 *     `graph.db` file. If no graph exists, the lifecycle attaches the folder
 *     name (so `getActiveWorkspace()` knows which folder is current) but
 *     leaves `getActiveStore()` returning `null`.
 *
 *   - `openForBuild(folder)` — called only by the `eh_build_graph` MCP
 *     handler (which is reachable solely via `/eh:optimize-context`). This
 *     is the ONE code path allowed to create files: it `mkdir`s `.eh/`,
 *     writes `.gitignore` if absent, and creates `graph.db` if missing.
 *
 * The user-triggered rule from the plan: nothing touches disk until the
 * user explicitly invokes the skill. Activation is allowed to *read* an
 * existing graph; it is not allowed to *create* one.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ProjectGraphDB } from './projectGraphDb.js';
import type { ProjectGraphStore } from './store.js';

const SAVE_INTERVAL_MS = 60_000;
const GITIGNORE_CONTENT = '*.db\n*.db-shm\n*.db-wal\n';

export class ProjectGraphLifecycle {
  private activeWorkspace: string | null = null;
  private activeDb: ProjectGraphDB | null = null;
  private activeDbPath: string | null = null;
  private saveInterval: ReturnType<typeof setInterval> | null = null;
  private readonly emitter = new vscode.EventEmitter<ProjectGraphStore | null>();
  private readonly dataEmitter = new vscode.EventEmitter<void>();

  /** Fires whenever the active store changes (attach, build, close, swap). */
  readonly onActiveStoreChange: vscode.Event<ProjectGraphStore | null> = this.emitter.event;

  /**
   * Fires when the active store's data changes in bulk — e.g. after a
   * `/eh:optimize-context` rebuild lands. Consumers (the webview) refresh
   * stats and re-fetch nodes when this fires. Distinct from
   * `onActiveStoreChange` (which is for transitions: open/close/swap).
   */
  readonly onDataChange: vscode.Event<void> = this.dataEmitter.event;

  /** Notify listeners that the active store's contents changed in bulk. */
  notifyDataChange(): void {
    this.dataEmitter.fire();
  }

  /**
   * The currently-tracked workspace folder, if any. Set by both
   * `attachIfExists` and `openForBuild`. Independent of whether a graph DB
   * is actually open — used by the MCP build handler to know which folder
   * to call `openForBuild` against.
   */
  getActiveWorkspace(): string | null {
    return this.activeWorkspace;
  }

  /**
   * The currently-loaded graph store, if any. Returns `null` when no graph
   * file exists on disk yet (the user hasn't run the skill) or no folder is
   * mounted at all.
   */
  getActiveStore(): ProjectGraphStore | null {
    return this.activeDb?.getStore() ?? null;
  }

  getActiveDbPath(): string | null {
    return this.activeDbPath;
  }

  /**
   * Read-only attach: tracks the folder and opens `<folder>/.eh/graph.db`
   * **only if the file already exists**. Never creates the directory or
   * any files. Safe to call on activation — the user can open any folder
   * in VS Code without writing anything to disk.
   *
   * If the lifecycle is currently attached to a different folder, that one
   * is closed (with a final flush of any dirty state) before the new one
   * is attached.
   */
  async attachIfExists(folder: string): Promise<void> {
    const normalized = path.resolve(folder);

    // Same folder, same state — no work.
    if (this.activeWorkspace === normalized) return;

    if (this.activeDb || this.activeWorkspace) {
      await this.closeActive();
    }

    this.activeWorkspace = normalized;

    const dbPath = path.join(normalized, '.eh', 'graph.db');
    console.log(`[Event Horizon] attachIfExists: workspace=${normalized}, dbPath=${dbPath}`);
    let buffer: Uint8Array | undefined;
    try {
      buffer = await fs.promises.readFile(dbPath);
    } catch {
      // No existing graph file — that's the normal pre-skill state. We
      // intentionally do NOT create the directory or an empty DB here.
      console.log(`[Event Horizon] No graph DB on disk at ${dbPath} — run /eh:optimize-context to build one.`);
      this.emitter.fire(null);
      return;
    }

    // Empty (0-byte) or corrupt files crash sql.js. Treat the same as
    // "no graph yet" — the user re-runs `/eh:optimize-context` to rebuild.
    if (!buffer || buffer.byteLength === 0) {
      console.warn(`[Event Horizon] graph.db at ${dbPath} is empty (0 bytes); ignoring. Re-run /eh:optimize-context to rebuild.`);
      this.emitter.fire(null);
      return;
    }

    let db: ProjectGraphDB;
    try {
      db = await ProjectGraphDB.create(buffer);
    } catch (err) {
      console.error(`[Event Horizon] graph.db at ${dbPath} failed to load (${buffer.byteLength} bytes) — re-run /eh:optimize-context to rebuild:`, err);
      this.emitter.fire(null);
      return;
    }

    this.activeDb = db;
    this.activeDbPath = dbPath;
    this.saveInterval = setInterval(() => this.tickSave(), SAVE_INTERVAL_MS);

    const stats = db.getStore().getStats();
    console.log(`[Event Horizon] Graph DB loaded from ${dbPath}: ${stats.nodeCount} nodes, ${stats.edgeCount} edges, ${stats.fileCount} files (buffer ${buffer.byteLength} bytes).`);

    this.emitter.fire(db.getStore());
  }

  /**
   * Build-mode open: ensures `<folder>/.eh/` exists, writes `.gitignore` if
   * absent, and opens (or creates) `<folder>/.eh/graph.db`. Returns the
   * active store. Called only by the `eh_build_graph` MCP handler — i.e.
   * only when the user has invoked `/eh:optimize-context`.
   *
   * If the lifecycle is already attached to this folder via `attachIfExists`
   * but no DB file existed yet, this upgrades the attachment in place by
   * creating the file and opening it. If attached to a *different* folder,
   * that one is closed first.
   */
  async openForBuild(folder: string): Promise<ProjectGraphStore> {
    const normalized = path.resolve(folder);

    // Always start a build with a clean slate. The user's intent when
    // running `/eh:optimize-context` is "rebuild the graph for this project
    // because it might have changed." Carrying over the prior DB risks
    // stale rows for files that were deleted or renamed since the last run.
    // The fresh in-memory DB will overwrite `<folder>/.eh/graph.db` on the
    // next save.
    if (this.activeDb) {
      // Have a DB — different folder OR same folder. Flush and close before
      // building fresh.
      await this.closeActive();
    } else if (this.activeWorkspace && this.activeWorkspace !== normalized) {
      // Attached to a different folder via attachIfExists — release it so
      // the build attaches to the correct folder.
      await this.closeActive();
    }
    // Otherwise the lifecycle is either fully unattached, or attached to
    // this folder via attachIfExists but with no DB. We can build directly
    // without a redundant close-and-reattach (avoids a spurious
    // onActiveStoreChange(null) right before the fresh `(store)` fire).

    const ehDir = path.join(normalized, '.eh');
    const dbPath = path.join(ehDir, 'graph.db');
    const gitignorePath = path.join(ehDir, '.gitignore');

    await fs.promises.mkdir(ehDir, { recursive: true });

    if (!fs.existsSync(gitignorePath)) {
      await fs.promises.writeFile(gitignorePath, GITIGNORE_CONTENT, 'utf8');
    }

    // Fresh empty DB — no buffer load. Marked dirty so the first save tick
    // overwrites whatever stale `graph.db` is on disk.
    const db = await ProjectGraphDB.create();
    this.activeDb = db;
    this.activeWorkspace = normalized;
    this.activeDbPath = dbPath;
    if (this.saveInterval === null) {
      this.saveInterval = setInterval(() => this.tickSave(), SAVE_INTERVAL_MS);
    }
    this.emitter.fire(db.getStore());

    return db.getStore();
  }

  /**
   * Flush dirty state and close the active DB. After this both
   * `getActiveStore()` and `getActiveWorkspace()` return `null` until the
   * lifecycle is re-attached. Idempotent.
   */
  async closeActive(): Promise<void> {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
      this.saveInterval = null;
    }

    if (this.activeDb && this.activeDb.isDirty() && this.activeDbPath) {
      try {
        const data = this.activeDb.save();
        await fs.promises.writeFile(this.activeDbPath, data);
      } catch {
        // Final-flush failure is non-fatal — the user's next skill run
        // rebuilds anything that didn't make it to disk.
      }
    }

    if (this.activeDb) {
      try {
        this.activeDb.close();
      } catch {
        /* close best-effort */
      }
    }

    const wasActive = this.activeDb !== null || this.activeWorkspace !== null;

    this.activeDb = null;
    this.activeWorkspace = null;
    this.activeDbPath = null;

    if (wasActive) this.emitter.fire(null);
  }

  /** Dispose the underlying EventEmitters. Call once on deactivation. */
  dispose(): void {
    this.emitter.dispose();
    this.dataEmitter.dispose();
  }

  private tickSave(): void {
    if (!this.activeDb || !this.activeDbPath) return;
    if (!this.activeDb.isDirty()) return;
    try {
      const data = this.activeDb.save();
      void fs.promises.writeFile(this.activeDbPath, data);
    } catch {
      // Intermittent disk errors will retry on the next tick. If the
      // workspace is read-only, every tick fails silently — the graph
      // still works in-memory for the current session.
    }
  }
}
