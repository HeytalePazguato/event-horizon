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

  it('extracts transcript_path from Stop event', () => {
    const result = mapClaudeHookToEvent({
      hook_event_name: 'Stop',
      session_id: 's1',
      transcript_path: '/home/user/.claude/projects/abc123.jsonl',
    });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('task.complete');
    const p = result!.payload as Record<string, unknown>;
    expect(p.transcriptPath).toBe('/home/user/.claude/projects/abc123.jsonl');
  });

  it('extracts token/cost from Stop if usage is present (forward-compat)', () => {
    const result = mapClaudeHookToEvent({
      hook_event_name: 'Stop',
      session_id: 's1',
      total_cost_usd: 1.23,
      usage: { input_tokens: 15000, output_tokens: 8500 },
    });
    expect(result).not.toBeNull();
    const p = result!.payload as Record<string, unknown>;
    expect(p.inputTokens).toBe(15000);
    expect(p.outputTokens).toBe(8500);
    expect(p.costUsd).toBe(1.23);
  });

  it('extracts transcript_path from any hook event (not just Stop)', () => {
    const result = mapClaudeHookToEvent({
      hook_event_name: 'PreToolUse',
      session_id: 's1',
      tool_name: 'Read',
      transcript_path: '/some/path.jsonl',
    });
    expect(result).not.toBeNull();
    const p = result!.payload as Record<string, unknown>;
    expect(p.transcriptPath).toBe('/some/path.jsonl');
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

  describe('3.3.0 hook events', () => {
    it('maps PostModelSwitch to the new model id', () => {
      const ev = mapClaudeHookToEvent({ hook_event_name: 'PostModelSwitch', session_id: 's', from_model: 'claude-opus-4-5', to_model: 'claude-opus-5' });
      expect(ev).not.toBeNull();
      expect(ev!.type).toBe('message.receive');
      expect(ev!.payload).toMatchObject({ hookType: 'model_switch', modelName: 'claude-opus-5', previousModelName: 'claude-opus-4-5' });
    });

    it('forwards SessionStart resume diagnostics and model', () => {
      const ev = mapClaudeHookToEvent({
        hook_event_name: 'SessionStart', session_id: 's', source: 'resume', model: 'claude-opus-5',
        context_tokens: 182340, estimated_cache_write_usd: 1.1396, prompt_cache_likely_expired: true, seconds_since_last_response: 5400,
      });
      expect(ev!.payload).toMatchObject({
        modelName: 'claude-opus-5', contextTokens: 182340, estimatedCacheWriteUsd: 1.1396,
        promptCacheLikelyExpired: true, secondsSinceLastResponse: 5400, startSource: 'resume',
      });
    });

    it('ignores non-numeric SessionStart diagnostics', () => {
      const ev = mapClaudeHookToEvent({ hook_event_name: 'SessionStart', session_id: 's', context_tokens: 'lots' });
      expect((ev!.payload as Record<string, unknown>).contextTokens).toBeUndefined();
    });

    it('maps StopFailure to agent.error with its message', () => {
      const ev = mapClaudeHookToEvent({ hook_event_name: 'StopFailure', session_id: 's', error: 'overloaded_error' });
      expect(ev!.type).toBe('agent.error');
      expect(ev!.payload).toMatchObject({ hookType: 'stop_failure', errorMessage: 'overloaded_error' });
    });

    it('maps PostCompact with token counts', () => {
      const ev = mapClaudeHookToEvent({ hook_event_name: 'PostCompact', session_id: 's', pre_tokens: 190000, post_tokens: 30000 });
      expect(ev!.payload).toMatchObject({ hookType: 'context_compaction', preTokens: 190000, postTokens: 30000 });
    });
  });
});
