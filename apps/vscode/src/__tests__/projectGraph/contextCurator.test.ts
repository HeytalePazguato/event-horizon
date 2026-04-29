/**
 * ContextCurator tests — fixture graph with 8 acceptance cases.
 *
 * Setup pattern (matches queryEngine.test.ts):
 *   ProjectGraphDB.create() → getStore() → upsert nodes/edges
 *   → new GraphQueryEngine(store) → new ContextCurator(engine)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProjectGraphDB } from '../../projectGraph/projectGraphDb.js';
import { GraphQueryEngine } from '../../projectGraph/queryEngine.js';
import { ContextCurator } from '../../projectGraph/contextCurator.js';
import type { ProjectGraphStore } from '../../projectGraph/store.js';
import type { GraphNode, GraphEdge } from '../../projectGraph/index.js';

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

function makeEdge(
  id: string,
  sourceId: string,
  targetId: string,
  overrides?: Partial<GraphEdge>,
): GraphEdge {
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

describe('ContextCurator', () => {
  let db: ProjectGraphDB;
  let store: ProjectGraphStore;
  let engine: GraphQueryEngine;
  let curator: ContextCurator;

  beforeEach(async () => {
    db = await ProjectGraphDB.create();
    store = db.getStore();
    engine = new GraphQueryEngine(store);
    curator = new ContextCurator(engine);
  });

  afterEach(() => {
    db.close();
  });

  // 1. Task description with one camelCase identifier → seed found and
  //    included; BFS expansion includes callers and callees.
  it('1. task identifier is found as seed; callers and callees appear after expansion', () => {
    const SEED = 'func:processPayment:/workspace/pay.ts';
    const CALLER = 'func:checkoutHandler:/workspace/checkout.ts';
    const CALLEE = 'func:chargeCard:/workspace/pay.ts';

    store.upsertNode(makeNode(SEED, 'processPayment', { sourceFile: '/workspace/pay.ts' }));
    store.upsertNode(makeNode(CALLER, 'checkoutHandler', { sourceFile: '/workspace/checkout.ts' }));
    store.upsertNode(makeNode(CALLEE, 'chargeCard', { sourceFile: '/workspace/pay.ts' }));

    store.upsertEdge(makeEdge('e-caller', CALLER, SEED));
    store.upsertEdge(makeEdge('e-callee', SEED, CALLEE));

    const result = curator.curate({
      taskDescription: 'Fix the processPayment flow for checkout',
      tokenBudget: 4000,
    });

    const ids = result.subgraph.nodes.map((n) => n.id);
    expect(ids).toContain(SEED);
    expect(ids).toContain(CALLER);
    expect(ids).toContain(CALLEE);
  });

  // 2. Token budget caps the result — 30-token budget yields fewer nodes
  //    than a 4000-token budget when the graph has 31 nodes.
  it('2. smaller token budget returns fewer nodes than a larger budget', () => {
    const SEED = 'func:buildGraph:/workspace/graph.ts';
    store.upsertNode(makeNode(SEED, 'buildGraph', { sourceFile: '/workspace/graph.ts' }));

    for (let i = 0; i < 30; i++) {
      const id = `func:helperFn${i}:/workspace/graph.ts`;
      store.upsertNode(makeNode(id, `helperFn${i}`, { sourceFile: '/workspace/graph.ts' }));
      store.upsertEdge(makeEdge(`e-${i}`, SEED, id));
    }

    const small = curator.curate({
      taskDescription: 'Implement buildGraph pipeline',
      tokenBudget: 30,
    });
    const large = curator.curate({
      taskDescription: 'Implement buildGraph pipeline',
      tokenBudget: 4000,
    });

    expect(small.subgraph.nodes.length).toBeLessThan(large.subgraph.nodes.length);
  });

  // 3. Seeds are always forced into the result even when the token budget is
  //    tiny and the seed has low confidence.
  it('3. low-confidence seed node is included regardless of a 1-token budget', () => {
    const SEED = 'func:lowConfidenceFn:/workspace/util.ts';
    store.upsertNode(
      makeNode(SEED, 'lowConfidenceFn', {
        confidence: 0.1,
        sourceFile: '/workspace/util.ts',
      }),
    );

    const result = curator.curate({
      taskDescription: 'Fix lowConfidenceFn edge case',
      tokenBudget: 1,
    });

    const ids = result.subgraph.nodes.map((n) => n.id);
    expect(ids).toContain(SEED);
  });

  // 4. includeActivity:false must exclude agent_activity nodes even when
  //    activity nodes exist for the seed's file.
  it('4. includeActivity:false excludes agent_activity nodes from the subgraph', () => {
    const SEED = 'func:handleRequest:/workspace/server.ts';
    const ACTIVITY = 'activity:agent1:1700000000000';
    // targetId of touched edges is the synthetic module node ID used by recentActivity
    const MODULE = 'module:/workspace/server.ts';

    store.upsertNode(makeNode(SEED, 'handleRequest', { sourceFile: '/workspace/server.ts' }));
    store.upsertNode(
      makeNode(ACTIVITY, 'agent1-activity', {
        type: 'agent_activity',
        sourceFile: undefined,
        properties: { timestamp: Date.now(), agentId: 'agent1' },
      }),
    );
    store.upsertEdge(makeEdge('e-touched', ACTIVITY, MODULE, { relationType: 'touched' }));

    const withActivity = curator.curate({
      taskDescription: 'Fix handleRequest server logic',
      tokenBudget: 4000,
      includeActivity: true,
    });
    const withoutActivity = curator.curate({
      taskDescription: 'Fix handleRequest server logic',
      tokenBudget: 4000,
      includeActivity: false,
    });

    expect(withActivity.subgraph.nodes.map((n) => n.id)).toContain(ACTIVITY);
    expect(withoutActivity.subgraph.nodes.map((n) => n.id)).not.toContain(ACTIVITY);
  });

  // 5. includeKnowledge:false must exclude knowledge-type nodes.
  //    The knowledge node uses tag INFERRED so it cannot become a seed.
  it('5. includeKnowledge:false excludes knowledge nodes from the subgraph', () => {
    const SEED = 'func:processClaim:/workspace/claims.ts';
    const KNOWLEDGE = 'knowledge:claimPolicy:1';

    store.upsertNode(makeNode(SEED, 'processClaim', { sourceFile: '/workspace/claims.ts' }));
    store.upsertNode(
      makeNode(KNOWLEDGE, 'claimPolicy', {
        type: 'knowledge',
        tag: 'INFERRED',
        sourceFile: undefined,
      }),
    );

    const withKnowledge = curator.curate({
      taskDescription: 'Implement processClaim using claimPolicy guidelines',
      tokenBudget: 4000,
      includeKnowledge: true,
    });
    const withoutKnowledge = curator.curate({
      taskDescription: 'Implement processClaim using claimPolicy guidelines',
      tokenBudget: 4000,
      includeKnowledge: false,
    });

    expect(withKnowledge.subgraph.nodes.map((n) => n.id)).toContain(KNOWLEDGE);
    expect(withoutKnowledge.subgraph.nodes.map((n) => n.id)).not.toContain(KNOWLEDGE);
  });

  // 6. suggestedReads is ordered by descending aggregate node score per file.
  //    payment.ts has the seed (score 1.0) plus two callees (0.5 each) = 2.0;
  //    utils.ts has one callee (0.5). payment.ts must come first.
  it('6. suggestedReads lists the highest-scoring file first', () => {
    const SEED = 'func:handlePayment:/workspace/payment.ts';
    const C1 = 'func:chargeCard:/workspace/payment.ts';
    const C2 = 'func:saveReceipt:/workspace/payment.ts';
    const U1 = 'func:logEvent:/workspace/utils.ts';

    store.upsertNode(makeNode(SEED, 'handlePayment', { sourceFile: '/workspace/payment.ts' }));
    store.upsertNode(makeNode(C1, 'chargeCard', { sourceFile: '/workspace/payment.ts' }));
    store.upsertNode(makeNode(C2, 'saveReceipt', { sourceFile: '/workspace/payment.ts' }));
    store.upsertNode(makeNode(U1, 'logEvent', { sourceFile: '/workspace/utils.ts' }));

    store.upsertEdge(makeEdge('e-c1', SEED, C1));
    store.upsertEdge(makeEdge('e-c2', SEED, C2));
    store.upsertEdge(makeEdge('e-u1', SEED, U1));

    const result = curator.curate({
      taskDescription: 'Fix handlePayment processing',
      tokenBudget: 4000,
    });

    expect(result.suggestedReads.length).toBeGreaterThanOrEqual(2);
    expect(result.suggestedReads[0]).toBe('/workspace/payment.ts');
  });

  // 7. Empty graph (no nodes at all) → empty subgraph, zeroed coverage, no crash.
  it('7. empty graph returns empty subgraph with zeroed coverage', () => {
    const result = curator.curate({
      taskDescription: 'Fix the processOrder logic',
      tokenBudget: 4000,
    });

    expect(result.subgraph.nodes).toHaveLength(0);
    expect(result.subgraph.edges).toHaveLength(0);
    expect(result.coverage.codeNodes).toBe(0);
    expect(result.coverage.conceptNodes).toBe(0);
    expect(result.coverage.activityNodes).toBe(0);
    expect(result.coverage.knowledgeNodes).toBe(0);
    expect(result.suggestedReads).toHaveLength(0);
  });

  // 8. Task description with no camelCase / snake_case / backtick identifiers
  //    → extractCandidateTokens yields nothing → empty subgraph, codeNodes===0.
  it('8. plain-English task with no identifier returns empty subgraph and codeNodes===0', () => {
    store.upsertNode(makeNode('func:foo:/workspace/foo.ts', 'foo', { sourceFile: '/workspace/foo.ts' }));

    const result = curator.curate({
      taskDescription: 'fix the sorting bug in production',
      tokenBudget: 4000,
    });

    expect(result.subgraph.nodes).toHaveLength(0);
    expect(result.coverage.codeNodes).toBe(0);
  });
});
