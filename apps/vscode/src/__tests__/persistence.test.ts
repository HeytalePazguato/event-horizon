/**
 * EventHorizonDB tests — SQLite persistence CRUD, FTS search, pruning, temporal validity.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import initSqlJs from 'sql.js';
import { EventHorizonDB } from '../persistence.js';
import type { AgentEvent } from '@event-horizon/core';
import type { PersistedKnowledgeEntry, AgentSession } from '../persistence.js';
import { GRAPH_SCHEMA_SQL } from '../projectGraph/schema.js';

function makeEvent(overrides?: Partial<AgentEvent>): AgentEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2, 8)}`,
    agentId: 'agent-1',
    agentName: 'Agent 1',
    agentType: 'claude-code',
    type: 'tool.call',
    timestamp: Date.now(),
    payload: { tool: 'Read', file: 'src/main.ts' },
    ...overrides,
  };
}

function makeKnowledge(overrides?: Partial<PersistedKnowledgeEntry>): PersistedKnowledgeEntry {
  return {
    id: `k-${Math.random().toString(36).slice(2, 8)}`,
    key: 'test-key',
    value: 'test-value',
    scope: 'workspace',
    author: 'tester',
    timestamp: Date.now(),
    validFrom: Date.now(),
    ...overrides,
  };
}

describe('EventHorizonDB', () => {
  let db: EventHorizonDB;

  beforeEach(async () => {
    db = await EventHorizonDB.create();
  });

  afterEach(() => {
    db.close();
  });

  // ── Schema ─────────────────────────────────────────────────────────────

  describe('schema creation', () => {
    it('initializes tables and indexes', () => {
      // Should not throw — tables exist
      expect(db.getEventCount()).toBe(0);
      expect(db.queryEvents()).toEqual([]);
      expect(db.queryKnowledge()).toEqual([]);
      expect(db.getSessions()).toEqual([]);
    });
  });

  // ── Event CRUD ─────────────────────────────────────────────────────────

  describe('event CRUD', () => {
    it('inserts and queries event by agentId', () => {
      const event = makeEvent({ agentId: 'a1' });
      db.insertEvent(event);

      const results = db.queryEvents({ agentId: 'a1' });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(event.id);
      expect(results[0].agentId).toBe('a1');
      expect(results[0].payload).toEqual({ tool: 'Read', file: 'src/main.ts' });
    });

    it('queries by event type', () => {
      db.insertEvent(makeEvent({ type: 'tool.call' }));
      db.insertEvent(makeEvent({ type: 'agent.spawn' }));
      db.insertEvent(makeEvent({ type: 'tool.call' }));

      const results = db.queryEvents({ type: 'tool.call' });
      expect(results).toHaveLength(2);
    });

    it('queries by time range', () => {
      const now = Date.now();
      db.insertEvent(makeEvent({ timestamp: now - 60000 }));
      db.insertEvent(makeEvent({ timestamp: now - 30000 }));
      db.insertEvent(makeEvent({ timestamp: now }));

      const results = db.queryEvents({ since: now - 45000, until: now - 15000 });
      expect(results).toHaveLength(1);
    });

    it('queries by workspace and category', () => {
      db.insertEvent(makeEvent(), '/project-a', 'tool');
      db.insertEvent(makeEvent(), '/project-b', 'agent');
      db.insertEvent(makeEvent(), '/project-a', 'agent');

      expect(db.queryEvents({ workspace: '/project-a' })).toHaveLength(2);
      expect(db.queryEvents({ category: 'agent' })).toHaveLength(2);
      expect(db.queryEvents({ workspace: '/project-a', category: 'tool' })).toHaveLength(1);
    });

    it('respects limit and offset', () => {
      for (let i = 0; i < 10; i++) {
        db.insertEvent(makeEvent({ timestamp: Date.now() + i }));
      }

      expect(db.queryEvents({ limit: 3 })).toHaveLength(3);
      expect(db.queryEvents({ limit: 5, offset: 8 })).toHaveLength(2);
    });

    it('ignores duplicate event IDs', () => {
      const event = makeEvent({ id: 'dup-1' });
      db.insertEvent(event);
      db.insertEvent(event); // duplicate — should be ignored

      expect(db.getEventCount()).toBe(1);
    });

    it('returns correct event count', () => {
      db.insertEvent(makeEvent());
      db.insertEvent(makeEvent());
      db.insertEvent(makeEvent());

      expect(db.getEventCount()).toBe(3);
    });
  });

  // ── FTS Search ─────────────────────────────────────────────────────────

  describe('FTS search', () => {
    it('searches events by payload content', () => {
      db.insertEvent(makeEvent({ payload: { tool: 'Read', file: 'auth.ts' } }));
      db.insertEvent(makeEvent({ payload: { tool: 'Write', file: 'utils.ts' } }));

      const results = db.searchEvents('auth');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].payload).toEqual({ tool: 'Read', file: 'auth.ts' });
    });

    it('returns empty for non-matching queries', () => {
      db.insertEvent(makeEvent({ payload: { tool: 'Read', file: 'main.ts' } }));

      const results = db.searchEvents('nonexistent_xyz');
      expect(results).toHaveLength(0);
    });
  });

  // ── Knowledge CRUD ─────────────────────────────────────────────────────

  describe('knowledge CRUD', () => {
    it('inserts and queries knowledge', () => {
      const entry = makeKnowledge({ key: 'api-endpoint', value: '/v1/users' });
      db.insertKnowledge(entry);

      const results = db.queryKnowledge({ scope: 'workspace' });
      expect(results).toHaveLength(1);
      expect(results[0].key).toBe('api-endpoint');
      expect(results[0].value).toBe('/v1/users');
    });

    it('queries by scope', () => {
      db.insertKnowledge(makeKnowledge({ scope: 'workspace' }));
      db.insertKnowledge(makeKnowledge({ scope: 'plan', planId: 'plan-1' }));

      expect(db.queryKnowledge({ scope: 'workspace' })).toHaveLength(1);
      expect(db.queryKnowledge({ scope: 'plan', planId: 'plan-1' })).toHaveLength(1);
    });

    it('deletes knowledge', () => {
      const entry = makeKnowledge({ id: 'k-del' });
      db.insertKnowledge(entry);
      expect(db.queryKnowledge()).toHaveLength(1);

      db.deleteKnowledge('k-del');
      expect(db.queryKnowledge()).toHaveLength(0);
    });

    it('upserts on same id', () => {
      db.insertKnowledge(makeKnowledge({ id: 'k-1', value: 'original' }));
      db.insertKnowledge(makeKnowledge({ id: 'k-1', value: 'updated' }));

      const results = db.queryKnowledge();
      expect(results).toHaveLength(1);
      expect(results[0].value).toBe('updated');
    });
  });

  // ── Temporal Validity ──────────────────────────────────────────────────

  describe('temporal validity', () => {
    it('excludes expired entries by default', () => {
      const now = Date.now();
      db.insertKnowledge(makeKnowledge({ id: 'k-active', validFrom: now, validUntil: now + 100000 }));
      db.insertKnowledge(makeKnowledge({ id: 'k-expired', validFrom: now - 200000, validUntil: now - 100000 }));

      const defaultResults = db.queryKnowledge();
      expect(defaultResults).toHaveLength(1);
      expect(defaultResults[0].id).toBe('k-active');
    });

    it('includes expired entries when requested', () => {
      const now = Date.now();
      db.insertKnowledge(makeKnowledge({ id: 'k-active', validFrom: now }));
      db.insertKnowledge(makeKnowledge({ id: 'k-expired', validFrom: now - 200000, validUntil: now - 100000 }));

      const allResults = db.queryKnowledge({ includeExpired: true });
      expect(allResults).toHaveLength(2);
    });

    it('entries with null validUntil never expire', () => {
      db.insertKnowledge(makeKnowledge({ validFrom: Date.now() - 1000000 }));

      const results = db.queryKnowledge();
      expect(results).toHaveLength(1);
    });
  });

  // ── Agent Sessions ─────────────────────────────────────────────────────

  describe('agent sessions', () => {
    it('inserts and queries sessions', () => {
      const session: AgentSession = {
        agentId: 'a1',
        agentName: 'Claude',
        agentType: 'claude-code',
        sessionStart: Date.now() - 60000,
        cwd: '/workspace',
        totalTokensIn: 5000,
        totalTokensOut: 2000,
        totalCostUsd: 0.05,
        eventCount: 42,
      };
      db.upsertSession(session);

      const results = db.getSessions();
      expect(results).toHaveLength(1);
      expect(results[0].agentId).toBe('a1');
      expect(results[0].totalTokensIn).toBe(5000);
      expect(results[0].eventCount).toBe(42);
    });

    it('updates session end on upsert', () => {
      const start = Date.now() - 60000;
      db.upsertSession({
        agentId: 'a1', agentType: 'claude-code', sessionStart: start,
        totalTokensIn: 0, totalTokensOut: 0, totalCostUsd: 0, eventCount: 0,
      });

      db.upsertSession({
        agentId: 'a1', agentType: 'claude-code', sessionStart: start,
        sessionEnd: Date.now(), totalTokensIn: 5000, totalTokensOut: 2000, totalCostUsd: 0.1, eventCount: 100,
      });

      const results = db.getSessions();
      expect(results).toHaveLength(1);
      expect(results[0].sessionEnd).toBeDefined();
      expect(results[0].eventCount).toBe(100);
    });

    it('filters sessions by since', () => {
      const now = Date.now();
      db.upsertSession({
        agentId: 'a1', agentType: 'claude-code', sessionStart: now - 100000,
        totalTokensIn: 0, totalTokensOut: 0, totalCostUsd: 0, eventCount: 0,
      });
      db.upsertSession({
        agentId: 'a2', agentType: 'opencode', sessionStart: now - 10000,
        totalTokensIn: 0, totalTokensOut: 0, totalCostUsd: 0, eventCount: 0,
      });

      expect(db.getSessions(now - 50000)).toHaveLength(1);
    });
  });

  // ── Pruning ────────────────────────────────────────────────────────────

  describe('pruning', () => {
    it('deletes events older than threshold', () => {
      const now = Date.now();
      db.insertEvent(makeEvent({ id: 'old', timestamp: now - 40 * 24 * 60 * 60 * 1000 })); // 40 days ago
      db.insertEvent(makeEvent({ id: 'recent', timestamp: now - 5 * 24 * 60 * 60 * 1000 })); // 5 days ago

      const deleted = db.pruneEvents(30 * 24 * 60 * 60 * 1000); // prune > 30 days
      expect(deleted).toBe(1);
      expect(db.getEventCount()).toBe(1);

      const remaining = db.queryEvents();
      expect(remaining[0].id).toBe('recent');
    });

    it('returns 0 when nothing to prune', () => {
      db.insertEvent(makeEvent({ timestamp: Date.now() }));
      const deleted = db.pruneEvents(30 * 24 * 60 * 60 * 1000);
      expect(deleted).toBe(0);
    });
  });

  // ── Persistence (save/load) ────────────────────────────────────────────

  describe('save and reload', () => {
    it('exports and reimports database', async () => {
      // Insert data
      db.insertEvent(makeEvent({ id: 'persist-1', agentId: 'a1' }));
      db.insertKnowledge(makeKnowledge({ id: 'k-persist', key: 'saved-key', value: 'saved-value' }));

      // Export
      const buffer = db.save();
      expect(buffer).toBeInstanceOf(Uint8Array);
      expect(buffer.length).toBeGreaterThan(0);

      // Close and reload
      db.close();
      const db2 = await EventHorizonDB.create(buffer);

      // Verify data survived
      const events = db2.queryEvents({ agentId: 'a1' });
      expect(events).toHaveLength(1);
      expect(events[0].id).toBe('persist-1');

      const knowledge = db2.queryKnowledge();
      expect(knowledge).toHaveLength(1);
      expect(knowledge[0].key).toBe('saved-key');

      db2.close();
    });
  });

  // ── v3.0.0-dev → v3.0.0 graph migration ──────────────────────────────────

  describe('graph table migration', () => {
    async function buildBufferWithGraphTables(): Promise<Uint8Array> {
      const SQL = await initSqlJs();
      const fixture = new SQL.Database();
      try {
        fixture.run(GRAPH_SCHEMA_SQL);
      } catch {
        /* FTS may be unavailable; non-FTS graph tables still land */
      }
      const buf = fixture.export();
      fixture.close();
      return buf;
    }

    async function tableExists(buf: Uint8Array, name: string): Promise<boolean> {
      const SQL = await initSqlJs();
      const tmp = new SQL.Database(buf);
      const res = tmp.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`, [name]);
      tmp.close();
      return res.length > 0 && res[0].values.length > 0;
    }

    async function metaValue(buf: Uint8Array, key: string): Promise<string | null> {
      const SQL = await initSqlJs();
      const tmp = new SQL.Database(buf);
      const res = tmp.exec(`SELECT value FROM eh_meta WHERE key = ?`, [key]);
      tmp.close();
      if (res.length === 0 || res[0].values.length === 0) return null;
      return res[0].values[0][0] as string;
    }

    it('drops graph_* tables and writes the marker on first load of a v3.0.0-dev DB', async () => {
      const fixture = await buildBufferWithGraphTables();
      expect(await tableExists(fixture, 'graph_nodes')).toBe(true);

      const migratedDb = await EventHorizonDB.create(fixture);
      const after = migratedDb.save();
      migratedDb.close();

      expect(await tableExists(after, 'graph_nodes')).toBe(false);
      expect(await tableExists(after, 'graph_edges')).toBe(false);
      expect(await tableExists(after, 'graph_file_state')).toBe(false);
      expect(await metaValue(after, 'graph_dropped')).toBe('1');
    });

    it('is idempotent: re-loading the migrated DB does not flag dirty', async () => {
      const fixture = await buildBufferWithGraphTables();
      const dbA = await EventHorizonDB.create(fixture);
      const migrated = dbA.save();
      dbA.close();

      const dbB = await EventHorizonDB.create(migrated);
      // Marker is already present — DROP is skipped, no fresh writes happen.
      expect(dbB.isDirty()).toBe(false);
      const reloaded = dbB.save();
      dbB.close();

      expect(await metaValue(reloaded, 'graph_dropped')).toBe('1');
      expect(await tableExists(reloaded, 'graph_nodes')).toBe(false);
    });

    it('a fresh DB (no fixture) gets the marker without errors', async () => {
      const dbFresh = await EventHorizonDB.create();
      const buf = dbFresh.save();
      dbFresh.close();
      expect(await metaValue(buf, 'graph_dropped')).toBe('1');
    });
  });
});
