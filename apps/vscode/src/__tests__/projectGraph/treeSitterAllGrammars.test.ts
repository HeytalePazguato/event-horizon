/**
 * Regression test: every shipped tree-sitter grammar must be loadable via
 * the production extractor and produce a real function/class node from a
 * minimal sample.
 *
 * This is the test that should have existed before v3.0.0 shipped. The
 * v3.0.0 release used `Language.load(<path string>)`, which routes through
 * Emscripten's virtual filesystem — not initialised in the VS Code
 * extension host. Every grammar load threw "Filename arg requires
 * Emscripten FS", every TS/JS/PHP/Python/C# file silently failed
 * extraction, and the only thing left in the graph was markdown
 * (because the markdown extractor is pure JS with no WASM dependency).
 *
 * The fix in 3.0.1 reads each grammar's WASM bytes via fs.readFile and
 * passes the Buffer to `Language.load`. Buffers don't touch Emscripten
 * FS and work in both plain Node and the extension host runtime.
 *
 * The test below runs the production code path end-to-end. If anyone
 * reverts to path-based loading, every assertion below fails — we never
 * ship a "graph only contains docs" release again.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { TreeSitterExtractor } from '../../projectGraph/treeSitterExtractor.js';

interface GrammarCase {
  language: string;
  fileName: string;
  source: string;
  expectedLabel: string;
  // 'function' for methods/funcs, 'class' for class declarations.
  expectedType: 'function' | 'class';
}

const CASES: GrammarCase[] = [
  {
    language: 'TypeScript',
    fileName: '/tmp/sample.ts',
    source: 'function processOrder(order: Order): void {\n  console.log(order);\n}\n',
    expectedLabel: 'processOrder',
    expectedType: 'function',
  },
  {
    language: 'TSX',
    fileName: '/tmp/sample.tsx',
    source: 'function MyComponent(): JSX.Element {\n  return <div />;\n}\n',
    expectedLabel: 'MyComponent',
    expectedType: 'function',
  },
  {
    language: 'JavaScript',
    fileName: '/tmp/sample.js',
    source: 'function helloWorld() {\n  console.log("hi");\n}\n',
    expectedLabel: 'helloWorld',
    expectedType: 'function',
  },
  {
    language: 'PHP',
    fileName: '/tmp/sample.php',
    source: '<?php\nclass Order {\n  public function calculateTotal(): float {\n    return 0.0;\n  }\n}\n',
    expectedLabel: 'calculateTotal',
    expectedType: 'function',
  },
  {
    language: 'Python',
    fileName: '/tmp/sample.py',
    source: 'def fetch_data(url):\n    return url\n',
    expectedLabel: 'fetch_data',
    expectedType: 'function',
  },
  {
    language: 'C#',
    fileName: '/tmp/sample.cs',
    source: 'class Repo {\n  public Order GetOrder(int id) {\n    return null;\n  }\n}\n',
    expectedLabel: 'GetOrder',
    expectedType: 'function',
  },
];

describe('Tree-sitter — all shipped grammars load via the production buffer path', () => {
  let extractor: TreeSitterExtractor;

  beforeAll(async () => {
    extractor = new TreeSitterExtractor();
    // Force one warm-up extract so Parser.init runs once before the
    // per-grammar assertions below. Not strictly necessary (the
    // extractor inits lazily) but makes the failure mode for a broken
    // Parser.init clearer.
    await extractor.extract('/tmp/warmup.ts', 'function _w() {}\n');
  }, 30_000);

  it('all 6 grammar WASMs exist in out/ (build-step prerequisite)', () => {
    const outDir = path.join(__dirname, '../../../out');
    const required = [
      'tree-sitter-typescript.wasm',
      'tree-sitter-tsx.wasm',
      'tree-sitter-javascript.wasm',
      'tree-sitter-php.wasm',
      'tree-sitter-python.wasm',
      'tree-sitter-c-sharp.wasm',
    ];
    const missing = required.filter((f) => !fs.existsSync(path.join(outDir, f)));
    expect(missing).toEqual([]);
  });

  for (const c of CASES) {
    it(`${c.language}: extractor produces a "${c.expectedLabel}" ${c.expectedType} node from a minimal sample`, async () => {
      const result = await extractor.extract(c.fileName, c.source);
      expect(result.skipped, `${c.language} extraction was skipped`).toBeFalsy();
      // The extractor always emits the module node; we want the *real*
      // function or class node that proves the grammar parsed.
      const realNode = result.nodes.find(
        (n) => n.type === c.expectedType && n.label === c.expectedLabel,
      );
      expect(
        realNode,
        `${c.language}: expected a ${c.expectedType} node labelled "${c.expectedLabel}" — found ${result.nodes.length} nodes total: ${result.nodes.map((n) => `${n.type}:${n.label}`).join(', ')}`,
      ).toBeDefined();
    });
  }
});
