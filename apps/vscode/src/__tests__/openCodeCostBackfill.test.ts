/**
 * OpenCode cost backfill tests.
 *
 * The bug: the connector's accumulator starts at zero and only counts
 * assistant messages seen while Event Horizon is attached, so a session that
 * had already spent $202.68 reported $0.62.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  sumSessionMessages,
  backfillSessionCost,
  resetBackfillState,
} from '../openCodeCostBackfill.js';
import { getTokenTotals, mapOpenCodeToEvent } from '@event-horizon/connectors';

function assistant(id: string, cost: number, input = 0, output = 0) {
  return { info: { id, role: 'assistant', cost, tokens: { input, output } } };
}

describe('sumSessionMessages', () => {
  it('totals cost and tokens across assistant messages', () => {
    const totals = sumSessionMessages([
      assistant('m1', 100.5, 1000, 200),
      assistant('m2', 102.18, 500, 100),
    ]);
    expect(totals.costUsd).toBeCloseTo(202.68, 2);
    expect(totals.inputTokens).toBe(1500);
    expect(totals.outputTokens).toBe(300);
    expect(totals.messageCount).toBe(2);
    expect(totals.messageIds).toEqual(['m1', 'm2']);
  });

  it('ignores user messages, which carry no cost', () => {
    const totals = sumSessionMessages([
      { info: { id: 'u1', role: 'user' } },
      assistant('m1', 5),
    ]);
    expect(totals.messageCount).toBe(1);
    expect(totals.costUsd).toBe(5);
  });

  it('counts a repeated message id once', () => {
    const totals = sumSessionMessages([assistant('m1', 5), assistant('m1', 5)]);
    expect(totals.costUsd).toBe(5);
  });

  it('folds cache reads and writes into input tokens', () => {
    const totals = sumSessionMessages([
      { info: { id: 'm1', role: 'assistant', cost: 1, tokens: { input: 10, output: 5, cache: { read: 100, write: 20 } } } },
    ]);
    expect(totals.inputTokens).toBe(130);
    expect(totals.outputTokens).toBe(5);
  });

  // OpenCode has moved these shapes around between versions.
  it('accepts a bare array, {messages}, or {data}', () => {
    const one = [assistant('m1', 3)];
    expect(sumSessionMessages(one).costUsd).toBe(3);
    expect(sumSessionMessages({ messages: one }).costUsd).toBe(3);
    expect(sumSessionMessages({ data: one }).costUsd).toBe(3);
  });

  it('accepts flat messages without an info wrapper', () => {
    const totals = sumSessionMessages([{ id: 'm1', role: 'assistant', cost: 7 }]);
    expect(totals.costUsd).toBe(7);
  });

  it('returns zeroes for junk rather than throwing', () => {
    expect(sumSessionMessages(null).messageCount).toBe(0);
    expect(sumSessionMessages({ nope: true }).messageCount).toBe(0);
    expect(sumSessionMessages([null, 'x', 42]).messageCount).toBe(0);
  });
});

describe('backfillSessionCost', () => {
  beforeEach(() => { resetBackfillState(); });

  const ok = (body: unknown) => async () =>
    ({ ok: true, json: async () => body }) as unknown as Response;

  it('seeds the accumulator with the real session total', async () => {
    const totals = await backfillSessionCost(
      'sess-1', 'http://127.0.0.1:4096', '/work',
      { fetchImpl: ok([assistant('m1', 100.5, 1000, 200), assistant('m2', 102.18, 500, 100)]) },
    );
    expect(totals?.costUsd).toBeCloseTo(202.68, 2);
    expect(getTokenTotals('sess-1')?.costUsd).toBeCloseTo(202.68, 2);
  });

  it('does not re-add a backfilled message when it arrives live', async () => {
    await backfillSessionCost(
      'sess-live', 'http://127.0.0.1:4096', '/work',
      { fetchImpl: ok([assistant('m1', 100)]) },
    );
    // The same message now streams in through the normal event path.
    mapOpenCodeToEvent({
      event: 'message.updated',
      agentId: 'sess-live',
      payload: { properties: { info: { id: 'm1', role: 'assistant', cost: 100, tokens: { input: 0, output: 0 } } } },
    });
    expect(getTokenTotals('sess-live')?.costUsd).toBe(100);
  });

  it('adds messages that arrive after the backfill', async () => {
    await backfillSessionCost(
      'sess-add', 'http://127.0.0.1:4096', '/work',
      { fetchImpl: ok([assistant('m1', 100)]) },
    );
    mapOpenCodeToEvent({
      event: 'message.updated',
      agentId: 'sess-add',
      payload: { properties: { info: { id: 'm2', role: 'assistant', cost: 2.5, tokens: { input: 0, output: 0 } } } },
    });
    expect(getTokenTotals('sess-add')?.costUsd).toBeCloseTo(102.5, 2);
  });

  it('runs once per session', async () => {
    let calls = 0;
    const counting = async () => {
      calls++;
      return { ok: true, json: async () => [assistant('m1', 5)] } as unknown as Response;
    };
    await backfillSessionCost('sess-2', 'http://x', undefined, { fetchImpl: counting });
    await backfillSessionCost('sess-2', 'http://x', undefined, { fetchImpl: counting });
    expect(calls).toBe(1);
  });

  it('falls back to the alternate endpoint spelling', async () => {
    const tried: string[] = [];
    const picky = async (url: string | URL | Request) => {
      const href = String(url);
      tried.push(href);
      if (href.endsWith('/message')) return { ok: false, status: 404 } as unknown as Response;
      return { ok: true, json: async () => [assistant('m1', 9)] } as unknown as Response;
    };
    const totals = await backfillSessionCost('sess-3', 'http://x', undefined, { fetchImpl: picky as typeof fetch });
    expect(tried).toHaveLength(2);
    expect(totals?.costUsd).toBe(9);
  });

  it('leaves the accumulator alone when the server is unreachable', async () => {
    const boom = async () => { throw new Error('ECONNREFUSED'); };
    const totals = await backfillSessionCost('sess-4', 'http://x', undefined, { fetchImpl: boom as unknown as typeof fetch });
    expect(totals).toBeNull();
    expect(getTokenTotals('sess-4')).toBeNull();
  });

  it('does nothing without a serverUrl', async () => {
    expect(await backfillSessionCost('sess-5', undefined, undefined)).toBeNull();
  });
});
