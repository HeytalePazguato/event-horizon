/**
 * Budget Manager — tracks spending per plan and per agent.
 * Supports limits, per-agent breakdown, and warning thresholds.
 */

export interface BudgetEntry {
  planId: string;
  agentId: string;
  costUsd: number;
  tokens: number;
  timestamp: number;
}

export interface BudgetSummary {
  spent: number;
  limit: number;
  remaining: number;
  percentUsed: number;
}

export interface AgentCostBreakdown {
  agentId: string;
  costUsd: number;
  tokens: number;
  entries: number;
}

export interface BudgetState {
  limits: Record<string, number>;         // planId → maxUsd
  entries: BudgetEntry[];
}

export class BudgetManager {
  private limits = new Map<string, number>();     // planId → maxUsd
  private entries: BudgetEntry[] = [];
  private warningThreshold = 0.8;

  /** Set a budget limit for a plan. */
  setLimit(planId: string, maxUsd: number): void {
    this.limits.set(planId, maxUsd);
  }

  /** Get the limit for a plan. */
  getLimit(planId: string): number | undefined {
    return this.limits.get(planId);
  }

  /** Set the warning threshold (0-1). */
  setWarningThreshold(threshold: number): void {
    this.warningThreshold = Math.max(0, Math.min(1, threshold));
  }

  /** Get the warning threshold. */
  getWarningThreshold(): number {
    return this.warningThreshold;
  }

  /** Record a cost entry for a plan/agent. */
  recordCost(planId: string, agentId: string, costUsd: number, tokens = 0): void {
    this.entries.push({
      planId,
      agentId,
      costUsd,
      tokens,
      timestamp: Date.now(),
    });
  }

  /** Get remaining budget for a plan. */
  getRemaining(planId: string): BudgetSummary {
    const limit = this.limits.get(planId) ?? 0;
    const spent = this.entries
      .filter((e) => e.planId === planId)
      .reduce((sum, e) => sum + e.costUsd, 0);
    const remaining = Math.max(0, limit - spent);
    const percentUsed = limit > 0 ? spent / limit : 0;
    return { spent, limit, remaining, percentUsed };
  }

  /** Check if budget is exceeded. */
  isExceeded(planId: string): boolean {
    const summary = this.getRemaining(planId);
    return summary.limit > 0 && summary.spent >= summary.limit;
  }

  /** Check if budget is at warning threshold. */
  isWarning(planId: string): boolean {
    const summary = this.getRemaining(planId);
    return summary.limit > 0 && summary.percentUsed >= this.warningThreshold && !this.isExceeded(planId);
  }

  /** Get per-agent cost breakdown for a plan. */
  getBreakdown(planId: string): AgentCostBreakdown[] {
    const byAgent = new Map<string, { costUsd: number; tokens: number; entries: number }>();
    for (const e of this.entries) {
      if (e.planId !== planId) continue;
      const existing = byAgent.get(e.agentId) ?? { costUsd: 0, tokens: 0, entries: 0 };
      existing.costUsd += e.costUsd;
      existing.tokens += e.tokens;
      existing.entries++;
      byAgent.set(e.agentId, existing);
    }
    return Array.from(byAgent.entries()).map(([agentId, data]) => ({
      agentId,
      ...data,
    }));
  }

  /** Serialize for persistence. */
  serialize(): BudgetState {
    return {
      limits: Object.fromEntries(this.limits),
      entries: this.entries.slice(-1000), // keep last 1000 entries
    };
  }

  /** Restore from persistence. */
  restore(state: BudgetState): void {
    this.limits = new Map(Object.entries(state.limits ?? {}));
    this.entries = state.entries ?? [];
  }
}
