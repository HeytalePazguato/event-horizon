/**
 * TelemetryStore tests — rollup bucketing, delta vs cumulative, bounded
 * queue, isolation from the main DB, log capping and sanitizing, retention.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { TelemetryStore, ROLLUP_BUCKET_MS, sanitizeLogAttributes } from '../otlp/telemetryStore.js';
import { EventHorizonDB } from '../persistence.js';
import type { OtlpMetricSample, OtlpLogRecord } from '../otlp/otlpReceiver.js';

const T0 = 1_800_000_000_000; // a bucket-aligned timestamp
const cost = (value: number, timeMs: number, over: Partial<OtlpMetricSample> = {}): OtlpMetricSample => ({
  metric: 'cost', sessionId: 'sess-1', model: 'claude-opus-5', querySource: 'main', value, temporality: 'delta',
  startTimeMs: timeMs - 10_000, timeMs, attributes: { 'session.id': 'sess-1', model: 'claude-opus-5', query_source: 'main' }, ...over,
});
const log = (name: string, timeMs: number, attributes: Record<string, string | number | boolean> = {}): OtlpLogRecord => ({ name, sessionId: 'sess-1', timeMs, attributes });

const stores: TelemetryStore[] = [];
async function store() {
  const s = await TelemetryStore.create();
  stores.push(s);
  return s;
}
afterEach(() => { while (stores.length) stores.pop()!.close(); });

describe('TelemetryStore', () => {
  it('aggregates samples into per-minute buckets keyed by agent, model and query source', async () => {
    const s = await store();
    s.enqueueMetrics([
      cost(0.1, T0 + 1_000),
      cost(0.2, T0 + 30_000),
      cost(0.5, T0 + ROLLUP_BUCKET_MS + 5_000),
      cost(1, T0 + 2_000, { model: 'claude-haiku-4-5', attributes: { 'session.id': 'sess-1', model: 'claude-haiku-4-5' } }),
    ]);
    s.flush();
    const rows = s.queryRollups();
    const opus = rows.filter((r) => r.model === 'claude-opus-5');
    expect(opus).toHaveLength(2);
    expect(opus[0]).toMatchObject({ bucketTs: T0, agentId: 'sess-1', querySource: 'main' });
    expect(opus[0].costUsd).toBeCloseTo(0.3);
    expect(opus[1].costUsd).toBeCloseTo(0.5);
    expect(rows.find((r) => r.model === 'claude-haiku-4-5')!.costUsd).toBeCloseTo(1);
  });

  it('adds token samples to the matching column', async () => {
    const s = await store();
    const tok = (type: string, v: number): OtlpMetricSample => ({ ...cost(v, T0), metric: 'tokens', tokenType: type, attributes: { 'session.id': 'sess-1', type } });
    s.enqueueMetrics([tok('input', 100), tok('output', 20), tok('cacheRead', 900), tok('cacheCreation', 50)]);
    s.flush();
    expect(s.queryRollups()[0]).toMatchObject({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 900, cacheCreationTokens: 50 });
  });

  it('stores only increments for cumulative series', async () => {
    const s = await store();
    const cum = (v: number, t: number) => cost(v, t, { temporality: 'cumulative' });
    s.enqueueMetrics([cum(1, T0), cum(1.5, T0 + 10_000), cum(2, T0 + 20_000)]);
    s.flush();
    expect(s.queryRollups()[0].costUsd).toBeCloseTo(2);
  });

  it('drops the oldest items rather than growing past the queue bound', async () => {
    const s = await TelemetryStore.create(undefined, { maxQueue: 100 });
    stores.push(s);
    s.enqueueMetrics(Array.from({ length: 10_000 }, (_, i) => cost(0.001, T0 + i)));
    expect(s.queueLength()).toBe(100);
    expect(s.droppedCount()).toBe(9_900);
  });

  it('telemetry never hijacks the main path: the main database stays clean during a burst', async () => {
    const main = await EventHorizonDB.create();
    try {
      main.save(); // clean baseline
      expect(main.isDirty()).toBe(false);
      const s = await store();
      s.enqueueMetrics(Array.from({ length: 10_000 }, (_, i) => cost(0.001, T0 + i)));
      s.enqueueLogs(Array.from({ length: 2_000 }, (_, i) => log('api_request', T0 + i)));
      s.flush();
      expect(main.isDirty()).toBe(false);
      expect(s.isDirty()).toBe(true);
    } finally {
      main.close();
    }
  });

  it('enqueue does no database work until flush', async () => {
    const s = await store();
    s.enqueueMetrics([cost(1, T0)]);
    expect(s.isDirty()).toBe(false);
    expect(s.queryRollups()).toEqual([]);
    expect(s.flush()).toBe(1);
    expect(s.queryRollups()).toHaveLength(1);
  });

  it('caps the log table and keeps the newest rows', async () => {
    const s = await TelemetryStore.create(undefined, { maxLogRows: 50 });
    stores.push(s);
    s.enqueueLogs(Array.from({ length: 120 }, (_, i) => log('api_request', T0 + i)));
    s.flush();
    expect(s.countLogs()).toBe(50);
  });

  it('strips content-bearing attributes from logs and truncates long values', () => {
    const out = sanitizeLogAttributes({ prompt: 'secret', tool_input: '{...}', tool_parameters: 'x', model: 'claude-opus-5', error: 'e'.repeat(2000) });
    expect(out).not.toHaveProperty('prompt');
    expect(out).not.toHaveProperty('tool_input');
    expect(out).not.toHaveProperty('tool_parameters');
    expect(out.model).toBe('claude-opus-5');
    expect((out.error as string).length).toBeLessThanOrEqual(501);
  });

  it('prunes rows older than the retention window', async () => {
    const s = await store();
    const day = 24 * 60 * 60 * 1000;
    s.enqueueMetrics([cost(1, T0), cost(2, T0 + 10 * day)]);
    s.enqueueLogs([log('api_request', T0), log('api_request', T0 + 10 * day)]);
    s.flush();
    const removed = s.prune(7 * day, T0 + 10 * day + 1);
    expect(removed).toBe(2);
    expect(s.queryRollups()).toHaveLength(1);
    expect(s.countLogs()).toBe(1);
  });

  it('purge empties stored and queued telemetry', async () => {
    const s = await store();
    s.enqueueMetrics([cost(1, T0)]);
    s.flush();
    s.enqueueMetrics([cost(1, T0)]);
    s.purge();
    expect(s.queueLength()).toBe(0);
    expect(s.queryRollups()).toEqual([]);
    expect(s.countLogs()).toBe(0);
  });

  it('round-trips through save and reload', async () => {
    const s = await store();
    s.enqueueMetrics([cost(1.25, T0)]);
    s.flush();
    const reloaded = await TelemetryStore.create(s.save());
    stores.push(reloaded);
    expect(reloaded.queryRollups()[0].costUsd).toBeCloseTo(1.25);
  });
});
