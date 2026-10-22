/**
 * TelemetryStore — Claude Code OTel data, kept apart from the main database.
 *
 * Telemetry is strictly subordinate to the event path:
 * - It lives in its own sql.js file with its own save cadence. sql.js saves by
 *   exporting the whole database, so sharing the main file would make every
 *   main-DB save pay for telemetry volume.
 * - Ingest is an O(1) push onto a bounded queue. When the queue is full the
 *   oldest items are dropped — it never blocks and never grows without limit.
 * - The queue drains on a timer, in one transaction, into per-minute rollups
 *   (agent, model, query source) rather than raw points, plus a capped log
 *   table.
 *
 * Content-bearing log attributes (prompts, tool inputs and parameters, raw
 * bodies) are removed before storage, whatever the user's OTel content gates
 * say — they may have opted into those for their own collector.
 */

import initSqlJs, { type Database } from 'sql.js';
import { locateSqlWasm } from '../persistence.js';
import type { OtlpMetricSample, OtlpLogRecord } from './otlpReceiver.js';

export const ROLLUP_BUCKET_MS = 60_000;
export const DEFAULT_MAX_QUEUE = 5_000;
export const DEFAULT_MAX_LOG_ROWS = 20_000;
const MAX_ATTRIBUTE_CHARS = 500;

/** Attributes that can carry prompt/response/tool content. Never stored. */
const CONTENT_ATTRIBUTES = new Set([
  'prompt', 'prompt.text', 'response', 'body', 'tool_input', 'tool_parameters', 'tool_output', 'tool_result',
  'request_body', 'response_body', 'assistant_response', 'user_prompt',
]);

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS telemetry_rollup (
  bucket_ts INTEGER NOT NULL,
  agent_id TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  query_source TEXT NOT NULL DEFAULT '',
  cost_usd REAL NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_ts, agent_id, model, query_source)
);
CREATE INDEX IF NOT EXISTS idx_telemetry_rollup_agent ON telemetry_rollup(agent_id, bucket_ts);

CREATE TABLE IF NOT EXISTS telemetry_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  agent_id TEXT,
  name TEXT NOT NULL,
  attributes TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_telemetry_log_ts ON telemetry_log(ts);
`;

const TOKEN_COLUMN: Record<string, string> = {
  input: 'input_tokens',
  output: 'output_tokens',
  cacheRead: 'cache_read_tokens',
  cacheCreation: 'cache_creation_tokens',
};

export interface TelemetryRollupRow {
  bucketTs: number;
  agentId: string;
  model: string;
  querySource: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface TelemetryStoreOptions {
  maxQueue?: number;
  maxLogRows?: number;
}

type QueueItem = { kind: 'metric'; sample: OtlpMetricSample } | { kind: 'log'; record: OtlpLogRecord };

/** Strip content-bearing attributes and truncate long values. */
export function sanitizeLogAttributes(attributes: Record<string, string | number | boolean>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(attributes)) {
    if (CONTENT_ATTRIBUTES.has(k)) continue;
    out[k] = typeof v === 'string' && v.length > MAX_ATTRIBUTE_CHARS ? `${v.slice(0, MAX_ATTRIBUTE_CHARS)}…` : v;
  }
  return out;
}

export class TelemetryStore {
  private queue: QueueItem[] = [];
  private dropped = 0;
  private dirty = false;
  /** Last value per cumulative series, so rollups only ever add increments. */
  private readonly lastCumulative = new Map<string, number>();
  private readonly maxQueue: number;
  private readonly maxLogRows: number;

  private constructor(private readonly db: Database, opts: TelemetryStoreOptions) {
    this.maxQueue = opts.maxQueue ?? DEFAULT_MAX_QUEUE;
    this.maxLogRows = opts.maxLogRows ?? DEFAULT_MAX_LOG_ROWS;
  }

  static async create(data?: ArrayLike<number>, opts: TelemetryStoreOptions = {}): Promise<TelemetryStore> {
    const SQL = await initSqlJs({ locateFile: locateSqlWasm });
    const db = data ? new SQL.Database(new Uint8Array(data)) : new SQL.Database();
    db.run('PRAGMA journal_mode = MEMORY');
    db.run('PRAGMA synchronous = OFF');
    db.run(SCHEMA_SQL);
    return new TelemetryStore(db, opts);
  }

  // ── Ingest (hot path: O(1), never blocks) ────────────────────────────────

  enqueueMetrics(samples: OtlpMetricSample[]): void {
    for (const sample of samples) this.push({ kind: 'metric', sample });
  }

  enqueueLogs(records: OtlpLogRecord[]): void {
    for (const record of records) this.push({ kind: 'log', record });
  }

  private push(item: QueueItem): void {
    this.queue.push(item);
    if (this.queue.length > this.maxQueue) {
      const excess = this.queue.length - this.maxQueue;
      this.queue.splice(0, excess);
      this.dropped += excess;
    }
  }

  /** Items waiting to be written. */
  queueLength(): number { return this.queue.length; }

  /** Items discarded because the queue was full, since creation. */
  droppedCount(): number { return this.dropped; }

  // ── Drain (off the hot path) ─────────────────────────────────────────────

  /** Write everything queued in one transaction. Returns the number of items written. */
  flush(): number {
    if (this.queue.length === 0) return 0;
    const items = this.queue;
    this.queue = [];
    let wroteLogs = false;
    this.db.run('BEGIN');
    try {
      for (const item of items) {
        if (item.kind === 'metric') this.writeMetric(item.sample);
        else { this.writeLog(item.record); wroteLogs = true; }
      }
      if (wroteLogs) this.capLogs();
      this.db.run('COMMIT');
    } catch {
      this.db.run('ROLLBACK');
      return 0;
    }
    this.dirty = true;
    return items.length;
  }

  private writeMetric(s: OtlpMetricSample): void {
    let increment = s.value;
    if (s.temporality === 'cumulative') {
      const key = `${s.metric}|${Object.keys(s.attributes).sort().map((k) => `${k}=${String(s.attributes[k])}`).join('|')}`;
      const last = this.lastCumulative.get(key) ?? 0;
      // A drop means the series restarted (new process); count from zero.
      increment = s.value >= last ? s.value - last : s.value;
      this.lastCumulative.set(key, s.value);
    }
    if (!(increment > 0)) return;
    const bucket = Math.floor((s.timeMs || Date.now()) / ROLLUP_BUCKET_MS) * ROLLUP_BUCKET_MS;
    const column = s.metric === 'cost' ? 'cost_usd' : TOKEN_COLUMN[s.tokenType ?? ''];
    if (!column) return;
    this.db.run(
      `INSERT INTO telemetry_rollup (bucket_ts, agent_id, model, query_source, ${column})
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(bucket_ts, agent_id, model, query_source) DO UPDATE SET ${column} = ${column} + excluded.${column}`,
      [bucket, s.sessionId, s.model ?? '', s.querySource ?? '', increment],
    );
  }

  private writeLog(r: OtlpLogRecord): void {
    this.db.run(
      'INSERT INTO telemetry_log (ts, agent_id, name, attributes) VALUES (?, ?, ?, ?)',
      [r.timeMs, r.sessionId ?? null, r.name, JSON.stringify(sanitizeLogAttributes(r.attributes))],
    );
  }

  private capLogs(): void {
    this.db.run(
      `DELETE FROM telemetry_log WHERE id NOT IN (SELECT id FROM telemetry_log ORDER BY id DESC LIMIT ?)`,
      [this.maxLogRows],
    );
  }

  // ── Queries & maintenance ────────────────────────────────────────────────

  queryRollups(opts: { agentId?: string; since?: number } = {}): TelemetryRollupRow[] {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (opts.agentId) { where.push('agent_id = ?'); params.push(opts.agentId); }
    if (opts.since !== undefined) { where.push('bucket_ts >= ?'); params.push(opts.since); }
    const stmt = this.db.prepare(`SELECT * FROM telemetry_rollup ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY bucket_ts`);
    stmt.bind(params);
    const rows: TelemetryRollupRow[] = [];
    while (stmt.step()) {
      const r = stmt.getAsObject();
      rows.push({
        bucketTs: r.bucket_ts as number,
        agentId: r.agent_id as string,
        model: r.model as string,
        querySource: r.query_source as string,
        costUsd: r.cost_usd as number,
        inputTokens: r.input_tokens as number,
        outputTokens: r.output_tokens as number,
        cacheReadTokens: r.cache_read_tokens as number,
        cacheCreationTokens: r.cache_creation_tokens as number,
      });
    }
    stmt.free();
    return rows;
  }

  countLogs(): number {
    const res = this.db.exec('SELECT COUNT(*) FROM telemetry_log');
    return (res[0]?.values[0]?.[0] as number) ?? 0;
  }

  /** Delete rollups and logs older than `Date.now() - olderThanMs`. Returns rows removed. */
  prune(olderThanMs: number, now = Date.now()): number {
    const cutoff = now - olderThanMs;
    this.db.run('DELETE FROM telemetry_rollup WHERE bucket_ts < ?', [cutoff]);
    let removed = this.db.getRowsModified();
    this.db.run('DELETE FROM telemetry_log WHERE ts < ?', [cutoff]);
    removed += this.db.getRowsModified();
    if (removed > 0) this.dirty = true;
    return removed;
  }

  /** Remove all telemetry, queued or stored. */
  purge(): void {
    this.queue = [];
    this.lastCumulative.clear();
    this.db.run('DELETE FROM telemetry_rollup');
    this.db.run('DELETE FROM telemetry_log');
    this.dirty = true;
  }

  isDirty(): boolean { return this.dirty; }

  /** Export the database for writing to disk. */
  save(): Uint8Array {
    const data = this.db.export();
    this.dirty = false;
    return data;
  }

  close(): void {
    this.db.close();
  }
}
