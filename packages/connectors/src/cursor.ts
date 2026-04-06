/**
 * Cursor hooks adapter — maps Cursor hook payloads to AgentEvent.
 * @event-horizon/connectors
 */

import type { AgentEvent, AgentEventType } from '@event-horizon/core';

const CURSOR_HOOK_TO_EVENT: Record<string, AgentEventType> = {
  beforeSubmitPrompt: 'task.start',
  stop:              'task.complete',
  beforeShellExecution: 'tool.call',
  afterShellExecution:  'tool.result',
  beforeReadFile:    'file.read',
  afterFileEdit:     'file.write',
  beforeMCPExecution: 'tool.call',
  afterMCPExecution:  'tool.result',
  afterAgentResponse: 'task.progress',
  afterAgentThought:  'task.progress',
  beforeTabFileRead:  'file.read',
  afterTabFileEdit:   'file.write',
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
