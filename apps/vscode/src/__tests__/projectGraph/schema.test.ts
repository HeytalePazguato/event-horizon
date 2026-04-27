/**
 * Project Graph schema tests — table creation, FTS5 availability, idempotency.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventHorizonDB } from '../../persistence.js';

describe('Project Graph schema', () => {
  let db: EventHorizonDB;

  beforeEach(async () => {
    db = await EventHorizonDB.create();
  });

  afterEach(() => {
    db.close();
  });

  it('creates graph_nodes, graph_edges, graph_file_state tables on init', () => {
    const store = db.getProjectGraphStore();
    const stats = store.getStats();
    expect(stats.nodeCount).toBe(0);
    expect(stats.edgeCount).toBe(0);
    expect(stats.fileCount).toBe(0);
  });

  it('search on empty graph returns no results without errors', () => {
    const store = db.getProjectGraphStore();
    const results = store.searchNodes('anything');
    expect(results).toEqual([]);
  });

  it('returns the same store instance across calls (lazy singleton)', () => {
    const a = db.getProjectGraphStore();
    const b = db.getProjectGraphStore();
    expect(a).toBe(b);
  });

  it('survives multiple create() calls (schema is idempotent via IF NOT EXISTS)', async () => {
    const db2 = await EventHorizonDB.create();
    const store = db2.getProjectGraphStore();
    expect(store.getStats().nodeCount).toBe(0);
    db2.close();
  });
});
