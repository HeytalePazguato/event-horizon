/**
 * Mock data generator for development.
 * Produces realistic agent event streams with multiple agents, tasks, and data transfers.
 * @event-horizon/connectors
 */

import type { AgentEvent, AgentEventType, AgentType } from '@event-horizon/core';

let id = 0;
function nextId(): string {
  return `mock-${++id}`;
}

const MOCK_AGENTS: Array<{ id: string; name: string; type: AgentType }> = [
  { id: 'agent-opencode', name: 'OpenCode', type: 'opencode' },
  { id: 'agent-claude', name: 'Claude Code', type: 'claude-code' },
  { id: 'agent-copilot', name: 'Copilot', type: 'copilot' },
];

const TASK_EVENT_SEQUENCE: AgentEventType[] = [
  'task.start',
  'task.progress',
  'task.progress',
  'task.progress',
  'tool.call',
  'tool.result',
  'task.progress',
  'task.complete',
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function createMockEvent(overrides: Partial<AgentEvent> = {}): AgentEvent {
  const agent = pick(MOCK_AGENTS);
  return {
    id: nextId(),
    agentId: agent.id,
    agentName: agent.name,
    agentType: agent.type,
    type: 'task.start',
    timestamp: Date.now(),
    payload: {},
    ...overrides,
  };
}

/** Single event with random type and optional payload. */
export function createRandomMockEvent(): AgentEvent {
  const agent = pick(MOCK_AGENTS);
  const types: AgentEventType[] = [
    'task.start',
    'task.progress',
    'task.complete',
    'tool.call',
    'tool.result',
    'file.read',
    'file.write',
    'message.send',
    'data.transfer',
    'agent.idle',
  ];
  const type = pick(types);
  const payload: Record<string, unknown> = {};
  if (type === 'task.start') payload.taskId = nextId();
  if (type === 'task.progress') payload.progress = Math.random();
  if (type === 'tool.call' || type === 'tool.result') {
    payload.toolName = pick(['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob']);
  }
  if (type === 'data.transfer') {
    const other = pick(MOCK_AGENTS.filter((a) => a.id !== agent.id));
    payload.toAgentId = other.id;
    payload.payloadSize = Math.floor(Math.random() * 1000) + 100;
  }

  return createMockEvent({
    agentId: agent.id,
    agentName: agent.name,
    agentType: agent.type,
    type,
    timestamp: Date.now(),
    payload,
  });
}

/** Async generator: realistic stream with task lifecycles and data transfers. */
export async function* mockEventStream(intervalMs = 800): AsyncGenerator<AgentEvent> {
  let step = 0;
  const agent = pick(MOCK_AGENTS);
  let taskId: string | null = null;

  while (true) {
    const type = TASK_EVENT_SEQUENCE[step % TASK_EVENT_SEQUENCE.length];
    const payload: Record<string, unknown> = {};

    if (type === 'task.start') {
      taskId = nextId();
      payload.taskId = taskId;
      payload.complexity = Math.floor(Math.random() * 5) + 1;
    } else if (type === 'task.progress') {
      payload.taskId = taskId ?? nextId();
      payload.progress = Math.min(1, (step % 4) * 0.25);
    } else if (type === 'task.complete' || type === 'task.fail') {
      payload.taskId = taskId ?? nextId();
      taskId = null;
    } else if (type === 'tool.call' || type === 'tool.result') {
      payload.toolName = pick(['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob']);
    }

    yield createMockEvent({
      agentId: agent.id,
      agentName: agent.name,
      agentType: agent.type,
      type,
      timestamp: Date.now(),
      payload,
    });

    step++;
    if (step % 8 === 0) {
      const other = pick(MOCK_AGENTS.filter((a) => a.id !== agent.id));
      yield createMockEvent({
        agentId: agent.id,
        agentName: agent.name,
        agentType: agent.type,
        type: 'data.transfer',
        timestamp: Date.now(),
        payload: { toAgentId: other.id, payloadSize: Math.floor(Math.random() * 500) + 50 },
      });
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** One-time burst of N events for testing. */
export function createMockEventBurst(count: number): AgentEvent[] {
  const out: AgentEvent[] = [];
  for (let i = 0; i < count; i++) {
    out.push(createRandomMockEvent());
  }
  return out;
}
