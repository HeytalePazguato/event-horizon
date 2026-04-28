/**
 * Per-workspace lifecycle for the project graph database.
 *
 * The extension owns one `ProjectGraphLifecycle` instance for the duration
 * of an activation. It opens `<workspace>/.eh/graph.db` for the primary
 * workspace folder, swaps DBs when the user changes folders, and closes
 * everything cleanly on deactivation. A 60s save loop persists dirty state
 * to disk in the background.
 *
 * Consumers (scanner, query engine, MCP handlers, webview) ask the
 * lifecycle for `getActiveStore()` at call time. When no folder is open
 * the store is `null` and consumers report a clear "no workspace" state
 * instead of silently writing into a polluted global DB — the workspace-
 * folder ambiguity that bit us during 3.0.0 dogfooding becomes structurally
 * impossible because the graph file's location *is* the project.
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

  /** Fires whenever the active store changes (open, close, or swap). */
  readonly onActiveStoreChange: vscode.Event<ProjectGraphStore | null> = this.emitter.event;

  getActiveWorkspace(): string | null {
    return this.activeWorkspace;
  }

  getActiveStore(): ProjectGraphStore | null {
    return this.activeDb?.getStore() ?? null;
  }

  getActiveDbPath(): string | null {
    return this.activeDbPath;
  }

  /**
   * Open (or re-open) the graph DB for the given workspace folder. If a
   * different workspace is active, it is closed with a final flush before
   * the new one is opened. Calling this with the currently-active folder
   * is a no-op.
   *
   * Side effects on first open for a folder:
   *   - Creates `<folder>/.eh/` if missing
   *   - Writes `<folder>/.eh/.gitignore` (`*.db`, `*.db-shm`, `*.db-wal`)
   *     only if it does not already exist (never overwrites a user-edited file)
   */
  async openForWorkspace(folder: string): Promise<void> {
    const normalized = path.resolve(folder);
    if (this.activeWorkspace === normalized && this.activeDb) return;

    if (this.activeDb) {
      await this.closeActive();
    }

    const ehDir = path.join(normalized, '.eh');
    const dbPath = path.join(ehDir, 'graph.db');
    const gitignorePath = path.join(ehDir, '.gitignore');

    await fs.promises.mkdir(ehDir, { recursive: true });

    if (!fs.existsSync(gitignorePath)) {
      await fs.promises.writeFile(gitignorePath, GITIGNORE_CONTENT, 'utf8');
    }

    let buffer: Uint8Array | undefined;
    try {
      buffer = await fs.promises.readFile(dbPath);
    } catch {
      // No existing graph DB on disk — start with a fresh one.
    }

    const db = await ProjectGraphDB.create(buffer);

    this.activeWorkspace = normalized;
    this.activeDb = db;
    this.activeDbPath = dbPath;
    this.saveInterval = setInterval(() => this.tickSave(), SAVE_INTERVAL_MS);

    this.emitter.fire(db.getStore());
  }

  /**
   * Flush dirty state and close the active DB. After this, `getActiveStore()`
   * returns `null` until `openForWorkspace()` is called again. Idempotent.
   */
  async closeActive(): Promise<void> {
    if (!this.activeDb) return;

    if (this.saveInterval) {
      clearInterval(this.saveInterval);
      this.saveInterval = null;
    }

    if (this.activeDb.isDirty() && this.activeDbPath) {
      try {
        const data = this.activeDb.save();
        await fs.promises.writeFile(this.activeDbPath, data);
      } catch {
        // Final-flush failure is non-fatal — the next session will rebuild
        // anything that didn't make it to disk. The graph is regeneratable
        // by re-running /eh:optimize-context.
      }
    }

    try {
      this.activeDb.close();
    } catch {
      /* close best-effort */
    }

    this.activeDb = null;
    this.activeWorkspace = null;
    this.activeDbPath = null;

    this.emitter.fire(null);
  }

  /** Dispose the underlying EventEmitter. Call once on deactivation. */
  dispose(): void {
    this.emitter.dispose();
  }

  private tickSave(): void {
    if (!this.activeDb || !this.activeDbPath) return;
    if (!this.activeDb.isDirty()) return;
    try {
      const data = this.activeDb.save();
      void fs.promises.writeFile(this.activeDbPath, data);
    } catch {
      // Intermittent disk errors will retry on the next tick. If the
      // workspace is read-only, every tick will fail silently — the
      // graph still works in-memory for the current session.
    }
  }
}
