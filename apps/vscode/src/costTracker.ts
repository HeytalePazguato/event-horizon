/**
 * CostTracker — the single entry point for cost samples in the extension host.
 *
 * Every producer (transcript watcher, OpenCode backfill, statusLine bridge, OTLP
 * receiver) reports a CUMULATIVE session cost tagged with its source. The tracker
 * feeds the resolver (live per-agent figure + estimated flag) and the ledger
 * (durable, survives eviction and restarts), and returns how much the agent's
 * total moved so budgets can record a delta instead of re-adding the cumulative
 * value on every event.
 */

import type { AgentEvent } from '@event-horizon/core';
import { CostResolver, COST_SOURCE_PRECEDENCE, type CostSource } from './costResolver.js';
import { CostLedger, type CostEntry } from './costLedger.js';

export interface CostUpdate {
  agentId: string;
  /** Agent total across sessions, from the ledger. */
  totalUsd: number;
  /** True when the winning source for the agent is an estimate. */
  estimated: boolean;
  source: CostSource;
  /** Change in the agent total caused by this sample (may be negative when a measured source replaces a higher estimate). */
  deltaUsd: number;
}

export class CostTracker {
  readonly resolver = new CostResolver();

  constructor(readonly ledger: CostLedger = new CostLedger(null)) {}

  record(entry: CostEntry & { unpriced?: boolean }): CostUpdate | null {
    if (!Number.isFinite(entry.costUsd) || entry.costUsd < 0) return null;
    const before = this.ledger.totalForAgent(entry.agentId);
    this.resolver.submit(entry.agentId, entry.source, entry.costUsd, { model: entry.model, unpriced: entry.unpriced });
    this.ledger.record(entry);
    const resolved = this.resolver.resolve(entry.agentId);
    if (!resolved) return null;
    const totalUsd = this.ledger.totalForAgent(entry.agentId);
    return { agentId: entry.agentId, totalUsd, estimated: resolved.estimated, source: resolved.source, deltaUsd: totalUsd - before };
  }

  /** Called when an agent is evicted: the live figure goes, the ledger keeps the spend. */
  evict(agentId: string): void {
    this.resolver.clear(agentId);
  }

  /** Grand total across every agent the ledger knows, live or evicted. */
  grandTotal(): number {
    let total = 0;
    for (const v of this.ledger.allTotals().values()) total += v;
    return total;
  }
}

const KNOWN_SOURCES = new Set<string>(COST_SOURCE_PRECEDENCE);

/**
 * Extract a cost sample from an event payload carrying `costUsd`, or null.
 * Producers that predate source tagging default to `agent-reported`, except the
 * transcript watcher, which always tags `transcript-estimated`.
 */
export function costSampleFromEvent(event: AgentEvent): (CostEntry & { unpriced?: boolean }) | null {
  const p = event.payload as Record<string, unknown> | undefined;
  if (!p || typeof p.costUsd !== 'number') return null;
  const source = typeof p.costSource === 'string' && KNOWN_SOURCES.has(p.costSource)
    ? p.costSource as CostSource
    : 'agent-reported';
  const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
  return {
    agentId: event.agentId,
    // Claude and OpenCode agent ids are per-session already. Payload session ids are
    // runtime-internal (OpenCode child sessions) and would split one agent's total.
    sessionId: event.agentId,
    model: typeof p.model === 'string' ? p.model : undefined,
    source,
    costUsd: p.costUsd,
    unpriced: p.costUnpriced === true,
    tokens: { input: num(p.inputTokens), output: num(p.outputTokens) },
    timestamp: event.timestamp,
  };
}
