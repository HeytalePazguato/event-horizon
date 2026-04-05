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
  StopFailure:         'agent.error',     // turn ended due to API error
  PreToolUse:          'tool.call',
  PostToolUse:         'tool.result',
  PostToolUseFailure:  'agent.error',
  TaskCreated:         'task.start',      // background task created
  TaskCompleted:       'task.complete',
  SubagentStart:       'task.start',
  SubagentStop:        'task.complete',
  TeammateIdle:        'agent.idle',
  Notification:        'message.receive',
  PermissionRequest:   'agent.waiting',
  PermissionDenied:    'agent.error',     // auto-mode classifier denied tool
  InstructionsLoaded:  'message.receive', // CLAUDE.md / rules loaded
  ConfigChange:        'message.receive', // config file changed
  CwdChanged:          'message.receive', // working directory changed
  FileChanged:         'message.receive', // watched file changed
  PreCompact:          'message.receive', // context compaction about to happen
  PostCompact:         'message.receive', // context compaction completed
  WorktreeCreate:      'message.receive', // worktree created (--worktree / isolation)
  WorktreeRemove:      'message.receive', // worktree removed (session exit / subagent done)
  Elicitation:         'agent.waiting',   // MCP server requests user input
  ElicitationResult:   'message.receive', // user responded to MCP elicitation
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
  if (hookEvent === 'Elicitation') {
    waitingSource = 'mcp_elicitation';
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

  // Pass transcript_path — the extension host uses it to start a transcript
  // watcher for richer events (waiting ring, per-turn tokens, tool details).
  // Available on SessionStart, Stop, and potentially other hooks.
  const tp = p.transcript_path ?? nested?.transcript_path;
  if (typeof tp === 'string') safePayload.transcriptPath = tp.slice(0, 1024);

  // Forward any direct cost/usage fields if the hook includes them (forward-compat)
  if (hookEvent === 'Stop') {
    if (typeof p.total_cost_usd === 'number') safePayload.costUsd = p.total_cost_usd;
    const usage = (p.usage as Record<string, unknown> | undefined);
    if (usage) {
      if (typeof usage.input_tokens === 'number') safePayload.inputTokens = usage.input_tokens;
      if (typeof usage.output_tokens === 'number') safePayload.outputTokens = usage.output_tokens;
    }
    // Richer telemetry: duration, turns, stop reason
    if (typeof p.duration_ms === 'number') safePayload.durationMs = p.duration_ms;
    if (typeof p.duration_api_ms === 'number') safePayload.durationApiMs = p.duration_api_ms;
    if (typeof p.num_turns === 'number') safePayload.numTurns = p.num_turns;
    if (typeof p.stop_reason === 'string') safePayload.stopReason = String(p.stop_reason).slice(0, 128);
    // Also check nested payload
    if (nested) {
      if (typeof nested.duration_ms === 'number' && !safePayload.durationMs) safePayload.durationMs = nested.duration_ms;
      if (typeof nested.duration_api_ms === 'number' && !safePayload.durationApiMs) safePayload.durationApiMs = nested.duration_api_ms;
      if (typeof nested.num_turns === 'number' && !safePayload.numTurns) safePayload.numTurns = nested.num_turns;
      if (typeof nested.stop_reason === 'string' && !safePayload.stopReason) safePayload.stopReason = String(nested.stop_reason).slice(0, 128);
    }
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

  // Enrich new hook types with relevant payload data
  if (hookEvent === 'CwdChanged') {
    const newCwd = p.new_cwd ?? nested?.new_cwd ?? p.cwd;
    if (typeof newCwd === 'string') safePayload.cwd = newCwd.slice(0, 512);
    safePayload.hookType = 'cwd_changed';
  }
  if (hookEvent === 'PostCompact') {
    const preTokens = p.pre_tokens ?? nested?.pre_tokens;
    const postTokens = p.post_tokens ?? nested?.post_tokens;
    if (typeof preTokens === 'number') safePayload.preTokens = preTokens;
    if (typeof postTokens === 'number') safePayload.postTokens = postTokens;
    safePayload.hookType = 'context_compaction';
  }
  if (hookEvent === 'PermissionDenied') {
    safePayload.hookType = 'permission_denied';
    if (p.tool_name) safePayload.deniedTool = String(p.tool_name).slice(0, 128);
    const reason = p.reason ?? nested?.reason;
    if (typeof reason === 'string') safePayload.deniedReason = reason.slice(0, 256);
    // Capture permission denials array if present
    const denials = p.permission_denials ?? nested?.permission_denials;
    if (Array.isArray(denials)) {
      safePayload.permissionDenials = denials.slice(0, 10).map((d: unknown) =>
        typeof d === 'string' ? d.slice(0, 128) : String(d).slice(0, 128),
      );
    }
  }
  if (hookEvent === 'StopFailure') {
    safePayload.hookType = 'stop_failure';
    const error = p.error ?? nested?.error;
    if (typeof error === 'string') safePayload.errorMessage = error.slice(0, 256);
  }
  if (hookEvent === 'FileChanged') {
    const filePath = p.file_path ?? nested?.file_path ?? p.filename;
    if (typeof filePath === 'string') safePayload.filePath = filePath.slice(0, 512);
    safePayload.hookType = 'file_changed';
  }
  if (hookEvent === 'TaskCreated') {
    safePayload.hookType = 'background_task';
    const taskId = p.task_id ?? nested?.task_id;
    if (typeof taskId === 'string') safePayload.taskId = taskId.slice(0, 128);
  }

  // Capture model name if present in payload (any hook)
  const model = p.model ?? nested?.model;
  if (typeof model === 'string') safePayload.modelName = model.slice(0, 128);

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
