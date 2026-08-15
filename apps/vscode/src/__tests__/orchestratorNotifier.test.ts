/**
 * Orchestrator notifier tests — worker error / task.fail → orchestrator inbox.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { notifyOrchestratorsOfFailure, type MessageSender } from '../orchestratorNotifier.js';
import type { AgentEvent } from '@event-horizon/core';
import type { PlanBoard } from '../planBoard.js';

function makePlan(overrides: Partial<PlanBoard>): PlanBoard {
  return {
    id: 'plan-1',
    name: 'Test',
    sourceFile: 't.md',
    status: 'active',
    tasks: [],
    createdAt: 0,
    lastUpdatedAt: 0,
    onDependencyFailure: 'cascade',
    maxAutoRetries: 0,
    orchestratorAgentId: null,
    strategy: 'manual',
    maxBudgetUsd: null,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<AgentEvent> & { type: AgentEvent['type'] }): AgentEvent {
  const base = {
    timestamp: Date.now(),
    agentId: 'worker-1',
    agentName: 'Worker One',
    agentType: 'claude-code',
    payload: {},
  };
  return { ...base, ...overrides } as AgentEvent;
}

class FakeQueue implements MessageSender {
  sent: Array<{ from: string; fromName: string; to: string; content: string }> = [];
  send(from: string, fromName: string, to: string, content: string): void {
    this.sent.push({ from, fromName, to, content });
  }
}

describe('notifyOrchestratorsOfFailure', () => {
  let queue: FakeQueue;

  beforeEach(() => {
    queue = new FakeQueue();
  });

  it('notifies the orchestrator on agent.error', () => {
    const plan = makePlan({ orchestratorAgentId: 'orch-1' });
    const event = makeEvent({
      type: 'agent.error',
      payload: { message: 'Something broke', taskId: '2.1' },
    });
    const result = notifyOrchestratorsOfFailure(event, [plan], queue);
    expect(result.notified).toEqual(['orch-1']);
    expect(queue.sent).toHaveLength(1);
    expect(queue.sent[0].to).toBe('orch-1');
    expect(queue.sent[0].content).toContain('Worker One');
    expect(queue.sent[0].content).toContain('task 2.1');
    expect(queue.sent[0].content).toContain('Something broke');
    expect(queue.sent[0].content).toContain('eh_retry_task');
  });

  it('notifies the orchestrator on task.fail', () => {
    const plan = makePlan({ orchestratorAgentId: 'orch-1' });
    const event = makeEvent({
      type: 'task.fail',
      payload: { reason: 'Tests fail', taskId: '2.3' },
    });
    const result = notifyOrchestratorsOfFailure(event, [plan], queue);
    expect(result.notified).toEqual(['orch-1']);
    expect(queue.sent[0].content).toContain('failed a task');
    expect(queue.sent[0].content).toContain('Tests fail');
  });

  it('does not notify on unrelated events', () => {
    const plan = makePlan({ orchestratorAgentId: 'orch-1' });
    const event = makeEvent({ type: 'tool.call', payload: { tool: 'Read' } });
    const result = notifyOrchestratorsOfFailure(event, [plan], queue);
    expect(result.notified).toEqual([]);
    expect(queue.sent).toHaveLength(0);
  });

  it('does not notify the orchestrator about its own error (no self-loop)', () => {
    const plan = makePlan({ orchestratorAgentId: 'orch-1' });
    const event = makeEvent({ type: 'agent.error', agentId: 'orch-1', payload: { message: 'x' } });
    const result = notifyOrchestratorsOfFailure(event, [plan], queue);
    expect(result.notified).toEqual([]);
    expect(queue.sent).toHaveLength(0);
  });

  it('skips plans without an orchestrator', () => {
    const plan = makePlan({ orchestratorAgentId: null });
    const event = makeEvent({ type: 'agent.error', payload: { message: 'x' } });
    const result = notifyOrchestratorsOfFailure(event, [plan], queue);
    expect(result.notified).toEqual([]);
  });

  it('skips archived or completed plans', () => {
    const plans = [
      makePlan({ id: 'a', orchestratorAgentId: 'orch-a', status: 'completed' }),
      makePlan({ id: 'b', orchestratorAgentId: 'orch-b', status: 'archived' }),
    ];
    const event = makeEvent({ type: 'agent.error', payload: { message: 'x' } });
    const result = notifyOrchestratorsOfFailure(event, plans, queue);
    expect(result.notified).toEqual([]);
  });

  it('deduplicates when one orchestrator manages multiple plans', () => {
    const plans = [
      makePlan({ id: 'a', orchestratorAgentId: 'orch-1' }),
      makePlan({ id: 'b', orchestratorAgentId: 'orch-1' }),
    ];
    const event = makeEvent({ type: 'agent.error', payload: { message: 'x' } });
    const result = notifyOrchestratorsOfFailure(event, plans, queue);
    expect(result.notified).toEqual(['orch-1']);
    expect(queue.sent).toHaveLength(1);
  });

  it('notifies multiple distinct orchestrators for different plans', () => {
    const plans = [
      makePlan({ id: 'a', orchestratorAgentId: 'orch-a' }),
      makePlan({ id: 'b', orchestratorAgentId: 'orch-b' }),
    ];
    const event = makeEvent({ type: 'agent.error', payload: { message: 'x' } });
    const result = notifyOrchestratorsOfFailure(event, plans, queue);
    expect(result.notified.sort()).toEqual(['orch-a', 'orch-b']);
    expect(queue.sent).toHaveLength(2);
  });

  it('truncates very long error messages to 300 chars', () => {
    const plan = makePlan({ orchestratorAgentId: 'orch-1' });
    const longMessage = 'x'.repeat(1000);
    const event = makeEvent({ type: 'agent.error', payload: { message: longMessage } });
    notifyOrchestratorsOfFailure(event, [plan], queue);
    // body = "... : xxx...". The reason substring should be capped at 300 chars.
    expect(queue.sent[0].content.length).toBeLessThan(600);
  });

  it('falls back to "unknown error" when payload is empty', () => {
    const plan = makePlan({ orchestratorAgentId: 'orch-1' });
    const event = makeEvent({ type: 'agent.error', payload: {} });
    notifyOrchestratorsOfFailure(event, [plan], queue);
    expect(queue.sent[0].content).toContain('unknown error');
  });

  // Connectors map PostToolUseFailure to agent.error, so without this filter a
  // grep with no match or a non-zero exit pings the orchestrator every time.
  it('ignores routine tool failures', () => {
    const plan = makePlan({ orchestratorAgentId: 'orch-1' });
    const event = makeEvent({
      type: 'agent.error',
      payload: { isToolFailure: true, message: 'File not found' },
    });
    const result = notifyOrchestratorsOfFailure(event, [plan], queue);
    expect(result.notified).toEqual([]);
    expect(result.skipped).toBe('tool-failure');
    expect(queue.sent).toHaveLength(0);
  });

  describe('repeat suppression', () => {
    it('sends an identical failure only once per cooldown', () => {
      const plan = makePlan({ orchestratorAgentId: 'orch-1' });
      const event = makeEvent({ type: 'agent.error', payload: { message: 'boom', taskId: '1.1' } });
      const recent = new Map<string, number>();

      notifyOrchestratorsOfFailure(event, [plan], queue, { recent, now: 1000 });
      const second = notifyOrchestratorsOfFailure(event, [plan], queue, { recent, now: 5000 });

      expect(queue.sent).toHaveLength(1);
      expect(second.notified).toEqual([]);
      expect(second.skipped).toBe('cooldown');
    });

    it('sends again once the cooldown expires', () => {
      const plan = makePlan({ orchestratorAgentId: 'orch-1' });
      const event = makeEvent({ type: 'agent.error', payload: { message: 'boom' } });
      const recent = new Map<string, number>();

      notifyOrchestratorsOfFailure(event, [plan], queue, { recent, now: 1000 });
      notifyOrchestratorsOfFailure(event, [plan], queue, { recent, now: 1000 + 60_001 });

      expect(queue.sent).toHaveLength(2);
    });

    it('does not suppress a different failure', () => {
      const plan = makePlan({ orchestratorAgentId: 'orch-1' });
      const recent = new Map<string, number>();

      notifyOrchestratorsOfFailure(
        makeEvent({ type: 'agent.error', payload: { message: 'boom' } }),
        [plan], queue, { recent, now: 1000 },
      );
      notifyOrchestratorsOfFailure(
        makeEvent({ type: 'agent.error', payload: { message: 'different' } }),
        [plan], queue, { recent, now: 1100 },
      );

      expect(queue.sent).toHaveLength(2);
    });
  });
});
