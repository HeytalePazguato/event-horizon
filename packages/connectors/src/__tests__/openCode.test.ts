import { describe, it, expect } from 'vitest';
import { mapOpenCodeToEvent } from '../openCode.js';

describe('mapOpenCodeToEvent', () => {
  it('maps session.created to agent.spawn', () => {
    const result = mapOpenCodeToEvent({ event: 'session.created', agentId: 'oc-1' });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('agent.spawn');
    expect(result!.agentId).toBe('oc-1');
    expect(result!.agentType).toBe('opencode');
  });

  it('maps session.deleted to agent.terminate', () => {
    const result = mapOpenCodeToEvent({ event: 'session.deleted', agentId: 'oc-1' });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('agent.terminate');
  });

  it('maps tool.execute.before to tool.call', () => {
    const result = mapOpenCodeToEvent({
      event: 'tool.execute.before',
      agentId: 'oc-1',
      payload: { toolName: 'Bash' },
    });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('tool.call');
    expect(result!.payload.toolName).toBe('Bash');
  });

  it('deduplicates message.updated user messages', () => {
    const msg = {
      event: 'message.updated',
      agentId: 'oc-1',
      payload: { properties: { info: { role: 'user', id: 'msg-1' } } },
    };

    // First call should produce task.start
    const first = mapOpenCodeToEvent(msg);
    expect(first).not.toBeNull();
    expect(first!.type).toBe('task.start');

    // Second call with same message id should be deduplicated (null)
    const second = mapOpenCodeToEvent(msg);
    expect(second).toBeNull();

    // Clean up dedup set by terminating
    mapOpenCodeToEvent({ event: 'session.deleted', agentId: 'oc-1' });
  });

  it('maps permission.asked to agent.waiting', () => {
    const result = mapOpenCodeToEvent({
      event: 'permission.asked',
      agentId: 'oc-1',
      payload: { tool: 'Bash', permission: 'execute' },
    });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('agent.waiting');
    expect(result!.payload.tool).toBe('Bash');
  });

  it('maps permission.replied to message.receive', () => {
    const result = mapOpenCodeToEvent({
      event: 'permission.replied',
      agentId: 'oc-1',
      payload: { tool: 'Bash', granted: true },
    });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('message.receive');
  });

  it('maps session.compacted to message.receive', () => {
    const result = mapOpenCodeToEvent({ event: 'session.compacted', agentId: 'oc-1' });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('message.receive');
  });

  it('maps command.executed to message.receive', () => {
    const result = mapOpenCodeToEvent({ event: 'command.executed', agentId: 'oc-1' });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('message.receive');
  });

  it('returns null for unknown events', () => {
    expect(mapOpenCodeToEvent({ event: 'some.unknown.event' })).toBeNull();
  });

  it('handles missing/invalid input gracefully', () => {
    expect(mapOpenCodeToEvent(null)).toBeNull();
    expect(mapOpenCodeToEvent(undefined)).toBeNull();
    expect(mapOpenCodeToEvent(42)).toBeNull();
    expect(mapOpenCodeToEvent({})).toBeNull();
    expect(mapOpenCodeToEvent({ event: 123 })).toBeNull();
  });

  it('clamps agentId and agentName lengths', () => {
    const result = mapOpenCodeToEvent({
      event: 'session.created',
      agentId: 'a'.repeat(300),
      agentName: 'n'.repeat(200),
    });
    expect(result).not.toBeNull();
    expect(result!.agentId.length).toBeLessThanOrEqual(128);
    expect(result!.agentName.length).toBeLessThanOrEqual(64);
  });

  it('extracts filePath from tool.call input', () => {
    const result = mapOpenCodeToEvent({
      event: 'tool.execute.before',
      agentId: 'oc-1',
      payload: { toolName: 'Edit', input: { file_path: '/project/main.go' } },
    });
    expect(result).not.toBeNull();
    expect(result!.payload.filePath).toBe('/project/main.go');
  });

  it('extracts filePath from file.edited event properties', () => {
    const result = mapOpenCodeToEvent({
      event: 'file.edited',
      agentId: 'oc-1',
      payload: { properties: { path: '/project/utils.ts' } },
    });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('file.write');
    expect(result!.payload.filePath).toBe('/project/utils.ts');
  });

  it('detects skill tool invocation with input.name', () => {
    const result = mapOpenCodeToEvent({
      event: 'tool.execute.before',
      agentId: 'oc-1',
      payload: { toolName: 'skill', input: { name: 'deploy-staging' } },
    });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('tool.call');
    expect(result!.payload.isSkill).toBe(true);
    expect(result!.payload.skillName).toBe('deploy-staging');
  });

  it('detects skill tool with case-insensitive tool name', () => {
    const result = mapOpenCodeToEvent({
      event: 'tool.execute.before',
      agentId: 'oc-1',
      payload: { toolName: 'Skill', input: { name: 'lint-fix' } },
    });
    expect(result).not.toBeNull();
    expect(result!.payload.isSkill).toBe(true);
    expect(result!.payload.skillName).toBe('lint-fix');
  });

  it('sets isSkill without skillName when input has no name', () => {
    const result = mapOpenCodeToEvent({
      event: 'tool.execute.before',
      agentId: 'oc-1',
      payload: { toolName: 'skill' },
    });
    expect(result).not.toBeNull();
    expect(result!.payload.isSkill).toBe(true);
    expect(result!.payload.skillName).toBeUndefined();
  });

  it('extracts token/cost from session.updated with usage data', () => {
    const result = mapOpenCodeToEvent({
      event: 'session.updated',
      agentId: 'oc-1',
      payload: { properties: { usage: { input_tokens: 8000, output_tokens: 4000, total_cost_usd: 0.60 } } },
    });
    expect(result).not.toBeNull();
    expect(result!.payload.inputTokens).toBe(8000);
    expect(result!.payload.outputTokens).toBe(4000);
    expect(result!.payload.costUsd).toBe(0.60);
  });

  it('extracts token/cost from top-level payload fields', () => {
    const result = mapOpenCodeToEvent({
      event: 'session.idle',
      agentId: 'oc-1',
      payload: { input_tokens: 3000, output_tokens: 1500, total_cost_usd: 0.25 },
    });
    expect(result).not.toBeNull();
    expect(result!.payload.inputTokens).toBe(3000);
    expect(result!.payload.outputTokens).toBe(1500);
    expect(result!.payload.costUsd).toBe(0.25);
  });

  describe('lifecycle hints', () => {
    it.each(['session.execution.succeeded', 'session.execution.failed', 'session.idle'])(
      'maps %s to an agent.idle turn end',
      (event) => {
        const r = mapOpenCodeToEvent({ event, agentId: 'oc-1' });
        expect(r!.type).toBe('agent.idle');
        expect(r!.payload.lifecycleSignal).toBe('opencode-session-idle');
      },
    );

    it('keeps the interrupt reason on session.execution.interrupted', () => {
      const r = mapOpenCodeToEvent({ event: 'session.execution.interrupted', agentId: 'oc-1', payload: { reason: 'inactivity' } });
      expect(r!.type).toBe('agent.idle');
      expect(r!.payload.lifecycleSignal).toBe('opencode-session-idle');
      expect(r!.payload.interruptReason).toBe('inactivity');
      expect(r!.payload.outcome).toBe('interrupted');
    });

    it('reads the interrupt reason from a nested data object', () => {
      const r = mapOpenCodeToEvent({ event: 'session.execution.interrupted', agentId: 'oc-1', payload: { data: { reason: 'shutdown' } } });
      expect(r!.payload.interruptReason).toBe('shutdown');
    });

    it('maps session.execution.started to activity', () => {
      const r = mapOpenCodeToEvent({ event: 'session.execution.started', agentId: 'oc-1' });
      expect(r!.type).toBe('task.progress');
      expect(r!.payload.lifecycleSignal).toBe('activity');
    });

    it('maps session.status busy to activity and idle to a turn end', () => {
      const busy = mapOpenCodeToEvent({ event: 'session.status', agentId: 'oc-1', payload: { properties: { status: { type: 'busy' } } } });
      expect(busy!.payload.lifecycleSignal).toBe('activity');
      const idle = mapOpenCodeToEvent({ event: 'session.status', agentId: 'oc-1', payload: { properties: { status: { type: 'idle' } } } });
      expect(idle!.payload.lifecycleSignal).toBe('opencode-session-idle');
    });
  });

  it('does not set isSkill for non-skill tools', () => {
    const result = mapOpenCodeToEvent({
      event: 'tool.execute.before',
      agentId: 'oc-1',
      payload: { toolName: 'Bash', input: { command: 'ls' } },
    });
    expect(result).not.toBeNull();
    expect(result!.payload.isSkill).toBeUndefined();
  });
});
