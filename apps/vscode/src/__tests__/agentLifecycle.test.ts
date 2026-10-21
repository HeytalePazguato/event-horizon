import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentLifecycleManager, type DeathSignal } from '../agentLifecycle.js';

const GRACE = 15_000;

interface Harness {
  mgr: AgentLifecycleManager;
  terminated: Array<[string, DeathSignal]>;
  activeTasks: Set<string>;
  nonInteractive: Set<string>;
  alive: Set<string>;
  hbStatus: Map<string, string>;
  known: string[];
}

function setup(): Harness {
  const activeTasks = new Set<string>();
  const nonInteractive = new Set<string>();
  const alive = new Set<string>();
  const hbStatus = new Map<string, string>();
  const known: string[] = [];
  const mgr = new AgentLifecycleManager({
    hasActiveTask: (id) => activeTasks.has(id),
    heartbeat: { getStatus: (id) => (hbStatus.get(id) ?? 'alive') as never },
    knownAgentIds: () => known,
    isProcessAlive: (id) => alive.has(id),
    isSpawnedNonInteractive: (id) => nonInteractive.has(id),
    graceMs: GRACE,
  });
  const terminated: Array<[string, DeathSignal]> = [];
  mgr.onTerminate((id, reason) => terminated.push([id, reason]));
  return { mgr, terminated, activeTasks, nonInteractive, alive, hbStatus, known };
}

describe('AgentLifecycleManager', () => {
  let h: Harness;
  beforeEach(() => {
    vi.useFakeTimers();
    h = setup();
  });
  afterEach(() => {
    h.mgr.dispose();
    vi.useRealTimers();
  });

  it.each(['process-exit', 'terminal-closed', 'session-end', 'opencode-session-deleted', 'user-purge'] as const)(
    'immediate signal %s terminates at once',
    (signal) => {
      h.mgr.registerSignal('a', signal);
      expect(h.terminated).toEqual([['a', signal]]);
      expect(h.mgr.isAlive('a')).toBe(false);
    },
  );

  it.each(['work-complete', 'opencode-session-idle'] as const)(
    '%s retires a spawned non-interactive agent only after the grace period',
    (signal) => {
      h.nonInteractive.add('w');
      h.mgr.registerSignal('w', signal);
      vi.advanceTimersByTime(GRACE - 1);
      expect(h.terminated).toEqual([]);
      expect(h.mgr.isAlive('w')).toBe(true);
      vi.advanceTimersByTime(1);
      expect(h.terminated).toEqual([['w', signal]]);
    },
  );

  it('activity during the grace period cancels termination', () => {
    h.nonInteractive.add('w');
    h.mgr.registerSignal('w', 'opencode-session-idle');
    vi.advanceTimersByTime(GRACE / 2);
    h.mgr.registerSignal('w', 'activity');
    vi.advanceTimersByTime(GRACE * 2);
    expect(h.terminated).toEqual([]);
    expect(h.mgr.isAlive('w')).toBe(true);
  });

  it('a task claimed during the grace period prevents termination (re-check)', () => {
    h.nonInteractive.add('w');
    h.mgr.registerSignal('w', 'work-complete');
    vi.advanceTimersByTime(GRACE / 2);
    h.activeTasks.add('w');
    vi.advanceTimersByTime(GRACE);
    expect(h.terminated).toEqual([]);
    expect(h.mgr.isAlive('w')).toBe(true);
  });

  it('interactive / user-started agents are never terminated by turn-end', () => {
    h.mgr.registerSignal('i', 'opencode-session-idle');
    h.mgr.registerSignal('i', 'work-complete');
    vi.advanceTimersByTime(GRACE * 10);
    expect(h.terminated).toEqual([]);
    expect(h.mgr.isAlive('i')).toBe(true);
  });

  it('an agent holding an active task is not terminated by turn-end', () => {
    h.nonInteractive.add('w');
    h.activeTasks.add('w');
    h.mgr.registerSignal('w', 'work-complete');
    vi.advanceTimersByTime(GRACE * 2);
    expect(h.terminated).toEqual([]);
  });

  it.each(['shutdown', 'inactivity'])('interrupt reason %s is ignored', (reason) => {
    h.nonInteractive.add('w');
    h.mgr.registerSignal('w', 'opencode-session-idle', { reason });
    vi.advanceTimersByTime(GRACE * 2);
    expect(h.terminated).toEqual([]);
    expect(h.mgr.isAlive('w')).toBe(true);
  });

  it('other interrupt reasons still start the grace period', () => {
    h.nonInteractive.add('w');
    h.mgr.registerSignal('w', 'opencode-session-idle', { reason: 'user' });
    vi.advanceTimersByTime(GRACE);
    expect(h.terminated).toHaveLength(1);
  });

  it('heartbeat-lost alone never terminates, but purgeStale does when still lost and process dead', () => {
    h.hbStatus.set('a', 'lost');
    h.mgr.registerSignal('a', 'heartbeat-lost');
    vi.advanceTimersByTime(GRACE * 100);
    expect(h.terminated).toEqual([]);
    expect(h.mgr.isAlive('a')).toBe(true);
    expect(h.mgr.purgeStale()).toEqual(['a']);
    expect(h.terminated).toEqual([['a', 'heartbeat-lost']]);
    expect(h.mgr.isAlive('a')).toBe(false);
  });

  it('purgeStale skips agents whose heartbeat recovered', () => {
    h.hbStatus.set('a', 'lost');
    h.mgr.registerSignal('a', 'heartbeat-lost');
    h.hbStatus.set('a', 'alive');
    expect(h.mgr.purgeStale()).toEqual([]);
    // No longer a candidate even if it goes lost again without a new signal.
    h.hbStatus.set('a', 'lost');
    expect(h.mgr.purgeStale()).toEqual([]);
    expect(h.mgr.isAlive('a')).toBe(true);
  });

  it('purgeStale skips agents whose process is alive', () => {
    h.hbStatus.set('a', 'lost');
    h.alive.add('a');
    h.mgr.registerSignal('a', 'heartbeat-lost');
    expect(h.mgr.purgeStale()).toEqual([]);
    expect(h.mgr.isAlive('a')).toBe(true);
    h.alive.delete('a');
    expect(h.mgr.purgeStale()).toEqual(['a']);
  });

  it('explicit purge with includeStale also terminates stale or lost agents with a dead process', () => {
    h.known.push('stale-dead', 'lost-dead', 'stale-alive', 'healthy', 'stale-but-terminated');
    h.hbStatus.set('stale-dead', 'stale');
    h.hbStatus.set('lost-dead', 'lost');
    h.hbStatus.set('stale-alive', 'stale');
    h.alive.add('stale-alive');
    h.hbStatus.set('stale-but-terminated', 'stale');
    h.mgr.registerSignal('stale-but-terminated', 'session-end');
    h.terminated.length = 0;
    expect(h.mgr.purgeStale({ includeStale: true }).sort()).toEqual(['lost-dead', 'stale-dead']);
    expect(h.terminated.sort()).toEqual([
      ['lost-dead', 'heartbeat-lost'],
      ['stale-dead', 'heartbeat-lost'],
    ]);
    expect(h.mgr.isAlive('stale-alive')).toBe(true);
    expect(h.mgr.isAlive('healthy')).toBe(true);
  });

  it('default purgeStale ignores stale agents that were never signalled', () => {
    h.known.push('stale-dead');
    h.hbStatus.set('stale-dead', 'stale');
    expect(h.mgr.purgeStale()).toEqual([]);
    expect(h.mgr.isAlive('stale-dead')).toBe(true);
  });

  it('activity clears heartbeat-lost eligibility', () => {
    h.hbStatus.set('a', 'lost');
    h.mgr.registerSignal('a', 'heartbeat-lost');
    h.mgr.registerSignal('a', 'activity');
    expect(h.mgr.purgeStale()).toEqual([]);
  });

  it('duplicate signals fire onTerminate exactly once', () => {
    h.mgr.registerSignal('a', 'process-exit');
    h.mgr.registerSignal('a', 'process-exit');
    h.mgr.registerSignal('a', 'session-end');
    h.mgr.registerSignal('a', 'user-purge');
    expect(h.terminated).toEqual([['a', 'process-exit']]);
  });

  it('a pending grace timer firing after an immediate kill does not double-terminate', () => {
    h.nonInteractive.add('w');
    h.mgr.registerSignal('w', 'work-complete');
    h.mgr.registerSignal('w', 'process-exit');
    vi.advanceTimersByTime(GRACE * 2);
    expect(h.terminated).toEqual([['w', 'process-exit']]);
  });

  it('isAlive flips only after termination; unknown agents are alive', () => {
    expect(h.mgr.isAlive('never-seen')).toBe(true);
    h.nonInteractive.add('w');
    h.mgr.registerSignal('w', 'work-complete');
    expect(h.mgr.isAlive('w')).toBe(true);
    vi.advanceTimersByTime(GRACE);
    expect(h.mgr.isAlive('w')).toBe(false);
  });

  it('revive() makes a terminated agent alive and terminable again', () => {
    h.mgr.registerSignal('a', 'session-end');
    expect(h.mgr.isAlive('a')).toBe(false);
    h.mgr.revive('a');
    expect(h.mgr.isAlive('a')).toBe(true);
    h.mgr.registerSignal('a', 'session-end');
    expect(h.terminated).toEqual([
      ['a', 'session-end'],
      ['a', 'session-end'],
    ]);
    expect(h.mgr.isAlive('a')).toBe(false);
  });

  it('dispose() clears pending timers', () => {
    h.nonInteractive.add('w');
    h.mgr.registerSignal('w', 'work-complete');
    expect(vi.getTimerCount()).toBe(1);
    h.mgr.dispose();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(GRACE * 2);
    expect(h.terminated).toEqual([]);
  });

  it('a failing subscriber does not block the others', () => {
    const seen: string[] = [];
    h.mgr.onTerminate(() => {
      throw new Error('boom');
    });
    h.mgr.onTerminate((id) => seen.push(id));
    h.mgr.registerSignal('a', 'process-exit');
    expect(seen).toEqual(['a']);
  });

  it('idle-session regression: a 10-minute-silent interactive agent with no process exit stays alive', () => {
    h.hbStatus.set('i', 'lost');
    h.mgr.registerSignal('i', 'opencode-session-idle');
    h.mgr.registerSignal('i', 'heartbeat-lost');
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(h.mgr.isAlive('i')).toBe(true);
    expect(h.terminated).toEqual([]);
  });
});
