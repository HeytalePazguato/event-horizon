/**
 * Derives visual metrics from agent events.
 * @event-horizon/core
 */

import type { AgentEvent, AgentEventType } from './events.js';

export interface AgentMetrics {
  agentId: string;
  load: number;
  toolCalls: number;
  toolFailures: number;
  promptsSubmitted: number;
  subagentSpawns: number;
  activeSubagents: number;
  activeTasks: number;
  errorCount: number;
  sessionStartedAt: number;
  toolBreakdown: Record<string, number>;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  lastUpdated: number;
}

const EVENT_LOAD_WEIGHT: Partial<Record<AgentEventType, number>> = {
  'agent.spawn': 0.1,
  'agent.idle': 0,
  'agent.error': 0.5,
  'task.start': 0.2,
  'task.progress': 0.3,
  'task.complete': 0.2,
  'task.fail': 0.3,
  'tool.call': 0.4,
  'tool.result': 0.2,
  'file.read': 0.1,
  'file.write': 0.2,
  'message.send': 0.15,
  'message.receive': 0.1,
  'data.transfer': 0.2,
};

const LOAD_DECAY_PER_MS = 0.0002;

export class MetricsEngine {
  private metrics = new Map<string, AgentMetrics>();
  private loadByAgent = new Map<string, number>();

  process(event: AgentEvent): void {
    const agentId = event.agentId;
    const now = event.timestamp;

    let m = this.metrics.get(agentId);
    if (!m) {
      m = {
        agentId,
        load: 0,
        toolCalls: 0,
        toolFailures: 0,
        promptsSubmitted: 0,
        subagentSpawns: 0,
        activeSubagents: 0,
        activeTasks: 0,
        errorCount: 0,
        sessionStartedAt: now,
        toolBreakdown: {},
        inputTokens: -1,  // -1 = no data yet
        outputTokens: -1, // -1 = no data yet
        estimatedCostUsd: -1, // -1 = no data yet
        lastUpdated: now,
      };
      this.metrics.set(agentId, m);
      this.loadByAgent.set(agentId, 0);
    }

    // Decay load based on time since last update
    const elapsed = Math.max(0, now - m.lastUpdated);
    let load = this.loadByAgent.get(agentId) ?? 0;
    load = Math.max(0, load - elapsed * LOAD_DECAY_PER_MS);

    const weight = EVENT_LOAD_WEIGHT[event.type] ?? 0.1;
    load = Math.min(1, load + weight);
    this.loadByAgent.set(agentId, load);
    m.load = load;

    m.lastUpdated = now;

    const isSubagent = !!(event.payload?.isSubagent);
    const isToolFailure = !!(event.payload?.isToolFailure);

    switch (event.type) {
      case 'agent.spawn':
        m.sessionStartedAt = now;
        break;
      case 'agent.error':
        m.errorCount += 1;
        if (isToolFailure) m.toolFailures += 1;
        break;
      case 'tool.call': {
        m.toolCalls += 1;
        const toolName = (event.payload?.toolName as string) ?? 'unknown';
        m.toolBreakdown[toolName] = (m.toolBreakdown[toolName] ?? 0) + 1;
        // Cap tool breakdown to prevent unbounded growth
        const keys = Object.keys(m.toolBreakdown);
        if (keys.length > 100) {
          // Remove least-used entries
          const sorted = keys.sort((a, b) => m.toolBreakdown[a] - m.toolBreakdown[b]);
          for (let ki = 0; ki < sorted.length - 100; ki++) delete m.toolBreakdown[sorted[ki]];
        }
        break;
      }
      case 'task.start':
        if (isSubagent) {
          m.subagentSpawns += 1;
          m.activeSubagents += 1;
        } else {
          m.activeTasks += 1;
          m.promptsSubmitted += 1;
        }
        break;
      case 'task.complete':
      case 'task.fail':
        if (isSubagent) {
          if (m.activeSubagents > 0) m.activeSubagents -= 1;
          else m.activeTasks = Math.max(0, m.activeTasks - 1); // flag mismatch fallback
        } else {
          if (m.activeTasks > 0) m.activeTasks -= 1;
          else m.activeSubagents = Math.max(0, m.activeSubagents - 1); // flag mismatch fallback
        }
        break;
      case 'agent.terminate':
        // Clean up — remove all metrics for terminated agent
        this.metrics.delete(agentId);
        this.loadByAgent.delete(agentId);
        return;
      default:
        break;
    }

    // Accumulate token/cost data from event payload (session totals — replace, not add)
    const payload = event.payload as Record<string, unknown> | undefined;
    if (payload) {
      if (typeof payload.inputTokens === 'number') m.inputTokens = payload.inputTokens;
      if (typeof payload.outputTokens === 'number') m.outputTokens = payload.outputTokens;
      if (typeof payload.costUsd === 'number') m.estimatedCostUsd = payload.costUsd;
    }

    this.metrics.set(agentId, { ...m });
  }

  /** Remove all metrics for a terminated agent. */
  remove(agentId: string): void {
    this.metrics.delete(agentId);
    this.loadByAgent.delete(agentId);
  }

  getMetrics(agentId: string): AgentMetrics | null {
    return this.metrics.get(agentId) ?? null;
  }

  getAllMetrics(): AgentMetrics[] {
    return Array.from(this.metrics.values());
  }
}
