/**
 * GitHub Copilot adapter — maps hook payloads to AgentEvent.
 *
 * Hooks are installed in .github/hooks/event-horizon.json in the workspace.
 * Payloads arrive as JSON via stdin with snake_case fields:
 *   hook_event_name, session_id, tool_name, agent_id, agent_type,
 *   prompt, cwd, transcript_path, tool_use_id, stop_hook_active, source
 *
 * @event-horizon/connectors
 */

import type { AgentEvent, AgentEventType } from '@event-horizon/core';

/** Map hook event names to AgentEvent types. */
const COPILOT_HOOK_TO_EVENT: Record<string, AgentEventType> = {
  SessionStart:        'agent.spawn',
  SessionEnd:          'agent.terminate', // never fires as of March 2026 — kept for future compat
  Stop:                'agent.idle',      // fires per-turn, NOT session end
  UserPromptSubmit:    'task.start',
  PreToolUse:          'tool.call',
  PostToolUse:         'tool.result',
  PostToolUseFailure:  'agent.error',
  SubagentStart:       'task.start',
  SubagentStop:        'task.complete',
  TaskCompleted:       'task.complete',
  TeammateIdle:        'agent.idle',
  PermissionRequest:   'agent.waiting',
  Notification:        'message.receive',
};

function nextId(): string {
  return `ev-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Maps a Copilot hook JSON payload to an AgentEvent.
 *
 * SubagentStart/SubagentStop use the subagent's session_id (not the parent's).
 * The extension host is responsible for remapping subagent events to the parent.
 */
export function mapCopilotHookToEvent(payload: unknown): AgentEvent | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;

  const hookEvent = String(p.hook_event_name ?? '');
  if (!hookEvent) return null;

  const type = COPILOT_HOOK_TO_EVENT[hookEvent];
  if (!type) return null;

  const agentId = String(p.session_id ?? 'copilot-1').slice(0, 128);
  const agentName = 'GitHub Copilot';

  const isSubagent = hookEvent === 'SubagentStart' || hookEvent === 'SubagentStop';

  const safePayload: Record<string, unknown> = {};
  if (p.tool_name) safePayload.toolName = String(p.tool_name).slice(0, 128);
  if (p.cwd) safePayload.cwd = String(p.cwd).slice(0, 512);
  if (p.prompt) safePayload.prompt = String(p.prompt).slice(0, 200);
  if (isSubagent) {
    safePayload.isSubagent = true;
    if (p.agent_id) safePayload.subagentSessionId = String(p.session_id).slice(0, 128);
    if (p.agent_id) safePayload.subagentId = String(p.agent_id).slice(0, 128);
    if (p.agent_type) safePayload.subagentType = String(p.agent_type).slice(0, 128);
  }

  // Pass transcript_path for Stop events (same as Claude Code — parse in extension host)
  if (hookEvent === 'Stop') {
    if (typeof p.transcript_path === 'string') safePayload.transcriptPath = String(p.transcript_path).slice(0, 1024);
    // Forward any direct cost/usage fields if present (forward-compat)
    if (typeof p.total_cost_usd === 'number') safePayload.costUsd = p.total_cost_usd;
    const usage = (p.usage as Record<string, unknown> | undefined);
    if (usage) {
      if (typeof usage.input_tokens === 'number') safePayload.inputTokens = usage.input_tokens;
      if (typeof usage.output_tokens === 'number') safePayload.outputTokens = usage.output_tokens;
    }
  }

  // Extract file_path from tool_input for file-touching tools (never content)
  const COPILOT_FILE_TOOLS = new Set(['read_file', 'write_file', 'edit_file', 'insert_edit_into_file']);
  if (safePayload.toolName && COPILOT_FILE_TOOLS.has(safePayload.toolName as string)) {
    const toolInput = p.tool_input;
    if (toolInput && typeof toolInput === 'object') {
      const fp = (toolInput as Record<string, unknown>).file_path
        ?? (toolInput as Record<string, unknown>).path;
      if (typeof fp === 'string') safePayload.filePath = fp.slice(0, 512);
    }
  }

  // Detect skill tool invocation — Copilot may use 'skill' or 'use_skill' tool names
  const toolNameStr = typeof safePayload.toolName === 'string' ? safePayload.toolName : '';
  const toolNameLower = toolNameStr.toLowerCase();
  if (toolNameLower === 'skill' || toolNameLower === 'use_skill') {
    safePayload.isSkill = true;
    const toolInput = p.tool_input;
    if (toolInput && typeof toolInput === 'object') {
      const ti = toolInput as Record<string, unknown>;
      const skillName = (ti.name as string) ?? (ti.skill as string);
      if (typeof skillName === 'string') safePayload.skillName = skillName.slice(0, 128);
    }
  }

  // PostToolUseFailure — capture error details (parity with Claude Code)
  if (hookEvent === 'PostToolUseFailure') {
    safePayload.isToolFailure = true;
    if (p.error_message) safePayload.errorMessage = String(p.error_message).slice(0, 256);
    if (p.failure_type) safePayload.failureType = String(p.failure_type).slice(0, 64);
  }

  // PermissionRequest — agent is waiting for user permission
  if (hookEvent === 'PermissionRequest') {
    safePayload.waitingSource = 'permission_request';
    if (p.tool_name) safePayload.toolName = String(p.tool_name).slice(0, 128);
  }

  // Notification — general notification from Copilot
  if (hookEvent === 'Notification') {
    const notifType = p.notification_type ?? (p.payload as Record<string, unknown> | undefined)?.notification_type;
    if (typeof notifType === 'string') safePayload.notificationType = notifType.slice(0, 128);
    if (p.message) safePayload.message = String(p.message).slice(0, 256);
  }

  // TeammateIdle — another agent in the team is idle
  if (hookEvent === 'TeammateIdle') {
    if (p.teammate_id) safePayload.teammateId = String(p.teammate_id).slice(0, 128);
    if (p.teammate_session_id) safePayload.teammateSessionId = String(p.teammate_session_id).slice(0, 128);
  }

  // TaskCompleted — background task completed
  if (hookEvent === 'TaskCompleted') {
    safePayload.hookType = 'task_completed';
    const taskId = p.task_id ?? p.taskId;
    if (typeof taskId === 'string') safePayload.taskId = taskId.slice(0, 128);
  }

  // Forward transcript_path on SessionStart too (parity with Claude Code)
  if (hookEvent === 'SessionStart') {
    if (typeof p.transcript_path === 'string') safePayload.transcriptPath = String(p.transcript_path).slice(0, 1024);
    // Capture MCP servers if present
    const mcpServers = p.mcp_servers;
    if (Array.isArray(mcpServers)) {
      safePayload.mcpServers = mcpServers.slice(0, 20).map((srv: unknown) => {
        if (!srv || typeof srv !== 'object') return { name: 'unknown', status: 'unknown' };
        const s = srv as Record<string, unknown>;
        return {
          name: String(s.name ?? 'unknown').slice(0, 128),
          status: String(s.status ?? 'unknown').slice(0, 32),
        };
      });
    }
  }

  // Capture model name if present (parity with Claude Code)
  const model = p.model;
  if (typeof model === 'string') safePayload.modelName = model.slice(0, 128);

  // Richer Stop telemetry (parity with Claude Code)
  if (hookEvent === 'Stop') {
    if (typeof p.duration_ms === 'number') safePayload.durationMs = p.duration_ms;
    if (typeof p.duration_api_ms === 'number') safePayload.durationApiMs = p.duration_api_ms;
    if (typeof p.num_turns === 'number') safePayload.numTurns = p.num_turns;
    if (typeof p.stop_reason === 'string') safePayload.stopReason = String(p.stop_reason).slice(0, 128);
  }

  return {
    id: nextId(),
    agentId,
    agentName,
    agentType: 'copilot',
    type,
    timestamp: Date.now(),
    payload: safePayload,
  };
}

/** Legacy output-string parser (passive fallback via copilotChannel). */
export function mapCopilotOutputToEvent(output: string): AgentEvent | null {
  if (!output || typeof output !== 'string') return null;
  const line = output.trim();
  if (!line) return null;

  let type: AgentEvent['type'] | null = null;
  if (/^(running|started|executing)\b/i.test(line) || /\b(running|executing)\s+(tool|command|task)\b/i.test(line)) type = 'task.start';
  else if (/^(completed?|done|finished|succeeded)\b/i.test(line) || /\btask\s+(completed?|done|finished)\b/i.test(line)) type = 'task.complete';
  else if (/^(error|failed|exception)\b/i.test(line) || /\b(failed to|error:)\s/i.test(line)) type = 'agent.error';
  else if (/\b(writ|edit|sav)(ing|e|ten)\s+[\w./\\]+\.\w{1,10}\b/i.test(line)) type = 'file.write';
  else if (/\b(read|open)(ing|ed)?\s+[\w./\\]+\.\w{1,10}\b/i.test(line)) type = 'file.read';
  else if (/\b(invoking|calling)\s+(tool|function|command)\b/i.test(line)) type = 'tool.call';

  if (!type) return null;

  return {
    id: nextId(),
    agentId: 'copilot-1',
    agentName: 'GitHub Copilot',
    agentType: 'copilot',
    type,
    timestamp: Date.now(),
    payload: { raw: line.slice(0, 200) },
  };
}
