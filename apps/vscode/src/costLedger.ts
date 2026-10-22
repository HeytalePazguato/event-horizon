/**
 * CostLedger — durable, terminate-proof cost totals per agent and session.
 *
 * SEMANTICS (read before changing): cost sources report CUMULATIVE session totals
 * (Claude statusLine `cost.total_cost_usd`, summed OTel `claude_code.cost.usage`,
 * transcript running estimate) — not per-turn deltas. Summing every recorded sample
 * would double-count. So rows are keyed by (agentId, sessionId, source) and each
 * `record()` REPLACES the previous sample for that key (latest timestamp wins).
 *
 * An agent's total is then:
 *   sum over its sessions of the value from the highest-precedence source present
 *   for that session (otel > statusline > transcript-estimated, same as CostResolver).
 * A lower-precedence sample can never override or add to a higher-precedence one.
 *
 * There is deliberately no terminate/clear API: cost outlives the agent. Only
 * `prune()` removes data. Running totals are held in memory so reads on the render
 * path never touch SQLite; SQLite is hydrated on construction and written through.
 * With `db === null` (persistence disabled) the ledger works purely in memory.
 */

import { COST_SOURCE_PRECEDENCE, type CostSource } from './costResolver.js';
import type { EventHorizonDB } from './persistence.js';

export interface CostEntry {
  agentId: string;
  sessionId?: string;
  planId?: string;
  model?: string;
  source: CostSource;
  /** Cumulative session cost in USD as reported by `source` (not a delta). */
  costUsd: number;
  tokens?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheCreation?: number;
  };
  timestamp: number;
}

type LedgerDb = Pick<EventHorizonDB, 'upsertCostEntry' | 'queryCostByAgent' | 'queryCostTotals' | 'pruneCostLedger'>;

const rowId = (agentId: string, sessionId: string | undefined, source: CostSource): string =>
  `${agentId}|${sessionId ?? ''}|${source}`;

export class CostLedger {
  /** One row per (agent, session, source) — the latest cumulative sample. */
  private readonly rows = new Map<string, CostEntry>();
  private readonly agentTotals = new Map<string, number>();
  private readonly sessionTotals = new Map<string, number>();

  constructor(private readonly db: LedgerDb | null) {
    if (db) this.hydrate(db);
  }

  record(entry: CostEntry): void {
    if (!Number.isFinite(entry.costUsd) || entry.costUsd < 0) return;
    const id = rowId(entry.agentId, entry.sessionId, entry.source);
    const prev = this.rows.get(id);
    if (prev && prev.timestamp > entry.timestamp) return; // stale sample
    this.rows.set(id, entry);
    this.recompute(entry.agentId);
    this.db?.upsertCostEntry({
      id,
      agentId: entry.agentId,
      sessionId: entry.sessionId,
      planId: entry.planId,
      model: entry.model,
      source: entry.source,
      costUsd: entry.costUsd,
      inputTokens: entry.tokens?.input,
      outputTokens: entry.tokens?.output,
      cacheReadTokens: entry.tokens?.cacheRead,
      cacheCreationTokens: entry.tokens?.cacheCreation,
      timestamp: entry.timestamp,
    });
  }

  totalForAgent(agentId: string): number {
    return this.agentTotals.get(agentId) ?? 0;
  }

  /** Total for a session id, summed across agents that reported it. */
  totalForSession(sessionId: string): number {
    return this.sessionTotals.get(sessionId) ?? 0;
  }

  allTotals(): Map<string, number> {
    return new Map(this.agentTotals);
  }

  /**
   * Drop samples older than `Date.now() - olderThanMs`.
   * @returns Number of rows removed.
   */
  prune(olderThanMs: number): number {
    const cutoff = Date.now() - olderThanMs;
    const affected = new Set<string>();
    let removed = 0;
    for (const [id, e] of this.rows) {
      if (e.timestamp < cutoff) {
        this.rows.delete(id);
        affected.add(e.agentId);
        removed++;
      }
    }
    for (const agentId of affected) this.recompute(agentId);
    this.db?.pruneCostLedger(olderThanMs);
    return removed;
  }

  private hydrate(db: LedgerDb): void {
    for (const { agentId } of db.queryCostTotals()) {
      for (const r of db.queryCostByAgent(agentId)) {
        this.rows.set(rowId(r.agentId, r.sessionId, r.source), {
          agentId: r.agentId,
          sessionId: r.sessionId,
          planId: r.planId,
          model: r.model,
          source: r.source,
          costUsd: r.costUsd,
          tokens: {
            input: r.inputTokens,
            output: r.outputTokens,
            cacheRead: r.cacheReadTokens,
            cacheCreation: r.cacheCreationTokens,
          },
          timestamp: r.timestamp,
        });
      }
      this.recompute(agentId);
    }
  }

  /** Recompute one agent's total (and its sessions') from the winning source per session. */
  private recompute(agentId: string): void {
    const bySession = new Map<string, Map<CostSource, number>>();
    for (const e of this.rows.values()) {
      if (e.agentId !== agentId) continue;
      const key = e.sessionId ?? '';
      let perSource = bySession.get(key);
      if (!perSource) bySession.set(key, (perSource = new Map()));
      perSource.set(e.source, e.costUsd);
    }

    let agentTotal = 0;
    for (const perSource of bySession.values()) {
      const winner = COST_SOURCE_PRECEDENCE.find((s) => perSource.has(s));
      if (winner) agentTotal += perSource.get(winner)!;
    }
    if (bySession.size === 0) this.agentTotals.delete(agentId);
    else this.agentTotals.set(agentId, agentTotal);

    this.rebuildSessionTotals();
  }

  private rebuildSessionTotals(): void {
    // (sessionId -> agentId -> source -> cost); a session id may in theory be shared by agents.
    const grouped = new Map<string, Map<string, Map<CostSource, number>>>();
    for (const e of this.rows.values()) {
      if (e.sessionId === undefined) continue;
      let byAgent = grouped.get(e.sessionId);
      if (!byAgent) grouped.set(e.sessionId, (byAgent = new Map()));
      let m = byAgent.get(e.agentId);
      if (!m) byAgent.set(e.agentId, (m = new Map()));
      m.set(e.source, e.costUsd);
    }
    this.sessionTotals.clear();
    for (const [sessionId, byAgent] of grouped) {
      let total = 0;
      for (const m of byAgent.values()) {
        const winner = COST_SOURCE_PRECEDENCE.find((s) => m.has(s));
        if (winner) total += m.get(winner)!;
      }
      this.sessionTotals.set(sessionId, total);
    }
  }
}
