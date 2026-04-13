/**
 * Orchestrator notifier — pushes worker error / task.fail events to the
 * orchestrator agent of each active plan so they can react (retry, reassign,
 * take over). Skips self-notifications so an orchestrator's own errors don't
 * loop back into its inbox.
 */

import type { AgentEvent } from '@event-horizon/core';
import type { PlanBoard } from './planBoard.js';

export interface MessageSender {
  send(fromAgentId: string, fromAgentName: string, toAgentId: string, content: string): unknown;
}

export interface NotifyResult {
  notified: string[];
  body: string | null;
}

/**
 * If the event is an error that orchestrators should know about, send a
 * notification message to each active plan's orchestrator. Returns the list
 * of orchestrator agent IDs that were notified (useful for tests).
 */
export function notifyOrchestratorsOfFailure(
  event: AgentEvent,
  plans: PlanBoard[],
  queue: MessageSender,
): NotifyResult {
  if (event.type !== 'agent.error' && event.type !== 'task.fail') {
    return { notified: [], body: null };
  }

  const payload = event.payload as Record<string, unknown> | undefined;
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
  const body = `\u26A0\uFE0F Worker ${who} ${verb}${taskId ? ` on task ${taskId}` : ''}: ${reason}. Consider eh_retry_task (escalates model tier) or eh_reassign_task.`;

  const notified = new Set<string>();
  for (const plan of plans) {
    if (plan.status !== 'active') continue;
    const orch = plan.orchestratorAgentId;
    if (!orch) continue;
    if (orch === event.agentId) continue; // self-notification would loop
    if (notified.has(orch)) continue;     // don't duplicate if orch manages multiple plans
    notified.add(orch);
    queue.send('event-horizon', 'Event Horizon', orch, body);
  }

  return { notified: [...notified], body };
}
