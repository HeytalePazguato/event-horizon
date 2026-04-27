import * as crypto from 'crypto';
import * as path from 'path';
import type { GraphNode, GraphEdge } from './index.js';

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.mts', '.cts',
  '.js', '.jsx', '.mjs', '.cjs',
]);

export function extractMarkdown(
  filePath: string,
  source: string,
  resolveByLabel: (label: string) => GraphNode | null,
  repoRoot: string,
): { nodes: GraphNode[]; edges: GraphEdge[]; contentHash: string } {
  const now = Date.now();
  const contentHash = crypto.createHash('sha256').update(source).digest('hex');
  const relPath = path.relative(repoRoot, filePath).replace(/\\/g, '/');
  const fileDir = path.dirname(filePath);

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const emittedEdgeIds = new Set<string>();

  const moduleId = `module:${filePath}`;
  nodes.push({
    id: moduleId,
    label: path.basename(filePath),
    type: 'module',
    sourceFile: filePath,
    properties: { kind: 'markdown' },
    tag: 'EXTRACTED',
    confidence: 1.0,
    createdAt: now,
    updatedAt: now,
  });

  // headingStack[level] = most recent section node at that level (1-6)
  const headingStack: Array<GraphNode | null> = new Array(7).fill(null);
  let currentSection: GraphNode | null = null;

  // Track slugs to de-duplicate within the file
  const slugCounts = new Map<string, number>();

  function emitEdge(sourceId: string, targetId: string, confidence: number): void {
    const edgeId = `${sourceId}->${targetId}:references`;
    if (emittedEdgeIds.has(edgeId)) return;
    emittedEdgeIds.add(edgeId);
    edges.push({
      id: edgeId,
      sourceId,
      targetId,
      relationType: 'references',
      tag: 'INFERRED',
      confidence,
      sourceFile: filePath,
      createdAt: now,
    });
  }

  const lines = source.split('\n');

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();
      const baseSlug = toSlug(text);

      const count = (slugCounts.get(baseSlug) ?? 0) + 1;
      slugCounts.set(baseSlug, count);
      const slug = count === 1 ? baseSlug : `${baseSlug}-${count - 1}`;

      const sectionId = `doc:${relPath}:${slug}`;
      const sectionNode: GraphNode = {
        id: sectionId,
        label: text,
        type: 'doc_section',
        sourceFile: filePath,
        properties: { level, slug },
        tag: 'INFERRED',
        confidence: 0.9,
        createdAt: now,
        updatedAt: now,
      };
      nodes.push(sectionNode);

      // Parent edge to nearest ancestor heading
      if (level > 1) {
        const parentNode = headingStack[level - 1];
        if (parentNode) {
          emitEdge(sectionId, parentNode.id, 0.9);
        }
      }

      headingStack[level] = sectionNode;
      // Clear deeper levels
      for (let l = level + 1; l <= 6; l++) headingStack[l] = null;
      currentSection = sectionNode;
      continue;
    }

    const contextId = currentSection ? currentSection.id : moduleId;

    // Inline backtick identifiers
    const backtickRe = /`([A-Za-z_$][A-Za-z0-9_$]*)`/g;
    let m: RegExpExecArray | null;
    while ((m = backtickRe.exec(line)) !== null) {
      const resolved = resolveByLabel(m[1]);
      if (resolved) emitEdge(contextId, resolved.id, 0.7);
    }

    // Markdown links to source files
    const linkRe = /\[.*?\]\(([^)]+)\)/g;
    while ((m = linkRe.exec(line)) !== null) {
      const href = m[1].split('#')[0].trim();
      if (!href) continue;

      const absTarget = path.isAbsolute(href)
        ? href
        : path.resolve(fileDir, href);

      const ext = path.extname(absTarget);
      if (!SOURCE_EXTENSIONS.has(ext)) continue;

      // Must not escape repoRoot
      const rel = path.relative(repoRoot, absTarget);
      if (rel.startsWith('..')) continue;

      emitEdge(contextId, `module:${absTarget}`, 0.7);
    }
  }

  return { nodes, edges, contentHash };
}

function toSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
