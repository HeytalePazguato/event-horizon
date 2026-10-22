/**
 * Maps an incoming AgentEvent to what it means for the AgentLifecycleManager.
 * Connectors tag turn-end / activity events with `payload.lifecycleSignal`;
 * everything else is classified here. No `vscode` import (unit-testable).
 */

import type { AgentEvent } from '@event-horizon/core';
import type { AgentLifecycleManager, DeathSignal } from './agentLifecycle.js';

export type LifecycleClassification =
  | { kind: 'turn-end'; signal: 'work-complete' | 'opencode-session-idle'; detail: { reason?: string } }
  | { kind: 'activity' }
  | { kind: 'none' };

/** Event types that say nothing about the agent working (handled elsewhere or purely informational). */
const NON_ACTIVITY_TYPES: ReadonlySet<string> = new Set(['agent.spawn', 'agent.terminate', 'agent.idle', 'task.complete']);

/**
 * Only genuine work counts as activity. Heartbeats (the OpenCode plugin's 30s
 * `session.created` re-send, EH pings), watchdog/synthetic events and turn-end
 * events themselves must not cancel a pending quiet-period timer.
 */
export function classifyLifecycleEvent(event: AgentEvent): LifecycleClassification {
  const p = event.payload ?? {};
  const hint = p.lifecycleSignal;
  if (hint === 'work-complete' || hint === 'opencode-session-idle') {
    const reason = p.interruptReason;
    return { kind: 'turn-end', signal: hint, detail: typeof reason === 'string' ? { reason } : {} };
  }
  if (p.heartbeat === true || p.source === 'watchdog' || p.synthetic === true) return { kind: 'none' };
  if (hint === 'activity') return { kind: 'activity' };
  if (NON_ACTIVITY_TYPES.has(event.type)) return { kind: 'none' };
  return { kind: 'activity' };
}

/** Feed an event's lifecycle meaning to the manager. A turn end never cancels its own timer. */
export function applyLifecycleClassification(manager: AgentLifecycleManager, event: AgentEvent): void {
  const c = classifyLifecycleEvent(event);
  if (c.kind === 'turn-end') manager.registerSignal(event.agentId, c.signal as DeathSignal, c.detail);
  else if (c.kind === 'activity') manager.registerSignal(event.agentId, 'activity');
}
