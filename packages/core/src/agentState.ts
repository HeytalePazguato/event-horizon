/**
 * Agent, task, and ship state management.
 * @event-horizon/core
 */

import type { AgentEvent } from './events.js';

export interface AgentState {
  id: string;
  name: string;
  type: string;
  state: 'idle' | 'thinking' | 'error';
  currentTaskId: string | null;
}

export class AgentStateManager {
  private agents = new Map<string, AgentState>();

  apply(_event: AgentEvent): void {
    // TODO: update agent/task/ship state from events
  }

  getAgent(agentId: string): AgentState | undefined {
    return this.agents.get(agentId);
  }

  getAllAgents(): AgentState[] {
    return Array.from(this.agents.values());
  }
}
