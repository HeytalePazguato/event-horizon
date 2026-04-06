import { describe, it, expect } from 'vitest';
import { mapCopilotHookToEvent, mapCopilotOutputToEvent } from '../copilot.js';

describe('mapCopilotHookToEvent', () => {
  it('maps SessionStart to agent.spawn', () => {
    const result = mapCopilotHookToEvent({
      hook_event_name: 'SessionStart',
      session_id: 'sess-123',
      cwd: '/home/user/project',
      source: 'new',
    });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('agent.spawn');
    expect(result!.agentId).toBe('sess-123');
    expect(result!.agentType).toBe('copilot');
    expect(result!.payload?.cwd).toBe('/home/user/project');
  });

  it('maps Stop to agent.idle (per-turn, not session end)', () => {
    const result = mapCopilotHookToEvent({
      hook_event_name: 'Stop',
      session_id: 'sess-123',
      stop_hook_active: false,
    });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('agent.idle');
  });

  it('maps SessionEnd to agent.terminate', () => {
    const result = mapCopilotHookToEvent({
      hook_event_name: 'SessionEnd',
      session_id: 'sess-123',
    });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('agent.terminate');
  });

  it('maps UserPromptSubmit to task.start with prompt', () => {
    const result = mapCopilotHookToEvent({
      hook_event_name: 'UserPromptSubmit',
      session_id: 'sess-123',
      prompt: 'Fix the bug in main.ts',
    });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('task.start');
    expect(result!.payload?.prompt).toBe('Fix the bug in main.ts');
  });

  it('maps PreToolUse to tool.call with tool name', () => {
    const result = mapCopilotHookToEvent({
      hook_event_name: 'PreToolUse',
      session_id: 'sess-123',
      tool_name: 'run_in_terminal',
      tool_use_id: 'call_123',
    });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('tool.call');
    expect(result!.payload?.toolName).toBe('run_in_terminal');
  });

  it('maps SubagentStart to task.start with subagent metadata', () => {
    const result = mapCopilotHookToEvent({
      hook_event_name: 'SubagentStart',
      session_id: 'sub-session-456',
      agent_id: 'agent-789',
      agent_type: 'default',
    });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('task.start');
    expect(result!.agentId).toBe('sub-session-456');
    expect(result!.payload?.isSubagent).toBe(true);
    expect(result!.payload?.subagentSessionId).toBe('sub-session-456');
    expect(result!.payload?.subagentId).toBe('agent-789');
  });

  it('maps SubagentStop to task.complete', () => {
    const result = mapCopilotHookToEvent({
      hook_event_name: 'SubagentStop',
      session_id: 'sub-session-456',
      agent_id: 'agent-789',
      agent_type: 'default',
    });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('task.complete');
    expect(result!.payload?.isSubagent).toBe(true);
  });

  it('returns null for unknown hook event', () => {
    expect(mapCopilotHookToEvent({ hook_event_name: 'UnknownEvent' })).toBeNull();
  });

  it('returns null for null/undefined input', () => {
    expect(mapCopilotHookToEvent(null)).toBeNull();
    expect(mapCopilotHookToEvent(undefined)).toBeNull();
    expect(mapCopilotHookToEvent({})).toBeNull();
  });

  it('defaults agentId when session_id is missing', () => {
    const result = mapCopilotHookToEvent({ hook_event_name: 'SessionStart' });
    expect(result).not.toBeNull();
    expect(result!.agentId).toBe('copilot-1');
  });

  it('extracts filePath from tool_input for file tools', () => {
    const result = mapCopilotHookToEvent({
      hook_event_name: 'PreToolUse',
      session_id: 'sess-1',
      tool_name: 'edit_file',
      tool_input: { file_path: '/project/src/app.ts', content: 'SECRET' },
    });
    expect(result).not.toBeNull();
    expect(result!.payload.filePath).toBe('/project/src/app.ts');
    expect((result!.payload as Record<string, unknown>).content).toBeUndefined();
  });

  it('does not extract filePath for non-file tools', () => {
    const result = mapCopilotHookToEvent({
      hook_event_name: 'PreToolUse',
      session_id: 'sess-1',
      tool_name: 'run_in_terminal',
      tool_input: { file_path: '/some/path' },
    });
    expect(result).not.toBeNull();
    expect((result!.payload as Record<string, unknown>).filePath).toBeUndefined();
  });

  it('detects skill tool invocation with tool_input.name', () => {
    const result = mapCopilotHookToEvent({
      hook_event_name: 'PreToolUse',
      session_id: 'sess-1',
      tool_name: 'skill',
      tool_input: { name: 'deploy-preview' },
    });
    expect(result).not.toBeNull();
    expect(result!.payload.isSkill).toBe(true);
    expect(result!.payload.skillName).toBe('deploy-preview');
  });

  it('detects use_skill tool name', () => {
    const result = mapCopilotHookToEvent({
      hook_event_name: 'PreToolUse',
      session_id: 'sess-1',
      tool_name: 'use_skill',
      tool_input: { skill: 'code-review' },
    });
    expect(result).not.toBeNull();
    expect(result!.payload.isSkill).toBe(true);
    expect(result!.payload.skillName).toBe('code-review');
  });

  it('sets isSkill without skillName when tool_input is missing', () => {
    const result = mapCopilotHookToEvent({
      hook_event_name: 'PreToolUse',
      session_id: 'sess-1',
      tool_name: 'skill',
    });
    expect(result).not.toBeNull();
    expect(result!.payload.isSkill).toBe(true);
    expect(result!.payload.skillName).toBeUndefined();
  });

  it('extracts transcript_path from Stop event', () => {
    const result = mapCopilotHookToEvent({
      hook_event_name: 'Stop',
      session_id: 'sess-123',
      transcript_path: '/home/user/.copilot/transcript.jsonl',
    });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('agent.idle');
    const p = result!.payload as Record<string, unknown>;
    expect(p.transcriptPath).toBe('/home/user/.copilot/transcript.jsonl');
  });

  it('forwards usage data from Stop if present (forward-compat)', () => {
    const result = mapCopilotHookToEvent({
      hook_event_name: 'Stop',
      session_id: 'sess-123',
      total_cost_usd: 0.75,
      usage: { input_tokens: 10000, output_tokens: 5000 },
    });
    expect(result).not.toBeNull();
    const p = result!.payload as Record<string, unknown>;
    expect(p.inputTokens).toBe(10000);
    expect(p.outputTokens).toBe(5000);
    expect(p.costUsd).toBe(0.75);
  });

  it('does not set isSkill for non-skill tools', () => {
    const result = mapCopilotHookToEvent({
      hook_event_name: 'PreToolUse',
      session_id: 'sess-1',
      tool_name: 'run_in_terminal',
    });
    expect(result).not.toBeNull();
    expect((result!.payload as Record<string, unknown>).isSkill).toBeUndefined();
  });

  it('maps PostToolUseFailure to agent.error with failure details', () => {
    const result = mapCopilotHookToEvent({
      hook_event_name: 'PostToolUseFailure',
      session_id: 'sess-1',
      tool_name: 'edit_file',
      error_message: 'File not found',
      failure_type: 'not_found',
    });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('agent.error');
    expect(result!.payload.isToolFailure).toBe(true);
    expect(result!.payload.errorMessage).toBe('File not found');
    expect(result!.payload.failureType).toBe('not_found');
  });

  it('maps PermissionRequest to agent.waiting', () => {
    const result = mapCopilotHookToEvent({
      hook_event_name: 'PermissionRequest',
      session_id: 'sess-1',
      tool_name: 'run_in_terminal',
    });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('agent.waiting');
    expect(result!.payload.waitingSource).toBe('permission_request');
    expect(result!.payload.toolName).toBe('run_in_terminal');
  });

  it('maps Notification to message.receive', () => {
    const result = mapCopilotHookToEvent({
      hook_event_name: 'Notification',
      session_id: 'sess-1',
      notification_type: 'info',
      message: 'Build completed',
    });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('message.receive');
    expect(result!.payload.notificationType).toBe('info');
    expect(result!.payload.message).toBe('Build completed');
  });

  it('maps TeammateIdle to agent.idle', () => {
    const result = mapCopilotHookToEvent({
      hook_event_name: 'TeammateIdle',
      session_id: 'sess-1',
      teammate_id: 'agent-2',
      teammate_session_id: 'sess-2',
    });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('agent.idle');
    expect(result!.payload.teammateId).toBe('agent-2');
    expect(result!.payload.teammateSessionId).toBe('sess-2');
  });

  it('maps TaskCompleted to task.complete', () => {
    const result = mapCopilotHookToEvent({
      hook_event_name: 'TaskCompleted',
      session_id: 'sess-1',
      task_id: 'task-42',
    });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('task.complete');
    expect(result!.payload.hookType).toBe('task_completed');
    expect(result!.payload.taskId).toBe('task-42');
  });

  it('captures model name from payload', () => {
    const result = mapCopilotHookToEvent({
      hook_event_name: 'SessionStart',
      session_id: 'sess-1',
      model: 'gpt-4o',
    });
    expect(result).not.toBeNull();
    expect(result!.payload.modelName).toBe('gpt-4o');
  });

  it('captures transcript_path on SessionStart', () => {
    const result = mapCopilotHookToEvent({
      hook_event_name: 'SessionStart',
      session_id: 'sess-1',
      transcript_path: '/home/user/.copilot/sessions/transcript.jsonl',
    });
    expect(result).not.toBeNull();
    expect(result!.payload.transcriptPath).toBe('/home/user/.copilot/sessions/transcript.jsonl');
  });

  it('captures richer Stop telemetry', () => {
    const result = mapCopilotHookToEvent({
      hook_event_name: 'Stop',
      session_id: 'sess-1',
      duration_ms: 12345,
      num_turns: 5,
      stop_reason: 'end_turn',
    });
    expect(result).not.toBeNull();
    expect(result!.payload.durationMs).toBe(12345);
    expect(result!.payload.numTurns).toBe(5);
    expect(result!.payload.stopReason).toBe('end_turn');
  });
});

describe('mapCopilotOutputToEvent (legacy)', () => {
  it('matches "Running tool bash" as task.start', () => {
    const result = mapCopilotOutputToEvent('Running tool bash');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('task.start');
    expect(result!.agentType).toBe('copilot');
  });

  it('matches "Error: something" as agent.error', () => {
    const result = mapCopilotOutputToEvent('Error: connection refused');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('agent.error');
  });

  it('returns null for empty/non-matching input', () => {
    expect(mapCopilotOutputToEvent('')).toBeNull();
    expect(mapCopilotOutputToEvent('just some random text')).toBeNull();
  });

  it('returns null for non-string input', () => {
    expect(mapCopilotOutputToEvent(null as unknown as string)).toBeNull();
    expect(mapCopilotOutputToEvent(undefined as unknown as string)).toBeNull();
  });
});
