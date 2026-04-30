/**
 * Phase 12 — resolution-pass regression tests.
 *
 * Each case wires up the minimum graph state to exercise one rule of the
 * resolver, then asserts that the post-pass graph contains the expected
 * merged shape (placeholder gone, edges retargeted to the EXTRACTED node)
 * or the expected unchanged shape (placeholder preserved when ambiguous
 * or generic).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProjectGraphDB } from '../../projectGraph/projectGraphDb.js';
import type { ProjectGraphStore } from '../../projectGraph/store.js';
import type { GraphNode, GraphEdge } from '../../projectGraph/types.js';
import { runResolution } from '../../projectGraph/resolution.js';

const NOW = 1_700_000_000_000;

function func(id: string, label: string, sourceFile: string, line = 10): GraphNode {
  return {
    id,
    label,
    type: 'function',
    sourceFile,
    sourceLocation: String(line),
    properties: {},
    tag: 'EXTRACTED',
    confidence: 1.0,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function ref(id: string, label: string, props: Record<string, unknown> = {}): GraphNode {
  return {
    id,
    label,
    type: 'function',
    properties: props,
    tag: 'INFERRED',
    confidence: 0.6,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function classNode(id: string, label: string, sourceFile: string): GraphNode {
  return {
    id,
    label,
    type: 'class',
    sourceFile,
    properties: {},
    tag: 'EXTRACTED',
    confidence: 1.0,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function classRef(id: string, label: string): GraphNode {
  return {
    id,
    label,
    type: 'class',
    properties: {},
    tag: 'INFERRED',
    confidence: 0.6,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function moduleRef(id: string, sourceFile: string): GraphNode {
  return {
    id,
    label: sourceFile,
    type: 'module',
    sourceFile,
    properties: {},
    tag: 'INFERRED',
    confidence: 0.6,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function edge(
  id: string,
  sourceId: string,
  targetId: string,
  relationType: GraphEdge['relationType'],
  sourceFile?: string,
): GraphEdge {
  return {
    id,
    sourceId,
    targetId,
    relationType,
    tag: 'EXTRACTED',
    confidence: 1.0,
    sourceFile,
    sourceLocation: '1',
    createdAt: NOW,
  };
}

function seed(store: ProjectGraphStore, nodes: GraphNode[], edges: GraphEdge[]) {
  // Group nodes by sourceFile so we can use replaceFileNodes which is
  // the supported write path. Refs (no sourceFile) get a synthetic
  // bucket since the store accepts them via that API.
  const byFile = new Map<string, { nodes: GraphNode[]; edges: GraphEdge[] }>();
  for (const n of nodes) {
    const key = n.sourceFile ?? '__refs__';
    const bucket = byFile.get(key) ?? { nodes: [], edges: [] };
    bucket.nodes.push(n);
    byFile.set(key, bucket);
  }
  for (const e of edges) {
    const key = e.sourceFile ?? '__refs__';
    const bucket = byFile.get(key) ?? { nodes: [], edges: [] };
    bucket.edges.push(e);
    byFile.set(key, bucket);
  }
  for (const [file, bucket] of byFile) {
    store.replaceFileNodes(file, 'test', bucket.nodes, bucket.edges, 'h');
  }
}

describe('Phase 12 — resolution pass', () => {
  let db: ProjectGraphDB;
  let store: ProjectGraphStore;

  beforeEach(async () => {
    db = await ProjectGraphDB.create();
    store = db.getStore();
  });

  afterEach(() => {
    db.close();
  });

  it('rule 1 — qualified Foo.bar merges into the matching extracted member', () => {
    const cls = classNode('class:Foo', 'Foo', 'foo.ts');
    const fn = func('func:foo.ts:bar', 'bar', 'foo.ts');
    const placeholder = ref('func_ref:Foo.bar', 'bar', { receiver: 'Foo' });
    const memberOf = edge('m1', fn.id, cls.id, 'member_of', 'foo.ts');
    const callerFn = func('func:caller.ts:caller', 'caller', 'caller.ts');
    const callsEdge = edge('c1', callerFn.id, placeholder.id, 'calls', 'caller.ts');
    seed(store, [cls, fn, callerFn, placeholder], [memberOf, callsEdge]);

    const result = runResolution(store);
    expect(result.merged).toBe(1);
    expect(store.allNodes().find((n) => n.id === placeholder.id)).toBeUndefined();
    const allEdges = store.allEdges();
    const calls = allEdges.filter((e) => e.relationType === 'calls');
    expect(calls).toHaveLength(1);
    expect(calls[0].targetId).toBe(fn.id);
  });

  it('rule 1 — qualified Foo.bar with no extracted member stays as placeholder', () => {
    const cls = classNode('class:Foo', 'Foo', 'foo.ts');
    const placeholder = ref('func_ref:Foo.zzzNonexistent', 'zzzNonexistent', { receiver: 'Foo' });
    seed(store, [cls, placeholder], []);
    const result = runResolution(store);
    expect(result.merged).toBe(0);
    expect(store.allNodes().find((n) => n.id === placeholder.id)).toBeDefined();
  });

  it('rule 2 — this.bar merges via enclosing-class member_of', () => {
    const cls = classNode('class:Foo', 'Foo', 'foo.ts');
    const realBar = func('func:foo.ts:bar', 'bar', 'foo.ts', 5);
    const callerInsideFoo = func('func:foo.ts:other', 'other', 'foo.ts', 10);
    const placeholder = ref('func_ref:this.bar', 'bar', { receiver: 'this' });
    const memberOf1 = edge('m1', realBar.id, cls.id, 'member_of', 'foo.ts');
    const memberOf2 = edge('m2', callerInsideFoo.id, cls.id, 'member_of', 'foo.ts');
    const callsEdge = edge('c1', callerInsideFoo.id, placeholder.id, 'calls', 'foo.ts');
    seed(store, [cls, realBar, callerInsideFoo, placeholder], [memberOf1, memberOf2, callsEdge]);

    const result = runResolution(store);
    expect(result.merged).toBe(1);
    expect(store.allNodes().find((n) => n.id === placeholder.id)).toBeUndefined();
  });

  it('rule 3 — base.Method merges via extends walk', () => {
    const baseCls = classNode('class:Base', 'Base', 'base.ts');
    const childCls = classNode('class:Child', 'Child', 'child.ts');
    const baseRef = classRef('class_ref:Base', 'Base');
    const realInit = func('func:base.ts:Init', 'Init', 'base.ts', 5);
    const callerInsideChild = func('func:child.ts:Run', 'Run', 'child.ts', 10);
    const placeholder = ref('func_ref:base.Init', 'Init', { receiver: 'base' });

    const baseMember = edge('m1', realInit.id, baseCls.id, 'member_of', 'base.ts');
    const childMember = edge('m2', callerInsideChild.id, childCls.id, 'member_of', 'child.ts');
    // child extends base — through the placeholder ref pattern the
    // extractor produces: extends edge points at class_ref.
    const extendsEdge = edge('e1', childCls.id, baseRef.id, 'extends', 'child.ts');
    const callsEdge = edge('c1', callerInsideChild.id, placeholder.id, 'calls', 'child.ts');

    seed(
      store,
      [baseCls, childCls, baseRef, realInit, callerInsideChild, placeholder],
      [baseMember, childMember, extendsEdge, callsEdge],
    );

    const result = runResolution(store);
    expect(result.merged).toBe(1);
    expect(store.allNodes().find((n) => n.id === placeholder.id)).toBeUndefined();
  });

  it('rule 4 — bare callee with callerFile and matching import merges', () => {
    const fn = func('func:lib.ts:helper', 'helper', 'lib.ts');
    const callerFn = func('func:caller.ts:caller', 'caller', 'caller.ts');
    const importedModule = moduleRef('module_ref:lib.ts', 'lib.ts');
    const placeholder = ref('func_ref:helper', 'helper', { callerFile: 'caller.ts' });
    const importEdge = edge('i1', callerFn.id, importedModule.id, 'imports', 'caller.ts');
    const callsEdge = edge('c1', callerFn.id, placeholder.id, 'calls', 'caller.ts');
    seed(store, [fn, callerFn, importedModule, placeholder], [importEdge, callsEdge]);

    const result = runResolution(store);
    expect(result.merged).toBe(1);
    expect(store.allNodes().find((n) => n.id === placeholder.id)).toBeUndefined();
  });

  it('rule 5 — bare callee with one extracted match merges', () => {
    const fn = func('func:any.ts:rareName', 'rareName', 'any.ts');
    const placeholder = ref('func_ref:rareName', 'rareName');
    seed(store, [fn, placeholder], []);
    const result = runResolution(store);
    expect(result.merged).toBe(1);
  });

  it('rule 5 — bare callee with two extracted matches stays as placeholder', () => {
    const fn1 = func('func:a.ts:doIt', 'doIt', 'a.ts');
    const fn2 = func('func:b.ts:doIt', 'doIt', 'b.ts');
    const placeholder = ref('func_ref:doIt', 'doIt');
    seed(store, [fn1, fn2, placeholder], []);
    const result = runResolution(store);
    expect(result.merged).toBe(0);
  });

  it('generic-name guard — `init` with one extracted match still stays as placeholder', () => {
    const fn = func('func:any.ts:init', 'init', 'any.ts');
    const placeholder = ref('func_ref:init', 'init');
    seed(store, [fn, placeholder], []);
    const result = runResolution(store);
    expect(result.merged).toBe(0);
    expect(store.allNodes().find((n) => n.id === placeholder.id)).toBeDefined();
  });

  it('language-prefixed ID — php:func_ref:Log.info merges via class index', () => {
    const cls = classNode('class:Log', 'Log', 'log.php');
    const fn = func('func:log.php:info', 'info', 'log.php');
    const memberOf = edge('m1', fn.id, cls.id, 'member_of', 'log.php');
    const placeholder = ref('php:func_ref:Log.info', 'info', { receiver: 'Log' });
    seed(store, [cls, fn, placeholder], [memberOf]);
    const result = runResolution(store);
    expect(result.merged).toBe(1);
  });

  it('Tier 2 upgrade in extractor + resolution — DeclaredType.method resolves', () => {
    // Simulates what the extractor would emit when given
    // `const x: Foo = ...; x.bar();` — the placeholder is already
    // qualified with `Foo.bar` thanks to Tier 2 lookup at extraction
    // time. The resolution pass then applies rule 1 normally.
    const cls = classNode('class:Foo', 'Foo', 'foo.ts');
    const fn = func('func:foo.ts:bar', 'bar', 'foo.ts');
    const memberOf = edge('m1', fn.id, cls.id, 'member_of', 'foo.ts');
    const placeholder = ref('func_ref:Foo.bar', 'bar', { receiver: 'Foo' });
    seed(store, [cls, fn, placeholder], [memberOf]);
    const result = runResolution(store);
    expect(result.merged).toBe(1);
  });

  it('idempotent — running the pass twice changes nothing on the second run', () => {
    const fn = func('func:any.ts:uniqueLabel', 'uniqueLabel', 'any.ts');
    const placeholder = ref('func_ref:uniqueLabel', 'uniqueLabel');
    seed(store, [fn, placeholder], []);
    const r1 = runResolution(store);
    const r2 = runResolution(store);
    expect(r1.merged).toBe(1);
    expect(r2.merged).toBe(0);
    expect(r2.totalRefs).toBe(0);
  });

  it('mergeNodes — edges incoming and outgoing all retarget cleanly', () => {
    const fn = func('func:any.ts:realFn', 'realFn', 'any.ts');
    const otherFn = func('func:any.ts:other', 'other', 'any.ts');
    const placeholder = ref('func_ref:realFn', 'realFn');
    const inEdge = edge('e1', otherFn.id, placeholder.id, 'calls', 'any.ts');
    const outEdge = edge('e2', placeholder.id, otherFn.id, 'references', 'any.ts');
    seed(store, [fn, otherFn, placeholder], [inEdge, outEdge]);

    runResolution(store);
    const allEdges = store.allEdges();
    expect(allEdges.find((e) => e.id === 'e1')?.targetId).toBe(fn.id);
    expect(allEdges.find((e) => e.id === 'e2')?.sourceId).toBe(fn.id);
  });
});
