/**
 * Context curator — assembles a token-budgeted subgraph relevant to a task.
 *
 * Given a free-text task description (and optional anchor files), the curator:
 *   1. extracts identifier-like candidates (camel/Pascal/snake/`backticks`)
 *   2. resolves them to seed graph nodes via the query engine
 *   3. expands BFS up to depth 2 along structural relations
 *   4. overlays recent agent activity touching seed files
 *   5. overlays related knowledge entries
 *   6. greedily packs the highest-scoring nodes under a token budget
 *
 * The output subgraph is a hint set for downstream planners — not exhaustive,
 * not authoritative. Only edges with both endpoints inside the included set
 * are returned.
 */

import type { GraphEdge, GraphNode, RelationType } from './index.js';
import type { GraphQueryEngine } from './queryEngine.js';

const EXPANSION_RELATIONS: RelationType[] = [
  'calls',
  'imports',
  'extends',
  'implements',
  'references',
];

const BFS_MAX_DEPTH = 2;
const NEIGHBOR_FETCH_LIMIT = 1000;
const ACTIVITY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const EDGE_TOKEN_COST = 4;
const SUGGESTED_READS_LIMIT = 10;

export interface CurateInput {
  taskDescription: string;
  tokenBudget: number;
  seedFiles?: string[];
  includeActivity?: boolean;
  includeKnowledge?: boolean;
}

export interface CurateCoverage {
  codeNodes: number;
  conceptNodes: number;
  activityNodes: number;
  knowledgeNodes: number;
}

export interface CurateResult {
  subgraph: { nodes: GraphNode[]; edges: GraphEdge[] };
  estimatedTokens: number;
  coverage: CurateCoverage;
  suggestedReads: string[];
}

export class ContextCurator {
  private engine: GraphQueryEngine;

  constructor(engine: GraphQueryEngine) {
    this.engine = engine;
  }

  curate(input: CurateInput): CurateResult {
    const includeActivity = input.includeActivity !== false;
    const includeKnowledge = input.includeKnowledge !== false;

    const tokens = this.extractCandidateTokens(input.taskDescription);

    const seedNodes: GraphNode[] = [];
    const seedIds = new Set<string>();
    const addSeed = (node: GraphNode): void => {
      if (seedIds.has(node.id)) return;
      seedIds.add(node.id);
      seedNodes.push(node);
    };

    for (const token of tokens) {
      const results = this.engine.search(token, { tag: 'EXTRACTED', limit: 5 });
      for (const node of results) addSeed(node);
    }

    if (input.seedFiles) {
      for (const file of input.seedFiles) {
        const results = this.engine.search(file, { type: 'module', limit: 1 });
        if (results.length > 0) addSeed(results[0]);
      }
    }

    const scores = new Map<string, number>();
    const allNodes = new Map<string, GraphNode>();
    const allEdges = new Map<string, GraphEdge>();

    for (const seed of seedNodes) {
      scores.set(seed.id, (scores.get(seed.id) ?? 0) + 1.0);
      allNodes.set(seed.id, seed);
    }

    for (const seed of seedNodes) {
      this.expandFromSeed(seed, scores, allNodes, allEdges);
    }

    if (includeActivity) {
      const since = Date.now() - ACTIVITY_WINDOW_MS;
      const seedFilePaths = new Set<string>();
      for (const seed of seedNodes) {
        if (seed.sourceFile) seedFilePaths.add(seed.sourceFile);
      }
      for (const filePath of seedFilePaths) {
        const result = this.engine.recentActivity(filePath, since);
        for (const activity of result.activities) {
          if (!allNodes.has(activity.id)) allNodes.set(activity.id, activity);
          scores.set(activity.id, (scores.get(activity.id) ?? 0) + 0.4);
        }
      }
    }

    if (includeKnowledge) {
      for (const token of tokens) {
        const results = this.engine.search(token, { type: 'knowledge', limit: 5 });
        for (const node of results) {
          if (!allNodes.has(node.id)) allNodes.set(node.id, node);
          scores.set(node.id, (scores.get(node.id) ?? 0) + 0.4);
        }
      }
    }

    const includedIds = new Set<string>();
    let estimatedTokens = 0;

    for (const seedId of seedIds) {
      const node = allNodes.get(seedId);
      if (!node) continue;
      includedIds.add(seedId);
      estimatedTokens += this.nodeTokenCost(node);
    }

    const sortedIds = Array.from(allNodes.keys()).sort(
      (a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0),
    );

    for (const id of sortedIds) {
      if (includedIds.has(id)) continue;
      const node = allNodes.get(id);
      if (!node) continue;
      const cost = this.nodeTokenCost(node);
      if (estimatedTokens + cost > input.tokenBudget) continue;
      includedIds.add(id);
      estimatedTokens += cost;
    }

    const includedEdges: GraphEdge[] = [];
    for (const edge of allEdges.values()) {
      if (includedIds.has(edge.sourceId) && includedIds.has(edge.targetId)) {
        includedEdges.push(edge);
        estimatedTokens += EDGE_TOKEN_COST;
      }
    }

    const includedNodes: GraphNode[] = [];
    for (const id of includedIds) {
      const node = allNodes.get(id);
      if (node) includedNodes.push(node);
    }

    const coverage: CurateCoverage = {
      codeNodes: 0,
      conceptNodes: 0,
      activityNodes: 0,
      knowledgeNodes: 0,
    };
    for (const node of includedNodes) {
      switch (node.type) {
        case 'function':
        case 'class':
        case 'module':
        case 'interface':
          coverage.codeNodes++;
          break;
        case 'concept':
        case 'doc_section':
        case 'rationale':
          coverage.conceptNodes++;
          break;
        case 'agent_activity':
          coverage.activityNodes++;
          break;
        case 'knowledge':
          coverage.knowledgeNodes++;
          break;
      }
    }

    const fileScores = new Map<string, number>();
    for (const node of includedNodes) {
      if (!node.sourceFile) continue;
      const score = scores.get(node.id) ?? 0;
      fileScores.set(node.sourceFile, (fileScores.get(node.sourceFile) ?? 0) + score);
    }
    const suggestedReads = Array.from(fileScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, SUGGESTED_READS_LIMIT)
      .map(([file]) => file);

    return {
      subgraph: { nodes: includedNodes, edges: includedEdges },
      estimatedTokens,
      coverage,
      suggestedReads,
    };
  }

  private expandFromSeed(
    seed: GraphNode,
    scores: Map<string, number>,
    allNodes: Map<string, GraphNode>,
    allEdges: Map<string, GraphEdge>,
  ): void {
    const visited = new Set<string>([seed.id]);
    let frontier: Array<{ id: string; depth: number }> = [{ id: seed.id, depth: 0 }];

    while (frontier.length > 0) {
      const next: Array<{ id: string; depth: number }> = [];
      for (const { id, depth } of frontier) {
        if (depth >= BFS_MAX_DEPTH) continue;

        const neighbors = this.engine.neighbors(id, {
          relationTypes: EXPANSION_RELATIONS,
          direction: 'both',
          limit: NEIGHBOR_FETCH_LIMIT,
        });

        for (const { node, edge } of neighbors) {
          allEdges.set(edge.id, edge);
          if (visited.has(node.id)) continue;
          visited.add(node.id);

          const newDepth = depth + 1;
          const baseScore = newDepth === 1 ? 0.5 : 0.33;
          const confidence = typeof node.confidence === 'number' ? node.confidence : 1;
          const delta = baseScore * confidence;
          scores.set(node.id, (scores.get(node.id) ?? 0) + delta);
          allNodes.set(node.id, node);

          next.push({ id: node.id, depth: newDepth });
        }
      }
      frontier = next;
    }
  }

  private nodeTokenCost(node: GraphNode): number {
    const propsJson = JSON.stringify(node.properties ?? {});
    return Math.ceil((node.label.length + propsJson.length) / 4);
  }

  private extractCandidateTokens(text: string): string[] {
    const tokens = new Set<string>();

    const camelOrPascal = /\b[a-z]+(?:[A-Z][a-z]+)+\b|\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g;
    const snakeCase = /\b[a-z]+_[a-z_]+\b/g;
    const backticked = /`([^`]+)`/g;

    for (const m of text.matchAll(camelOrPascal)) tokens.add(m[0]);
    for (const m of text.matchAll(snakeCase)) tokens.add(m[0]);
    for (const m of text.matchAll(backticked)) {
      const inner = m[1].trim();
      if (inner.length > 0) tokens.add(inner);
    }

    return Array.from(tokens);
  }
}
