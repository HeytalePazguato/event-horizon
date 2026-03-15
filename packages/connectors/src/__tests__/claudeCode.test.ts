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

  it('extracts filePath from tool_input for file tools (object)', () => {
    const result = mapClaudeHookToEvent({
      hook_event_name: 'PreToolUse',
      session_id: 's1',
      tool_name: 'Edit',
      tool_input: { file_path: '/home/user/project/src/index.ts', old_string: 'SECRET', new_string: 'SECRET2' },
    });
    expect(result).not.toBeNull();
    expect(result!.payload.filePath).toBe('/home/user/project/src/index.ts');
    // Content fields must not leak
    expect((result!.payload as Record<string, unknown>).old_string).toBeUndefined();
    expect((result!.payload as Record<string, unknown>).new_string).toBeUndefined();
  });

  it('extracts filePath from stringified tool_input for file tools', () => {
    const result = mapClaudeHookToEvent({
      hook_event_name: 'PreToolUse',
      session_id: 's1',
      tool_name: 'Write',
      tool_input: JSON.stringify({ file_path: '/tmp/out.json', content: 'SECRET CONTENT' }),
    });
    expect(result).not.toBeNull();
    expect(result!.payload.filePath).toBe('/tmp/out.json');
    expect((result!.payload as Record<string, unknown>).content).toBeUndefined();
  });

  it('does not extract filePath for non-file tools', () => {
    const result = mapClaudeHookToEvent({
      hook_event_name: 'PreToolUse',
      session_id: 's1',
      tool_name: 'Bash',
      tool_input: { file_path: '/some/path', command: 'ls' },
    });
    expect(result).not.toBeNull();
    expect((result!.payload as Record<string, unknown>).filePath).toBeUndefined();
  });

  it('extracts skill metadata from Skill tool use', () => {
    const result = mapClaudeHookToEvent({
      hook_event_name: 'PreToolUse',
      session_id: 's1',
      tool_name: 'Skill',
      tool_input: { skill: 'commit', args: '-m "fix bug"' },
    });
    expect(result).not.toBeNull();
    const p = result!.payload as Record<string, unknown>;
    expect(p.isSkill).toBe(true);
    expect(p.skillName).toBe('commit');
    expect(p.skillArgs).toBe('-m "fix bug"');
  });

  it('extracts skill metadata from stringified tool_input', () => {
    const result = mapClaudeHookToEvent({
      hook_event_name: 'PreToolUse',
      session_id: 's1',
      tool_name: 'Skill',
      tool_input: JSON.stringify({ skill: 'review-pr', args: '123' }),
    });
    expect(result).not.toBeNull();
    const p = result!.payload as Record<string, unknown>;
    expect(p.isSkill).toBe(true);
    expect(p.skillName).toBe('review-pr');
  });

  it('sets isSkill without skillName when tool_input is missing', () => {
    const result = mapClaudeHookToEvent({
      hook_event_name: 'PreToolUse',
      session_id: 's1',
      tool_name: 'Skill',
    });
    expect(result).not.toBeNull();
    const p = result!.payload as Record<string, unknown>;
    expect(p.isSkill).toBe(true);
    expect(p.skillName).toBeUndefined();
  });

  it('extracts token/cost data from Stop event', () => {
    const result = mapClaudeHookToEvent({
      hook_event_name: 'Stop',
      session_id: 's1',
      total_input_tokens: 15000,
      total_output_tokens: 8500,
      total_cost_usd: 1.23,
    });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('task.complete');
    const p = result!.payload as Record<string, unknown>;
    expect(p.inputTokens).toBe(15000);
    expect(p.outputTokens).toBe(8500);
    expect(p.costUsd).toBe(1.23);
  });

  it('extracts token/cost from nested payload in Stop event', () => {
    const result = mapClaudeHookToEvent({
      hook_event_name: 'Stop',
      session_id: 's1',
      payload: { total_input_tokens: 5000, total_output_tokens: 2000, total_cost_usd: 0.50 },
    });
    expect(result).not.toBeNull();
    const p = result!.payload as Record<string, unknown>;
    expect(p.inputTokens).toBe(5000);
    expect(p.outputTokens).toBe(2000);
    expect(p.costUsd).toBe(0.50);
  });

  it('does not extract token/cost from non-Stop events', () => {
    const result = mapClaudeHookToEvent({
      hook_event_name: 'PreToolUse',
      session_id: 's1',
      tool_name: 'Read',
      total_input_tokens: 9999,
    });
    expect(result).not.toBeNull();
    const p = result!.payload as Record<string, unknown>;
    expect(p.inputTokens).toBeUndefined();
  });

  it('does not set isSkill for non-Skill tools', () => {
    const result = mapClaudeHookToEvent({
      hook_event_name: 'PreToolUse',
      session_id: 's1',
      tool_name: 'Edit',
      tool_input: { file_path: '/test.ts', old_string: 'a', new_string: 'b' },
    });
    expect(result).not.toBeNull();
    expect((result!.payload as Record<string, unknown>).isSkill).toBeUndefined();
  });
});
