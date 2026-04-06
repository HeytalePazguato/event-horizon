/**
 * Shared Knowledge Store — layered knowledge base for multi-agent coordination.
 *
 * Two scopes:
 *   - workspace: persistent across plans/sessions (tech stack, conventions, constraints)
 *   - plan: scoped to active plan (task findings, decisions, corrections)
 *
 * Both humans and agents can read/write. All entries visible to all agents.
 */

export type KnowledgeScope = 'workspace' | 'plan';

export interface KnowledgeEntry {
  key: string;
  value: string;
  scope: KnowledgeScope;
  author: string;        // agent name or 'user'
  authorId: string;      // agent ID or 'user'
  createdAt: number;
  updatedAt: number;
}

const MAX_WORKSPACE_ENTRIES = 200;
const MAX_PLAN_ENTRIES = 300;
const SUMMARY_TRUNCATE = 200;

export class SharedKnowledgeStore {
  private workspace = new Map<string, KnowledgeEntry>();
  private planEntries = new Map<string, Map<string, KnowledgeEntry>>(); // planId -> entries
  private changeListeners: Array<() => void> = [];

  onChange(listener: () => void): void {
    this.changeListeners.push(listener);
  }

  private notifyChange(): void {
    for (const fn of this.changeListeners) fn();
  }

  /**
   * Write a knowledge entry. Upserts by key within scope.
   */
  write(
    key: string,
    value: string,
    scope: KnowledgeScope,
    author: string,
    authorId: string,
    planId?: string,
  ): KnowledgeEntry {
    const now = Date.now();

    if (scope === 'workspace') {
      const existing = this.workspace.get(key);
      const entry: KnowledgeEntry = {
        key,
        value,
        scope,
        author,
        authorId,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      this.workspace.set(key, entry);
      this.enforceLimit(this.workspace, MAX_WORKSPACE_ENTRIES);
      this.notifyChange();
      return entry;
    }

    // Plan scope
    const pid = planId ?? '_default';
    if (!this.planEntries.has(pid)) {
      this.planEntries.set(pid, new Map());
    }
    const planMap = this.planEntries.get(pid)!;
    const existing = planMap.get(key);
    const entry: KnowledgeEntry = {
      key,
      value,
      scope,
      author,
      authorId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    planMap.set(key, entry);
    this.enforceLimit(planMap, MAX_PLAN_ENTRIES);
    this.notifyChange();
    return entry;
  }

  /**
   * Read entries. If key provided, returns single entry (merged lookup: plan first, then workspace).
   * If no key, returns all entries merged (workspace + active plan).
   */
  read(key?: string, planId?: string): KnowledgeEntry[] {
    const pid = planId ?? '_default';
    const planMap = this.planEntries.get(pid);

    if (key) {
      const planEntry = planMap?.get(key);
      if (planEntry) return [planEntry];
      const wsEntry = this.workspace.get(key);
      if (wsEntry) return [wsEntry];
      return [];
    }

    // Return all: workspace first, then plan
    const results: KnowledgeEntry[] = [];
    for (const entry of this.workspace.values()) {
      results.push(entry);
    }
    if (planMap) {
      for (const entry of planMap.values()) {
        results.push(entry);
      }
    }
    return results;
  }

  /**
   * Delete an entry. Returns true if found and deleted.
   * callerAuthorId is used to enforce ownership for agents (user can delete any).
   */
  delete(key: string, scope: KnowledgeScope, callerAuthorId: string, planId?: string): boolean {
    if (scope === 'workspace') {
      const entry = this.workspace.get(key);
      if (!entry) return false;
      // User can delete any, agents can only delete their own
      if (callerAuthorId !== 'user' && entry.authorId !== callerAuthorId) return false;
      this.workspace.delete(key);
      this.notifyChange();
      return true;
    }

    const pid = planId ?? '_default';
    const planMap = this.planEntries.get(pid);
    if (!planMap) return false;
    const entry = planMap.get(key);
    if (!entry) return false;
    if (callerAuthorId !== 'user' && entry.authorId !== callerAuthorId) return false;
    planMap.delete(key);
    this.notifyChange();
    return true;
  }

  /**
   * Get a markdown summary of all knowledge, grouped by scope and author.
   */
  getSummary(planId?: string): string {
    const sections: string[] = [];

    // Workspace section
    const wsEntries = Array.from(this.workspace.values());
    if (wsEntries.length > 0) {
      sections.push('## Workspace Knowledge');
      for (const e of wsEntries) {
        const val = e.value.length > SUMMARY_TRUNCATE
          ? e.value.slice(0, SUMMARY_TRUNCATE) + '...'
          : e.value;
        sections.push(`- **${e.key}** (by ${e.author}): ${val}`);
      }
    }

    // Plan section
    const pid = planId ?? '_default';
    const planMap = this.planEntries.get(pid);
    if (planMap && planMap.size > 0) {
      sections.push('');
      sections.push('## Plan Knowledge');
      for (const e of planMap.values()) {
        const val = e.value.length > SUMMARY_TRUNCATE
          ? e.value.slice(0, SUMMARY_TRUNCATE) + '...'
          : e.value;
        sections.push(`- **${e.key}** (by ${e.author}): ${val}`);
      }
    }

    if (sections.length === 0) {
      return 'No shared knowledge yet.';
    }

    return sections.join('\n');
  }

  /**
   * Remove all plan-scoped entries for a given plan.
   */
  clearPlan(planId: string): void {
    this.planEntries.delete(planId);
    this.notifyChange();
  }

  /**
   * Serialize for persistence (workspace only — plan entries live with the plan).
   */
  serializeWorkspace(): KnowledgeEntry[] {
    return Array.from(this.workspace.values());
  }

  /**
   * Serialize plan entries for a specific plan.
   */
  serializePlan(planId: string): KnowledgeEntry[] {
    const planMap = this.planEntries.get(planId);
    return planMap ? Array.from(planMap.values()) : [];
  }

  /**
   * Restore workspace entries from persistence.
   */
  restoreWorkspace(entries: KnowledgeEntry[]): void {
    this.workspace.clear();
    for (const entry of entries) {
      this.workspace.set(entry.key, entry);
    }
  }

  /**
   * Restore plan entries from persistence.
   */
  restorePlan(planId: string, entries: KnowledgeEntry[]): void {
    const map = new Map<string, KnowledgeEntry>();
    for (const entry of entries) {
      map.set(entry.key, entry);
    }
    this.planEntries.set(planId, map);
  }

  /** Get all entries (for broadcasting to webview). */
  getAllEntries(planId?: string): { workspace: KnowledgeEntry[]; plan: KnowledgeEntry[] } {
    const pid = planId ?? '_default';
    const planMap = this.planEntries.get(pid);
    return {
      workspace: Array.from(this.workspace.values()),
      plan: planMap ? Array.from(planMap.values()) : [],
    };
  }

  private enforceLimit(map: Map<string, KnowledgeEntry>, max: number): void {
    if (map.size <= max) return;
    // FIFO eviction: remove oldest by createdAt
    const sorted = Array.from(map.entries()).sort((a, b) => a[1].createdAt - b[1].createdAt);
    while (map.size > max) {
      const oldest = sorted.shift();
      if (oldest) map.delete(oldest[0]);
    }
  }
}
