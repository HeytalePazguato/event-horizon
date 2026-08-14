/**
 * LockManager unit tests.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LockManager } from '../lockManager.js';

let lm: LockManager;

beforeEach(() => {
  lm = new LockManager(100); // 100ms TTL for fast tests
  lm.setEnabled(true);
});

describe('acquire and release', () => {
  it('acquires a lock on a free file', () => {
    const result = lm.acquire('src/index.ts', 'agent-a', 'Agent A');
    expect(result.allowed).toBe(true);
  });

  it('same agent can re-acquire (refresh)', () => {
    lm.acquire('src/index.ts', 'agent-a', 'Agent A');
    const result = lm.acquire('src/index.ts', 'agent-a', 'Agent A');
    expect(result.allowed).toBe(true);
  });

  it('different agent is blocked', () => {
    lm.acquire('src/index.ts', 'agent-a', 'Agent A');
    const result = lm.acquire('src/index.ts', 'agent-b', 'Agent B');
    expect(result.allowed).toBe(false);
    expect(result.owner).toBe('Agent A');
  });

  it('release allows another agent to acquire', () => {
    lm.acquire('src/index.ts', 'agent-a', 'Agent A');
    lm.release('src/index.ts', 'agent-a');
    const result = lm.acquire('src/index.ts', 'agent-b', 'Agent B');
    expect(result.allowed).toBe(true);
  });

  it('releaseAll clears all locks for an agent', () => {
    lm.acquire('src/a.ts', 'agent-a', 'Agent A');
    lm.acquire('src/b.ts', 'agent-a', 'Agent A');
    lm.releaseAll('agent-a');
    expect(lm.acquire('src/a.ts', 'agent-b', 'B').allowed).toBe(true);
    expect(lm.acquire('src/b.ts', 'agent-b', 'B').allowed).toBe(true);
  });
});

describe('query (read check)', () => {
  it('returns allowed when no lock exists', () => {
    expect(lm.query('src/index.ts', 'agent-b').allowed).toBe(true);
  });

  it('returns allowed for the lock owner', () => {
    lm.acquire('src/index.ts', 'agent-a', 'Agent A');
    expect(lm.query('src/index.ts', 'agent-a').allowed).toBe(true);
  });

  it('returns blocked for a different agent', () => {
    lm.acquire('src/index.ts', 'agent-a', 'Agent A');
    const result = lm.query('src/index.ts', 'agent-b');
    expect(result.allowed).toBe(false);
    expect(result.owner).toBe('Agent A');
  });
});

describe('TTL expiry', () => {
  it('lock expires after TTL', async () => {
    lm.acquire('src/index.ts', 'agent-a', 'Agent A');
    await new Promise((r) => setTimeout(r, 150));
    const result = lm.acquire('src/index.ts', 'agent-b', 'Agent B');
    expect(result.allowed).toBe(true);
  });
});

describe('waitForUnlock', () => {
  it('returns immediately if file is free', async () => {
    const result = await lm.waitForUnlock('src/index.ts', 'agent-b', 'Agent B', 1000);
    expect(result.allowed).toBe(true);
  });

  it('waits and acquires after release', async () => {
    lm.acquire('src/index.ts', 'agent-a', 'Agent A');
    const promise = lm.waitForUnlock('src/index.ts', 'agent-b', 'Agent B', 5000);
    setTimeout(() => lm.release('src/index.ts', 'agent-a'), 50);
    const result = await promise;
    expect(result.allowed).toBe(true);
  });

  it('times out if lock is never released', async () => {
    // A TTL longer than the wait keeps the lock held for the whole test. The
    // previous version refreshed a 100ms lock from a 50ms setInterval, which
    // let the lock lapse whenever a loaded event loop delayed a tick — the
    // waiter then acquired the lock and the assertion flipped.
    const held = new LockManager(60_000);
    held.setEnabled(true);
    held.acquire('src/index.ts', 'agent-a', 'Agent A');

    const result = await held.waitForUnlock('src/index.ts', 'agent-b', 'Agent B', 200);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Timeout');
  });
});

describe('enabled/disabled', () => {
  it('allows everything when disabled', () => {
    lm.setEnabled(false);
    lm.acquire('src/index.ts', 'agent-a', 'Agent A');
    const result = lm.acquire('src/index.ts', 'agent-b', 'Agent B');
    expect(result.allowed).toBe(true);
  });

  it('clears locks when disabled', () => {
    lm.acquire('src/index.ts', 'agent-a', 'Agent A');
    lm.setEnabled(false);
    expect(lm.getActiveLocks()).toHaveLength(0);
  });
});

describe('path normalization', () => {
  it('treats backslashes and forward slashes as equivalent', () => {
    lm.acquire('src\\index.ts', 'agent-a', 'Agent A');
    const result = lm.acquire('src/index.ts', 'agent-b', 'Agent B');
    expect(result.allowed).toBe(false);
  });

  it('is case-insensitive', () => {
    lm.acquire('SRC/Index.ts', 'agent-a', 'Agent A');
    const result = lm.acquire('src/index.ts', 'agent-b', 'Agent B');
    expect(result.allowed).toBe(false);
  });
});

describe('reason tracking', () => {
  it('stores and returns reason', () => {
    lm.acquire('src/index.ts', 'agent-a', 'Agent A', 'Refactoring auth');
    const result = lm.acquire('src/index.ts', 'agent-b', 'Agent B');
    expect(result.reason).toBe('Refactoring auth');
  });
});
