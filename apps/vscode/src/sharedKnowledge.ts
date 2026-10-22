/**
 * Shared Knowledge Store — layered knowledge base for multi-agent coordination.
 *
 * Two scopes:
 *   - workspace: persistent across plans/sessions (tech stack, conventions, constraints)
 *   - plan: scoped to active plan (task findings, decisions, corrections)
 *
 * Both humans and agents can read/write. All entries visible to all agents.
 */

import type { EventBridge } from './projectGraph/eventBridge.js';
import { KnowledgeStore } from './knowledgeStore.js';

export type KnowledgeScope = 'workspace' | 'plan';

export type KnowledgeTier = 'L0' | 'L1' | 'L2';

export type KnowledgeSource = 'auto' | 'user' | 'agent';

export interface KnowledgeEntry {
  key: string;
  value: string;
  scope: KnowledgeScope;
  author: string;        // agent name or 'user'
  authorId: string;      // agent ID or 'user'
  createdAt: number;
  updatedAt: number;
  /** Timestamp when the entry becomes valid (defaults to createdAt). */
  validFrom?: number;
  /** Timestamp when the entry expires. Undefined = never expires. */
  validUntil?: number;
  /** MemPalace-inspired loading tier. Defaults: workspace = L1, plan = L2. L0 = critical identity. */
  tier?: KnowledgeTier;
  /** Origin of the entry. 'auto' = scanned from instruction files; 'user' = human-authored via UI; 'agent' = eh_write_shared. */
  source?: KnowledgeSource;
}

const MAX_WORKSPACE_ENTRIES = 200;
const MAX_PLAN_ENTRIES = 300;
const SUMMARY_TRUNCATE = 200;

export class SharedKnowledgeStore {
  private workspace = new Map<string, KnowledgeEntry>();
  private planEntries = new Map<string, Map<string, KnowledgeEntry>>(); // planId -> entries
  private changeListeners: Array<() => void> = [];
  private eventBridge?: EventBridge;
  /** SQLite system of record. When absent (persistence disabled/unavailable) the Maps are the only copy. */
  private store?: KnowledgeStore;

  constructor(eventBridge?: EventBridge) {
    this.eventBridge = eventBridge;
  }

  setEventBridge(bridge: EventBridge | undefined): void {
    this.eventBridge = bridge;
  }

  /** True once a SQLite-backed store is attached and receiving every write. */
  hasStore(): boolean {
    return this.store !== undefined;
  }

  /**
   * Attach the SQLite store and hydrate the read cache from it. Entries written to
   * the cache before the DB was ready (and not already newer in SQLite) are flushed
   * to the store first so nothing written during startup is lost.
   */
  attachStore(store: KnowledgeStore): void {
    this.store = store;
    const pending: Array<{ entry: KnowledgeEntry; planId?: string }> = [];
    for (const entry of this.workspace.values()) pending.push({ entry });
    for (const [planId, map] of this.planEntries) {
      for (const entry of map.values()) pending.push({ entry, planId });
    }
    const persisted = new Map<string, number>();
    for (const { entry, planId } of store.load({ includeExpired: true })) {
      persisted.set(KnowledgeStore.rowId(entry.scope, entry.key, planId), entry.updatedAt);
    }
    for (const { entry, planId } of pending) {
      const prev = persisted.get(KnowledgeStore.rowId(entry.scope, entry.key, planId));
      if (prev === undefined || prev < entry.updatedAt) store.upsert(entry, planId);
    }

    this.workspace.clear();
    this.planEntries.clear();
    for (const { entry, planId } of store.load({ includeExpired: true })) {
      if (entry.scope === 'workspace') {
        this.workspace.set(entry.key, entry);
        continue;
      }
      const pid = planId ?? '_default';
      let map = this.planEntries.get(pid);
      if (!map) {
        map = new Map();
        this.planEntries.set(pid, map);
      }
      map.set(entry.key, entry);
    }
    this.notifyChange();
  }

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
    validUntil?: number,
    tier?: KnowledgeTier,
    source?: KnowledgeSource,
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
        validFrom: existing?.validFrom ?? now,
        validUntil,
        tier: tier ?? existing?.tier,
        source: source ?? existing?.source,
      };
      this.workspace.set(key, entry);
      this.store?.upsert(entry);
      for (const evicted of this.enforceLimit(this.workspace, MAX_WORKSPACE_ENTRIES)) {
        this.store?.delete('workspace', evicted);
      }
      this.notifyChange();
      this.eventBridge?.ingestKnowledge(entry, 'write');
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
      validFrom: existing?.validFrom ?? now,
      validUntil,
      tier: tier ?? existing?.tier,
      source: source ?? existing?.source,
    };
    planMap.set(key, entry);
    this.store?.upsert(entry, pid);
    for (const evicted of this.enforceLimit(planMap, MAX_PLAN_ENTRIES)) {
      this.store?.delete('plan', evicted, pid);
    }
    this.notifyChange();
    this.eventBridge?.ingestKnowledge(entry, 'write');
    return entry;
  }

  /**
   * Write an auto-scanned entry only if no user or agent entry with the same key already exists.
   * Returns the final entry (either the preserved existing one or the newly written auto entry).
   */
  writeIfNotUserAuthored(
    key: string,
    value: string,
    scope: KnowledgeScope,
    author: string,
    authorId: string,
    planId?: string,
    validUntil?: number,
    tier?: KnowledgeTier,
  ): KnowledgeEntry | null {
    const map = scope === 'workspace'
      ? this.workspace
      : this.planEntries.get(planId ?? '_default');
    const existing = map?.get(key);
    if (existing && (existing.source === 'user' || existing.source === 'agent')) {
      return existing;
    }
    return this.write(key, value, scope, author, authorId, planId, validUntil, tier, 'auto');
  }

  /**
   * Read entries. If key provided, returns single entry (merged lookup: plan first, then workspace).
   * If no key, returns all entries merged (workspace + active plan).
   * By default excludes expired entries — pass includeExpired=true to see them.
   */
  read(key?: string, planId?: string, includeExpired = false): KnowledgeEntry[] {
    const pid = planId ?? '_default';
    const planMap = this.planEntries.get(pid);
    const now = Date.now();
    const isValid = (e: KnowledgeEntry) => includeExpired || !e.validUntil || e.validUntil > now;

    if (key) {
      const planEntry = planMap?.get(key);
      if (planEntry && isValid(planEntry)) return [planEntry];
      const wsEntry = this.workspace.get(key);
      if (wsEntry && isValid(wsEntry)) return [wsEntry];
      return [];
    }

    // Return all: workspace first, then plan
    const results: KnowledgeEntry[] = [];
    for (const entry of this.workspace.values()) {
      if (isValid(entry)) results.push(entry);
    }
    if (planMap) {
      for (const entry of planMap.values()) {
        if (isValid(entry)) results.push(entry);
      }
    }
    return results;
  }

  /**
   * Read all entries including expired (for UI display with stale styling).
   */
  readAll(planId?: string): KnowledgeEntry[] {
    return this.read(undefined, planId, true);
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
      this.store?.delete('workspace', key);
      this.notifyChange();
      this.eventBridge?.ingestKnowledge(entry, 'delete');
      return true;
    }

    const pid = planId ?? '_default';
    const planMap = this.planEntries.get(pid);
    if (!planMap) return false;
    const entry = planMap.get(key);
    if (!entry) return false;
    if (callerAuthorId !== 'user' && entry.authorId !== callerAuthorId) return false;
    planMap.delete(key);
    this.store?.delete('plan', key, pid);
    this.notifyChange();
    this.eventBridge?.ingestKnowledge(entry, 'delete');
    return true;
  }

  /**
   * Get a markdown summary of all knowledge, grouped by scope and author.
   */
  getSummary(planId?: string, includeExpired = false): string {
    const sections: string[] = [];
    const now = Date.now();
    const isValid = (e: KnowledgeEntry) => includeExpired || !e.validUntil || e.validUntil > now;

    // Workspace section
    const wsEntries = Array.from(this.workspace.values()).filter(isValid);
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
      const planEntries = Array.from(planMap.values()).filter(isValid);
      if (planEntries.length > 0) {
      sections.push('');
      sections.push('## Plan Knowledge');
      for (const e of planEntries) {
        const val = e.value.length > SUMMARY_TRUNCATE
          ? e.value.slice(0, SUMMARY_TRUNCATE) + '...'
          : e.value;
        sections.push(`- **${e.key}** (by ${e.author}): ${val}`);
      }
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
    const planMap = this.planEntries.get(planId);
    if (planMap && this.store) {
      for (const key of planMap.keys()) this.store.delete('plan', key, planId);
    }
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

  /** FIFO-evict the oldest entries (by createdAt) beyond max. Returns the evicted keys. */
  private enforceLimit(map: Map<string, KnowledgeEntry>, max: number): string[] {
    if (map.size <= max) return [];
    const evicted: string[] = [];
    const sorted = Array.from(map.entries()).sort((a, b) => a[1].createdAt - b[1].createdAt);
    while (map.size > max) {
      const oldest = sorted.shift();
      if (oldest) {
        map.delete(oldest[0]);
        evicted.push(oldest[0]);
      }
    }
    return evicted;
  }
}

