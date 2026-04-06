/**
 * Cursor hooks adapter — maps Cursor hook payloads to AgentEvent.
 * @event-horizon/connectors
 */

import type { AgentEvent, AgentEventType } from '@event-horizon/core';

const CURSOR_HOOK_TO_EVENT: Record<string, AgentEventType> = {
  // Session lifecycle
  sessionStart:         'agent.spawn',
  sessionEnd:           'agent.terminate',
  // User prompt
  beforeSubmitPrompt:   'task.start',
  stop:                 'task.complete',
  // Generic tool hooks (fires for ALL tool types)
  preToolUse:           'tool.call',
  postToolUse:          'tool.result',
  postToolUseFailure:   'agent.error',
  // Shell execution
  beforeShellExecution: 'tool.call',
  afterShellExecution:  'tool.result',
  // File operations
  beforeReadFile:       'file.read',
  afterFileEdit:        'file.write',
  beforeTabFileRead:    'file.read',
  afterTabFileEdit:     'file.write',
  // MCP tool execution
  beforeMCPExecution:   'tool.call',
  afterMCPExecution:    'tool.result',
  // Agent reasoning
  afterAgentResponse:   'task.progress',
  afterAgentThought:    'task.progress',
  // Subagents
  subagentStart:        'task.start',
  subagentStop:         'task.complete',
  // Context compaction
  preCompact:           'message.receive',
};

function nextId(): string {
  return `ev-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function mapCursorHookToEvent(payload: unknown): AgentEvent | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;

  const hookEvent = String(p.hook_event_name ?? '');
  if (!hookEvent) return null;

  const type = CURSOR_HOOK_TO_EVENT[hookEvent];
  if (!type) return null;

  // Use conversation_id as agentId (stable per chat session); fall back to generation_id
  const agentId = String(p.conversation_id ?? p.generation_id ?? 'cursor-1').slice(0, 128);
  const agentName = 'Cursor';

  // Extract cwd from workspace_roots[0] or shell_directory
  const workspaceRoots = p.workspace_roots as string[] | undefined;
  const shellDir = p.shell_directory as string | undefined;
  const cwd = (Array.isArray(workspaceRoots) && typeof workspaceRoots[0] === 'string')
    ? workspaceRoots[0]
    : (typeof shellDir === 'string' ? shellDir : undefined);

  // Whitelist safe payload fields only
  const safePayload: Record<string, unknown> = {};
  if (cwd) safePayload.cwd = String(cwd).slice(0, 512);

  // Prompt (truncated)
  if (p.prompt) safePayload.prompt = String(p.prompt).slice(0, 200);

  // File path from file-touching hooks
  if (p.file_path) safePayload.filePath = String(p.file_path).slice(0, 512);

  // Shell command info
  if (p.shell_command) safePayload.toolName = String(p.shell_command).slice(0, 128);
  if (p.shell_directory) safePayload.shellDirectory = String(p.shell_directory).slice(0, 512);

  // MCP tool info
  if (p.tool_name) safePayload.toolName = String(p.tool_name).slice(0, 128);
  if (p.server_name) safePayload.serverName = String(p.server_name).slice(0, 128);

  // start_line / end_line for file reads
  if (typeof p.start_line === 'number') safePayload.startLine = p.start_line;
  if (typeof p.end_line === 'number') safePayload.endLine = p.end_line;

  // Shell execution hooks: wrap command as tool call info
  if (hookEvent === 'beforeShellExecution' && p.shell_command) {
    safePayload.toolName = 'ShellExecution';
    safePayload.shellCommand = String(p.shell_command).slice(0, 256);
  }

  // MCP execution hooks: set toolName from tool_name or server_name
  if ((hookEvent === 'beforeMCPExecution' || hookEvent === 'afterMCPExecution') && p.tool_name) {
    safePayload.toolName = String(p.tool_name).slice(0, 128);
    if (p.server_name) safePayload.serverName = String(p.server_name).slice(0, 128);
  }

  // Forward generation_id for correlation
  if (p.generation_id) safePayload.generationId = String(p.generation_id).slice(0, 128);

  // Session lifecycle
  if (hookEvent === 'sessionStart') {
    if (p.session_id) safePayload.sessionId = String(p.session_id).slice(0, 128);
    if (p.composer_mode) safePayload.composerMode = String(p.composer_mode).slice(0, 32);
    if (typeof p.is_background_agent === 'boolean') safePayload.isBackgroundAgent = p.is_background_agent;
  }
  if (hookEvent === 'sessionEnd') {
    if (p.session_id) safePayload.sessionId = String(p.session_id).slice(0, 128);
    if (p.reason) safePayload.stopReason = String(p.reason).slice(0, 64);
    if (typeof p.duration_ms === 'number') safePayload.durationMs = p.duration_ms;
    if (p.error_message) safePayload.errorMessage = String(p.error_message).slice(0, 256);
  }

  // Generic preToolUse / postToolUse / postToolUseFailure
  if (hookEvent === 'preToolUse' || hookEvent === 'postToolUse' || hookEvent === 'postToolUseFailure') {
    if (p.tool_name) safePayload.toolName = String(p.tool_name).slice(0, 128);
    if (p.tool_use_id) safePayload.toolUseId = String(p.tool_use_id).slice(0, 128);
    if (typeof p.duration === 'number') safePayload.durationMs = p.duration;
    if (hookEvent === 'postToolUseFailure') {
      safePayload.isToolFailure = true;
      if (p.error_message) safePayload.errorMessage = String(p.error_message).slice(0, 256);
      if (p.failure_type) safePayload.failureType = String(p.failure_type).slice(0, 64);
    }
  }

  // Subagent events
  if (hookEvent === 'subagentStart' || hookEvent === 'subagentStop') {
    safePayload.isSubagent = true;
    if (p.subagent_id) safePayload.subagentId = String(p.subagent_id).slice(0, 128);
    if (p.subagent_type) safePayload.subagentType = String(p.subagent_type).slice(0, 64);
    if (p.task) safePayload.taskDescription = String(p.task).slice(0, 200);
    if (hookEvent === 'subagentStop') {
      if (p.status) safePayload.stopReason = String(p.status).slice(0, 64);
      if (typeof p.duration_ms === 'number') safePayload.durationMs = p.duration_ms;
      if (typeof p.tool_call_count === 'number') safePayload.toolCallCount = p.tool_call_count;
      if (Array.isArray(p.modified_files)) {
        safePayload.modifiedFiles = (p.modified_files as unknown[]).slice(0, 20).map((f) => String(f).slice(0, 256));
      }
      if (p.agent_transcript_path) safePayload.transcriptPath = String(p.agent_transcript_path).slice(0, 1024);
    }
  }

  // Context compaction
  if (hookEvent === 'preCompact') {
    safePayload.hookType = 'context_compaction';
    if (typeof p.context_tokens === 'number') safePayload.preTokens = p.context_tokens;
    if (typeof p.context_window_size === 'number') safePayload.contextWindowSize = p.context_window_size;
    if (typeof p.context_usage_percent === 'number') safePayload.contextUsagePercent = p.context_usage_percent;
    if (p.trigger) safePayload.compactionTrigger = String(p.trigger).slice(0, 32);
  }

  // Capture model name (available on all hooks via base fields)
  if (p.model) safePayload.modelName = String(p.model).slice(0, 128);

  // Forward transcript_path if available
  if (p.transcript_path) safePayload.transcriptPath = String(p.transcript_path).slice(0, 1024);

  return {
    id: nextId(),
    agentId,
    agentName,
    agentType: 'cursor',
    type,
    timestamp: Date.now(),
    payload: safePayload,
  };
}
