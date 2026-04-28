/**
 * ProjectGraphStore tests — CRUD, FTS, shrink guard, file delete cascade.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProjectGraphDB } from '../../projectGraph/projectGraphDb.js';
import type { ProjectGraphStore } from '../../projectGraph/store.js';
import type { GraphNode, GraphEdge } from '../../projectGraph/index.js';

function makeNode(overrides?: Partial<GraphNode>): GraphNode {
  const now = Date.now();
  return {
    id: `node-${Math.random().toString(36).slice(2, 8)}`,
    label: 'foo',
    type: 'function',
    sourceFile: '/abs/path/foo.ts',
    sourceLocation: '12-20',
    properties: { params: ['x'], async: false },
    tag: 'EXTRACTED',
    confidence: 1.0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeEdge(overrides?: Partial<GraphEdge>): GraphEdge {
  return {
    id: `edge-${Math.random().toString(36).slice(2, 8)}`,
    sourceId: 'node-a',
    targetId: 'node-b',
    relationType: 'calls',
    tag: 'EXTRACTED',
    confidence: 1.0,
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('ProjectGraphStore', () => {
  let db: ProjectGraphDB;
  let store: ProjectGraphStore;

  beforeEach(async () => {
    db = await ProjectGraphDB.create();
    store = db.getStore();
  });

  afterEach(() => {
    db.close();
  });

  // ── Node CRUD ──────────────────────────────────────────────────────────

  describe('node CRUD', () => {
    it('upsertNode + getNodeById round-trips', () => {
      const node = makeNode({ id: 'n1', label: 'validateToken' });
      store.upsertNode(node);

      const found = store.getNodeById('n1');
      expect(found).not.toBeNull();
      expect(found!.label).toBe('validateToken');
      expect(found!.type).toBe('function');
      expect(found!.tag).toBe('EXTRACTED');
      expect(found!.confidence).toBe(1.0);
    });

    it('preserves properties JSON object on round-trip', () => {
      const node = makeNode({
        id: 'n2',
        properties: { params: ['a', 'b'], async: true, deep: { nested: 42 } },
      });
      store.upsertNode(node);

      const found = store.getNodeById('n2');
      expect(found!.properties).toEqual({
        params: ['a', 'b'],
        async: true,
        deep: { nested: 42 },
      });
    });

    it('upsertNode replaces an existing node by id', () => {
      const original = makeNode({ id: 'n3', label: 'old' });
      const updated = makeNode({ id: 'n3', label: 'new' });
      store.upsertNode(original);
      store.upsertNode(updated);

      expect(store.getNodeById('n3')!.label).toBe('new');
      expect(store.getStats().nodeCount).toBe(1);
    });

    it('returns null for missing id', () => {
      expect(store.getNodeById('does-not-exist')).toBeNull();
    });

    it('persists INFERRED tag and 0.7 confidence', () => {
      store.upsertNode(
        makeNode({ id: 'n4', tag: 'INFERRED', confidence: 0.7 }),
      );
      const found = store.getNodeById('n4');
      expect(found!.tag).toBe('INFERRED');
      expect(found!.confidence).toBe(0.7);
    });
  });

  // ── Edge CRUD ──────────────────────────────────────────────────────────

  describe('edge CRUD', () => {
    it('upsertEdge + getEdges by sourceId returns it', () => {
      const edge = makeEdge({
        id: 'e1',
        sourceId: 'src-1',
        targetId: 'tgt-1',
      });
      store.upsertEdge(edge);

      const results = store.getEdges({ sourceId: 'src-1' });
      expect(results).toHaveLength(1);
      expect(results[0].targetId).toBe('tgt-1');
    });

    it('filters by relationType', () => {
      store.upsertEdge(makeEdge({ id: 'e2', relationType: 'calls' }));
      store.upsertEdge(makeEdge({ id: 'e3', relationType: 'imports' }));
      store.upsertEdge(makeEdge({ id: 'e4', relationType: 'calls' }));

      const calls = store.getEdges({ relationType: 'calls' });
      expect(calls).toHaveLength(2);

      const imports = store.getEdges({ relationType: 'imports' });
      expect(imports).toHaveLength(1);
    });
  });

  // ── FTS search ─────────────────────────────────────────────────────────

  describe('search', () => {
    it('finds a node by partial label match', () => {
      store.upsertNode(makeNode({ id: 'n10', label: 'validateToken' }));
      store.upsertNode(makeNode({ id: 'n11', label: 'unrelated' }));

      const results = store.searchNodes('validate');
      const labels = results.map((n) => n.label);
      expect(labels).toContain('validateToken');
      expect(labels).not.toContain('unrelated');
    });

    it('respects type filter', () => {
      store.upsertNode(
        makeNode({ id: 'n12', label: 'authToken', type: 'function' }),
      );
      store.upsertNode(
        makeNode({ id: 'n13', label: 'authToken', type: 'class' }),
      );

      const results = store.searchNodes('authToken', { type: 'function' });
      expect(results.every((n) => n.type === 'function')).toBe(true);
    });

    it('respects tag filter', () => {
      store.upsertNode(
        makeNode({
          id: 'n14',
          label: 'foo_extracted',
          tag: 'EXTRACTED',
        }),
      );
      store.upsertNode(
        makeNode({
          id: 'n15',
          label: 'foo_inferred',
          tag: 'INFERRED',
        }),
      );

      const extracted = store.searchNodes('foo_extracted', {
        tag: 'EXTRACTED',
      });
      expect(extracted.every((n) => n.tag === 'EXTRACTED')).toBe(true);

      const inferred = store.searchNodes('foo_inferred', { tag: 'INFERRED' });
      expect(inferred.every((n) => n.tag === 'INFERRED')).toBe(true);
    });
  });

  // ── Shrink guard ──────────────────────────────────────────────────────

  describe('replaceFileNodes shrink guard', () => {
    it('aborts when new node count is < 50% of existing', () => {
      const file = '/abs/auth.ts';
      const initial = [
        makeNode({ id: 'a1', sourceFile: file }),
        makeNode({ id: 'a2', sourceFile: file }),
        makeNode({ id: 'a3', sourceFile: file }),
      ];
      const first = store.replaceFileNodes(file, 'tree-sitter-ts', initial, [], 'h1');
      expect(first.committed).toBe(true);
      expect(store.getNodesByFile(file)).toHaveLength(3);

      const shrunk = [makeNode({ id: 'a1', sourceFile: file })];
      const second = store.replaceFileNodes(
        file,
        'tree-sitter-ts',
        shrunk,
        [],
        'h2',
      );
      expect(second.committed).toBe(false);
      expect(second.reason).toBe('shrink-guard');
      expect(store.getNodesByFile(file)).toHaveLength(3); // unchanged
    });

    it('honors force: true to bypass shrink guard', () => {
      const file = '/abs/auth.ts';
      const initial = [
        makeNode({ id: 'b1', sourceFile: file }),
        makeNode({ id: 'b2', sourceFile: file }),
        makeNode({ id: 'b3', sourceFile: file }),
      ];
      store.replaceFileNodes(file, 'tree-sitter-ts', initial, [], 'h1');

      const shrunk = [makeNode({ id: 'b1', sourceFile: file })];
      const result = store.replaceFileNodes(
        file,
        'tree-sitter-ts',
        shrunk,
        [],
        'h2',
        { force: true },
      );
      expect(result.committed).toBe(true);
      expect(store.getNodesByFile(file)).toHaveLength(1);
    });

    it('commits when first-time inserting (no existing rows)', () => {
      const file = '/abs/new.ts';
      const result = store.replaceFileNodes(
        file,
        'tree-sitter-ts',
        [makeNode({ id: 'c1', sourceFile: file })],
        [],
        'h0',
      );
      expect(result.committed).toBe(true);
      expect(store.getNodesByFile(file)).toHaveLength(1);
    });
  });

  // ── File delete cascade ───────────────────────────────────────────────

  describe('deleteFile', () => {
    it('removes nodes and their edges (cascade)', () => {
      const file = '/abs/cascade.ts';
      const n1 = makeNode({ id: 'd1', sourceFile: file });
      const n2 = makeNode({ id: 'd2', sourceFile: file });
      const n3 = makeNode({ id: 'd3', sourceFile: file });
      const otherNode = makeNode({ id: 'other', sourceFile: '/abs/other.ts' });

      store.replaceFileNodes(file, 'tree-sitter-ts', [n1, n2, n3], [], 'h');
      store.upsertNode(otherNode);
      store.upsertEdge(
        makeEdge({ id: 'eA', sourceId: 'd1', targetId: 'other' }),
      );
      store.upsertEdge(
        makeEdge({ id: 'eB', sourceId: 'other', targetId: 'd2' }),
      );

      store.deleteFile(file);

      expect(store.getNodesByFile(file)).toHaveLength(0);
      expect(store.getNodeById('other')).not.toBeNull(); // unaffected
      expect(store.getEdges({ sourceId: 'd1' })).toEqual([]);
      expect(store.getEdges({ targetId: 'd2' })).toEqual([]);
    });
  });

  // ── Stats ─────────────────────────────────────────────────────────────

  describe('getStats', () => {
    it('returns matching counts for inserted nodes/edges/files', () => {
      const file1 = '/abs/s1.ts';
      const file2 = '/abs/s2.ts';

      store.replaceFileNodes(
        file1,
        'tree-sitter-ts',
        [
          makeNode({ id: 's1a', sourceFile: file1 }),
          makeNode({ id: 's1b', sourceFile: file1 }),
        ],
        [makeEdge({ id: 'es1', sourceId: 's1a', targetId: 's1b' })],
        'h1',
      );
      store.replaceFileNodes(
        file2,
        'tree-sitter-ts',
        [makeNode({ id: 's2a', sourceFile: file2 })],
        [],
        'h2',
      );

      const stats = store.getStats();
      expect(stats.nodeCount).toBe(3);
      expect(stats.edgeCount).toBe(1);
      expect(stats.fileCount).toBe(2);
    });
  });

  // ── File state ────────────────────────────────────────────────────────

  describe('getFileState', () => {
    it('records contentHash and node_count after replaceFileNodes', () => {
      const file = '/abs/fs.ts';
      store.replaceFileNodes(
        file,
        'tree-sitter-ts',
        [
          makeNode({ id: 'fs1', sourceFile: file }),
          makeNode({ id: 'fs2', sourceFile: file }),
        ],
        [],
        'hash-abc',
      );

      const state = store.getFileState(file);
      expect(state).not.toBeNull();
      expect(state!.contentHash).toBe('hash-abc');
      expect(state!.nodeCount).toBe(2);
      expect(state!.extractor).toBe('tree-sitter-ts');
    });

    it('returns null for unknown file', () => {
      expect(store.getFileState('/nope.ts')).toBeNull();
    });
  });
});
