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

  // More specific patterns to reduce false positives
  let type: AgentEvent['type'] | null = null;
  if (/^(running|started|executing)\b/i.test(line) || /\b(running|executing)\s+(tool|command|task)\b/i.test(line)) type = 'task.start';
  else if (/^(completed?|done|finished|succeeded)\b/i.test(line) || /\btask\s+(completed?|done|finished)\b/i.test(line)) type = 'task.complete';
  else if (/^(error|failed|exception)\b/i.test(line) || /\b(failed to|error:)\s/i.test(line)) type = 'agent.error';
  else if (/\b(writ|edit|sav)(ing|e|ten)\s+[\w./\\]+\.\w{1,10}\b/i.test(line)) type = 'file.write';
  else if (/\b(read|open)(ing|ed)?\s+[\w./\\]+\.\w{1,10}\b/i.test(line)) type = 'file.read';
  else if (/\b(invoking|calling)\s+(tool|function|command)\b/i.test(line)) type = 'tool.call';

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
