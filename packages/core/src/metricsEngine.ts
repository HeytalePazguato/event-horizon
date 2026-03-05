/**
 * Derives visual metrics from agent events.
 * @event-horizon/core
 */

import type { AgentEvent } from './events.js';

export interface AgentMetrics {
  agentId: string;
  load: number;
  tokenUsage: number;
  activeTasks: number;
  errorCount: number;
  lastUpdated: number;
}

export class MetricsEngine {
  process(_event: AgentEvent): void {
    // TODO: aggregate events into per-agent metrics
  }

  getMetrics(_agentId: string): AgentMetrics | null {
    return null;
  }
}
