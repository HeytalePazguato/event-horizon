/**
 * Model Tier Manager — tiered model selection with success-rate tracking.
 * Recommends the cheapest viable model for a given task complexity + role,
 * tracks first-attempt success rates, and drops underperformers.
 */

// ── Types ──────────────────────────────────────────────────────────────────

export interface ModelTierConfig {
  tiers: string[];           // e.g. ['haiku', 'sonnet', 'opus'] — cheapest first
  successThreshold: number;  // minimum first-attempt success rate to stay in tier list (e.g. 0.3)
}

export interface ModelStats {
  attempts: number;
  successes: number;  // verification passed on first attempt
  failures: number;
  avgCostUsd: number;
}

interface StatsKey {
  model: string;
  role: string;
  complexity: string;
}

interface StatsEntry extends ModelStats {
  totalCostUsd: number;  // internal — avgCostUsd is derived
}

interface SerializedState {
  stats: Array<{ key: StatsKey; entry: StatsEntry }>;
}

// ── Default config ─────────────────────────────────────────────────────────

const DEFAULT_TIERS = ['haiku', 'sonnet', 'opus'];
const DEFAULT_THRESHOLD = 0.3;
const MIN_ATTEMPTS_FOR_STATS = 5;

// ── Manager ────────────────────────────────────────────────────────────────

export class ModelTierManager {
  private config: ModelTierConfig;
  private stats = new Map<string, StatsEntry>();

  constructor(config?: Partial<ModelTierConfig>) {
    this.config = {
      tiers: config?.tiers ?? [...DEFAULT_TIERS],
      successThreshold: config?.successThreshold ?? DEFAULT_THRESHOLD,
    };
  }

  /** Build a map key from model + role + complexity. */
  private key(model: string, role: string, complexity: string): string {
    return `${model}:${role}:${complexity}`;
  }

  /** Get success rate for a model+role+complexity combo. Returns null if insufficient data. */
  private getSuccessRate(model: string, role: string, complexity: string): number | null {
    const entry = this.stats.get(this.key(model, role, complexity));
    if (!entry || entry.attempts < MIN_ATTEMPTS_FOR_STATS) return null;
    return entry.successes / entry.attempts;
  }

  /** Get aggregated success rate for a model across all roles/complexities. */
  private getAggregateSuccessRate(model: string): number | null {
    let totalAttempts = 0;
    let totalSuccesses = 0;
    for (const [k, entry] of this.stats) {
      if (k.startsWith(`${model}:`)) {
        totalAttempts += entry.attempts;
        totalSuccesses += entry.successes;
      }
    }
    if (totalAttempts < MIN_ATTEMPTS_FOR_STATS) return null;
    return totalSuccesses / totalAttempts;
  }

  /**
   * Get the recommended model for a task with the given complexity and role.
   * Returns the cheapest tier with success rate above threshold, or falls
   * back to the next tier if insufficient data.
   */
  getRecommendedModel(complexity: string, role: string): string {
    const tiers = this.config.tiers;
    if (tiers.length === 0) return 'sonnet'; // fallback

    for (const model of tiers) {
      const rate = this.getSuccessRate(model, role, complexity);

      // Insufficient data — give this model a chance
      if (rate === null) return model;

      // Has enough data and is above threshold
      if (rate >= this.config.successThreshold) return model;

      // Below threshold — skip to next tier
    }

    // All tiers failed threshold — return the most capable (last tier)
    return tiers[tiers.length - 1];
  }

  /**
   * Get the next model tier after the given one (for escalation on failure).
   * Returns null if already at the highest tier.
   */
  getNextTier(currentModel: string): string | null {
    const idx = this.config.tiers.indexOf(currentModel);
    if (idx === -1 || idx >= this.config.tiers.length - 1) return null;
    return this.config.tiers[idx + 1];
  }

  /** Record an attempt result for a model+role+complexity. */
  recordAttempt(model: string, role: string, complexity: string, succeeded: boolean, costUsd: number): void {
    const k = this.key(model, role, complexity);
    let entry = this.stats.get(k);
    if (!entry) {
      entry = { attempts: 0, successes: 0, failures: 0, avgCostUsd: 0, totalCostUsd: 0 };
      this.stats.set(k, entry);
    }

    entry.attempts++;
    if (succeeded) {
      entry.successes++;
    } else {
      entry.failures++;
    }
    entry.totalCostUsd += costUsd;
    entry.avgCostUsd = entry.totalCostUsd / entry.attempts;
  }

  /** Get stats organized as model → role → ModelStats. */
  getStats(): Record<string, Record<string, ModelStats>> {
    const result: Record<string, Record<string, ModelStats>> = {};

    for (const [k, entry] of this.stats) {
      const [model, role] = k.split(':');
      if (!result[model]) result[model] = {};
      if (!result[model][role]) {
        result[model][role] = { attempts: 0, successes: 0, failures: 0, avgCostUsd: 0 };
      }
      const r = result[model][role];
      r.attempts += entry.attempts;
      r.successes += entry.successes;
      r.failures += entry.failures;
      r.avgCostUsd = (r.avgCostUsd * (r.attempts - entry.attempts) + entry.avgCostUsd * entry.attempts) / r.attempts;
    }

    return result;
  }

  /** Get models that have dropped below threshold across all roles. */
  getDisabledModels(): string[] {
    const disabled: string[] = [];
    for (const model of this.config.tiers) {
      const rate = this.getAggregateSuccessRate(model);
      if (rate !== null && rate < this.config.successThreshold) {
        disabled.push(model);
      }
    }
    return disabled;
  }

  /** Update the tier list (e.g. from plan metadata <!-- tiers: sonnet, opus -->). */
  setTiers(tiers: string[]): void {
    this.config.tiers = tiers;
  }

  /** Serialize state for persistence. */
  serialize(): SerializedState {
    const stats: SerializedState['stats'] = [];
    for (const [k, entry] of this.stats) {
      const [model, role, complexity] = k.split(':');
      stats.push({ key: { model, role, complexity }, entry });
    }
    return { stats };
  }

  /** Restore from persisted state. */
  restore(state: SerializedState): void {
    this.stats.clear();
    for (const { key: k, entry } of state.stats) {
      this.stats.set(this.key(k.model, k.role, k.complexity), entry);
    }
  }
}
