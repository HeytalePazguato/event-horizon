/**
 * CostTracker tests — resolver + ledger composition, budget deltas, eviction,
 * late DB attach, and payload extraction.
 */

import { describe, it, expect } from 'vitest';
import type { AgentEvent } from '@event-horizon/core';
import { CostTracker, costSampleFromEvent } from '../costTracker.js';
import { CostLedger } from '../costLedger.js';
import { EventHorizonDB } from '../persistence.js';

function ev(agentId: string, payload: Record<string, unknown>, timestamp = Date.now()): AgentEvent {
  return { id: `e-${Math.random()}`, agentId, agentName: agentId, agentType: 'claude-code', type: 'agent.idle', timestamp, payload };
}

describe('CostTracker', () => {
  it('returns the agent total and a delta, not the cumulative value, per sample', () => {
    const t = new CostTracker();
    const now = Date.now();
    const a = t.record({ agentId: 'a', sessionId: 'a', source: 'statusline', costUsd: 1, timestamp: now });
    const b = t.record({ agentId: 'a', sessionId: 'a', source: 'statusline', costUsd: 1.5, timestamp: now + 1 });
    expect(a).toMatchObject({ totalUsd: 1, deltaUsd: 1, estimated: false });
    expect(b).toMatchObject({ totalUsd: 1.5, deltaUsd: 0.5 });
  });

  it('sums of deltas equal the final total (budget stays in step with the ledger)', () => {
    const t = new CostTracker();
    const now = Date.now();
    let budget = 0;
    for (const [i, cost] of [0.2, 0.9, 1.4, 3.1].entries()) {
      budget += t.record({ agentId: 'a', sessionId: 'a', source: 'transcript-estimated', costUsd: cost, timestamp: now + i })!.deltaUsd;
    }
    expect(budget).toBeCloseTo(3.1);
  });

  it('a measured source replacing a higher estimate yields a negative delta', () => {
    const t = new CostTracker();
    const now = Date.now();
    t.record({ agentId: 'a', sessionId: 'a', source: 'transcript-estimated', costUsd: 5, timestamp: now });
    const u = t.record({ agentId: 'a', sessionId: 'a', source: 'otel', costUsd: 4, timestamp: now + 1 })!;
    expect(u).toMatchObject({ totalUsd: 4, deltaUsd: -1, source: 'otel', estimated: false });
  });

  it('flags estimated when only the transcript estimate exists', () => {
    const t = new CostTracker();
    const u = t.record({ agentId: 'a', sessionId: 'a', source: 'transcript-estimated', costUsd: 2, timestamp: Date.now() })!;
    expect(u.estimated).toBe(true);
  });

  it('eviction clears the live figure but keeps the spend in the grand total', () => {
    const t = new CostTracker();
    t.record({ agentId: 'a', sessionId: 'a', source: 'otel', costUsd: 2, timestamp: Date.now() });
    t.record({ agentId: 'b', sessionId: 'b', source: 'otel', costUsd: 3, timestamp: Date.now() });
    t.evict('a');
    expect(t.resolver.resolve('a')).toBeNull();
    expect(t.ledger.totalForAgent('a')).toBe(2);
    expect(t.grandTotal()).toBe(5);
  });

  it('ignores invalid costs', () => {
    const t = new CostTracker();
    expect(t.record({ agentId: 'a', source: 'otel', costUsd: -1, timestamp: Date.now() })).toBeNull();
    expect(t.record({ agentId: 'a', source: 'otel', costUsd: Number.NaN, timestamp: Date.now() })).toBeNull();
  });
});

describe('CostLedger.attach', () => {
  it('writes samples recorded before the DB opened and loads persisted ones', async () => {
    const db = await EventHorizonDB.create();
    try {
      const earlier = new CostLedger(db);
      earlier.record({ agentId: 'old', sessionId: 'old', source: 'otel', costUsd: 7, timestamp: 1 });

      const ledger = new CostLedger(null);
      ledger.record({ agentId: 'new', sessionId: 'new', source: 'statusline', costUsd: 1.25, timestamp: Date.now() });
      ledger.attach(db);
      expect(ledger.totalForAgent('old')).toBe(7);
      expect(ledger.totalForAgent('new')).toBe(1.25);

      const reloaded = new CostLedger(db);
      expect(reloaded.totalForAgent('new')).toBe(1.25);
    } finally {
      db.close();
    }
  });
});

describe('costSampleFromEvent', () => {
  it('returns null without a numeric costUsd', () => {
    expect(costSampleFromEvent(ev('a', {}))).toBeNull();
    expect(costSampleFromEvent(ev('a', { costUsd: '1' }))).toBeNull();
  });

  it('keeps a known source tag and the unpriced flag', () => {
    const s = costSampleFromEvent(ev('a', { costUsd: 1, costSource: 'transcript-estimated', costUnpriced: true }))!;
    expect(s).toMatchObject({ source: 'transcript-estimated', unpriced: true, sessionId: 'a' });
  });

  it('defaults untagged producers to agent-reported', () => {
    expect(costSampleFromEvent(ev('a', { costUsd: 1 }))!.source).toBe('agent-reported');
    expect(costSampleFromEvent(ev('a', { costUsd: 1, costSource: 'made-up' }))!.source).toBe('agent-reported');
  });

  it('keys the session by agent id, not runtime-internal session ids', () => {
    expect(costSampleFromEvent(ev('agent-1', { costUsd: 1, sessionId: 'child-9' }))!.sessionId).toBe('agent-1');
  });
});
