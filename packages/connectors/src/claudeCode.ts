/**
 * Claude Code hooks adapter — maps Claude hook payloads to AgentEvent.
 * @event-horizon/connectors
 */

import type { AgentEvent, AgentEventType } from '@event-horizon/core';

const CLAUDE_HOOK_TO_EVENT: Record<string, AgentEventType> = {
  SessionStart: 'agent.spawn',
  SessionEnd: 'agent.terminate',
  UserPromptSubmit: 'message.send',
  PreToolUse: 'tool.call',
  PostToolUse: 'tool.result',
  PostToolUseFailure: 'tool.result',
  TaskCompleted: 'task.complete',
  SubagentStart: 'task.start',
  SubagentStop: 'task.complete',
  TeammateIdle: 'agent.idle',
  Notification: 'message.receive',
};

function nextId(): string {
  return `ev-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function mapClaudeHookToEvent(payload: unknown): AgentEvent | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  const hookEvent = p.event ?? p.hook ?? p.type;
  if (typeof hookEvent !== 'string') return null;

  const type = CLAUDE_HOOK_TO_EVENT[hookEvent];
  if (!type) return null;

  const agentId = (p.agentId ?? p.sessionId ?? 'claude-1') as string;
  const agentName = (p.agentName ?? 'Claude Code') as string;

  return {
    id: nextId(),
    agentId: String(agentId),
    agentName: String(agentName),
    agentType: 'claude-code',
    type,
    timestamp: (p.timestamp as number) ?? Date.now(),
    payload: (p.payload as Record<string, unknown>) ?? (p.data as Record<string, unknown>) ?? p,
  };
}

export function createClaudeCodeAdapter(): (payload: unknown) => AgentEvent | null {
  return mapClaudeHookToEvent;
}
