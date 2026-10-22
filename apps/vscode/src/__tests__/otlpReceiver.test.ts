/**
 * OTLP/JSON receiver tests — metric + log parsing, delta accumulation,
 * PII stripping, and malformed input.
 */

import { describe, it, expect } from 'vitest';
import {
  parseOtlpMetrics,
  parseOtlpLogs,
  otlpLogToEvent,
  OtlpCostAccumulator,
} from '../otlp/otlpReceiver.js';

const s = (key: string, v: string) => ({ key, value: { stringValue: v } });
const MS = 1_000_000; // ns per ms

function costPoint(session: string, model: string, value: number, start: number, end: number, extra: Array<{ key: string; value: object }> = []) {
  return {
    attributes: [s('session.id', session), s('model', model), s('query_source', 'main'), s('user.email', 'me@example.com'), ...extra],
    startTimeUnixNano: String(start * MS),
    timeUnixNano: String(end * MS),
    asDouble: value,
  };
}

function metricsBody(dataPoints: object[], opts: { name?: string; temporality?: number; resource?: object[] } = {}) {
  return {
    resourceMetrics: [{
      resource: { attributes: opts.resource ?? [s('service.name', 'claude-code'), s('organization.id', 'org-1')] },
      scopeMetrics: [{
        scope: { name: 'com.anthropic.claude_code' },
        metrics: [{
          name: opts.name ?? 'claude_code.cost.usage',
          unit: 'USD',
          sum: { aggregationTemporality: opts.temporality ?? 1, isMonotonic: true, dataPoints },
        }],
      }],
    }],
  };
}

describe('parseOtlpMetrics', () => {
  it('returns one sample per cost data point with model and query_source', () => {
    const samples = parseOtlpMetrics(metricsBody([
      costPoint('sess-1', 'claude-opus-5', 0.12, 0, 10_000),
      costPoint('sess-1', 'claude-haiku-4-5', 0.01, 0, 10_000),
    ]));
    expect(samples).toHaveLength(2);
    expect(samples[0]).toMatchObject({ metric: 'cost', sessionId: 'sess-1', model: 'claude-opus-5', querySource: 'main', value: 0.12, temporality: 'delta', timeMs: 10_000 });
  });

  it('strips personal identifiers from attributes', () => {
    const [sample] = parseOtlpMetrics(metricsBody([costPoint('sess-1', 'claude-opus-5', 0.1, 0, 1)]));
    expect(sample.attributes['user.email']).toBeUndefined();
    expect(sample.attributes['organization.id']).toBeUndefined();
    expect(sample.attributes['service.name']).toBe('claude-code');
  });

  it('reads session.id from resource attributes when not on the data point', () => {
    const dp = { attributes: [s('model', 'claude-sonnet-5')], timeUnixNano: '1', asDouble: 0.5 };
    const samples = parseOtlpMetrics(metricsBody([dp], { resource: [s('session.id', 'from-resource')] }));
    expect(samples[0].sessionId).toBe('from-resource');
  });

  it('parses token usage with its type and int64-as-string values', () => {
    const dp = { attributes: [s('session.id', 'sess-1'), s('type', 'cacheRead')], timeUnixNano: '1', asInt: '12345' };
    const [sample] = parseOtlpMetrics(metricsBody([dp], { name: 'claude_code.token.usage' }));
    expect(sample).toMatchObject({ metric: 'tokens', tokenType: 'cacheRead', value: 12345 });
  });

  it('marks cumulative temporality', () => {
    const [sample] = parseOtlpMetrics(metricsBody([costPoint('sess-1', 'm', 1, 0, 1)], { temporality: 2 }));
    expect(sample.temporality).toBe('cumulative');
  });

  it('skips unrelated metrics, points without a session, and negative values', () => {
    expect(parseOtlpMetrics(metricsBody([costPoint('s', 'm', 1, 0, 1)], { name: 'claude_code.session.count' }))).toEqual([]);
    expect(parseOtlpMetrics(metricsBody([{ attributes: [s('model', 'm')], asDouble: 1 }]))).toEqual([]);
    expect(parseOtlpMetrics(metricsBody([costPoint('s', 'm', -1, 0, 1)]))).toEqual([]);
  });

  it('returns [] for malformed payloads without throwing', () => {
    for (const bad of [null, undefined, 42, 'x', {}, { resourceMetrics: 'nope' }, { resourceMetrics: [{ scopeMetrics: [{ metrics: [null] }] }] }]) {
      expect(parseOtlpMetrics(bad)).toEqual([]);
    }
  });
});

describe('OtlpCostAccumulator', () => {
  it('sums delta exports into a cumulative session cost', () => {
    const acc = new OtlpCostAccumulator();
    acc.ingest(parseOtlpMetrics(metricsBody([costPoint('sess-1', 'claude-opus-5', 0.10, 0, 10_000)])));
    acc.ingest(parseOtlpMetrics(metricsBody([costPoint('sess-1', 'claude-opus-5', 0.25, 10_000, 20_000)])));
    expect(acc.sessionCost('sess-1')).toBeCloseTo(0.35);
  });

  it('does not double-count an exporter retry of the same delta point', () => {
    const acc = new OtlpCostAccumulator();
    const body = metricsBody([costPoint('sess-1', 'claude-opus-5', 0.10, 0, 10_000)]);
    acc.ingest(parseOtlpMetrics(body));
    const changed = acc.ingest(parseOtlpMetrics(body));
    expect(changed.size).toBe(0);
    expect(acc.sessionCost('sess-1')).toBeCloseTo(0.10);
  });

  it('keeps the latest value for cumulative series', () => {
    const acc = new OtlpCostAccumulator();
    acc.ingest(parseOtlpMetrics(metricsBody([costPoint('sess-1', 'm', 0.10, 0, 10_000)], { temporality: 2 })));
    acc.ingest(parseOtlpMetrics(metricsBody([costPoint('sess-1', 'm', 0.30, 0, 20_000)], { temporality: 2 })));
    expect(acc.sessionCost('sess-1')).toBeCloseTo(0.30);
  });

  it('sums across models and attribution series within a session, and isolates sessions', () => {
    const acc = new OtlpCostAccumulator();
    acc.ingest(parseOtlpMetrics(metricsBody([
      costPoint('sess-1', 'claude-opus-5', 1, 0, 1),
      costPoint('sess-1', 'claude-haiku-4-5', 0.5, 0, 1),
      costPoint('sess-1', 'claude-opus-5', 2, 0, 1, [s('agent.name', 'reviewer')]),
      costPoint('sess-2', 'claude-opus-5', 9, 0, 1),
    ])));
    expect(acc.sessionCost('sess-1')).toBeCloseTo(3.5);
    expect(acc.sessionCost('sess-2')).toBeCloseTo(9);
  });

  it('reports which sessions changed', () => {
    const acc = new OtlpCostAccumulator();
    const changed = acc.ingest(parseOtlpMetrics(metricsBody([costPoint('a', 'm', 1, 0, 1), costPoint('b', 'm', 1, 0, 1)])));
    expect([...changed].sort()).toEqual(['a', 'b']);
  });

  it('splits tokens by type', () => {
    const acc = new OtlpCostAccumulator();
    const tok = (type: string, v: number) => ({ attributes: [s('session.id', 's'), s('type', type)], startTimeUnixNano: '0', timeUnixNano: '1', asInt: String(v) });
    acc.ingest(parseOtlpMetrics(metricsBody([tok('input', 100), tok('output', 20), tok('cacheRead', 900), tok('cacheCreation', 50)], { name: 'claude_code.token.usage' })));
    expect(acc.sessionTokens('s')).toEqual({ input: 100, output: 20, cacheRead: 900, cacheCreation: 50 });
  });

  it('forgets a session', () => {
    const acc = new OtlpCostAccumulator();
    acc.ingest(parseOtlpMetrics(metricsBody([costPoint('a', 'm', 1, 0, 1)])));
    acc.forgetSession('a');
    expect(acc.sessionCost('a')).toBe(0);
  });
});

function logsBody(records: object[]) {
  return { resourceLogs: [{ resource: { attributes: [s('service.name', 'claude-code')] }, scopeLogs: [{ logRecords: records }] }] };
}

describe('parseOtlpLogs / otlpLogToEvent', () => {
  const apiRequest = {
    timeUnixNano: String(5_000 * MS),
    body: { stringValue: 'claude_code.api_request' },
    attributes: [
      s('event.name', 'api_request'), s('session.id', 'sess-1'), s('model', 'claude-opus-5'),
      s('cost_usd', '0.042'), s('duration_ms', '1834'), s('input_tokens', '1200'), s('user.email', 'me@example.com'),
    ],
  };

  it('parses event name, session and attributes, dropping PII', () => {
    const [rec] = parseOtlpLogs(logsBody([apiRequest]));
    expect(rec).toMatchObject({ name: 'api_request', sessionId: 'sess-1', timeMs: 5_000 });
    expect(rec.attributes['user.email']).toBeUndefined();
  });

  it('falls back to the body for the event name', () => {
    const [rec] = parseOtlpLogs(logsBody([{ body: { stringValue: 'claude_code.tool_result' }, attributes: [s('session.id', 'x')] }]));
    expect(rec.name).toBe('tool_result');
  });

  it('maps api_request to task.progress with numeric request details', () => {
    const ev = otlpLogToEvent(parseOtlpLogs(logsBody([apiRequest]))[0])!;
    expect(ev).toMatchObject({ agentId: 'sess-1', agentType: 'claude-code', type: 'task.progress' });
    expect(ev.payload).toMatchObject({ otel: 'api_request', model: 'claude-opus-5', durationMs: 1834, requestCostUsd: 0.042, requestInputTokens: 1200 });
  });

  it('maps api_error to task.progress, not agent.error (retries are not failures)', () => {
    const rec = parseOtlpLogs(logsBody([{ attributes: [s('event.name', 'api_error'), s('session.id', 's'), s('status_code', '529'), s('attempt', '2')] }]))[0];
    const ev = otlpLogToEvent(rec)!;
    expect(ev.type).toBe('task.progress');
    expect(ev.payload).toMatchObject({ otel: 'api_error', statusCode: 529, attempt: 2 });
  });

  it('does not map tool events that hooks already report', () => {
    for (const name of ['tool_result', 'tool_decision', 'user_prompt']) {
      const rec = parseOtlpLogs(logsBody([{ attributes: [s('event.name', name), s('session.id', 's')] }]))[0];
      expect(otlpLogToEvent(rec)).toBeNull();
    }
  });

  it('drops records without a session id when mapping', () => {
    const rec = parseOtlpLogs(logsBody([{ attributes: [s('event.name', 'api_request')] }]))[0];
    expect(otlpLogToEvent(rec)).toBeNull();
  });

  it('returns [] for malformed payloads without throwing', () => {
    for (const bad of [null, 1, {}, { resourceLogs: {} }, { resourceLogs: [{ scopeLogs: [{ logRecords: [null, 5] }] }] }]) {
      expect(parseOtlpLogs(bad)).toEqual([]);
    }
  });
});
