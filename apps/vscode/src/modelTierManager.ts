/**
 * Model Tier Manager — tiered model selection with success-rate tracking.
 * Recommends the cheapest viable model for a given task complexity + role,
 * tracks first-attempt success rates, and drops underperformers.
 */

import { MODEL_PRICES, costOfTokens, type ModelTier } from './modelPricing.js';

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

// Fixed representative task size used to normalize per-tier cost when scoring.
const REPRESENTATIVE_AVG_TOKENS = 10_000;
// Weights for the blended cost/success score (must sum to 1).
const COST_WEIGHT = 0.5;
const SUCCESS_WEIGHT = 0.5;
// Optimistic success rate assumed for a tier with insufficient data — gives
// untested tiers a chance (mirrors the pre-cost "return on null" behavior).
const UNTESTED_SUCCESS_RATE = 1;

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
   * Estimate the USD cost of a task on the given tier, assuming a
   * representative 70% input / 30% output token split (no cache activity).
   */
  estimateTaskCost(tier: ModelTier, avgTokens: number): number {
    return costOfTokens(tier, {
      input: avgTokens * 0.7,
      output: avgTokens * 0.3,
      cacheRead: 0,
      cacheCreation: 0,
    });
  }

  /**
   * Get the recommended model for a task with the given complexity and role.
   *
   * Among the tiers whose historical first-attempt success rate clears the
   * threshold (tiers with insufficient data are given a chance), pick the one
   * minimizing a blended score of normalized cost and failure rate:
   *   normalizedCost * 0.5 + (1 - successRate) * 0.5
   * Cost is min-max normalized across the three known tiers at a fixed
   * representative task size. The static cheapest-first tier order breaks ties.
   * If no tier clears the threshold, fall back to the most capable (last) tier.
   */
  getRecommendedModel(complexity: string, role: string): string {
    const tiers = this.config.tiers;
    if (tiers.length === 0) return 'sonnet'; // fallback

    // Min-max range of the representative cost across the three known tiers.
    const knownTiers = Object.keys(MODEL_PRICES) as ModelTier[];
    const costs = knownTiers.map((t) => this.estimateTaskCost(t, REPRESENTATIVE_AVG_TOKENS));
    const minCost = Math.min(...costs);
    const maxCost = Math.max(...costs);
    const costRange = maxCost - minCost;

    let best: string | null = null;
    let bestScore = Infinity;

    // Iterate cheapest-first so the first-seen tier wins on tied scores.
    for (const model of tiers) {
      const rate = this.getSuccessRate(model, role, complexity);

      // Below threshold with enough data — not a candidate.
      if (rate !== null && rate < this.config.successThreshold) continue;

      // Insufficient data gets an optimistic rate so it still competes.
      const successRate = rate ?? UNTESTED_SUCCESS_RATE;

      // Cost normalization only applies to the three known tiers; unknown
      // tiers score as most expensive so they don't win on cost alone.
      const isKnown = (knownTiers as string[]).includes(model);
      const cost = isKnown ? this.estimateTaskCost(model as ModelTier, REPRESENTATIVE_AVG_TOKENS) : maxCost;
      const normalizedCost = costRange > 0 ? (cost - minCost) / costRange : 0;

      const score = normalizedCost * COST_WEIGHT + (1 - successRate) * SUCCESS_WEIGHT;

      // Strictly-less keeps the earlier (cheaper) tier on ties.
      if (score < bestScore) {
        bestScore = score;
        best = model;
      }
    }

    if (best !== null) return best;

    // No tier cleared the threshold — return the most capable (last tier).
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
