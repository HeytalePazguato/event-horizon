/**
 * Per-project graph database — a thin sql.js wrapper that holds ONLY the
 * project-graph tables (`graph_nodes`, `graph_edges`, `graph_file_state`,
 * `graph_nodes_fts`). One instance per workspace folder, persisted to
 * `<workspace>/.eh/graph.db` by `ProjectGraphLifecycle`.
 *
 * Why a separate DB from `EventHorizonDB`:
 *   - Events / sessions / shared knowledge are intentionally cross-project
 *     (multi-agent coordination spans workspaces) and stay in the global DB.
 *   - The graph is project-scoped — a function in project A has nothing to
 *     say about project B. Storing the graph alongside the project that owns
 *     it makes the workspace-folder ambiguity that bit us during 3.0.0
 *     dogfooding structurally impossible: the graph file's location *is*
 *     the answer to "which project".
 *
 * Reuses `sql.js` and `ProjectGraphStore` verbatim — no new dependencies.
 */

import initSqlJs, { type Database } from 'sql.js';
import * as path from 'path';
import * as fs from 'fs';
import { GRAPH_SCHEMA_SQL } from './schema.js';
import { ProjectGraphStore } from './store.js';

/**
 * Resolve the path to sql.js's WASM binary. Same lookup chain as
 * `persistence.ts` — checked next to the compiled extension first, then
 * via require.resolve for dev/test, then sql.js's default as last resort.
 */
function locateSqlWasm(file: string): string {
  const nearby = path.join(__dirname, file);
  if (fs.existsSync(nearby)) return nearby;
  try {
    return require.resolve(`sql.js/dist/${file}`);
  } catch {
    return file;
  }
}

export class ProjectGraphDB {
  private db: Database;
  private store: ProjectGraphStore | null = null;
  private _dirty: boolean;
  private _closed = false;

  private constructor(db: Database, dirty: boolean) {
    this.db = db;
    this._dirty = dirty;
  }

  /**
   * Create a new graph DB or load one from a previously-saved buffer.
   * @param data Optional buffer from a prior `save()`. When omitted, a
   *   fresh in-memory database is created and marked dirty so the first
   *   auto-save loop persists it to disk.
   */
  static async create(data?: ArrayLike<number>): Promise<ProjectGraphDB> {
    const SQL = await initSqlJs({ locateFile: locateSqlWasm });
    const db = data ? new SQL.Database(new Uint8Array(data)) : new SQL.Database();

    db.run('PRAGMA journal_mode = MEMORY');
    db.run('PRAGMA synchronous = OFF');

    // FTS5 may fail on older sql.js builds — apply graph schema in two
    // phases so the non-FTS tables still land. ProjectGraphStore detects
    // FTS availability and falls back to LIKE search.
    try {
      db.run(GRAPH_SCHEMA_SQL);
    } catch {
      /* FTS unavailable — non-FTS tables already created up to that point */
    }

    // A fresh DB has nothing on disk yet — flag dirty so the first save
    // tick writes the empty schema. Loading from a buffer means the disk
    // copy already matches; nothing to flush until the first mutation.
    return new ProjectGraphDB(db, !data);
  }

  /**
   * Lazily construct and cache the store wrapper. Each store mutation
   * marks the DB dirty via the `onMutate` callback so the auto-save
   * loop knows there's something new to flush.
   */
  getStore(): ProjectGraphStore {
    if (!this.store) {
      this.store = new ProjectGraphStore(this.db, () => {
        this._dirty = true;
      });
    }
    return this.store;
  }

  /** Whether there are unsaved mutations since the last `save()` (or load). */
  isDirty(): boolean {
    return this._dirty;
  }

  /** Export the database as a binary buffer for persistence to disk. */
  save(): Uint8Array {
    const data = this.db.export();
    this._dirty = false;
    return data;
  }

  /** Close the underlying sql.js handle. Idempotent. */
  close(): void {
    if (this._closed) return;
    this._closed = true;
    try {
      this.db.close();
    } catch {
      /* sql.js close is best-effort; nothing actionable on failure */
    }
  }
}
