/**
 * Claude Code hooks adapter — maps Claude hook payloads to AgentEvent.
 * @event-horizon/connectors
 */

import type { AgentEvent, AgentEventType } from '@event-horizon/core';

const CLAUDE_HOOK_TO_EVENT: Record<string, AgentEventType> = {
  SessionStart:        'agent.spawn',
  SessionEnd:          'agent.terminate',
  UserPromptSubmit:    'task.start',      // prompt submitted = new task
  Stop:                'task.complete',   // Claude finished responding
  PreToolUse:          'tool.call',
  PostToolUse:         'tool.result',
  PostToolUseFailure:  'agent.error',
  TaskCompleted:       'task.complete',
  SubagentStart:       'task.start',
  SubagentStop:        'task.complete',
  TeammateIdle:        'agent.idle',
  Notification:        'message.receive',
};

function nextId(): string {
  return `ev-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function mapClaudeHookToEvent(payload: unknown): AgentEvent | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  // Claude Code sends hook_event_name; fallback to older field names for compatibility
  const hookEvent = p.hook_event_name ?? p.event ?? p.hook ?? p.type;
  if (typeof hookEvent !== 'string') return null;

  const type = CLAUDE_HOOK_TO_EVENT[hookEvent];
  if (!type) return null;

  // Claude Code uses session_id; fall back to other id fields
  const agentId = (p.session_id ?? p.agentId ?? p.sessionId ?? 'claude-1') as string;
  const agentName = (p.agentName ?? 'Claude Code') as string;

  // Extract token counts from usage fields Claude Code may provide
  const usage = p.usage as Record<string, number> | undefined;
  const inputTokens  = (usage?.input_tokens  ?? p.input_tokens  ?? 0) as number;
  const outputTokens = (usage?.output_tokens ?? p.output_tokens ?? 0) as number;

  return {
    id: nextId(),
    agentId: String(agentId),
    agentName: String(agentName),
    agentType: 'claude-code',
    type,
    timestamp: (p.timestamp as number) ?? Date.now(),
    payload: {
      ...((p.payload as Record<string, unknown>) ?? p),
      inputTokens,
      outputTokens,
      toolName: p.tool_name,
      toolInput: p.tool_input,
    },
  };
}

export function createClaudeCodeAdapter(): (payload: unknown) => AgentEvent | null {
  return mapClaudeHookToEvent;
}
