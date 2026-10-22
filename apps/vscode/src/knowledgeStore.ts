/**
 * KnowledgeStore — SQLite-backed system of record for shared knowledge.
 *
 * Wraps the knowledge methods on EventHorizonDB. SharedKnowledgeStore keeps its
 * Maps as a read cache hydrated from here once at startup; every write/delete it
 * performs is forwarded here, so there is a single writer path.
 */

import type { EventHorizonDB, PersistedKnowledgeEntry } from './persistence.js';
import type { KnowledgeEntry, KnowledgeScope, KnowledgeSource, KnowledgeTier } from './sharedKnowledge.js';

/** globalState key holding the legacy (pre-3.3.0) workspace knowledge blob. */
export const LEGACY_KNOWLEDGE_KEY = 'sharedKnowledge';
/** globalState flag set once the legacy blob has been imported into SQLite. */
export const KNOWLEDGE_MIGRATED_FLAG = 'knowledgeMigratedToSqlite';

/** Minimal slice of vscode.Memento used by the migration (keeps this module vscode-free). */
export interface KnowledgeMemento {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void> | void;
}

/** A cache entry tagged with the plan it belongs to (undefined for workspace scope). */
export interface StoredKnowledgeEntry {
  entry: KnowledgeEntry;
  planId?: string;
}

/** Plan-scoped entries written without a planId are filed under this bucket. */
const DEFAULT_PLAN_ID = '_default';

export class KnowledgeStore {
  constructor(private readonly db: EventHorizonDB) {}

  /** Stable row id — one row per (scope, plan, key), matching the cache's upsert semantics. */
  static rowId(scope: KnowledgeScope, key: string, planId?: string): string {
    return scope === 'workspace' ? `workspace::${key}` : `plan:${planId ?? DEFAULT_PLAN_ID}:${key}`;
  }

  upsert(entry: KnowledgeEntry, planId?: string): void {
    const pid = entry.scope === 'plan' ? (planId ?? DEFAULT_PLAN_ID) : undefined;
    this.db.insertKnowledge({
      id: KnowledgeStore.rowId(entry.scope, entry.key, pid),
      key: entry.key,
      value: entry.value,
      scope: entry.scope,
      planId: pid,
      author: entry.author,
      authorId: entry.authorId,
      timestamp: entry.updatedAt,
      createdAt: entry.createdAt,
      validFrom: entry.validFrom ?? entry.createdAt,
      validUntil: entry.validUntil,
      tier: entry.tier,
      source: entry.source,
    });
  }

  delete(scope: KnowledgeScope, key: string, planId?: string): void {
    this.db.deleteKnowledge(KnowledgeStore.rowId(scope, key, planId));
  }

  /** Load entries. Expired entries are filtered unless includeExpired is set. */
  load(opts: { scope?: KnowledgeScope; planId?: string; includeExpired?: boolean } = {}): StoredKnowledgeEntry[] {
    // queryKnowledge returns newest first; reverse so cache insertion order is oldest → newest.
    return this.db.queryKnowledge(opts).reverse().map(fromRow);
  }

  /**
   * Import legacy entries, skipping any the store already holds at the same or a
   * newer updatedAt (so a re-import can never clobber fresher SQLite data).
   */
  importEntries(entries: KnowledgeEntry[], planId?: string): number {
    const current = new Map<string, number>();
    for (const { entry, planId: pid } of this.load({ includeExpired: true })) {
      current.set(KnowledgeStore.rowId(entry.scope, entry.key, pid), entry.updatedAt);
    }
    let imported = 0;
    for (const entry of entries) {
      if (!entry || typeof entry.key !== 'string' || typeof entry.value !== 'string') continue;
      const id = KnowledgeStore.rowId(entry.scope, entry.key, planId);
      const existing = current.get(id);
      if (existing !== undefined && existing >= entry.updatedAt) continue;
      this.upsert(entry, planId);
      imported++;
    }
    return imported;
  }
}

/**
 * One-time import of the legacy globalState knowledge blob into SQLite.
 * Sets the migrated flag afterwards so it never re-runs. Returns the number of
 * entries imported, or null if the migration had already run.
 */
export function migrateLegacyKnowledgeOnce(store: KnowledgeStore, memento: KnowledgeMemento): number | null {
  if (memento.get<boolean>(KNOWLEDGE_MIGRATED_FLAG)) return null;
  const legacy = memento.get<KnowledgeEntry[]>(LEGACY_KNOWLEDGE_KEY);
  const imported = Array.isArray(legacy) ? store.importEntries(legacy) : 0;
  void memento.update(KNOWLEDGE_MIGRATED_FLAG, true);
  return imported;
}

function fromRow(row: PersistedKnowledgeEntry): StoredKnowledgeEntry {
  const entry: KnowledgeEntry = {
    key: row.key,
    value: row.value,
    scope: row.scope,
    author: row.author,
    authorId: row.authorId ?? row.author,
    createdAt: row.createdAt ?? row.validFrom,
    updatedAt: row.timestamp,
    validFrom: row.validFrom,
    validUntil: row.validUntil,
    tier: row.tier as KnowledgeTier | undefined,
    source: row.source as KnowledgeSource | undefined,
  };
  return { entry, planId: row.scope === 'plan' ? row.planId : undefined };
}
