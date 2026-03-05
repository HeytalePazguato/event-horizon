/**
 * Mock data generator for development.
 * @event-horizon/connectors
 */

import type { AgentEvent } from '@event-horizon/core';

let id = 0;
function nextId(): string {
  return `mock-${++id}`;
}

export function createMockEvent(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    id: nextId(),
    agentId: 'agent-1',
    agentName: 'Mock Agent',
    agentType: 'opencode',
    type: 'task.start',
    timestamp: Date.now(),
    payload: {},
    ...overrides,
  };
}

export async function* mockEventStream(intervalMs = 1000): AsyncGenerator<AgentEvent> {
  const types = ['task.start', 'task.progress', 'task.complete', 'tool.call', 'message.send'] as const;
  while (true) {
    yield createMockEvent({ type: types[Math.floor(Math.random() * types.length)] });
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
