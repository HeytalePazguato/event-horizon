/**
 * CostLedger tests — cumulative (not additive) semantics, source precedence,
 * durability across terminate/reload, prune, and db-null mode.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventHorizonDB } from '../persistence.js';
import { CostLedger, type CostEntry } from '../costLedger.js';

function entry(overrides?: Partial<CostEntry>): CostEntry {
  return {
    agentId: 'a1',
    sessionId: 's1',
    source: 'statusline',
    costUsd: 1,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('CostLedger', () => {
  let db: EventHorizonDB;
  let ledger: CostLedger;

  beforeEach(async () => {
    db = await EventHorizonDB.create();
    ledger = new CostLedger(db);
  });

  afterEach(() => {
    db.close();
  });

  it('records and reads totals per agent and session', () => {
    ledger.record(entry({ costUsd: 0.5 }));
    expect(ledger.totalForAgent('a1')).toBeCloseTo(0.5);
    expect(ledger.totalForSession('s1')).toBeCloseTo(0.5);
    expect(ledger.allTotals().get('a1')).toBeCloseTo(0.5);
    expect(ledger.totalForAgent('nobody')).toBe(0);
    expect(ledger.totalForSession('nope')).toBe(0);
  });

  it('does not double-count cumulative samples', () => {
    const t = Date.now();
    ledger.record(entry({ costUsd: 1, timestamp: t }));
    ledger.record(entry({ costUsd: 2, timestamp: t + 1 }));
    ledger.record(entry({ costUsd: 3, timestamp: t + 2 }));
    expect(ledger.totalForAgent('a1')).toBeCloseTo(3);
    expect(ledger.totalForSession('s1')).toBeCloseTo(3);
  });

  it('ignores stale (older) samples and invalid costs', () => {
    const t = Date.now();
    ledger.record(entry({ costUsd: 5, timestamp: t }));
    ledger.record(entry({ costUsd: 1, timestamp: t - 100 }));
    ledger.record(entry({ costUsd: Number.NaN, timestamp: t + 1 }));
    ledger.record(entry({ costUsd: -2, timestamp: t + 2 }));
    expect(ledger.totalForAgent('a1')).toBeCloseTo(5);
  });

  it('sums across sessions of one agent', () => {
    ledger.record(entry({ sessionId: 's1', costUsd: 2 }));
    ledger.record(entry({ sessionId: 's2', costUsd: 3 }));
    expect(ledger.totalForAgent('a1')).toBeCloseTo(5);
    expect(ledger.totalForSession('s2')).toBeCloseTo(3);
  });

  it('applies source precedence otel > statusline > transcript-estimated', () => {
    const t = Date.now();
    ledger.record(entry({ source: 'transcript-estimated', costUsd: 9, timestamp: t }));
    expect(ledger.totalForAgent('a1')).toBeCloseTo(9);
    ledger.record(entry({ source: 'statusline', costUsd: 4, timestamp: t + 1 }));
    expect(ledger.totalForAgent('a1')).toBeCloseTo(4);
    ledger.record(entry({ source: 'otel', costUsd: 2, timestamp: t + 2 }));
    expect(ledger.totalForAgent('a1')).toBeCloseTo(2);
    // A later low-precedence sample never overrides or adds to otel.
    ledger.record(entry({ source: 'transcript-estimated', costUsd: 50, timestamp: t + 3 }));
    expect(ledger.totalForAgent('a1')).toBeCloseTo(2);
    expect(ledger.totalForSession('s1')).toBeCloseTo(2);
  });

  it('keeps cost after the owning agent terminates (no terminate API)', () => {
    ledger.record(entry({ costUsd: 1.25 }));
    expect((ledger as unknown as Record<string, unknown>)['clear']).toBeUndefined();
    expect((ledger as unknown as Record<string, unknown>)['terminate']).toBeUndefined();
    expect(ledger.totalForAgent('a1')).toBeCloseTo(1.25);
  });

  it('survives reload from the serialized DB', async () => {
    ledger.record(entry({ agentId: 'a1', sessionId: 's1', source: 'statusline', costUsd: 1.5, tokens: { input: 10, output: 5 } }));
    ledger.record(entry({ agentId: 'a1', sessionId: 's1', source: 'otel', costUsd: 1.2 }));
    ledger.record(entry({ agentId: 'a2', sessionId: 's9', costUsd: 7 }));

    const reloadedDb = await EventHorizonDB.create(db.save());
    try {
      const reloaded = new CostLedger(reloadedDb);
      expect(reloaded.totalForAgent('a1')).toBeCloseTo(1.2);
      expect(reloaded.totalForAgent('a2')).toBeCloseTo(7);
      expect(reloaded.totalForSession('s1')).toBeCloseTo(1.2);
      expect(reloaded.allTotals().size).toBe(2);
      // Further cumulative samples still replace, not add.
      reloaded.record(entry({ agentId: 'a2', sessionId: 's9', costUsd: 8, timestamp: Date.now() + 10 }));
      expect(reloaded.totalForAgent('a2')).toBeCloseTo(8);
    } finally {
      reloadedDb.close();
    }
  });

  it('prunes old samples and updates totals', () => {
    const now = Date.now();
    ledger.record(entry({ agentId: 'old', sessionId: 'so', costUsd: 3, timestamp: now - 10_000 }));
    ledger.record(entry({ agentId: 'new', sessionId: 'sn', costUsd: 4, timestamp: now }));
    expect(ledger.prune(5_000)).toBe(1);
    expect(ledger.totalForAgent('old')).toBe(0);
    expect(ledger.totalForSession('so')).toBe(0);
    expect(ledger.totalForAgent('new')).toBeCloseTo(4);
    expect(ledger.allTotals().has('old')).toBe(false);
  });

  it('works purely in memory when persistence is disabled (db null)', () => {
    const mem = new CostLedger(null);
    const t = Date.now() - 10_000;
    mem.record(entry({ costUsd: 1, timestamp: t }));
    mem.record(entry({ costUsd: 2, timestamp: t + 1 }));
    mem.record(entry({ source: 'otel', costUsd: 1.5, timestamp: t + 2 }));
    expect(mem.totalForAgent('a1')).toBeCloseTo(1.5);
    expect(mem.prune(5_000)).toBe(2); // statusline + otel rows
    expect(mem.allTotals().size).toBe(0);
  });
});
