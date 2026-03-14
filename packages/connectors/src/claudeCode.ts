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
  PermissionRequest:   'agent.waiting',
  InstructionsLoaded:  'message.receive', // CLAUDE.md / rules loaded
  ConfigChange:        'message.receive', // config file changed
  PreCompact:          'message.receive', // context compaction about to happen
  WorktreeCreate:      'message.receive', // worktree created (--worktree / isolation)
  WorktreeRemove:      'message.receive', // worktree removed (session exit / subagent done)
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

  let type = CLAUDE_HOOK_TO_EVENT[hookEvent];
  if (!type) return null;

  // Detect "waiting for user input" scenarios:
  //   PermissionRequest — fires before permission dialog (for ALL tools, including subagents).
  //     The webview filters by toolName to only show the waiting ring for AskUserQuestion.
  //   Notification(elicitation_dialog) — AskUserQuestion prompt (doesn't fire in practice).
  // NOTE: Notification(permission_prompt) is NOT used — it fires on the parent session
  // even for subagent permissions, causing false positive waiting rings.
  let waitingSource: string | null = null;
  if (hookEvent === 'Notification') {
    const notifType = p.notification_type
      ?? (p.payload as Record<string, unknown> | undefined)?.notification_type;
    if (notifType === 'elicitation_dialog') {
      type = 'agent.waiting';
      waitingSource = 'elicitation_dialog';
    }
    // NOTE: permission_prompt is NOT used here — it fires on the parent session
    // even for subagent permissions (GitHub #23983/#33473), causing false positives.
    // PermissionRequest (below) only fires on the main session, so it's reliable.
  }
  if (hookEvent === 'PermissionRequest') {
    waitingSource = 'permission_request';
  }

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
  if (waitingSource) safePayload.waitingSource = waitingSource;
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

  // Extract file_path from tool_input for file-touching tools (never content/strings)
  const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'MultiEdit', 'ReadFile', 'WriteFile']);
  const toolNameStr = safePayload.toolName as string | undefined;
  if (toolNameStr && FILE_TOOLS.has(toolNameStr)) {
    const toolInput = p.tool_input ?? nested?.tool_input;
    if (toolInput && typeof toolInput === 'object') {
      const fp = (toolInput as Record<string, unknown>).file_path;
      if (typeof fp === 'string') safePayload.filePath = fp.slice(0, 512);
    } else if (typeof toolInput === 'string') {
      try {
        const parsed = JSON.parse(toolInput);
        if (typeof parsed.file_path === 'string') safePayload.filePath = parsed.file_path.slice(0, 512);
      } catch { /* ignore non-JSON */ }
    }
  }

  // Extract skill metadata when the Skill tool is invoked
  if (toolNameStr === 'Skill') {
    safePayload.isSkill = true;
    const toolInput = p.tool_input ?? nested?.tool_input;
    if (toolInput && typeof toolInput === 'object') {
      const ti = toolInput as Record<string, unknown>;
      if (typeof ti.skill === 'string') safePayload.skillName = ti.skill.slice(0, 128);
      if (typeof ti.args === 'string') safePayload.skillArgs = ti.args.slice(0, 128);
    } else if (typeof toolInput === 'string') {
      try {
        const parsed = JSON.parse(toolInput);
        if (typeof parsed.skill === 'string') safePayload.skillName = parsed.skill.slice(0, 128);
        if (typeof parsed.args === 'string') safePayload.skillArgs = parsed.args.slice(0, 128);
      } catch { /* ignore non-JSON */ }
    }
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
