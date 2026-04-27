/**
 * SQLite persistence layer for Event Horizon.
 * Uses sql.js (WASM-based SQLite) for zero-native-dependency, cross-platform storage.
 * Stores events, knowledge entries, and agent sessions verbatim (MemPalace principle:
 * never summarize — filter at retrieval time).
 */

import initSqlJs, { type Database, type SqlValue } from 'sql.js';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Resolve the path to sql.js's WASM binary.
 *
 * Tried in order:
 *   1. Alongside the compiled extension output (`<out>/sql-wasm.wasm`) — populated by
 *      the `copy-sql-wasm.mjs` build step and shipped in the VSIX.
 *   2. `node_modules/sql.js/dist/sql-wasm.wasm` via `require.resolve` — works in dev
 *      (tsc compile) and unit tests (vitest) where node_modules is available.
 *   3. Whatever sql.js's default is — last-resort fallback.
 *
 * Without this, packaged extensions crash on activation with
 * `ENOENT: no such file or directory, open '<install>/out/sql-wasm.wasm'`
 * because sql.js looks next to its own JS file, which gets inlined into
 * `out/extension.js` by esbuild and leaves the WASM orphaned.
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
import type { AgentEvent } from '@event-horizon/core';
import { GRAPH_SCHEMA_SQL } from './projectGraph/schema.js';
import { ProjectGraphStore } from './projectGraph/store.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface PersistedKnowledgeEntry {
  id: string;
  key: string;
  value: string;
  scope: 'workspace' | 'plan';
  planId?: string;
  author: string;
  timestamp: number;
  tags?: string[];
  validFrom: number;
  validUntil?: number;
}

export interface AgentSession {
  agentId: string;
  agentName?: string;
  agentType: string;
  sessionStart: number;
  sessionEnd?: number;
  cwd?: string;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostUsd: number;
  eventCount: number;
}

export interface EventQueryOptions {
  agentId?: string;
  type?: string;
  since?: number;
  until?: number;
  workspace?: string;
  category?: string;
  limit?: number;
  offset?: number;
}

// ── Schema ─────────────────────────────────────────────────────────────────

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  agent_name TEXT,
  agent_type TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  payload TEXT NOT NULL,
  workspace TEXT,
  category TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_agent ON events(agent_id);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
CREATE INDEX IF NOT EXISTS idx_events_workspace ON events(workspace);

CREATE TABLE IF NOT EXISTS knowledge (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  scope TEXT NOT NULL,
  plan_id TEXT,
  author TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  tags TEXT,
  valid_from INTEGER NOT NULL,
  valid_until INTEGER
);
CREATE INDEX IF NOT EXISTS idx_knowledge_scope ON knowledge(scope, plan_id);

CREATE TABLE IF NOT EXISTS agent_sessions (
  agent_id TEXT NOT NULL,
  agent_name TEXT,
  agent_type TEXT NOT NULL,
  session_start INTEGER NOT NULL,
  session_end INTEGER,
  cwd TEXT,
  total_tokens_in INTEGER DEFAULT 0,
  total_tokens_out INTEGER DEFAULT 0,
  total_cost_usd REAL DEFAULT 0,
  event_count INTEGER DEFAULT 0,
  PRIMARY KEY (agent_id, session_start)
);
CREATE INDEX IF NOT EXISTS sessions_agent_open ON agent_sessions(agent_id, session_end);
`;

// FTS5 virtual table — created separately since it can fail on some builds
const FTS_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
  id, type, agent_id, payload,
  content=events, content_rowid=rowid
);

CREATE TRIGGER IF NOT EXISTS events_ai AFTER INSERT ON events BEGIN
  INSERT INTO events_fts(id, type, agent_id, payload)
  VALUES (new.id, new.type, new.agent_id, new.payload);
END;

CREATE TRIGGER IF NOT EXISTS events_ad AFTER DELETE ON events BEGIN
  INSERT INTO events_fts(events_fts, id, type, agent_id, payload)
  VALUES ('delete', old.id, old.type, old.agent_id, old.payload);
END;
`;

// ── Database class ─────────────────────────────────────────────────────────

export class EventHorizonDB {
  private db: Database;
  private ftsEnabled = false;
  private _dirty = false;
  private graphStore: ProjectGraphStore | null = null;

  // Batching — inserts are queued and flushed inside a single transaction
  // every FLUSH_WINDOW_MS so bursty ingestion (transcript watcher, hook
  // storms) doesn't pay the per-INSERT overhead of sql.js + FTS triggers.
  private static readonly FLUSH_WINDOW_MS = 250;
  private pendingInserts: Array<{ event: AgentEvent; workspace?: string; category?: string }> = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  private constructor(db: Database) {
    this.db = db;
  }

  /**
   * Create or load a database.
   * @param data Optional existing database buffer to load from.
   */
  static async create(data?: ArrayLike<number>): Promise<EventHorizonDB> {
    const SQL = await initSqlJs({ locateFile: locateSqlWasm });
    const db = data ? new SQL.Database(new Uint8Array(data)) : new SQL.Database();

    // Enable WAL-like performance (pragmas)
    db.run('PRAGMA journal_mode = MEMORY');
    db.run('PRAGMA synchronous = OFF');

    // Create schema
    db.run(SCHEMA_SQL);

    // Project Graph schema (code & knowledge graph). FTS5 portion may fail
    // on older sql.js builds — non-FTS tables are still created since
    // sql.js executes statements sequentially.
    try {
      db.run(GRAPH_SCHEMA_SQL);
    } catch {
      /* graph FTS unavailable — store gracefully degrades to LIKE search */
    }

    const instance = new EventHorizonDB(db);

    // Try to enable FTS5 — may not be available in all sql.js builds
    try {
      db.run(FTS_SQL);
      instance.ftsEnabled = true;
    } catch {
      // FTS5 not available — full-text search will fall back to LIKE queries
    }

    return instance;
  }

  /** Check if the database has unsaved changes. */
  isDirty(): boolean {
    return this._dirty;
  }

  // ── Events ─────────────────────────────────────────────────────────────

  insertEvent(event: AgentEvent, workspace?: string, category?: string): void {
    this._insertEventRaw(event, workspace, category);
  }

  /**
   * Queue an event for batched insertion. Inserts are coalesced into a single
   * BEGIN/COMMIT transaction that fires every 250ms, yielding ~3× throughput
   * on event bursts. Call `flushSync()` before shutdown to avoid losing
   * queued events.
   */
  queueInsert(event: AgentEvent, workspace?: string, category?: string): void {
    this.pendingInserts.push({ event, workspace, category });
    if (this.flushTimer === null) {
      this.flushTimer = setTimeout(() => this.flush(), EventHorizonDB.FLUSH_WINDOW_MS);
    }
  }

  /** Flush any queued inserts immediately (e.g. on dispose/deactivate). */
  flushSync(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }

  /** Stop the flush timer and drain the queue. */
  dispose(): void {
    this.flushSync();
  }

  private flush(): void {
    this.flushTimer = null;
    if (this.pendingInserts.length === 0) return;

    const batch = this.pendingInserts;
    this.pendingInserts = [];

    this.db.exec('BEGIN TRANSACTION');
    try {
      for (const { event, workspace, category } of batch) {
        this._insertEventRaw(event, workspace, category);
      }
      this.db.exec('COMMIT');
      this._dirty = true;
    } catch {
      try { this.db.exec('ROLLBACK'); } catch { /* rollback best-effort */ }
    }
  }

  private _insertEventRaw(event: AgentEvent, workspace?: string, category?: string): void {
    this.db.run(
      `INSERT OR IGNORE INTO events (id, type, agent_id, agent_name, agent_type, timestamp, payload, workspace, category)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.id,
        event.type,
        event.agentId,
        event.agentName ?? null,
        event.agentType,
        event.timestamp,
        JSON.stringify(event.payload),
        workspace ?? event.workspace ?? null,
        category ?? event.category ?? null,
      ]
    );
    this._dirty = true;
  }

  queryEvents(opts: EventQueryOptions = {}): AgentEvent[] {
    const conditions: string[] = [];
    const params: SqlValue[] = [];

    if (opts.agentId) { conditions.push('agent_id = ?'); params.push(opts.agentId); }
    if (opts.type) { conditions.push('type = ?'); params.push(opts.type); }
    if (opts.since) { conditions.push('timestamp >= ?'); params.push(opts.since); }
    if (opts.until) { conditions.push('timestamp <= ?'); params.push(opts.until); }
    if (opts.workspace) { conditions.push('workspace = ?'); params.push(opts.workspace); }
    if (opts.category) { conditions.push('category = ?'); params.push(opts.category); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = opts.limit ?? 1000;
    const offset = opts.offset ?? 0;

    const sql = `SELECT id, type, agent_id, agent_name, agent_type, timestamp, payload, workspace, category
                 FROM events ${where}
                 ORDER BY timestamp DESC
                 LIMIT ? OFFSET ?`;

    const stmt = this.db.prepare(sql);
    stmt.bind([...params, limit, offset]);

    const results: AgentEvent[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      results.push({
        id: row['id'] as string,
        type: row['type'] as AgentEvent['type'],
        agentId: row['agent_id'] as string,
        agentName: (row['agent_name'] as string) ?? '',
        agentType: (row['agent_type'] as string) as AgentEvent['agentType'],
        timestamp: row['timestamp'] as number,
        payload: JSON.parse(row['payload'] as string),
        workspace: (row['workspace'] as string) ?? undefined,
        category: (row['category'] as string) ?? undefined,
      });
    }
    stmt.free();

    return results;
  }

  searchEvents(query: string, limit = 50): AgentEvent[] {
    if (this.ftsEnabled) {
      // FTS5 full-text search
      const sql = `SELECT e.id, e.type, e.agent_id, e.agent_name, e.agent_type, e.timestamp, e.payload, e.workspace, e.category
                   FROM events e
                   JOIN events_fts fts ON e.id = fts.id
                   WHERE events_fts MATCH ?
                   ORDER BY e.timestamp DESC
                   LIMIT ?`;
      try {
        const stmt = this.db.prepare(sql);
        stmt.bind([query, limit]);

        const results: AgentEvent[] = [];
        while (stmt.step()) {
          const row = stmt.getAsObject();
          results.push({
            id: row['id'] as string,
            type: row['type'] as AgentEvent['type'],
            agentId: row['agent_id'] as string,
            agentName: (row['agent_name'] as string) ?? '',
            agentType: (row['agent_type'] as string) as AgentEvent['agentType'],
            timestamp: row['timestamp'] as number,
            payload: JSON.parse(row['payload'] as string),
            workspace: (row['workspace'] as string) ?? undefined,
            category: (row['category'] as string) ?? undefined,
          });
        }
        stmt.free();
        return results;
      } catch {
        // FTS query syntax error — fall back to LIKE search
      }
    }

    // Fallback: LIKE-based search on payload
    return this.queryEvents({ limit }).filter((e) => {
      const payloadStr = JSON.stringify(e.payload).toLowerCase();
      return payloadStr.includes(query.toLowerCase());
    });
  }

  getEventCount(): number {
    const result = this.db.exec('SELECT COUNT(*) as cnt FROM events');
    if (result.length === 0) return 0;
    return result[0].values[0][0] as number;
  }

  // ── Knowledge ──────────────────────────────────────────────────────────

  insertKnowledge(entry: PersistedKnowledgeEntry): void {
    this.db.run(
      `INSERT OR REPLACE INTO knowledge (id, key, value, scope, plan_id, author, timestamp, tags, valid_from, valid_until)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.id,
        entry.key,
        entry.value,
        entry.scope,
        entry.planId ?? null,
        entry.author,
        entry.timestamp,
        entry.tags ? JSON.stringify(entry.tags) : null,
        entry.validFrom,
        entry.validUntil ?? null,
      ]
    );
    this._dirty = true;
  }

  queryKnowledge(opts: {
    scope?: 'workspace' | 'plan';
    planId?: string;
    includeExpired?: boolean;
  } = {}): PersistedKnowledgeEntry[] {
    const conditions: string[] = [];
    const params: SqlValue[] = [];

    if (opts.scope) { conditions.push('scope = ?'); params.push(opts.scope); }
    if (opts.planId) { conditions.push('plan_id = ?'); params.push(opts.planId); }
    if (!opts.includeExpired) {
      conditions.push('(valid_until IS NULL OR valid_until > ?)');
      params.push(Date.now());
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM knowledge ${where} ORDER BY timestamp DESC`;

    const stmt = this.db.prepare(sql);
    stmt.bind(params);

    const results: PersistedKnowledgeEntry[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      results.push({
        id: row['id'] as string,
        key: row['key'] as string,
        value: row['value'] as string,
        scope: row['scope'] as 'workspace' | 'plan',
        planId: (row['plan_id'] as string) ?? undefined,
        author: row['author'] as string,
        timestamp: row['timestamp'] as number,
        tags: row['tags'] ? JSON.parse(row['tags'] as string) : undefined,
        validFrom: row['valid_from'] as number,
        validUntil: (row['valid_until'] as number) ?? undefined,
      });
    }
    stmt.free();

    return results;
  }

  deleteKnowledge(id: string): void {
    this.db.run('DELETE FROM knowledge WHERE id = ?', [id]);
    this._dirty = true;
  }

  // ── Agent Sessions ─────────────────────────────────────────────────────

  upsertSession(session: AgentSession): void {
    this.db.run(
      `INSERT OR REPLACE INTO agent_sessions
       (agent_id, agent_name, agent_type, session_start, session_end, cwd, total_tokens_in, total_tokens_out, total_cost_usd, event_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        session.agentId,
        session.agentName ?? null,
        session.agentType,
        session.sessionStart,
        session.sessionEnd ?? null,
        session.cwd ?? null,
        session.totalTokensIn,
        session.totalTokensOut,
        session.totalCostUsd,
        session.eventCount,
      ]
    );
    this._dirty = true;
  }

  getSessions(since?: number): AgentSession[] {
    const conditions: string[] = [];
    const params: SqlValue[] = [];

    if (since) { conditions.push('session_start >= ?'); params.push(since); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM agent_sessions ${where} ORDER BY session_start DESC`;

    const stmt = this.db.prepare(sql);
    stmt.bind(params);

    const results: AgentSession[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      results.push({
        agentId: row['agent_id'] as string,
        agentName: (row['agent_name'] as string) ?? undefined,
        agentType: row['agent_type'] as string,
        sessionStart: row['session_start'] as number,
        sessionEnd: (row['session_end'] as number) ?? undefined,
        cwd: (row['cwd'] as string) ?? undefined,
        totalTokensIn: row['total_tokens_in'] as number,
        totalTokensOut: row['total_tokens_out'] as number,
        totalCostUsd: row['total_cost_usd'] as number,
        eventCount: row['event_count'] as number,
      });
    }
    stmt.free();

    return results;
  }

  getOpenSession(agentId: string): AgentSession | null {
    const stmt = this.db.prepare(
      `SELECT * FROM agent_sessions WHERE agent_id = ? AND session_end IS NULL LIMIT 1`
    );
    stmt.bind([agentId]);
    const found = stmt.step();
    const row = found ? stmt.getAsObject() : null;
    stmt.free();
    if (!row) return null;
    return {
      agentId: row['agent_id'] as string,
      agentName: (row['agent_name'] as string) ?? undefined,
      agentType: row['agent_type'] as string,
      sessionStart: row['session_start'] as number,
      sessionEnd: (row['session_end'] as number) ?? undefined,
      cwd: (row['cwd'] as string) ?? undefined,
      totalTokensIn: row['total_tokens_in'] as number,
      totalTokensOut: row['total_tokens_out'] as number,
      totalCostUsd: row['total_cost_usd'] as number,
      eventCount: row['event_count'] as number,
    };
  }

  // ── Project Graph ──────────────────────────────────────────────────────

  /**
   * Lazily construct and cache a `ProjectGraphStore` over this database.
   * The graph schema (`GRAPH_SCHEMA_SQL`) is applied during `create()`.
   */
  getProjectGraphStore(): ProjectGraphStore {
    if (!this.graphStore) {
      this.graphStore = new ProjectGraphStore(this.db);
    }
    return this.graphStore;
  }

  // ── Maintenance ────────────────────────────────────────────────────────

  /**
   * Delete events older than the given threshold.
   * @param olderThanMs Milliseconds — events older than `Date.now() - olderThanMs` are removed.
   * @returns Number of events deleted.
   */
  pruneEvents(olderThanMs: number): number {
    const cutoff = Date.now() - olderThanMs;
    this.db.run('DELETE FROM events WHERE timestamp < ?', [cutoff]);
    const result = this.db.exec('SELECT changes()');
    const count = result.length > 0 ? (result[0].values[0][0] as number) : 0;
    if (count > 0) {
      this._dirty = true;
    }
    return count;
  }

  /** Export the full database as a binary buffer for persistence to disk. */
  save(): Uint8Array {
    const data = this.db.export();
    this._dirty = false;
    return data;
  }

  /** Get the approximate database size in bytes. */
  getDbSizeBytes(): number {
    return this.save().length;
  }

  /** Close the database connection. */
  close(): void {
    this.flushSync();
    this.db.close();
  }
}
