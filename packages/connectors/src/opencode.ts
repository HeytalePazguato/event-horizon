/**
 * OpenCode plugin adapter — maps OpenCode plugin events to AgentEvent.
 * @event-horizon/connectors
 */

import type { AgentEvent, AgentEventType } from '@event-horizon/core';

const OPENCODE_TO_EVENT: Record<string, AgentEventType> = {
  'session.created': 'agent.spawn',
  'session.deleted': 'agent.terminate',
  'session.idle': 'agent.idle',
  'session.error': 'agent.error',
  'tool.execute.before': 'tool.call',
  'tool.execute.after': 'tool.result',
  'message.updated': 'message.send',
  'file.edited': 'file.write',
  'file.watcher.updated': 'file.read',
};

function nextId(): string {
  return `ev-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function mapOpenCodeToEvent(raw: unknown): AgentEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const eventName = o.event ?? o.name;
  if (typeof eventName !== 'string') return null;

  const type = OPENCODE_TO_EVENT[eventName] ?? (eventName.startsWith('tool.') ? 'tool.call' : null);
  if (!type) return null;

  const agentId = String(o.agentId ?? o.sessionId ?? 'opencode-1').slice(0, 128);
  const agentName = String(o.agentName ?? 'OpenCode').slice(0, 64);

  return {
    id: nextId(),
    agentId,
    agentName,
    agentType: 'opencode',
    type,
    timestamp: (o.timestamp as number) ?? Date.now(),
    payload: (o.payload as Record<string, unknown>) ?? (o.data as Record<string, unknown>) ?? {},
  };
}

export function createOpenCodeAdapter(): (raw: unknown) => AgentEvent | null {
  return mapOpenCodeToEvent;
}
