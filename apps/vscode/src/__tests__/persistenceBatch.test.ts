/**
 * Batch-insert behavior for EventHorizonDB.
 * Verifies the 250ms flush window coalesces queued inserts into a single
 * transaction and that flushSync drains pending events synchronously.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventHorizonDB } from '../persistence.js';
import type { AgentEvent } from '@event-horizon/core';

function makeEvent(i: number): AgentEvent {
  return {
    id: `evt-batch-${i}`,
    agentId: 'agent-batch',
    agentName: 'Batch Agent',
    agentType: 'claude-code',
    type: 'tool.call',
    timestamp: 1_700_000_000_000 + i,
    payload: { idx: i },
  };
}

describe('EventHorizonDB — batched inserts', () => {
  let db: EventHorizonDB;

  beforeEach(async () => {
    db = await EventHorizonDB.create();
  });

  afterEach(() => {
    vi.useRealTimers();
    db.close();
  });

  it('flushes 500 queued inserts after the 250ms window', async () => {
    vi.useFakeTimers();

    for (let i = 0; i < 500; i++) {
      db.queueInsert(makeEvent(i));
    }

    // Before the window elapses, nothing has been persisted yet.
    expect(db.getEventCount()).toBe(0);

    vi.advanceTimersByTime(300);

    expect(db.getEventCount()).toBe(500);
    const rows = db.queryEvents({ limit: 1000 });
    expect(rows).toHaveLength(500);
  });

  it('flushSync drains queued events without waiting for the timer', async () => {
    vi.useFakeTimers();

    for (let i = 0; i < 10; i++) {
      db.queueInsert(makeEvent(i));
    }
    expect(db.getEventCount()).toBe(0);

    db.flushSync();

    expect(db.getEventCount()).toBe(10);
    // Timer should have been cleared — advancing time shouldn't double-flush.
    vi.advanceTimersByTime(1000);
    expect(db.getEventCount()).toBe(10);
  });

  it('coalesces multiple queueInsert bursts into one flush per window', async () => {
    vi.useFakeTimers();

    db.queueInsert(makeEvent(0));
    vi.advanceTimersByTime(100);
    db.queueInsert(makeEvent(1));
    vi.advanceTimersByTime(100);
    db.queueInsert(makeEvent(2));

    // Still within the first 250ms window — no flush yet.
    expect(db.getEventCount()).toBe(0);

    vi.advanceTimersByTime(100); // cumulative 300ms

    expect(db.getEventCount()).toBe(3);
  });

  it('keeps the existing insertEvent API bypassing the queue', () => {
    db.insertEvent(makeEvent(42));
    // Immediate persistence — no timer advance needed.
    expect(db.getEventCount()).toBe(1);
  });
});
