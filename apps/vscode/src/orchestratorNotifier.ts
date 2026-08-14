/**
 * Orchestrator notifier — pushes worker error / task.fail events to the
 * orchestrator agent of each active plan so they can react (retry, reassign,
 * take over). Skips self-notifications so an orchestrator's own errors don't
 * loop back into its inbox.
 *
 * Two filters keep this from becoming inbox noise:
 *   - Tool-level failures are ignored. Connectors map PostToolUseFailure to
 *     agent.error, so a grep with no match or a non-zero Bash exit would
 *     otherwise ping the orchestrator on every miss. Those are routine agent
 *     work, not something an orchestrator can act on.
 *   - Identical failures are suppressed for a cooldown window, so a worker
 *     stuck in a retry loop reports once instead of once per attempt.
 */

import type { AgentEvent } from '@event-horizon/core';
import type { PlanBoard } from './planBoard.js';
import type { SendOptions } from './messageQueue.js';

export interface MessageSender {
  send(
    fromAgentId: string,
    fromAgentName: string,
    toAgentId: string,
    content: string,
    options?: SendOptions,
  ): unknown;
}

export interface NotifyOptions {
  /**
   * Per-key timestamp of the last notice sent. Owned by the caller so the
   * function stays pure and testable. Omit to disable suppression.
   */
  recent?: Map<string, number>;
  /** How long an identical failure stays suppressed. Default 60s. */
  cooldownMs?: number;
  /** Injectable clock for tests. */
  now?: number;
}

export interface NotifyResult {
  notified: string[];
  body: string | null;
  /** Why nothing was sent, when the event was a failure but got filtered. */
  skipped?: 'tool-failure' | 'cooldown';
}

/** Default suppression window for repeats of the same failure. */
export const NOTIFY_COOLDOWN_MS = 60_000;

/**
 * If the event is an error that orchestrators should know about, send a
 * notification message to each active plan's orchestrator. Returns the list
 * of orchestrator agent IDs that were notified (useful for tests).
 */
export function notifyOrchestratorsOfFailure(
  event: AgentEvent,
  plans: PlanBoard[],
  queue: MessageSender,
  options: NotifyOptions = {},
): NotifyResult {
  if (event.type !== 'agent.error' && event.type !== 'task.fail') {
    return { notified: [], body: null };
  }

  const payload = event.payload as Record<string, unknown> | undefined;

  // Routine tool errors are the agent's own business — not an escalation.
  if (payload?.isToolFailure === true) {
    return { notified: [], body: null, skipped: 'tool-failure' };
  }

  const reason = String(
    payload?.message
    ?? payload?.error
    ?? payload?.reason
    ?? payload?.note
    ?? 'unknown error',
  ).slice(0, 300);
  const taskId = typeof payload?.taskId === 'string' ? payload.taskId : undefined;
  const who = event.agentName ?? event.agentId;
  const verb = event.type === 'agent.error' ? 'reported an error' : 'failed a task';
  const body = `⚠️ Worker ${who} ${verb}${taskId ? ` on task ${taskId}` : ''}: ${reason}. Consider eh_retry_task (escalates model tier) or eh_reassign_task.`;

  const recent = options.recent;
  const cooldownMs = options.cooldownMs ?? NOTIFY_COOLDOWN_MS;
  const now = options.now ?? Date.now();

  const notified = new Set<string>();
  let suppressed = false;

  for (const plan of plans) {
    if (plan.status !== 'active') continue;
    const orch = plan.orchestratorAgentId;
    if (!orch) continue;
    if (orch === event.agentId) continue; // self-notification would loop
    if (notified.has(orch)) continue;     // don't duplicate if orch manages multiple plans

    if (recent) {
      const key = `${orch}|${event.agentId}|${taskId ?? ''}|${reason}`;
      const last = recent.get(key);
      if (last !== undefined && now - last < cooldownMs) {
        suppressed = true;
        continue;
      }
      recent.set(key, now);
      pruneExpired(recent, now, cooldownMs);
    }

    notified.add(orch);
    queue.send('event-horizon', 'Event Horizon', orch, body);
  }

  if (notified.size === 0 && suppressed) {
    return { notified: [], body, skipped: 'cooldown' };
  }
  return { notified: [...notified], body };
}

/** Drop dedupe entries older than the cooldown so the map can't grow forever. */
function pruneExpired(recent: Map<string, number>, now: number, cooldownMs: number): void {
  if (recent.size < 200) return;
  for (const [key, ts] of recent) {
    if (now - ts >= cooldownMs) recent.delete(key);
  }
}
