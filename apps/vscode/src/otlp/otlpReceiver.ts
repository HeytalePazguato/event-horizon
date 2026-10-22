/**
 * OTLP/HTTP JSON receiver for Claude Code telemetry.
 *
 * Claude Code exports `claude_code.cost.usage` and `claude_code.token.usage`
 * counters plus `claude_code.*` log events when CLAUDE_CODE_ENABLE_TELEMETRY is
 * on. We accept the `http/json` encoding so no protobuf dependency is needed.
 *
 * Counters default to DELTA temporality: each export carries only what changed
 * since the previous one. OtlpCostAccumulator turns that into a cumulative
 * per-session total (the shape every other cost source reports), and also
 * handles CUMULATIVE series by keeping their latest value.
 *
 * Personal identifiers that Claude Code attaches to every record (user.email,
 * user.account_uuid, user.id, organization.id) are dropped during parsing so
 * nothing downstream can store them. Forwarding to a user's own collector uses
 * the raw request body, not these parsed values.
 */

import type { AgentEvent } from '@event-horizon/core';

// ── OTLP JSON shapes (subset) ───────────────────────────────────────────────

interface AnyValue {
  stringValue?: string;
  intValue?: string | number;
  doubleValue?: number;
  boolValue?: boolean;
}
interface KeyValue { key: string; value?: AnyValue }
interface NumberDataPoint {
  attributes?: KeyValue[];
  startTimeUnixNano?: string | number;
  timeUnixNano?: string | number;
  asDouble?: number;
  asInt?: string | number;
}

/** OTLP AggregationTemporality: 1 = DELTA, 2 = CUMULATIVE. Anything but cumulative is treated as delta. */
const TEMPORALITY_CUMULATIVE = 2;

const DROPPED_ATTRIBUTES = new Set(['user.email', 'user.account_uuid', 'user.account_id', 'user.id', 'organization.id']);

export type OtlpTemporality = 'delta' | 'cumulative';

export interface OtlpMetricSample {
  metric: 'cost' | 'tokens';
  sessionId: string;
  model?: string;
  querySource?: string;
  /** Token type for `tokens` samples: input | output | cacheRead | cacheCreation. */
  tokenType?: string;
  value: number;
  temporality: OtlpTemporality;
  startTimeMs: number;
  timeMs: number;
  /** Data-point + resource attributes with personal identifiers removed. */
  attributes: Record<string, string | number | boolean>;
}

export interface OtlpLogRecord {
  /** Short event name, e.g. `api_request`. */
  name: string;
  sessionId?: string;
  timeMs: number;
  attributes: Record<string, string | number | boolean>;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function anyValue(v: AnyValue | undefined): string | number | boolean | undefined {
  if (!v || typeof v !== 'object') return undefined;
  if (typeof v.stringValue === 'string') return v.stringValue;
  if (typeof v.doubleValue === 'number') return v.doubleValue;
  // int64 is encoded as a JSON string in OTLP/JSON.
  if (v.intValue !== undefined) {
    const n = Number(v.intValue);
    return Number.isFinite(n) ? n : undefined;
  }
  if (typeof v.boolValue === 'boolean') return v.boolValue;
  return undefined;
}

function attrs(list: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!Array.isArray(list)) return out;
  for (const kv of list as KeyValue[]) {
    if (!kv || typeof kv.key !== 'string' || DROPPED_ATTRIBUTES.has(kv.key)) continue;
    const v = anyValue(kv.value);
    if (v !== undefined) out[kv.key] = v;
  }
  return out;
}

function nanosToMs(v: string | number | undefined): number {
  if (v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n / 1e6) : 0;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
}

// ── Metrics ─────────────────────────────────────────────────────────────────

const METRIC_KIND: Record<string, OtlpMetricSample['metric']> = {
  'claude_code.cost.usage': 'cost',
  'claude_code.token.usage': 'tokens',
};

/**
 * Parse an OTLP ExportMetricsServiceRequest (JSON). Returns one sample per data
 * point of the Claude Code cost/token counters. Unrecognised or malformed
 * payloads yield `[]` — this never throws.
 */
export function parseOtlpMetrics(body: unknown): OtlpMetricSample[] {
  const samples: OtlpMetricSample[] = [];
  try {
    for (const rm of arr(obj(body).resourceMetrics)) {
      const resourceAttrs = attrs(obj(obj(rm).resource).attributes);
      for (const sm of arr(obj(rm).scopeMetrics)) {
        for (const metric of arr(obj(sm).metrics)) {
          const m = obj(metric);
          const kind = METRIC_KIND[String(m.name)];
          if (!kind) continue;
          const series = obj(m.sum ?? m.gauge);
          const temporality: OtlpTemporality =
            series.aggregationTemporality === TEMPORALITY_CUMULATIVE || series.aggregationTemporality === 'AGGREGATION_TEMPORALITY_CUMULATIVE'
              ? 'cumulative'
              : 'delta';
          for (const dp of arr(series.dataPoints) as NumberDataPoint[]) {
            const a = { ...resourceAttrs, ...attrs(dp.attributes) };
            const sessionId = str(a['session.id']);
            if (!sessionId) continue;
            const raw = dp.asDouble ?? (dp.asInt !== undefined ? Number(dp.asInt) : undefined);
            if (raw === undefined || !Number.isFinite(raw) || raw < 0) continue;
            samples.push({
              metric: kind,
              sessionId,
              model: str(a.model),
              querySource: str(a.query_source),
              tokenType: kind === 'tokens' ? str(a.type) : undefined,
              value: raw,
              temporality,
              startTimeMs: nanosToMs(dp.startTimeUnixNano),
              timeMs: nanosToMs(dp.timeUnixNano),
              attributes: a,
            });
          }
        }
      }
    }
  } catch {
    return [];
  }
  return samples;
}

/**
 * Turns delta and cumulative counter samples into cumulative per-session
 * totals. A series is one distinct attribute set (model, query_source,
 * agent/skill/plugin attribution, token type...). Delta points are summed,
 * de-duplicated on (series, start, end) so an exporter retry is not counted
 * twice; cumulative points replace the series value.
 */
export class OtlpCostAccumulator {
  private readonly series = new Map<string, { sessionId: string; metric: OtlpMetricSample['metric']; model?: string; tokenType?: string; value: number }>();
  private readonly seenDeltaPoints = new Set<string>();

  /** Ingest samples; returns the session ids whose totals changed. */
  ingest(samples: OtlpMetricSample[]): Set<string> {
    const changed = new Set<string>();
    for (const s of samples) {
      const key = seriesKey(s);
      const existing = this.series.get(key);
      if (s.temporality === 'delta') {
        const pointKey = `${key}#${s.startTimeMs}-${s.timeMs}`;
        if (this.seenDeltaPoints.has(pointKey)) continue;
        this.seenDeltaPoints.add(pointKey);
        if (s.value === 0) continue;
        this.series.set(key, { sessionId: s.sessionId, metric: s.metric, model: s.model, tokenType: s.tokenType, value: (existing?.value ?? 0) + s.value });
      } else {
        if (existing && existing.value === s.value) continue;
        this.series.set(key, { sessionId: s.sessionId, metric: s.metric, model: s.model, tokenType: s.tokenType, value: s.value });
      }
      changed.add(s.sessionId);
    }
    // Bound the de-dup set; old points can no longer be retried.
    if (this.seenDeltaPoints.size > 50_000) this.seenDeltaPoints.clear();
    return changed;
  }

  /** Cumulative USD for a session across every model and attribution. */
  sessionCost(sessionId: string): number {
    let total = 0;
    for (const s of this.series.values()) if (s.sessionId === sessionId && s.metric === 'cost') total += s.value;
    return total;
  }

  /** Cumulative tokens for a session, split by token type. */
  sessionTokens(sessionId: string): { input: number; output: number; cacheRead: number; cacheCreation: number } {
    const out = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
    for (const s of this.series.values()) {
      if (s.sessionId !== sessionId || s.metric !== 'tokens') continue;
      if (s.tokenType === 'input' || s.tokenType === 'output' || s.tokenType === 'cacheRead' || s.tokenType === 'cacheCreation') {
        out[s.tokenType] += s.value;
      }
    }
    return out;
  }

  /** Most recent model seen for a session's cost, if any. */
  sessionModel(sessionId: string): string | undefined {
    let model: string | undefined;
    for (const s of this.series.values()) if (s.sessionId === sessionId && s.metric === 'cost' && s.model) model = s.model;
    return model;
  }

  forgetSession(sessionId: string): void {
    for (const [k, s] of this.series) if (s.sessionId === sessionId) this.series.delete(k);
  }
}

function seriesKey(s: OtlpMetricSample): string {
  const keys = Object.keys(s.attributes).sort();
  return `${s.metric}|${keys.map((k) => `${k}=${String(s.attributes[k])}`).join('|')}`;
}

// ── Logs ────────────────────────────────────────────────────────────────────

/**
 * Parse an OTLP ExportLogsServiceRequest (JSON) into Claude Code log records.
 * Event name comes from the `event.name` attribute, falling back to a
 * `claude_code.<name>` string body. Malformed payloads yield `[]`.
 */
export function parseOtlpLogs(body: unknown): OtlpLogRecord[] {
  const records: OtlpLogRecord[] = [];
  try {
    for (const rl of arr(obj(body).resourceLogs)) {
      const resourceAttrs = attrs(obj(obj(rl).resource).attributes);
      for (const sl of arr(obj(rl).scopeLogs)) {
        for (const lr of arr(obj(sl).logRecords)) {
          const r = obj(lr);
          const a = { ...resourceAttrs, ...attrs(r.attributes) };
          const bodyName = str(anyValue(obj(r.body) as AnyValue));
          const rawName = str(a['event.name']) ?? bodyName;
          if (!rawName) continue;
          const name = rawName.replace(/^claude_code\./, '');
          records.push({
            name,
            sessionId: str(a['session.id']),
            timeMs: nanosToMs((r.timeUnixNano ?? r.observedTimeUnixNano) as string | number | undefined) || Date.now(),
            attributes: a,
          });
        }
      }
    }
  } catch {
    return [];
  }
  return records;
}

let otlpEventSeq = 0;

/**
 * Map a log record to an AgentEvent, or null. Only events hooks do not already
 * report are mapped, as task.progress — tool_result/tool_decision would
 * double-count tool calls that PreToolUse/PostToolUse already emit, so they
 * stay telemetry-only.
 */
export function otlpLogToEvent(record: OtlpLogRecord): AgentEvent | null {
  if (!record.sessionId) return null;
  const a = record.attributes;
  const num = (k: string): number | undefined => (typeof a[k] === 'number' ? a[k] as number : (typeof a[k] === 'string' && a[k] !== '' && Number.isFinite(Number(a[k])) ? Number(a[k]) : undefined));
  const base = {
    id: `otel-${record.timeMs}-${++otlpEventSeq}`,
    agentId: record.sessionId,
    agentName: 'Claude Code',
    agentType: 'claude-code' as const,
    timestamp: record.timeMs,
  };
  if (record.name === 'api_request') {
    return {
      ...base,
      type: 'task.progress',
      payload: {
        otel: 'api_request',
        model: a.model,
        querySource: a.query_source,
        durationMs: num('duration_ms'),
        requestCostUsd: num('cost_usd'),
        requestInputTokens: num('input_tokens'),
        requestOutputTokens: num('output_tokens'),
        requestCacheReadTokens: num('cache_read_tokens'),
        requestCacheCreationTokens: num('cache_creation_tokens'),
      },
    };
  }
  if (record.name === 'api_error') {
    // Not agent.error: this fires per retried attempt, including ones that later
    // succeed. A turn that actually fails arrives via the StopFailure hook.
    return {
      ...base,
      type: 'task.progress',
      payload: {
        otel: 'api_error',
        model: a.model,
        error: typeof a.error === 'string' ? a.error.slice(0, 500) : undefined,
        statusCode: num('status_code'),
        attempt: num('attempt'),
        durationMs: num('duration_ms'),
      },
    };
  }
  return null;
}
