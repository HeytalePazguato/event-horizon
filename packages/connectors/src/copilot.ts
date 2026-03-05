/**
 * GitHub Copilot adapter — infers events from output channel content.
 * @event-horizon/connectors
 */

import type { AgentEvent } from '@event-horizon/core';

function nextId(): string {
  return `ev-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function mapCopilotOutputToEvent(output: string): AgentEvent | null {
  if (!output || typeof output !== 'string') return null;
  const line = output.trim();
  if (!line) return null;

  let type: AgentEvent['type'] | null = null;
  if (/\b(running|started|executing)\b/i.test(line)) type = 'task.start';
  else if (/\b(complete|done|finished|success)\b/i.test(line)) type = 'task.complete';
  else if (/\b(error|failed|exception)\b/i.test(line)) type = 'agent.error';
  else if (/\b(write|editing|saving)\s+\S+\.\w+/i.test(line)) type = 'file.write';
  else if (/\b(read|reading|opening)\s+\S+/i.test(line)) type = 'file.read';
  else if (/\b(tool|command|invok)\w*/i.test(line)) type = 'tool.call';

  if (!type) return null;

  return {
    id: nextId(),
    agentId: 'copilot-1',
    agentName: 'GitHub Copilot',
    agentType: 'copilot',
    type,
    timestamp: Date.now(),
    payload: { raw: line.slice(0, 200) },
  };
}

export function createCopilotAdapter(): (output: string) => AgentEvent | null {
  return mapCopilotOutputToEvent;
}
