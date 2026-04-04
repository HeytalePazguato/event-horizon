/**
 * Agent Profiler — tracks historical agent performance across tasks.
 * Stores task records, computes per-agent-type profiles grouped by role,
 * and provides scored recommendations for role assignment.
 */

// ── Interfaces ─────────────────────────────────────────────────────────────

export interface TaskRecord {
  taskId: string;
  planId: string;
  agentId: string;
  agentType: string;
  agentName: string;
  role: string | null;
  claimedAt: number;
  completedAt: number;
  status: 'done' | 'failed';
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  toolCalls: number;
  errorCount: number;
}

export interface RoleStats {
  total: number;
  completed: number;
  failed: number;
  avgDurationMs: number;
  avgCostUsd: number;
  avgTokens: number;
  successRate: number; // 0-1
}

export interface AgentTypeProfile {
  agentType: string;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  overallSuccessRate: number;
  avgDurationMs: number;
  avgCostUsd: number;
  byRole: Record<string, RoleStats>;
  lastUpdated: number;
}

export interface AgentRecommendation {
  agentType: string;
  score: number; // 0-100
  reason: string;
  stats: RoleStats;
}

// ── AgentProfiler ──────────────────────────────────────────────────────────

export class AgentProfiler {
  private records: TaskRecord[] = [];
  private profiles: Map<string, AgentTypeProfile> = new Map();
  private maxRecords: number;

  constructor(maxRecords = 500) {
    this.maxRecords = maxRecords;
  }

  /** Store a task record, evicting oldest if over capacity, then rebuild the profile. */
  recordTask(record: TaskRecord): void {
    this.records.push(record);
    if (this.records.length > this.maxRecords) {
      this.records.shift();
    }
    this.rebuildProfile(record.agentType);
  }

  /** Get the computed profile for a given agent type, or null if none exists. */
  getProfile(agentType: string): AgentTypeProfile | null {
    return this.profiles.get(agentType) ?? null;
  }

  /** Get all computed profiles. */
  getAllProfiles(): AgentTypeProfile[] {
    return Array.from(this.profiles.values());
  }

  /**
   * Recommend agent types for a given role, ranked by score descending.
   * Returns an empty array if no records exist for that role.
   */
  recommendForRole(roleId: string): AgentRecommendation[] {
    // Gather per-agent-type stats for this role
    const candidates: Array<{ agentType: string; stats: RoleStats }> = [];

    for (const [agentType, profile] of this.profiles) {
      const roleStats = profile.byRole[roleId];
      if (roleStats && roleStats.total > 0) {
        candidates.push({ agentType, stats: roleStats });
      }
    }

    if (candidates.length === 0) {
      return [];
    }

    // Compute normalization ranges for speed and cost
    const durations = candidates.map((c) => c.stats.avgDurationMs);
    const costs = candidates.map((c) => c.stats.avgCostUsd);

    const minDuration = Math.min(...durations);
    const maxDuration = Math.max(...durations);
    const durationRange = maxDuration - minDuration;

    const minCost = Math.min(...costs);
    const maxCost = Math.max(...costs);
    const costRange = maxCost - minCost;

    const recommendations: AgentRecommendation[] = candidates.map(({ agentType, stats }) => {
      // Insufficient data check
      if (stats.total < 3) {
        return {
          agentType,
          score: 0,
          reason: `Insufficient data (${stats.total} tasks recorded)`,
          stats,
        };
      }

      const speedScore = durationRange === 0 ? 1.0 : (maxDuration - stats.avgDurationMs) / durationRange;
      const costScore = costRange === 0 ? 1.0 : (maxCost - stats.avgCostUsd) / costRange;
      const score = stats.successRate * 40 + speedScore * 30 + costScore * 30;

      const pct = (stats.successRate * 100).toFixed(1);
      const duration = (stats.avgDurationMs / 1000).toFixed(1);
      const cost = stats.avgCostUsd.toFixed(4);
      const reason = `Success: ${pct}%, avg ${duration}s, avg $${cost}`;

      return { agentType, score, reason, stats };
    });

    recommendations.sort((a, b) => b.score - a.score);
    return recommendations;
  }

  /** Serialize all records for persistence (e.g. globalState). */
  serialize(): TaskRecord[] {
    return [...this.records];
  }

  /** Restore records from persistence and rebuild all profiles. */
  restore(records: TaskRecord[]): void {
    this.records = [...records];
    // Truncate to maxRecords if the restored set exceeds capacity
    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(this.records.length - this.maxRecords);
    }
    this.profiles.clear();
    const agentTypes = new Set(this.records.map((r) => r.agentType));
    for (const agentType of agentTypes) {
      this.rebuildProfile(agentType);
    }
  }

  /** Recompute the AgentTypeProfile for the given agent type from current records. */
  private rebuildProfile(agentType: string): void {
    const filtered = this.records.filter((r) => r.agentType === agentType);
    if (filtered.length === 0) {
      this.profiles.delete(agentType);
      return;
    }

    const completedTasks = filtered.filter((r) => r.status === 'done').length;
    const failedTasks = filtered.filter((r) => r.status === 'failed').length;
    const totalDuration = filtered.reduce((sum, r) => sum + r.durationMs, 0);
    const totalCost = filtered.reduce((sum, r) => sum + r.estimatedCostUsd, 0);

    // Group by role
    const roleGroups = new Map<string, TaskRecord[]>();
    for (const rec of filtered) {
      const key = rec.role ?? '__none__';
      const group = roleGroups.get(key);
      if (group) {
        group.push(rec);
      } else {
        roleGroups.set(key, [rec]);
      }
    }

    const byRole: Record<string, RoleStats> = {};
    for (const [role, group] of roleGroups) {
      const completed = group.filter((r) => r.status === 'done').length;
      const failed = group.filter((r) => r.status === 'failed').length;
      const avgDuration = group.reduce((s, r) => s + r.durationMs, 0) / group.length;
      const avgCost = group.reduce((s, r) => s + r.estimatedCostUsd, 0) / group.length;
      const avgTokens = group.reduce((s, r) => s + r.inputTokens + r.outputTokens, 0) / group.length;
      byRole[role] = {
        total: group.length,
        completed,
        failed,
        avgDurationMs: avgDuration,
        avgCostUsd: avgCost,
        avgTokens,
        successRate: completed / group.length,
      };
    }

    this.profiles.set(agentType, {
      agentType,
      totalTasks: filtered.length,
      completedTasks,
      failedTasks,
      overallSuccessRate: completedTasks / filtered.length,
      avgDurationMs: totalDuration / filtered.length,
      avgCostUsd: totalCost / filtered.length,
      byRole,
      lastUpdated: Date.now(),
    });
  }
}
