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
  | 'data.transfer';

export type AgentType = 'opencode' | 'claude-code' | 'copilot' | 'cursor' | 'unknown';

export interface AgentEvent {
  id: string;
  agentId: string;
  agentName: string;
  agentType: AgentType;
  type: AgentEventType;
  timestamp: number;
  payload: Record<string, unknown>;
}

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
] as const;
