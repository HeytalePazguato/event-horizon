/**
 * Code-comment rationale extractor.
 *
 * Walks comment AST nodes and emits:
 * - rationale nodes + rationale_for edges for WHY / TODO / FIXME annotations
 * - docstring enrichment data for JSDoc/TSDoc blocks that immediately precede
 *   a function or class declaration (no separate node is emitted for these)
 *
 * Reuses the cached web-tree-sitter parser singleton from treeSitterExtractor.ts
 * so WASM is only loaded once per language per session.
 */

import type { Node as TSNode } from 'web-tree-sitter';
import type { GraphEdge, GraphNode } from './index.js';
import { detectLanguage, treeSitterExtractor } from './treeSitterExtractor.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DocstringInfo {
  targetNodeId: string;
  description: string;
  tags: Record<string, string[]>;
}

export interface RationaleExtractResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  docstrings: DocstringInfo[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DECLARATION_NODE_TYPES = new Set([
  'function_declaration',
  'function_expression',
  'method_definition',
  'arrow_function',
  'class_declaration',
  'class_expression',
  'interface_declaration',
  'lexical_declaration',
  'variable_declaration',
]);

const JSDOC_TAG_NAMES = new Set(['param', 'returns', 'return', 'throws', 'throw', 'deprecated', 'example']);

// Inline comment patterns (// ...)
const WHY_INLINE = /^\/\/+\s*WHY:\s*([\s\S]+)/;
const TODO_INLINE = /^\/\/+\s*TODO\s*(?:\([^)]*\)|\[[^\]]*\])?\s*:?\s*([\s\S]+)/i;
const FIXME_INLINE = /^\/\/+\s*FIXME\s*:?\s*([\s\S]+)/i;

// Block comment patterns (/* ... */ and /** ... */)
const WHY_BLOCK = /^\/\*+\s*WHY:\s*([\s\S]*?)\s*\*+\//;
const TODO_BLOCK = /^\/\*+\s*TODO\s*(?:\([^)]*\)|\[[^\]]*\])?\s*:?\s*([\s\S]*?)\s*\*+\//i;
const FIXME_BLOCK = /^\/\*+\s*FIXME\s*:?\s*([\s\S]*?)\s*\*+\//i;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isJSDoc(text: string): boolean {
  return text.startsWith('/**') && !text.startsWith('/***');
}

function parseSourceLocationLine(loc: string | undefined): number | null {
  if (!loc) return null;
  const n = parseInt(loc.split('-')[0], 10);
  return isNaN(n) ? null : n;
}

/**
 * Collect all comment nodes from the AST via depth-first traversal.
 */
function collectCommentNodes(node: TSNode, out: TSNode[]): void {
  if (node.type === 'comment') {
    out.push(node);
    return;
  }
  for (const child of node.namedChildren) {
    if (child) collectCommentNodes(child, out);
  }
}

/**
 * Return the next named sibling that is a declaration-level node, skipping
 * other comments. Also unwraps export_statement wrappers.
 */
function findNextDeclarationSibling(commentNode: TSNode): TSNode | null {
  let sibling = commentNode.nextNamedSibling;
  while (sibling) {
    if (sibling.type === 'comment') {
      sibling = sibling.nextNamedSibling;
      continue;
    }
    if (DECLARATION_NODE_TYPES.has(sibling.type)) return sibling;
    if (sibling.type === 'export_statement') {
      const inner = sibling.firstNamedChild;
      if (inner && DECLARATION_NODE_TYPES.has(inner.type)) return inner;
    }
    break;
  }
  return null;
}

/**
 * Find the graph node that corresponds to a declaration AST node, matching
 * by start-line proximity (within 2 lines to handle export wrappers).
 */
function findNodeForDecl(decl: TSNode, codeNodes: GraphNode[]): GraphNode | null {
  const declLine = decl.startPosition.row + 1;
  let best: GraphNode | null = null;
  let bestDist = 3; // max 2 lines tolerance
  for (const n of codeNodes) {
    if (n.type === 'rationale' || n.type === 'knowledge' || n.type === 'doc_section') continue;
    const loc = parseSourceLocationLine(n.sourceLocation);
    if (loc === null) continue;
    const dist = Math.abs(loc - declLine);
    if (dist < bestDist) {
      bestDist = dist;
      best = n;
    }
  }
  return best;
}

/**
 * Find the nearest code node to associate a rationale comment with.
 *
 * Strategy (in priority order):
 *   1. Closest node that starts just *after* the comment (within 5 lines) —
 *      the typical "comment precedes the thing it explains" pattern.
 *   2. Closest node that started *before* the comment (within 100 lines) —
 *      the comment is inside a function body.
 *   3. Closest node below (within 100 lines) if no node above qualifies.
 */
function findNearestCodeNode(commentLine: number, codeNodes: GraphNode[]): GraphNode | null {
  let belowNode: GraphNode | null = null;
  let belowDist = Infinity;
  let aboveNode: GraphNode | null = null;
  let aboveDist = Infinity;

  for (const n of codeNodes) {
    if (n.type === 'rationale' || n.type === 'knowledge' || n.type === 'doc_section') continue;
    const loc = parseSourceLocationLine(n.sourceLocation);
    if (loc === null) continue;
    if (loc > commentLine) {
      const d = loc - commentLine;
      if (d < belowDist) { belowDist = d; belowNode = n; }
    } else {
      const d = commentLine - loc;
      if (d < aboveDist) { aboveDist = d; aboveNode = n; }
    }
  }

  if (belowNode && belowDist <= 5) return belowNode;
  if (aboveNode && aboveDist <= 100) return aboveNode;
  if (belowNode && belowDist <= 100) return belowNode;
  return null;
}

// ---------------------------------------------------------------------------
// JSDoc parser
// ---------------------------------------------------------------------------

function parseJSDoc(raw: string): { description: string; tags: Record<string, string[]> } {
  // Strip /** ... */ wrapper and leading * per line
  const cleaned = raw
    .replace(/^\/\*+/, '')
    .replace(/\*+\/$/, '')
    .split('\n')
    .map(line => line.replace(/^\s*\*\s?/, ''))
    .join('\n')
    .trim();

  const descLines: string[] = [];
  const tags: Record<string, string[]> = {};
  let lastTag: string | null = null;

  for (const line of cleaned.split('\n')) {
    const tagMatch = line.match(/^\s*@(\w+)\s*(.*)/);
    if (tagMatch) {
      const name = tagMatch[1];
      if (JSDOC_TAG_NAMES.has(name)) {
        if (!tags[name]) tags[name] = [];
        tags[name].push(tagMatch[2].trim());
        lastTag = name;
      } else {
        lastTag = null;
      }
    } else if (lastTag) {
      // continuation line for the previous tag
      tags[lastTag][tags[lastTag].length - 1] += ' ' + line.trim();
    } else {
      descLines.push(line);
    }
  }

  return { description: descLines.join('\n').trim(), tags };
}

// ---------------------------------------------------------------------------
// Pattern matching
// ---------------------------------------------------------------------------

type CommentKind = 'why' | 'todo' | 'fixme';

function matchRationalePattern(raw: string): { kind: CommentKind; text: string } | null {
  let m: RegExpMatchArray | null;

  m = raw.match(WHY_INLINE) ?? raw.match(WHY_BLOCK);
  if (m) return { kind: 'why', text: m[1].trim() };

  m = raw.match(TODO_INLINE) ?? raw.match(TODO_BLOCK);
  if (m) return { kind: 'todo', text: m[1].trim() };

  m = raw.match(FIXME_INLINE) ?? raw.match(FIXME_BLOCK);
  if (m) return { kind: 'fixme', text: m[1].trim() };

  return null;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function extractRationale(
  filePath: string,
  source: string,
  codeNodes: GraphNode[],
): Promise<RationaleExtractResult> {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const docstrings: DocstringInfo[] = [];

  const langKey = detectLanguage(filePath);
  if (!langKey) return { nodes, edges, docstrings };

  let parser;
  try {
    parser = await treeSitterExtractor.getParser(langKey);
  } catch {
    return { nodes, edges, docstrings };
  }

  const tree = parser.parse(source);
  if (!tree) return { nodes, edges, docstrings };

  try {
    const relPath = filePath.replace(/\\/g, '/');
    const now = Date.now();
    const commentNodes: TSNode[] = [];
    collectCommentNodes(tree.rootNode, commentNodes);

    for (const commentNode of commentNodes) {
      const raw = commentNode.text;
      const startLine = commentNode.startPosition.row + 1;
      const endLine = commentNode.endPosition.row + 1;

      if (isJSDoc(raw)) {
        const nextDecl = findNextDeclarationSibling(commentNode);
        if (nextDecl) {
          const targetNode = findNodeForDecl(nextDecl, codeNodes);
          if (targetNode) {
            const { description, tags } = parseJSDoc(raw);
            docstrings.push({ targetNodeId: targetNode.id, description, tags });
          }
        }
        // JSDoc does not emit a rationale node
        continue;
      }

      const matched = matchRationalePattern(raw);
      if (!matched) continue;

      const { kind, text } = matched;
      const confidence = kind === 'why' ? 0.8 : 0.7;
      const nodeId = `rationale:${relPath}:${startLine}:${kind}`;

      const rationaleNode: GraphNode = {
        id: nodeId,
        label: text.slice(0, 50),
        type: 'rationale',
        sourceFile: filePath,
        sourceLocation: `${startLine}-${endLine}`,
        properties: { kind, text },
        tag: 'INFERRED',
        confidence,
        createdAt: now,
        updatedAt: now,
      };
      nodes.push(rationaleNode);

      const target = findNearestCodeNode(startLine, codeNodes);
      if (target) {
        edges.push({
          id: `rationale_for:${nodeId}:${target.id}`,
          sourceId: nodeId,
          targetId: target.id,
          relationType: 'rationale_for',
          tag: 'INFERRED',
          confidence,
          sourceFile: filePath,
          sourceLocation: `${startLine}-${endLine}`,
          createdAt: now,
        });
      }
    }
  } finally {
    tree.delete();
  }

  return { nodes, edges, docstrings };
}
