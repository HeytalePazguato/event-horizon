import { describe, it, expect } from 'vitest';
import { mapClaudeHookToEvent } from '../claudeCode.js';

describe('mapClaudeHookToEvent', () => {
  it('maps SessionStart hook to agent.spawn', () => {
    const result = mapClaudeHookToEvent({ hook_event_name: 'SessionStart', session_id: 's1' });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('agent.spawn');
    expect(result!.agentId).toBe('s1');
    expect(result!.agentType).toBe('claude-code');
  });

  it('maps PreToolUse to tool.call', () => {
    const result = mapClaudeHookToEvent({ hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'Read' });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('tool.call');
    expect(result!.payload.toolName).toBe('Read');
  });

  it('maps PostToolUse to tool.result', () => {
    const result = mapClaudeHookToEvent({ hook_event_name: 'PostToolUse', session_id: 's1' });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('tool.result');
  });

  it('maps UserPromptSubmit to task.start', () => {
    const result = mapClaudeHookToEvent({ hook_event_name: 'UserPromptSubmit', session_id: 's1' });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('task.start');
  });

  it('maps Notification to message.receive', () => {
    const result = mapClaudeHookToEvent({ hook_event_name: 'Notification', session_id: 's1' });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('message.receive');
  });

  it('returns null for unknown/invalid input', () => {
    expect(mapClaudeHookToEvent(null)).toBeNull();
    expect(mapClaudeHookToEvent(undefined)).toBeNull();
    expect(mapClaudeHookToEvent(42)).toBeNull();
    expect(mapClaudeHookToEvent({})).toBeNull();
    expect(mapClaudeHookToEvent({ hook_event_name: 'UnknownHook' })).toBeNull();
  });

  it('whitelists payload fields (no tool_input leak)', () => {
    const result = mapClaudeHookToEvent({
      hook_event_name: 'PreToolUse',
      session_id: 's1',
      tool_name: 'Write',
      tool_input: 'SECRET DATA SHOULD NOT APPEAR',
    });
    expect(result).not.toBeNull();
    expect(result!.payload.toolName).toBe('Write');
    expect((result!.payload as Record<string, unknown>).tool_input).toBeUndefined();
  });

  it('clamps string lengths', () => {
    const longId = 'x'.repeat(300);
    const result = mapClaudeHookToEvent({ hook_event_name: 'SessionStart', session_id: longId });
    expect(result).not.toBeNull();
    expect(result!.agentId.length).toBeLessThanOrEqual(128);
  });

  it('captures cwd from top-level payload', () => {
    const result = mapClaudeHookToEvent({ hook_event_name: 'SessionStart', session_id: 's1', cwd: '/home/user/project' });
    expect(result).not.toBeNull();
    expect(result!.payload.cwd).toBe('/home/user/project');
  });

  it('captures cwd from nested payload', () => {
    const result = mapClaudeHookToEvent({ hook_event_name: 'PreToolUse', session_id: 's1', payload: { cwd: '/nested/path' } });
    expect(result).not.toBeNull();
    expect(result!.payload.cwd).toBe('/nested/path');
  });
});
