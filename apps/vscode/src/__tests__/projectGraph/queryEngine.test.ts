/**
 * GraphQueryEngine tests — fixture graph with 5 functions + class + doc node.
 *
 * Graph topology:
 *   A → B, A → C, B → D, C → D  (all 'calls' edges)
 *   E is isolated (no edges)
 *   K is a class node (no edges)
 *   M is a doc_section node with a 'references' edge to A
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventHorizonDB } from '../../persistence.js';
import { GraphQueryEngine } from '../../projectGraph/queryEngine.js';
import type { ProjectGraphStore } from '../../projectGraph/store.js';
import type { GraphNode, GraphEdge } from '../../projectGraph/index.js';

// ── Fixture node / edge IDs ────────────────────────────────────────────────

const A = 'func:A:/workspace/test.ts';
const B = 'func:B:/workspace/test.ts';
const C = 'func:C:/workspace/test.ts';
const D = 'func:D:/workspace/test.ts';
const E = 'func:E:/workspace/test.ts';
const K = 'class:K:/workspace/test.ts';
const M = 'doc_section:M:/workspace/README.md';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeNode(id: string, label: string, overrides?: Partial<GraphNode>): GraphNode {
  const now = Date.now();
  return {
    id,
    label,
    type: 'function',
    sourceFile: '/workspace/test.ts',
    sourceLocation: '1-10',
    properties: {},
    tag: 'EXTRACTED',
    confidence: 1.0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeEdge(id: string, sourceId: string, targetId: string, overrides?: Partial<GraphEdge>): GraphEdge {
  return {
    id,
    sourceId,
    targetId,
    relationType: 'calls',
    tag: 'EXTRACTED',
    confidence: 1.0,
    createdAt: Date.now(),
    ...overrides,
  };
}

// ── Suite ──────────────────────────────────────────────────────────────────

describe('GraphQueryEngine', () => {
  let db: EventHorizonDB;
  let store: ProjectGraphStore;
  let engine: GraphQueryEngine;

  beforeEach(async () => {
    db = await EventHorizonDB.create();
    store = db.getProjectGraphStore();
    engine = new GraphQueryEngine(store);

    // Nodes
    store.upsertNode(makeNode(A, 'funcA'));
    store.upsertNode(makeNode(B, 'funcB'));
    store.upsertNode(makeNode(C, 'funcC'));
    store.upsertNode(makeNode(D, 'funcD'));
    store.upsertNode(makeNode(E, 'funcE'));
    store.upsertNode(makeNode(K, 'classK', { type: 'class' }));
    store.upsertNode(makeNode(M, 'docM', { type: 'doc_section', sourceFile: '/workspace/README.md' }));

    // Call edges: A→B, A→C, B→D, C→D
    store.upsertEdge(makeEdge('e-AB', A, B));
    store.upsertEdge(makeEdge('e-AC', A, C));
    store.upsertEdge(makeEdge('e-BD', B, D));
    store.upsertEdge(makeEdge('e-CD', C, D));

    // Doc reference: M references A
    store.upsertEdge(makeEdge('e-MA', M, A, { relationType: 'references', tag: 'EXTRACTED' }));
  });

  afterEach(() => {
    db.close();
  });

  // 1. callers(A) — A is the root, nothing calls it
  it('1. callers(A) returns empty — A is the entry point', () => {
    const result = engine.callers(A);
    expect(result).toHaveLength(0);
  });

  // 2. callees(A, 1) — direct children only: B and C
  it('2. callees(A, 1) returns direct callees [B, C]', () => {
    const result = engine.callees(A, 1);
    const ids = result.map((n) => n.id);
    expect(ids).toHaveLength(2);
    expect(ids).toContain(B);
    expect(ids).toContain(C);
  });

  // 3. callees(A, 2) — transitive: B, C, and D (D reachable via B and via C)
  it('3. callees(A, 2) returns [B, C, D] — D reached transitively', () => {
    const result = engine.callees(A, 2);
    const ids = result.map((n) => n.id);
    expect(ids).toHaveLength(3);
    expect(ids).toContain(B);
    expect(ids).toContain(C);
    expect(ids).toContain(D);
  });

  // 4. neighbors(A, { relationTypes: ['calls'] }) — only outgoing call edges exist for A
  it('4. neighbors(A, { relationTypes: ["calls"] }) returns 2 entries (B and C)', () => {
    const result = engine.neighbors(A, { relationTypes: ['calls'] });
    expect(result).toHaveLength(2);
    const ids = result.map((e) => e.node.id);
    expect(ids).toContain(B);
    expect(ids).toContain(C);
  });

  // 5. shortestPath(A, D) — path of length 3 through B or C
  it('5. shortestPath(A, D) returns a length-3 path [A, B|C, D]', () => {
    const path = engine.shortestPath(A, D);
    expect(path).not.toBeNull();
    expect(path!).toHaveLength(3);
    expect(path![0].id).toBe(A);
    expect(path![2].id).toBe(D);
    expect([B, C]).toContain(path![1].id);
  });

  // 6. shortestPath(A, E) — E has no edges so it is unreachable
  it('6. shortestPath(A, E) returns null — E is unreachable from A', () => {
    const path = engine.shortestPath(A, E);
    expect(path).toBeNull();
  });

  // 7. search with tag filter excludes INFERRED placeholders
  it('7. search("funcA", { tag: "EXTRACTED" }) returns node A and excludes INFERRED placeholders', () => {
    const INFERRED_ID = 'func_ref:A:/workspace/test.ts';
    store.upsertNode(makeNode(INFERRED_ID, 'funcA', { tag: 'INFERRED', confidence: 0.6 }));

    const results = engine.search('funcA', { tag: 'EXTRACTED' });
    expect(results.every((n) => n.tag === 'EXTRACTED')).toBe(true);
    const ids = results.map((n) => n.id);
    expect(ids).toContain(A);
    expect(ids).not.toContain(INFERRED_ID);
  });

  // 8. explain(A) — A node + outgoing edges to B and C
  it('8. explain(A) returns node A with out edges to B and C', () => {
    const result = engine.explain(A);
    expect(result).not.toBeNull();
    expect(result!.node).not.toBeNull();
    expect(result!.node!.id).toBe(A);
    const outIds = result!.out.map((e) => e.node.id);
    expect(outIds).toHaveLength(2);
    expect(outIds).toContain(B);
    expect(outIds).toContain(C);
  });

  // 9. Cycle: X→Y and Y→X — callers BFS must not loop infinitely
  it('9. callers(X, 5) terminates and returns [Y] when X↔Y form a call cycle', () => {
    const X = 'func:X:/workspace/cycle.ts';
    const Y = 'func:Y:/workspace/cycle.ts';
    store.upsertNode(makeNode(X, 'funcX'));
    store.upsertNode(makeNode(Y, 'funcY'));
    store.upsertEdge(makeEdge('e-XY', X, Y));
    store.upsertEdge(makeEdge('e-YX', Y, X));

    const result = engine.callers(X, 5);
    const ids = result.map((n) => n.id);
    // Y is a caller of X
    expect(ids).toContain(Y);
    // Y must appear exactly once — no infinite-loop duplicate
    expect(ids.filter((id) => id === Y)).toHaveLength(1);
    // X must not appear (it is the start node, not a caller)
    expect(ids).not.toContain(X);
  });
});
