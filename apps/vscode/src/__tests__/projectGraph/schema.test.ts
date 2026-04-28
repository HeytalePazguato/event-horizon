/**
 * Project Graph schema tests — table creation, FTS5 availability, idempotency.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProjectGraphDB } from '../../projectGraph/projectGraphDb.js';

describe('Project Graph schema', () => {
  let db: ProjectGraphDB;

  beforeEach(async () => {
    db = await ProjectGraphDB.create();
  });

  afterEach(() => {
    db.close();
  });

  it('creates graph_nodes, graph_edges, graph_file_state tables on init', () => {
    const store = db.getStore();
    const stats = store.getStats();
    expect(stats.nodeCount).toBe(0);
    expect(stats.edgeCount).toBe(0);
    expect(stats.fileCount).toBe(0);
  });

  it('search on empty graph returns no results without errors', () => {
    const store = db.getStore();
    const results = store.searchNodes('anything');
    expect(results).toEqual([]);
  });

  it('returns the same store instance across calls (lazy singleton)', () => {
    const a = db.getStore();
    const b = db.getStore();
    expect(a).toBe(b);
  });

  it('survives multiple create() calls (schema is idempotent via IF NOT EXISTS)', async () => {
    const db2 = await ProjectGraphDB.create();
    const store = db2.getStore();
    expect(store.getStats().nodeCount).toBe(0);
    db2.close();
  });
});
