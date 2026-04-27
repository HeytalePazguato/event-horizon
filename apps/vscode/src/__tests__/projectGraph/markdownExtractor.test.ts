/**
 * Markdown and comment extractor unit tests — 7 cases covering markdown
 * parsing (headings, links, backtick references) and code-comment rationale
 * extraction (WHY/TODO/FIXME + JSDoc/TSDoc enrichment).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { extractMarkdown } from '../../projectGraph/markdownExtractor.js';
import { extractRationale } from '../../projectGraph/commentExtractor.js';
import { TreeSitterExtractor } from '../../projectGraph/treeSitterExtractor.js';
import type { GraphNode } from '../../projectGraph/index.js';

const REPO_ROOT = '/workspace';

describe('extractMarkdown', () => {
  // 1. Empty markdown source ─────────────────────────────────────────────────
  it('empty markdown: 1 module node, 0 doc_section nodes', () => {
    const result = extractMarkdown(
      `${REPO_ROOT}/README.md`,
      '',
      () => null,
      REPO_ROOT,
    );

    const modules = result.nodes.filter(n => n.type === 'module');
    const sections = result.nodes.filter(n => n.type === 'doc_section');

    expect(modules).toHaveLength(1);
    expect(sections).toHaveLength(0);
    expect(modules[0].properties.kind).toBe('markdown');
  });

  // 2. Two headings with parent edge ────────────────────────────────────────
  it('two headings: 2 doc_section nodes + parent reference edge from B to A', () => {
    const source = '# A\n## B';
    const result = extractMarkdown(
      `${REPO_ROOT}/README.md`,
      source,
      () => null,
      REPO_ROOT,
    );

    const sections = result.nodes.filter(n => n.type === 'doc_section');
    expect(sections).toHaveLength(2);

    const sectionA = sections.find(n => n.label === 'A');
    const sectionB = sections.find(n => n.label === 'B');
    expect(sectionA).toBeDefined();
    expect(sectionB).toBeDefined();

    // Section B should have a parent edge to A
    const parentEdges = result.edges.filter(
      e => e.sourceId === sectionB!.id && e.targetId === sectionA!.id,
    );
    expect(parentEdges).toHaveLength(1);
    expect(parentEdges[0].relationType).toBe('references');
  });

  // 3. Backtick label resolves ──────────────────────────────────────────────
  it('backtick label: references edge to resolved function node', () => {
    const source = 'Some docs for `validateToken`.';
    const mockFunctionNode: GraphNode = {
      id: 'func:validateToken',
      label: 'validateToken',
      type: 'function',
      properties: {},
      tag: 'EXTRACTED',
      confidence: 1.0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const result = extractMarkdown(
      `${REPO_ROOT}/README.md`,
      source,
      (label) => (label === 'validateToken' ? mockFunctionNode : null),
      REPO_ROOT,
    );

    const moduleNode = result.nodes.find(n => n.type === 'module');
    expect(moduleNode).toBeDefined();

    const refEdges = result.edges.filter(
      e => e.targetId === 'func:validateToken',
    );
    expect(refEdges).toHaveLength(1);
    expect(refEdges[0].relationType).toBe('references');
    expect(refEdges[0].confidence).toBe(0.7);
  });

  // 4. Markdown link to source file ──────────────────────────────────────────
  it('markdown link to source file: references edge with absolute path module id', () => {
    const source = 'See [auth module](src/auth.ts).';
    const result = extractMarkdown(
      `${REPO_ROOT}/docs/guide.md`,
      source,
      () => null,
      REPO_ROOT,
    );

    const moduleNode = result.nodes.find(n => n.type === 'module');
    expect(moduleNode).toBeDefined();

    // The link resolver should create an absolute path module ID
    const linkEdges = result.edges.filter(
      e => e.targetId.startsWith('module:'),
    );
    expect(linkEdges.length).toBeGreaterThan(0);

    // The target should be the absolute path to src/auth.ts
    const targetModuleId = linkEdges[0].targetId;
    expect(targetModuleId).toContain('auth.ts');
  });
});

describe('extractRationale', () => {
  let treeSitterEx: TreeSitterExtractor;

  // Load tree-sitter parser once for suite
  beforeAll(async () => {
    treeSitterEx = new TreeSitterExtractor();
    await treeSitterEx.extract('/test.ts', 'function _warmup() {}');
  }, 30_000);

  // 5. WHY comment ──────────────────────────────────────────────────────────
  it('WHY comment: 1 rationale node + rationale_for edge to function', async () => {
    const source = `// WHY: caching avoids 200ms RTT
function fetch() { return data; }`;

    // First extract code nodes
    const codeResult = await treeSitterEx.extract('/test.ts', source);

    // Then extract rationale
    const result = await extractRationale('/test.ts', source, codeResult.nodes);

    const rationaleNodes = result.nodes.filter(n => n.type === 'rationale');
    expect(rationaleNodes).toHaveLength(1);
    expect(rationaleNodes[0].properties.kind).toBe('why');
    expect(rationaleNodes[0].properties.text).toContain('caching avoids 200ms RTT');

    // Should have a rationale_for edge
    const rationaleEdges = result.edges.filter(
      e => e.relationType === 'rationale_for',
    );
    expect(rationaleEdges).toHaveLength(1);
    expect(rationaleEdges[0].sourceId).toBe(rationaleNodes[0].id);
    expect(rationaleEdges[0].tag).toBe('INFERRED');
  });

  // 6. JSDoc on function ────────────────────────────────────────────────────
  it('JSDoc on function: NO rationale node, but docstring entry with tags', async () => {
    const source = `/** Adds two numbers.
 * @param a First number.
 * @returns The sum.
 */
function add(a: number, b: number) { return a + b; }`;

    // First extract code nodes
    const codeResult = await treeSitterEx.extract('/test.ts', source);

    // Then extract rationale
    const result = await extractRationale('/test.ts', source, codeResult.nodes);

    // Should NOT emit a rationale node for JSDoc
    const rationaleNodes = result.nodes.filter(n => n.type === 'rationale');
    expect(rationaleNodes).toHaveLength(0);

    // But should have docstring enrichment
    expect(result.docstrings.length).toBeGreaterThan(0);
    const docstring = result.docstrings[0];
    expect(docstring.description).toContain('Adds two numbers');
    expect(docstring.tags.param).toBeDefined();
    expect(docstring.tags.returns).toBeDefined();
    expect(docstring.tags.param![0]).toContain('First number');
  });

  // 7. TODO comment ─────────────────────────────────────────────────────────
  it('TODO comment: 1 rationale node with kind=todo + rationale_for edge', async () => {
    const source = `// TODO: refactor legacy code
function old() { return 42; }`;

    // First extract code nodes
    const codeResult = await treeSitterEx.extract('/test.ts', source);

    // Then extract rationale
    const result = await extractRationale('/test.ts', source, codeResult.nodes);

    const rationaleNodes = result.nodes.filter(n => n.type === 'rationale');
    expect(rationaleNodes).toHaveLength(1);
    expect(rationaleNodes[0].properties.kind).toBe('todo');
    expect(rationaleNodes[0].properties.text).toContain('refactor legacy code');

    // Should have rationale_for edge
    const rationaleEdges = result.edges.filter(
      e => e.relationType === 'rationale_for',
    );
    expect(rationaleEdges).toHaveLength(1);
  });
});
