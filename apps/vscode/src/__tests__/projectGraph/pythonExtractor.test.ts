/**
 * Python extractor tests — exercise the real tree-sitter-python WASM grammar
 * via the public TreeSitterExtractor entry point.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { TreeSitterExtractor } from '../../projectGraph/treeSitterExtractor.js';

const FILE = '/workspace/test.py';

describe('Python extractor', () => {
  let ex: TreeSitterExtractor;

  beforeAll(async () => {
    ex = new TreeSitterExtractor();
    await ex.extract(FILE, 'def _warmup():\n  pass\n');
  }, 30_000);

  it('top-level def + call edge', async () => {
    const source = `
def compute(x):
    return helper(x)

def helper(x):
    return x
`;
    const { nodes, edges, skipped } = await ex.extract(FILE, source);
    expect(skipped).toBeUndefined();

    // Filter to real definitions; the `helper(x)` call also produces an
    // INFERRED `func_ref` placeholder node by design.
    const fns = nodes.filter((n) => n.type === 'function' && n.tag === 'EXTRACTED');
    expect(fns.map((f) => f.label).sort()).toEqual(['compute', 'helper']);

    const calls = edges.filter((e) => e.relationType === 'calls');
    expect(calls).toHaveLength(1);
    expect(calls[0].targetId).toBe('py:func_ref:helper');
  });

  it('async def sets properties.async = true', async () => {
    const source = 'async def fetch():\n    pass\n';
    const { nodes } = await ex.extract(FILE, source);
    const fn = nodes.find((n) => n.type === 'function' && n.label === 'fetch');
    expect(fn).toBeDefined();
    expect((fn!.properties as Record<string, unknown>).async).toBe(true);
  });

  it('decorated function carries its decorators in properties', async () => {
    const source = `
@cached
@staticmethod
def memo(x):
    return x
`;
    const { nodes } = await ex.extract(FILE, source);
    const fn = nodes.find((n) => n.type === 'function' && n.label === 'memo');
    expect(fn).toBeDefined();
    const decorators = (fn!.properties as Record<string, unknown>).decorators as string[];
    expect(decorators).toContain('cached');
    expect(decorators).toContain('staticmethod');
  });

  it('docstring is captured from the first body statement', async () => {
    const source = `
def greet():
    """Say hello to the user."""
    return 'hello'
`;
    const { nodes } = await ex.extract(FILE, source);
    const fn = nodes.find((n) => n.type === 'function' && n.label === 'greet');
    expect(fn).toBeDefined();
    const docstring = (fn!.properties as Record<string, unknown>).docstring as string | undefined;
    expect(docstring).toBeDefined();
    expect(docstring).toContain('Say hello to the user');
  });

  it('class inheritance produces extends edges', async () => {
    const source = `
class Order(Base):
    pass
`;
    const { nodes, edges } = await ex.extract(FILE, source);
    expect(nodes.find((n) => n.type === 'class' && n.label === 'Order')).toBeDefined();
    const ext = edges.filter((e) => e.relationType === 'extends');
    expect(ext).toHaveLength(1);
    expect(ext[0].targetId).toBe('py:class_ref:Base');
  });

  it('import + from-import produce imports edges', async () => {
    const source = `
import os
from typing import List, Dict
`;
    const { edges } = await ex.extract(FILE, source);
    const imports = edges.filter((e) => e.relationType === 'imports');
    // 1 from `import os` + 2 from `from typing import List, Dict`.
    expect(imports.length).toBeGreaterThanOrEqual(3);
    const targets = imports.map((e) => e.targetId);
    expect(targets).toContain('module_ref:os');
    expect(targets.some((t) => t.includes('List'))).toBe(true);
    expect(targets.some((t) => t.includes('Dict'))).toBe(true);
  });

  it('# TODO / # FIXME comments produce rationale nodes', async () => {
    const source = `
def compute(x):
    # FIXME: handle empty input
    return helper(x)
`;
    const { nodes, edges } = await ex.extract(FILE, source);
    const rationale = nodes.filter((n) => n.type === 'rationale');
    expect(rationale).toHaveLength(1);
    expect(rationale[0].label.toLowerCase()).toContain('fixme');

    const rfor = edges.filter((e) => e.relationType === 'rationale_for');
    expect(rfor).toHaveLength(1);
    // The rationale should attach to the enclosing function (compute).
    const computeFn = nodes.find((n) => n.type === 'function' && n.label === 'compute');
    expect(rfor[0].targetId).toBe(computeFn!.id);
  });
});
