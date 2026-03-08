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
  'server.instance.disposed': 'agent.terminate',
  'tool.execute.before': 'tool.call',
  'tool.execute.after': 'tool.result',
  'file.edited': 'file.write',
  'file.watcher.updated': 'file.read',
};

function nextId(): string {
  return `ev-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Track seen message IDs to deduplicate message.updated events. */
const seenMessageIds = new Set<string>();

export function mapOpenCodeToEvent(raw: unknown): AgentEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const eventName = o.event ?? o.name;
  if (typeof eventName !== 'string') return null;

  const agentId = String(o.agentId ?? o.sessionId ?? 'opencode-1').slice(0, 128);
  const agentName = String(o.agentName ?? 'OpenCode').slice(0, 64);
  const payload = (o.payload as Record<string, unknown>) ?? (o.data as Record<string, unknown>) ?? {};

  // message.updated: only create task.start for NEW user messages, task.progress for assistant
  if (eventName === 'message.updated') {
    const info = (payload.properties as Record<string, unknown>)?.info as Record<string, unknown> | undefined;
    const role = info?.role as string | undefined;
    const messageId = info?.id as string | undefined;

    if (role === 'user' && messageId && !seenMessageIds.has(messageId)) {
      seenMessageIds.add(messageId);
      return { id: nextId(), agentId, agentName, agentType: 'opencode', type: 'task.start', timestamp: Date.now(), payload };
    }
    if (role === 'assistant') {
      return { id: nextId(), agentId, agentName, agentType: 'opencode', type: 'task.progress', timestamp: Date.now(), payload };
    }
    // Duplicate user message or unknown role — skip
    return null;
  }

  // session.status: map busy→task.progress, idle→agent.idle
  if (eventName === 'session.status') {
    const statusType = (payload.properties as Record<string, unknown>)?.status as Record<string, unknown> | undefined;
    const sType = statusType?.type as string | undefined;
    if (sType === 'busy') {
      return { id: nextId(), agentId, agentName, agentType: 'opencode', type: 'task.progress', timestamp: Date.now(), payload };
    }
    if (sType === 'idle') {
      return { id: nextId(), agentId, agentName, agentType: 'opencode', type: 'task.complete', timestamp: Date.now(), payload };
    }
    return null;
  }

  const type = OPENCODE_TO_EVENT[eventName] ?? (eventName.startsWith('tool.') ? 'tool.call' : null);
  if (!type) return null;

  // Extract toolName from OpenCode's event structure or from dedicated hook payload
  const enrichedPayload = { ...payload };
  if (type === 'tool.call' || type === 'tool.result') {
    const toolName = (payload.toolName as string)
      ?? (payload.tool as string)
      ?? ((payload.properties as Record<string, unknown>)?.tool as string)
      ?? undefined;
    if (toolName) enrichedPayload.toolName = toolName;
  }

  return {
    id: nextId(),
    agentId,
    agentName,
    agentType: 'opencode',
    type,
    timestamp: (o.timestamp as number) ?? Date.now(),
    payload: enrichedPayload,
  };
}

export function createOpenCodeAdapter(): (raw: unknown) => AgentEvent | null {
  return mapOpenCodeToEvent;
}
