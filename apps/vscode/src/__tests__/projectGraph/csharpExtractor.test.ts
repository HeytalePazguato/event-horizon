/**
 * C# extractor tests — exercise the real tree-sitter-c-sharp WASM grammar
 * via the public TreeSitterExtractor entry point.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { TreeSitterExtractor } from '../../projectGraph/treeSitterExtractor.js';

const FILE = '/workspace/Test.cs';

describe('C# extractor', () => {
  let ex: TreeSitterExtractor;

  beforeAll(async () => {
    ex = new TreeSitterExtractor();
    await ex.extract(FILE, 'class Warmup {}');
  }, 30_000);

  it('class with method and call: method node + calls edge', async () => {
    const source = `
class OrderService {
  public Order Get(int id) {
    return _repo.Find(id);
  }
}`;
    const { nodes, edges } = await ex.extract(FILE, source);

    const cls = nodes.find((n) => n.type === 'class' && n.label === 'OrderService');
    expect(cls).toBeDefined();

    const method = nodes.find((n) => n.type === 'function' && n.label === 'Get');
    expect(method).toBeDefined();
    const props = method!.properties as Record<string, unknown>;
    expect(props.kind).toBe('method_declaration');
    expect(props.parentLabel).toBe('OrderService');

    const calls = edges.filter((e) => e.relationType === 'calls' && e.targetId === 'cs:func_ref:Find');
    expect(calls).toHaveLength(1);
  });

  it('class with base + interfaces: 1 extends + 2 implements edges', async () => {
    const source = `class OrderService : BaseService, IOrderService, IAuditable {}`;
    const { edges } = await ex.extract(FILE, source);
    expect(edges.filter((e) => e.relationType === 'extends')).toHaveLength(1);
    expect(edges.filter((e) => e.relationType === 'implements')).toHaveLength(2);
  });

  it('record / struct / enum get kind property and class type', async () => {
    const source = `
record Money(decimal Amount, string Currency);
struct Point { public int X; public int Y; }
enum Color { Red, Green, Blue }
`;
    const { nodes } = await ex.extract(FILE, source);

    const money = nodes.find((n) => n.label === 'Money');
    expect(money?.type).toBe('class');
    expect((money!.properties as Record<string, unknown>).kind).toBe('record');

    const point = nodes.find((n) => n.label === 'Point');
    expect(point?.type).toBe('class');
    expect((point!.properties as Record<string, unknown>).kind).toBe('struct');

    const color = nodes.find((n) => n.label === 'Color');
    expect(color?.type).toBe('class');
    expect((color!.properties as Record<string, unknown>).kind).toBe('enum');
  });

  it('using directive produces an imports edge', async () => {
    const source = `
using System.Linq;
using System.Collections.Generic;

class Foo {}
`;
    const { edges } = await ex.extract(FILE, source);
    const imports = edges.filter((e) => e.relationType === 'imports');
    expect(imports.length).toBeGreaterThanOrEqual(2);
    const targets = imports.map((e) => e.targetId);
    expect(targets).toContain('module_ref:System.Linq');
    expect(targets).toContain('module_ref:System.Collections.Generic');
  });

  it('XML doc comments preceding a class attach as docstring', async () => {
    const source = `
/// <summary>
/// Repository for orders.
/// </summary>
class OrderRepo {}
`;
    const { nodes } = await ex.extract(FILE, source);
    const cls = nodes.find((n) => n.type === 'class' && n.label === 'OrderRepo');
    expect(cls).toBeDefined();
    const docstring = (cls!.properties as Record<string, unknown>).docstring as string | undefined;
    expect(docstring).toBeDefined();
    expect(docstring).toContain('Repository for orders');
  });

  it('interface with extends produces extends edges (not implements)', async () => {
    const source = `interface IExtended : IBase, IDisposable {}`;
    const { edges } = await ex.extract(FILE, source);
    expect(edges.filter((e) => e.relationType === 'extends')).toHaveLength(2);
    expect(edges.filter((e) => e.relationType === 'implements')).toHaveLength(0);
  });
});
