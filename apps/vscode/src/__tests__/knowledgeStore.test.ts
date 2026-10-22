/**
 * KnowledgeStore tests — SQLite as the system of record for shared knowledge,
 * with SharedKnowledgeStore's Maps acting as a read cache.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventHorizonDB } from '../persistence.js';
import {
  KnowledgeStore,
  migrateLegacyKnowledgeOnce,
  LEGACY_KNOWLEDGE_KEY,
  KNOWLEDGE_MIGRATED_FLAG,
  type KnowledgeMemento,
} from '../knowledgeStore.js';
import { SharedKnowledgeStore, type KnowledgeEntry } from '../sharedKnowledge.js';

function makeMemento(initial: Record<string, unknown> = {}): KnowledgeMemento & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = { ...initial };
  return {
    data,
    get<T>(key: string): T | undefined { return data[key] as T | undefined; },
    update(key: string, value: unknown): void { data[key] = value; },
  };
}

function legacyEntry(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  const now = Date.now();
  return {
    key: 'legacy-key',
    value: 'legacy-value',
    scope: 'workspace',
    author: 'user',
    authorId: 'user',
    createdAt: now - 1000,
    updatedAt: now - 1000,
    validFrom: now - 1000,
    ...overrides,
  };
}

/** Simulate a window reload: export the DB, reopen it, hydrate a fresh cache. */
async function reload(db: EventHorizonDB): Promise<{ db: EventHorizonDB; shared: SharedKnowledgeStore }> {
  const reopened = await EventHorizonDB.create(db.save());
  const shared = new SharedKnowledgeStore();
  shared.attachStore(new KnowledgeStore(reopened));
  return { db: reopened, shared };
}

describe('KnowledgeStore', () => {
  let db: EventHorizonDB;
  const opened: EventHorizonDB[] = [];

  beforeEach(async () => {
    db = await EventHorizonDB.create();
    opened.push(db);
  });

  afterEach(() => {
    while (opened.length) opened.pop()!.close();
  });

  it('round-trips every KnowledgeEntry field through SQLite', () => {
    const store = new KnowledgeStore(db);
    const shared = new SharedKnowledgeStore();
    shared.attachStore(store);

    const written = shared.write('stack', 'TypeScript', 'workspace', 'Agent A', 'agent-a', undefined, Date.now() + 60_000, 'L0', 'agent');
    const [loaded] = store.load();

    expect(loaded.planId).toBeUndefined();
    expect(loaded.entry).toEqual(written);
  });

  it('restores entries after a reload, read from SQLite', async () => {
    const shared = new SharedKnowledgeStore();
    shared.attachStore(new KnowledgeStore(db));
    shared.write('conv', 'use pnpm', 'workspace', 'user', 'user');
    shared.write('finding', 'auth is broken', 'plan', 'Agent A', 'agent-a', 'plan-1');

    const after = await reload(db);
    opened.push(after.db);

    expect(after.shared.read('conv')[0]?.value).toBe('use pnpm');
    expect(after.shared.read('finding', 'plan-1')[0]?.value).toBe('auth is broken');
  });

  it('keeps plan entries scoped to their planId and separate from workspace entries', async () => {
    const shared = new SharedKnowledgeStore();
    shared.attachStore(new KnowledgeStore(db));
    shared.write('k', 'workspace-value', 'workspace', 'user', 'user');
    shared.write('k', 'plan-1-value', 'plan', 'user', 'user', 'plan-1');
    shared.write('k', 'plan-2-value', 'plan', 'user', 'user', 'plan-2');

    const store = new KnowledgeStore(db);
    expect(store.load({ scope: 'workspace' }).map((r) => r.entry.value)).toEqual(['workspace-value']);
    expect(store.load({ scope: 'plan', planId: 'plan-1' }).map((r) => [r.planId, r.entry.value])).toEqual([['plan-1', 'plan-1-value']]);

    const after = await reload(db);
    opened.push(after.db);
    const { workspace, plan } = after.shared.getAllEntries('plan-2');
    expect(workspace.map((e) => e.value)).toEqual(['workspace-value']);
    expect(plan.map((e) => e.value)).toEqual(['plan-2-value']);
    expect(after.shared.read('k', 'plan-1')[0]?.value).toBe('plan-1-value');
  });

  it('propagates deletes to SQLite', async () => {
    const shared = new SharedKnowledgeStore();
    shared.attachStore(new KnowledgeStore(db));
    shared.write('ws', 'v', 'workspace', 'user', 'user');
    shared.write('pl', 'v', 'plan', 'user', 'user', 'plan-1');

    expect(shared.delete('ws', 'workspace', 'user')).toBe(true);
    expect(shared.delete('pl', 'plan', 'user', 'plan-1')).toBe(true);
    expect(new KnowledgeStore(db).load({ includeExpired: true })).toEqual([]);

    const after = await reload(db);
    opened.push(after.db);
    expect(after.shared.readAll('plan-1')).toEqual([]);
  });

  it('clearPlan removes that plan\'s rows only', () => {
    const shared = new SharedKnowledgeStore();
    const store = new KnowledgeStore(db);
    shared.attachStore(store);
    shared.write('a', 'v', 'plan', 'user', 'user', 'plan-1');
    shared.write('b', 'v', 'plan', 'user', 'user', 'plan-2');

    shared.clearPlan('plan-1');

    expect(store.load().map((r) => r.planId)).toEqual(['plan-2']);
  });

  it('filters expired entries on load unless includeExpired is set', () => {
    const store = new KnowledgeStore(db);
    const shared = new SharedKnowledgeStore();
    shared.attachStore(store);
    shared.write('live', 'v', 'workspace', 'user', 'user');
    shared.write('stale', 'v', 'workspace', 'user', 'user', undefined, Date.now() - 1);

    expect(store.load().map((r) => r.entry.key)).toEqual(['live']);
    expect(store.load({ includeExpired: true }).map((r) => r.entry.key).sort()).toEqual(['live', 'stale']);
  });

  it('hydrates expired entries into the cache so readAll still shows them', async () => {
    const shared = new SharedKnowledgeStore();
    shared.attachStore(new KnowledgeStore(db));
    shared.write('stale', 'v', 'workspace', 'user', 'user', undefined, Date.now() - 1);

    const after = await reload(db);
    opened.push(after.db);
    expect(after.shared.read('stale')).toEqual([]);
    expect(after.shared.readAll().map((e) => e.key)).toEqual(['stale']);
  });

  it('flushes entries written before the store was attached', () => {
    const shared = new SharedKnowledgeStore();
    shared.write('early', 'written during startup', 'workspace', 'user', 'user');
    const store = new KnowledgeStore(db);
    shared.attachStore(store);

    expect(store.load().map((r) => r.entry.key)).toEqual(['early']);
    expect(shared.read('early')[0]?.value).toBe('written during startup');
  });

  it('notifies listeners once after hydration', () => {
    const shared = new SharedKnowledgeStore();
    let calls = 0;
    shared.onChange(() => { calls++; });
    shared.attachStore(new KnowledgeStore(db));
    expect(calls).toBe(1);
    expect(shared.hasStore()).toBe(true);
  });

  describe('migrateLegacyKnowledgeOnce', () => {
    it('imports the legacy globalState blob and sets the flag', () => {
      const store = new KnowledgeStore(db);
      const legacy = legacyEntry({ tier: 'L1', source: 'user' });
      const memento = makeMemento({ [LEGACY_KNOWLEDGE_KEY]: [legacy] });

      expect(migrateLegacyKnowledgeOnce(store, memento)).toBe(1);
      expect(memento.data[KNOWLEDGE_MIGRATED_FLAG]).toBe(true);

      const [row] = store.load();
      expect(row.entry).toEqual(legacy);
    });

    it('runs exactly once — never re-imports after the flag is set', () => {
      const store = new KnowledgeStore(db);
      const memento = makeMemento({ [LEGACY_KNOWLEDGE_KEY]: [legacyEntry()] });
      migrateLegacyKnowledgeOnce(store, memento);

      // User deletes the migrated entry, then the extension restarts.
      store.delete('workspace', 'legacy-key');
      expect(migrateLegacyKnowledgeOnce(store, memento)).toBeNull();
      expect(store.load({ includeExpired: true })).toEqual([]);
    });

    it('sets the flag even when there is nothing to migrate', () => {
      const memento = makeMemento();
      expect(migrateLegacyKnowledgeOnce(new KnowledgeStore(db), memento)).toBe(0);
      expect(memento.data[KNOWLEDGE_MIGRATED_FLAG]).toBe(true);
    });

    it('does not overwrite a newer SQLite row with an older legacy entry', () => {
      const store = new KnowledgeStore(db);
      store.upsert(legacyEntry({ value: 'fresh', updatedAt: Date.now() }));
      const memento = makeMemento({ [LEGACY_KNOWLEDGE_KEY]: [legacyEntry({ value: 'old' })] });

      expect(migrateLegacyKnowledgeOnce(store, memento)).toBe(0);
      expect(store.load()[0].entry.value).toBe('fresh');
    });
  });

  it('adds the 3.3.0 columns to a pre-3.3.0 knowledge table', async () => {
    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();
    const legacy = new SQL.Database();
    legacy.run(`CREATE TABLE knowledge (
      id TEXT PRIMARY KEY, key TEXT NOT NULL, value TEXT NOT NULL, scope TEXT NOT NULL, plan_id TEXT,
      author TEXT NOT NULL, timestamp INTEGER NOT NULL, tags TEXT, valid_from INTEGER NOT NULL, valid_until INTEGER
    )`);
    legacy.run(`INSERT INTO knowledge VALUES ('old', 'k', 'v', 'workspace', NULL, 'bob', 5, NULL, 3, NULL)`);
    const upgraded = await EventHorizonDB.create(legacy.export());
    legacy.close();
    opened.push(upgraded);

    const [row] = new KnowledgeStore(upgraded).load();
    expect(row.entry).toMatchObject({ key: 'k', author: 'bob', authorId: 'bob', createdAt: 3, updatedAt: 5 });

    // Re-opening an already-upgraded DB is a no-op.
    const again = await EventHorizonDB.create(upgraded.save());
    opened.push(again);
    expect(new KnowledgeStore(again).load()).toHaveLength(1);
  });
});
