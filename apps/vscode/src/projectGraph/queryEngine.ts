/**
 * Project Graph query engine — high-level read API over `ProjectGraphStore`.
 *
 * Used by MCP tools (`eh_query_graph`) and the context curator to answer
 * structured questions about the graph: who calls X, what does X call,
 * neighbors with edge metadata, shortest path, free-text search, full
 * incoming/outgoing snapshot for a node, and recent agent activity touching
 * a file.
 *
 * BFS traversals cap visited-set size at MAX_VISITED to keep cycles and
 * pathologically dense graphs from hanging the extension host.
 *
 * Each public method resolves the active store from the lifecycle at call
 * time. When no workspace is open the store is `null` and the method returns
 * an empty/null result instead of throwing.
 */

import type {
  GraphEdge,
  GraphNode,
  GraphNodeType,
  GraphTag,
  RelationType,
} from './index.js';
import type { ProjectGraphStore } from './store.js';

const MAX_VISITED = 10_000;
const DEFAULT_NEIGHBOR_LIMIT = 50;
const DEFAULT_BFS_DEPTH = 2;
const DEFAULT_PATH_MAX_DEPTH = 6;

export type Direction = 'in' | 'out' | 'both';

export interface NeighborsOpts {
  relationTypes?: RelationType[];
  direction?: Direction;
  limit?: number;
}

export interface ShortestPathOpts {
  maxDepth?: number;
  relationTypes?: RelationType[];
}

export interface SearchOpts {
  type?: GraphNodeType;
  tag?: GraphTag;
  limit?: number;
}

export interface NeighborEntry {
  node: GraphNode;
  edge: GraphEdge;
}

export interface ExplainResult {
  node: GraphNode | null;
  in: NeighborEntry[];
  out: NeighborEntry[];
  rationale: GraphNode[];
}

export interface RecentActivityResult {
  agents: string[];
  activities: GraphNode[];
}

export class GraphQueryEngine {
  private storeResolver: () => ProjectGraphStore | null;

  /**
   * @param storeOrResolver Either a concrete `ProjectGraphStore` (for tests
   *   that own a single in-memory DB) or a `() => ProjectGraphStore | null`
   *   resolver (for the extension host, which routes through
   *   `ProjectGraphLifecycle`).
   */
  constructor(storeOrResolver: ProjectGraphStore | (() => ProjectGraphStore | null)) {
    this.storeResolver =
      typeof storeOrResolver === 'function'
        ? storeOrResolver
        : (): ProjectGraphStore | null => storeOrResolver;
  }

  /** Whether a graph store is currently active (workspace folder is open). */
  hasActiveStore(): boolean {
    return this.storeResolver() !== null;
  }

  callers(nodeId: string, depth: number = DEFAULT_BFS_DEPTH): GraphNode[] {
    const store = this.storeResolver();
    if (!store) return [];
    return this.bfsCalls(store, nodeId, depth, 'in');
  }

  callees(nodeId: string, depth: number = DEFAULT_BFS_DEPTH): GraphNode[] {
    const store = this.storeResolver();
    if (!store) return [];
    return this.bfsCalls(store, nodeId, depth, 'out');
  }

  neighbors(nodeId: string, opts: NeighborsOpts = {}): NeighborEntry[] {
    const store = this.storeResolver();
    if (!store) return [];
    const direction: Direction = opts.direction ?? 'both';
    const limit = opts.limit ?? DEFAULT_NEIGHBOR_LIMIT;
    const relationTypes = opts.relationTypes;
    const nodeCache = new Map<string, GraphNode | null>();
    const entries: NeighborEntry[] = [];

    const fetchNode = (id: string): GraphNode | null => {
      if (!nodeCache.has(id)) nodeCache.set(id, store.getNodeById(id));
      return nodeCache.get(id) ?? null;
    };

    const collect = (dir: 'in' | 'out'): boolean => {
      const edges = this.fetchEdges(store, nodeId, dir, relationTypes);
      for (const edge of edges) {
        const otherId = dir === 'in' ? edge.sourceId : edge.targetId;
        const node = fetchNode(otherId);
        if (!node) continue;
        entries.push({ node, edge });
        if (entries.length >= limit) return true;
      }
      return false;
    };

    if (direction === 'in' || direction === 'both') {
      if (collect('in')) return entries;
    }
    if (direction === 'out' || direction === 'both') {
      if (collect('out')) return entries;
    }
    return entries;
  }

  shortestPath(
    sourceId: string,
    targetId: string,
    opts: ShortestPathOpts = {},
  ): GraphNode[] | null {
    const store = this.storeResolver();
    if (!store) return null;
    const maxDepth = opts.maxDepth ?? DEFAULT_PATH_MAX_DEPTH;
    const relationTypes = opts.relationTypes;

    if (sourceId === targetId) {
      const node = store.getNodeById(sourceId);
      return node ? [node] : null;
    }

    const visited = new Set<string>([sourceId]);
    const parent = new Map<string, string>();
    let frontier: string[] = [sourceId];

    for (let level = 0; level < maxDepth; level++) {
      const next: string[] = [];
      for (const id of frontier) {
        if (visited.size >= MAX_VISITED) return null;

        const edges = this.fetchEdges(store, id, 'out', relationTypes);
        for (const edge of edges) {
          const neighborId = edge.targetId;
          if (visited.has(neighborId)) continue;
          visited.add(neighborId);
          parent.set(neighborId, id);

          if (neighborId === targetId) {
            return this.reconstructPath(store, parent, sourceId, targetId);
          }
          next.push(neighborId);
          if (visited.size >= MAX_VISITED) return null;
        }
      }
      frontier = next;
      if (frontier.length === 0) break;
    }
    return null;
  }

  search(query: string, opts: SearchOpts = {}): GraphNode[] {
    const store = this.storeResolver();
    if (!store) return [];
    const results = store.searchNodes(query, {
      type: opts.type,
      tag: opts.tag,
      limit: opts.limit,
    });
    let filtered = results;
    if (opts.type) filtered = filtered.filter((n) => n.type === opts.type);
    if (opts.tag) filtered = filtered.filter((n) => n.tag === opts.tag);
    return filtered;
  }

  explain(nodeId: string): ExplainResult | null {
    const store = this.storeResolver();
    if (!store) return null;
    const node = store.getNodeById(nodeId);
    if (!node) return null;

    const inEdges = store.getEdges({ targetId: nodeId });
    const outEdges = store.getEdges({ sourceId: nodeId });

    const inEntries: NeighborEntry[] = [];
    for (const edge of inEdges) {
      const other = store.getNodeById(edge.sourceId);
      if (other) inEntries.push({ node: other, edge });
    }

    const outEntries: NeighborEntry[] = [];
    for (const edge of outEdges) {
      const other = store.getNodeById(edge.targetId);
      if (other) outEntries.push({ node: other, edge });
    }

    const rationale: GraphNode[] = [];
    const seenRationale = new Set<string>();
    for (const edge of inEdges) {
      if (edge.relationType !== 'rationale_for') continue;
      if (seenRationale.has(edge.sourceId)) continue;
      seenRationale.add(edge.sourceId);
      const r = store.getNodeById(edge.sourceId);
      if (r) rationale.push(r);
    }

    return { node, in: inEntries, out: outEntries, rationale };
  }

  recentActivity(filePath: string, sinceMs: number): RecentActivityResult {
    const store = this.storeResolver();
    if (!store) return { agents: [], activities: [] };
    const moduleNodeId = `module:${filePath}`;
    const touched = store.getEdges({
      targetId: moduleNodeId,
      relationType: 'touched',
    });
    const authored = store.getEdges({
      targetId: moduleNodeId,
      relationType: 'authored',
    });

    const activitiesById = new Map<string, GraphNode>();
    const agents = new Set<string>();

    for (const edge of [...touched, ...authored]) {
      if (activitiesById.has(edge.sourceId)) continue;
      const node = store.getNodeById(edge.sourceId);
      if (!node || node.type !== 'agent_activity') continue;

      const ts =
        typeof node.properties?.['timestamp'] === 'number'
          ? (node.properties['timestamp'] as number)
          : node.createdAt;
      if (ts < sinceMs) continue;

      activitiesById.set(node.id, node);
      const agentId = node.properties?.['agentId'];
      if (typeof agentId === 'string' && agentId.length > 0) {
        agents.add(agentId);
      }
    }

    return {
      agents: Array.from(agents),
      activities: Array.from(activitiesById.values()),
    };
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private bfsCalls(
    store: ProjectGraphStore,
    startId: string,
    depth: number,
    direction: 'in' | 'out',
  ): GraphNode[] {
    if (depth <= 0) return [];

    const visited = new Set<string>([startId]);
    const result: GraphNode[] = [];
    let frontier: string[] = [startId];

    for (let level = 0; level < depth; level++) {
      const next: string[] = [];
      for (const id of frontier) {
        if (visited.size >= MAX_VISITED) return result;

        const edges =
          direction === 'in'
            ? store.getEdges({ targetId: id, relationType: 'calls' })
            : store.getEdges({ sourceId: id, relationType: 'calls' });

        for (const edge of edges) {
          const neighborId = direction === 'in' ? edge.sourceId : edge.targetId;
          if (visited.has(neighborId)) continue;
          visited.add(neighborId);

          const node = store.getNodeById(neighborId);
          if (node) result.push(node);
          next.push(neighborId);

          if (visited.size >= MAX_VISITED) return result;
        }
      }
      frontier = next;
      if (frontier.length === 0) break;
    }

    return result;
  }

  private fetchEdges(
    store: ProjectGraphStore,
    nodeId: string,
    direction: 'in' | 'out',
    relationTypes?: RelationType[],
  ): GraphEdge[] {
    const baseOpts = direction === 'in' ? { targetId: nodeId } : { sourceId: nodeId };
    if (relationTypes && relationTypes.length > 0) {
      const all: GraphEdge[] = [];
      for (const rt of relationTypes) {
        all.push(...store.getEdges({ ...baseOpts, relationType: rt }));
      }
      return all;
    }
    return store.getEdges(baseOpts);
  }

  private reconstructPath(
    store: ProjectGraphStore,
    parent: Map<string, string>,
    sourceId: string,
    targetId: string,
  ): GraphNode[] | null {
    const ids: string[] = [targetId];
    let cur = targetId;
    while (cur !== sourceId) {
      const p = parent.get(cur);
      if (!p) return null;
      ids.push(p);
      cur = p;
    }
    ids.reverse();
    const out: GraphNode[] = [];
    for (const id of ids) {
      const node = store.getNodeById(id);
      if (!node) return null;
      out.push(node);
    }
    return out;
  }
}
