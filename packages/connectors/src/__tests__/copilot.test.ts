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

  it('does not set isSkill for non-skill tools', () => {
    const result = mapCopilotHookToEvent({
      hook_event_name: 'PreToolUse',
      session_id: 'sess-1',
      tool_name: 'run_in_terminal',
    });
    expect(result).not.toBeNull();
    expect((result!.payload as Record<string, unknown>).isSkill).toBeUndefined();
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
