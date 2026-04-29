/**
 * TreeSitterExtractor unit tests — 8 cases covering node/edge emission,
 * file-size skip, TSX parsing, and stable ID generation.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { TreeSitterExtractor } from '../../projectGraph/treeSitterExtractor.js';

const FILE_TS = '/workspace/test.ts';
const FILE_TSX = '/workspace/test.tsx';

describe('TreeSitterExtractor', () => {
  let ex: TreeSitterExtractor;

  // Load the WASM runtime once for the suite so individual tests don't time out.
  beforeAll(async () => {
    ex = new TreeSitterExtractor();
    await ex.extract(FILE_TS, 'function _warmup() {}');
  }, 30_000);

  // 1. Simple function ─────────────────────────────────────────────────────────
  it('simple function: 1 module + 1 function node, 0 call edges', async () => {
    const { nodes, edges, skipped } = await ex.extract(FILE_TS, 'function foo() {}');

    expect(skipped).toBeUndefined();

    const modules = nodes.filter(n => n.type === 'module');
    const functions = nodes.filter(n => n.type === 'function');

    expect(modules).toHaveLength(1);
    expect(functions).toHaveLength(1);
    expect(functions[0].label).toBe('foo');
    expect(edges.filter(e => e.relationType === 'calls')).toHaveLength(0);
  });

  // 2. Function with call ──────────────────────────────────────────────────────
  it('function with call: 1 calls edge → func_ref:bar (INFERRED, 0.6)', async () => {
    const { nodes, edges, skipped } = await ex.extract(
      FILE_TS,
      'function foo() { bar(); }',
    );

    expect(skipped).toBeUndefined();

    const callEdges = edges.filter(e => e.relationType === 'calls');
    expect(callEdges).toHaveLength(1);
    expect(callEdges[0].targetId).toBe('func_ref:bar');

    const barRef = nodes.find(n => n.id === 'func_ref:bar');
    expect(barRef).toBeDefined();
    expect(barRef!.tag).toBe('INFERRED');
    expect(barRef!.confidence).toBe(0.6);
  });

  // 3. Class with extends ──────────────────────────────────────────────────────
  it('class extends: class node A + class_ref:B placeholder + 1 extends edge', async () => {
    const { nodes, edges, skipped } = await ex.extract(FILE_TS, 'class A extends B {}');

    expect(skipped).toBeUndefined();

    const classA = nodes.find(n => n.type === 'class' && n.label === 'A');
    expect(classA).toBeDefined();
    expect(classA!.tag).toBe('EXTRACTED');

    const classRefB = nodes.find(n => n.id === 'class_ref:B');
    expect(classRefB).toBeDefined();
    expect(classRefB!.tag).toBe('INFERRED');

    const extendsEdges = edges.filter(e => e.relationType === 'extends');
    expect(extendsEdges).toHaveLength(1);
    expect(extendsEdges[0].sourceId).toBe(classA!.id);
    expect(extendsEdges[0].targetId).toBe('class_ref:B');
  });

  // 4. TS interface ────────────────────────────────────────────────────────────
  it('TS interface: emits 1 interface node', async () => {
    const { nodes, skipped } = await ex.extract(FILE_TS, 'interface X {}');

    expect(skipped).toBeUndefined();

    const ifaces = nodes.filter(n => n.type === 'interface');
    expect(ifaces).toHaveLength(1);
    expect(ifaces[0].label).toBe('X');
  });

  // 5. Import statement ────────────────────────────────────────────────────────
  it("import: 1 imports edge from module node to module_ref:./y", async () => {
    const { nodes, edges, skipped } = await ex.extract(
      FILE_TS,
      "import { x } from './y';",
    );

    expect(skipped).toBeUndefined();

    const importEdges = edges.filter(e => e.relationType === 'imports');
    expect(importEdges).toHaveLength(1);

    const moduleNode = nodes.find(n => n.type === 'module');
    expect(moduleNode).toBeDefined();
    expect(importEdges[0].sourceId).toBe(moduleNode!.id);
    expect(importEdges[0].targetId).toBe('module_ref:./y');

    const modRef = nodes.find(n => n.id === 'module_ref:./y');
    expect(modRef).toBeDefined();
  });

  // 6. TSX file ────────────────────────────────────────────────────────────────
  it('TSX: arrow component parses without error and emits function node', async () => {
    const { nodes, skipped } = await ex.extract(
      FILE_TSX,
      'const Btn = () => <div />;',
    );

    expect(skipped).toBeUndefined();

    const functions = nodes.filter(n => n.type === 'function');
    expect(functions.length).toBeGreaterThanOrEqual(1);
    expect(functions.find(f => f.label === 'Btn')).toBeDefined();
  });

  // 7. Skip > 1 MB ─────────────────────────────────────────────────────────────
  it('skips files larger than 1 MB: skipped=true, empty nodes/edges', async () => {
    const bigSource = 'x'.repeat(1024 * 1024 + 1);
    const { nodes, edges, skipped } = await ex.extract(FILE_TS, bigSource);

    expect(skipped).toBe(true);
    expect(nodes).toHaveLength(0);
    expect(edges).toHaveLength(0);
  });

  // 8. Stable IDs ──────────────────────────────────────────────────────────────
  it('stable IDs: identical node IDs across two extractions of the same source', async () => {
    const source = 'function greet() { console.log("hi"); }';

    const r1 = await ex.extract(FILE_TS, source);
    const r2 = await ex.extract(FILE_TS, source);

    const ids1 = r1.nodes.map(n => n.id).sort();
    const ids2 = r2.nodes.map(n => n.id).sort();

    expect(ids1).toEqual(ids2);
  });
});
