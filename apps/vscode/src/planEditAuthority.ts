/**
 * Tracks which agent last wrote a plan file, and builds the LockManager
 * ownership rule that restricts plan-file edits to the plan's orchestrator.
 */

/** Copy of LockManager's normalization — keep in sync so the two always agree. */
export function defaultNormalizePath(p: string): string {
  return p.split('\\').join('/').toLowerCase();
}

export class PlanEditAuthority {
  private writes = new Map<string, Array<{ agentId: string; ts: number }>>();

  constructor(private readonly normalize: (p: string) => string = defaultNormalizePath) {}

  recordWrite(agentId: string, filePath: string, ts: number = Date.now()): void {
    const key = this.normalize(filePath);
    let list = this.writes.get(key);
    if (!list) {
      list = [];
      this.writes.set(key, list);
    }
    list.push({ agentId, ts });
    // Bound memory: keep only recent entries.
    if (list.length > 50) list.splice(0, list.length - 50);
  }

  /** Most recent writer of the file within the window, or null. */
  lastWriter(filePath: string, withinMs = 3000): string | null {
    const list = this.writes.get(this.normalize(filePath));
    if (!list || list.length === 0) return null;
    const now = Date.now();
    let best: { agentId: string; ts: number } | null = null;
    for (const w of list) {
      if (now - w.ts <= withinMs && (!best || w.ts >= best.ts)) best = w;
    }
    return best ? best.agentId : null;
  }

  ownershipRuleFor(
    getPlans: () => Array<{ sourceFile: string; orchestratorAgentId: string | null }>,
  ): (normPath: string) => string | null {
    return (normPath) => {
      for (const plan of getPlans()) {
        if (!plan.sourceFile || plan.sourceFile === 'inline' || !plan.orchestratorAgentId) continue;
        if (this.normalize(plan.sourceFile) === normPath) return plan.orchestratorAgentId;
      }
      return null;
    };
  }
}
