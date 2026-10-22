import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mapOpenCodeToEvent, mapClaudeHookToEvent } from '@event-horizon/connectors';
import type { AgentEvent } from '@event-horizon/core';
import { AgentLifecycleManager, type DeathSignal } from '../agentLifecycle.js';
import { classifyLifecycleEvent, applyLifecycleClassification } from '../lifecycleSignals.js';

const GRACE = 15_000;

function oc(event: string, payload: Record<string, unknown> = {}, agentId = 'w'): AgentEvent {
  const e = mapOpenCodeToEvent({ event, agentId, payload });
  if (!e) throw new Error(`${event} mapped to null`);
  return e;
}

describe('classifyLifecycleEvent', () => {
  it('treats a heartbeat session.created as no signal', () => {
    expect(classifyLifecycleEvent(oc('session.created', { heartbeat: true }))).toEqual({ kind: 'none' });
  });

  it.each(['session.execution.succeeded', 'session.execution.failed', 'session.idle'])('%s is a turn end', (name) => {
    expect(classifyLifecycleEvent(oc(name))).toMatchObject({ kind: 'turn-end', signal: 'opencode-session-idle' });
  });

  it('carries the interrupt reason through', () => {
    const c = classifyLifecycleEvent(oc('session.execution.interrupted', { reason: 'shutdown' }));
    expect(c).toEqual({ kind: 'turn-end', signal: 'opencode-session-idle', detail: { reason: 'shutdown' } });
  });

  it.each([
    oc('session.execution.started'),
    oc('tool.execute.before', { toolName: 'Bash' }),
    oc('session.status', { properties: { status: { type: 'busy' } } }),
  ])('real work counts as activity', (event) => {
    expect(classifyLifecycleEvent(event)).toEqual({ kind: 'activity' });
  });

  it('maps Claude TaskCompleted to work-complete', () => {
    const e = mapClaudeHookToEvent({ hook_event_name: 'TaskCompleted', session_id: 's' })!;
    expect(classifyLifecycleEvent(e)).toMatchObject({ kind: 'turn-end', signal: 'work-complete' });
  });
});

describe('lifecycle wiring', () => {
  let nonInteractive: Set<string>;
  let mgr: AgentLifecycleManager;
  let terminated: Array<[string, DeathSignal]>;

  beforeEach(() => {
    vi.useFakeTimers();
    nonInteractive = new Set();
    terminated = [];
    mgr = new AgentLifecycleManager({
      hasActiveTask: () => false,
      heartbeat: { getStatus: () => 'alive' as never },
      isProcessAlive: () => true,
      isSpawnedNonInteractive: (id) => nonInteractive.has(id),
      graceMs: GRACE,
    });
    mgr.onTerminate((id, reason) => terminated.push([id, reason]));
  });
  afterEach(() => {
    mgr.dispose();
    vi.useRealTimers();
  });

  it('retires a spawned non-interactive OpenCode worker after its turn ends, despite heartbeats', () => {
    nonInteractive.add('w');
    applyLifecycleClassification(mgr, oc('session.execution.started'));
    applyLifecycleClassification(mgr, oc('tool.execute.before', { toolName: 'Bash' }));
    applyLifecycleClassification(mgr, oc('session.execution.succeeded'));
    // Heartbeats keep arriving every 30s and must not cancel the quiet timer.
    vi.advanceTimersByTime(5_000);
    applyLifecycleClassification(mgr, oc('session.created', { heartbeat: true }));
    vi.advanceTimersByTime(GRACE - 5_000);
    expect(terminated).toEqual([['w', 'opencode-session-idle']]);
  });

  it('real activity after a turn end keeps the worker alive', () => {
    nonInteractive.add('w');
    applyLifecycleClassification(mgr, oc('session.execution.succeeded'));
    applyLifecycleClassification(mgr, oc('session.execution.started'));
    vi.advanceTimersByTime(GRACE * 2);
    expect(terminated).toEqual([]);
  });

  it('ignores shutdown interrupts', () => {
    nonInteractive.add('w');
    applyLifecycleClassification(mgr, oc('session.execution.interrupted', { reason: 'shutdown' }));
    vi.advanceTimersByTime(GRACE * 2);
    expect(terminated).toEqual([]);
  });

  it('never terminates an interactive Claude session idle for 10+ minutes', () => {
    const start = mapClaudeHookToEvent({ hook_event_name: 'UserPromptSubmit', session_id: 'c' })!;
    const done = mapClaudeHookToEvent({ hook_event_name: 'TaskCompleted', session_id: 'c' })!;
    const stop = mapClaudeHookToEvent({ hook_event_name: 'Stop', session_id: 'c' })!;
    applyLifecycleClassification(mgr, start);
    applyLifecycleClassification(mgr, done);
    applyLifecycleClassification(mgr, stop);
    vi.advanceTimersByTime(11 * 60_000);
    expect(terminated).toEqual([]);
    expect(mgr.isAlive('c')).toBe(true);
  });
});
