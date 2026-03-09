import { describe, it, expect, beforeEach } from 'vitest';
import { AgentStateManager } from '../agentState.js';
import type { AgentEvent } from '../events.js';

function makeEvent(overrides: Partial<AgentEvent> & { type: AgentEvent['type']; agentId: string }): AgentEvent {
  return {
    id: `ev-${Date.now()}`,
    agentName: 'Test Agent',
    agentType: 'claude-code',
    timestamp: Date.now(),
    payload: {},
    ...overrides,
  };
}

describe('AgentStateManager', () => {
  let manager: AgentStateManager;

  beforeEach(() => {
    manager = new AgentStateManager();
  });

  it('agent.spawn creates an agent in idle state', () => {
    manager.apply(makeEvent({ type: 'agent.spawn', agentId: 'a1', agentName: 'Claude', agentType: 'claude-code' }));
    const agent = manager.getAgent('a1');
    expect(agent).toBeDefined();
    expect(agent!.state).toBe('idle');
    expect(agent!.name).toBe('Claude');
    expect(agent!.type).toBe('claude-code');
    expect(agent!.currentTaskId).toBeNull();
  });

  it('agent.terminate removes the agent AND its tasks', () => {
    manager.apply(makeEvent({ type: 'agent.spawn', agentId: 'a1' }));
    manager.apply(makeEvent({ type: 'task.start', agentId: 'a1', payload: { taskId: 't1' } }));
    expect(manager.getTask('t1')).toBeDefined();

    manager.apply(makeEvent({ type: 'agent.terminate', agentId: 'a1' }));
    expect(manager.getAgent('a1')).toBeUndefined();
    expect(manager.getTask('t1')).toBeUndefined();
    expect(manager.getTasksForAgent('a1')).toHaveLength(0);
  });

  it('task.start sets agent to thinking with taskId', () => {
    manager.apply(makeEvent({ type: 'agent.spawn', agentId: 'a1' }));
    manager.apply(makeEvent({ type: 'task.start', agentId: 'a1', payload: { taskId: 'my-task' } }));

    const agent = manager.getAgent('a1');
    expect(agent!.state).toBe('thinking');
    expect(agent!.currentTaskId).toBe('my-task');
    expect(manager.getTask('my-task')).toBeDefined();
    expect(manager.getTask('my-task')!.agentId).toBe('a1');
  });

  it('task.complete with taskId removes task and sets idle', () => {
    manager.apply(makeEvent({ type: 'agent.spawn', agentId: 'a1' }));
    manager.apply(makeEvent({ type: 'task.start', agentId: 'a1', payload: { taskId: 't1' } }));
    manager.apply(makeEvent({ type: 'task.complete', agentId: 'a1', payload: { taskId: 't1' } }));

    expect(manager.getAgent('a1')!.state).toBe('idle');
    expect(manager.getAgent('a1')!.currentTaskId).toBeNull();
    expect(manager.getTask('t1')).toBeUndefined();
  });

  it('task.complete without taskId falls back to currentTaskId', () => {
    manager.apply(makeEvent({ type: 'agent.spawn', agentId: 'a1' }));
    manager.apply(makeEvent({ type: 'task.start', agentId: 'a1', payload: { taskId: 't1' } }));

    // Complete without specifying taskId
    manager.apply(makeEvent({ type: 'task.complete', agentId: 'a1', payload: {} }));

    expect(manager.getAgent('a1')!.state).toBe('idle');
    expect(manager.getAgent('a1')!.currentTaskId).toBeNull();
    expect(manager.getTask('t1')).toBeUndefined();
  });

  it('task.fail removes task', () => {
    manager.apply(makeEvent({ type: 'agent.spawn', agentId: 'a1' }));
    manager.apply(makeEvent({ type: 'task.start', agentId: 'a1', payload: { taskId: 't1' } }));
    manager.apply(makeEvent({ type: 'task.fail', agentId: 'a1', payload: { taskId: 't1' } }));

    expect(manager.getTask('t1')).toBeUndefined();
    expect(manager.getAgent('a1')!.state).toBe('idle');
  });

  it('agent.error sets error state', () => {
    manager.apply(makeEvent({ type: 'agent.spawn', agentId: 'a1' }));
    manager.apply(makeEvent({ type: 'agent.error', agentId: 'a1' }));

    expect(manager.getAgent('a1')!.state).toBe('error');
  });

  it('agent.idle sets idle state', () => {
    manager.apply(makeEvent({ type: 'agent.spawn', agentId: 'a1' }));
    manager.apply(makeEvent({ type: 'task.start', agentId: 'a1', payload: { taskId: 't1' } }));
    expect(manager.getAgent('a1')!.state).toBe('thinking');

    manager.apply(makeEvent({ type: 'agent.idle', agentId: 'a1' }));
    expect(manager.getAgent('a1')!.state).toBe('idle');
    expect(manager.getAgent('a1')!.currentTaskId).toBeNull();
  });

  it('agent.spawn captures cwd from payload', () => {
    manager.apply(makeEvent({ type: 'agent.spawn', agentId: 'a1', payload: { cwd: '/home/user/project' } }));
    expect(manager.getAgent('a1')!.cwd).toBe('/home/user/project');
  });

  it('cwd is updated on subsequent events if not set at spawn', () => {
    manager.apply(makeEvent({ type: 'agent.spawn', agentId: 'a1' }));
    expect(manager.getAgent('a1')!.cwd).toBeUndefined();

    manager.apply(makeEvent({ type: 'tool.call', agentId: 'a1', payload: { cwd: '/home/user/project' } }));
    expect(manager.getAgent('a1')!.cwd).toBe('/home/user/project');
  });

  it('cwd is not overwritten once set', () => {
    manager.apply(makeEvent({ type: 'agent.spawn', agentId: 'a1', payload: { cwd: '/first' } }));
    manager.apply(makeEvent({ type: 'tool.call', agentId: 'a1', payload: { cwd: '/second' } }));
    expect(manager.getAgent('a1')!.cwd).toBe('/first');
  });
});
