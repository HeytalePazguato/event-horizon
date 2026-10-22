/**
 * CostResolver — holds cost per agent per source and resolves by precedence
 * (otel > statusline > agent-reported > transcript-estimated), carrying provenance
 * with every figure. Replaces last-writer-wins, which is an arrival-order race once a
 * second source exists.
 *
 * `agent-reported` is cost the agent runtime itself computed and exposed (OpenCode's
 * per-message cost via the session backfill). It is measured, not estimated.
 */

export type CostSource = 'otel' | 'statusline' | 'agent-reported' | 'transcript-estimated';

/** Highest precedence first. */
export const COST_SOURCE_PRECEDENCE: readonly CostSource[] = ['otel', 'statusline', 'agent-reported', 'transcript-estimated'];

export interface CostMeta {
  model?: string;
  unpriced?: boolean;
}

export interface ResolvedCost {
  costUsd: number;
  source: CostSource;
  estimated: boolean;
}

interface CostEntry {
  costUsd: number;
  meta?: CostMeta;
}

export class CostResolver {
  private readonly entries = new Map<string, Map<CostSource, CostEntry>>();

  submit(agentId: string, source: CostSource, costUsd: number, meta?: CostMeta): void {
    if (!Number.isFinite(costUsd) || costUsd < 0) return;
    let perSource = this.entries.get(agentId);
    if (!perSource) {
      perSource = new Map();
      this.entries.set(agentId, perSource);
    }
    perSource.set(source, { costUsd, meta });
  }

  resolve(agentId: string): ResolvedCost | null {
    const perSource = this.entries.get(agentId);
    if (!perSource) return null;
    for (const source of COST_SOURCE_PRECEDENCE) {
      const entry = perSource.get(source);
      if (entry) {
        return {
          costUsd: entry.costUsd,
          source,
          estimated: source === 'transcript-estimated' || entry.meta?.unpriced === true,
        };
      }
    }
    return null;
  }

  clear(agentId: string): void {
    this.entries.delete(agentId);
  }
}
