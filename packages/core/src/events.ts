/**
 * Unified event model for AI agent activity.
 * @event-horizon/core
 */

export type AgentEventType =
  | 'agent.spawn'
  | 'agent.idle'
  | 'agent.error'
  | 'agent.terminate'
  | 'task.start'
  | 'task.progress'
  | 'task.complete'
  | 'task.fail'
  | 'tool.call'
  | 'tool.result'
  | 'file.read'
  | 'file.write'
  | 'message.send'
  | 'message.receive'
  | 'data.transfer'
  | 'agent.waiting';

export type AgentType = 'opencode' | 'claude-code' | 'copilot' | 'cursor' | 'unknown';

export interface AgentEvent {
  id: string;
  agentId: string;
  agentName: string;
  agentType: AgentType;
  type: AgentEventType;
  timestamp: number;
  payload: Record<string, unknown>;
  /** Workspace identifier — hierarchical partition for event filtering. Set from agent's cwd or VS Code workspace folder. */
  workspace?: string;
  /** Event category — derived from event type prefix: 'agent', 'task', 'tool', 'file', 'message', 'data'. */
  category?: string;
}

/** Derive event category from the dot-namespaced event type (e.g. 'tool.call' → 'tool'). */
export function deriveEventCategory(eventType: string): string {
  return eventType.split('.')[0];
}

/** All agent types for validation. */
export const AGENT_TYPES: readonly AgentType[] = [
  'opencode', 'claude-code', 'copilot', 'cursor', 'unknown',
] as const;

/** All event types for validation and iteration. */
export const AGENT_EVENT_TYPES: readonly AgentEventType[] = [
  'agent.spawn',
  'agent.idle',
  'agent.error',
  'agent.terminate',
  'task.start',
  'task.progress',
  'task.complete',
  'task.fail',
  'tool.call',
  'tool.result',
  'file.read',
  'file.write',
  'message.send',
  'message.receive',
  'data.transfer',
  'agent.waiting',
] as const;
