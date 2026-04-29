/**
 * PHP extractor tests — uses the real tree-sitter-php WASM grammar via the
 * `TreeSitterExtractor`'s public surface, so we exercise the same path the
 * scanner does in production.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { TreeSitterExtractor } from '../../projectGraph/treeSitterExtractor.js';

const FILE = '/workspace/test.php';

describe('PHP extractor', () => {
  let ex: TreeSitterExtractor;

  beforeAll(async () => {
    ex = new TreeSitterExtractor();
    // Warm up so individual tests don't pay the WASM init cost.
    await ex.extract(FILE, '<?php function _warmup() {}');
  }, 30_000);

  it('top-level function: 1 module + 1 function node, no calls', async () => {
    const { nodes, edges, skipped } = await ex.extract(FILE, '<?php function foo() {}');
    expect(skipped).toBeUndefined();

    const modules = nodes.filter((n) => n.type === 'module');
    const functions = nodes.filter((n) => n.type === 'function');
    expect(modules).toHaveLength(1);
    expect(functions).toHaveLength(1);
    expect(functions[0].label).toBe('foo');
    expect(edges.filter((e) => e.relationType === 'calls')).toHaveLength(0);
  });

  it('trait + method + member call: trait kind=trait, method node, calls edge', async () => {
    const source = `<?php
      trait InsurancesQuote {
        private function getQuoteAna($x) {
          $this->bar();
        }
      }`;
    const { nodes, edges } = await ex.extract(FILE, source);

    const traitNodes = nodes.filter(
      (n) => n.type === 'class' && (n.properties as Record<string, unknown>)?.kind === 'trait',
    );
    expect(traitNodes).toHaveLength(1);
    expect(traitNodes[0].label).toBe('InsurancesQuote');

    const methodNodes = nodes.filter((n) => n.type === 'function' && n.label === 'getQuoteAna');
    expect(methodNodes).toHaveLength(1);
    const props = methodNodes[0].properties as Record<string, unknown>;
    expect(props.kind).toBe('method_declaration');
    expect(props.parentLabel).toBe('InsurancesQuote');
    expect(props.params).toEqual(['$x']);

    const callsToBar = edges.filter((e) => e.relationType === 'calls' && e.targetId === 'php:func_ref:bar');
    expect(callsToBar).toHaveLength(1);
  });

  it('static call (Foo::bar) and namespaced call (\\Pkg\\baz()) both produce calls edges', async () => {
    const source = `<?php
      function caller() {
        Log::info('hi');
        \\App\\helper();
      }`;
    const { edges } = await ex.extract(FILE, source);
    const callees = edges
      .filter((e) => e.relationType === 'calls')
      .map((e) => e.targetId);
    expect(callees).toContain('php:func_ref:info');
    expect(callees).toContain('php:func_ref:helper');
  });

  it('class extends + implements: 1 extends edge, 1 implements edge', async () => {
    const source = `<?php class OrderService extends BaseService implements Storable, Auditable {}`;
    const { nodes, edges } = await ex.extract(FILE, source);

    expect(nodes.filter((n) => n.type === 'class' && n.label === 'OrderService')).toHaveLength(1);
    expect(edges.filter((e) => e.relationType === 'extends')).toHaveLength(1);
    expect(edges.filter((e) => e.relationType === 'implements')).toHaveLength(2);
  });

  it('namespace use produces an imports edge per used symbol', async () => {
    const source = `<?php
      use App\\Models\\Order;
      use App\\Services\\OrderService;
      class Foo {}`;
    const { edges } = await ex.extract(FILE, source);

    const importEdges = edges.filter((e) => e.relationType === 'imports');
    expect(importEdges.length).toBeGreaterThanOrEqual(2);
    const targets = importEdges.map((e) => e.targetId);
    expect(targets.some((t) => t.includes('Order'))).toBe(true);
    expect(targets.some((t) => t.includes('OrderService'))).toBe(true);
  });

  it('PHPDoc preceding a method attaches as docstring', async () => {
    const source = `<?php
      class Svc {
        /**
         * Return the customer's quote payload.
         */
        public function getQuote() { return null; }
      }`;
    const { nodes } = await ex.extract(FILE, source);
    const method = nodes.find((n) => n.type === 'function' && n.label === 'getQuote');
    expect(method).toBeDefined();
    const docstring = (method!.properties as Record<string, unknown>).docstring as string | undefined;
    expect(docstring).toBeDefined();
    expect(docstring).toContain("customer's quote payload");
  });
});
