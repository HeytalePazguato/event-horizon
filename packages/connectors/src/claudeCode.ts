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

  // Claude Code uses session_id; fall back to other id fields; clamp to prevent oversized strings
  const agentId = String(p.session_id ?? p.agentId ?? p.sessionId ?? 'claude-1').slice(0, 128);
  const agentName = String(p.agentName ?? 'Claude Code').slice(0, 64);

  const isSubagent = hookEvent === 'SubagentStart' || hookEvent === 'SubagentStop';
  const isToolFailure = hookEvent === 'PostToolUseFailure';

  // Whitelist specific payload fields to avoid leaking sensitive data (tool_input, file contents)
  const safePayload: Record<string, unknown> = {};
  if (p.tool_name) safePayload.toolName = String(p.tool_name).slice(0, 128);
  if (p.taskId) safePayload.taskId = String(p.taskId).slice(0, 128);
  if (isSubagent) safePayload.isSubagent = true;
  if (isToolFailure) safePayload.isToolFailure = true;
  // Capture working directory for workspace-aware cooperation detection
  if (p.cwd) safePayload.cwd = String(p.cwd).slice(0, 512);
  // Only include safe metadata from the nested payload object
  const nested = p.payload as Record<string, unknown> | undefined;
  if (nested) {
    if (nested.toolName) safePayload.toolName = String(nested.toolName).slice(0, 128);
    if (nested.taskId) safePayload.taskId = String(nested.taskId).slice(0, 128);
    if (nested.isSubagent) safePayload.isSubagent = true;
    if (nested.cwd) safePayload.cwd = String(nested.cwd).slice(0, 512);
  }

  return {
    id: nextId(),
    agentId,
    agentName,
    agentType: 'claude-code',
    type,
    timestamp: Number(p.timestamp) || Date.now(),
    payload: safePayload,
  };
}
