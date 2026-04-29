import * as path from 'path';
import type { AgentEvent } from '@event-horizon/core';
import type { ProjectGraphStore } from './index.js';
import type { KnowledgeEntry } from '../sharedKnowledge.js';

/**
 * Bridges live runtime data (agent events, shared knowledge mutations) into
 * the project graph. Each public entry resolves the active store from the
 * lifecycle at call time — when no workspace is open the store is `null`
 * and ingestion silently no-ops, never erroring.
 */
export class EventBridge {
  private getStore: () => ProjectGraphStore | null;
  private workspaceFolder: string;
  private agentLastActivity = new Map<string, { id: string; timestamp: number }>();
  private agentSessionStart = new Map<string, number>();

  /**
   * @param storeOrResolver Either a concrete `ProjectGraphStore` (used by
   *   tests that own a single in-memory DB) or a `() => ProjectGraphStore | null`
   *   resolver (used by the extension host, which routes through
   *   `ProjectGraphLifecycle`).
   */
  constructor(
    storeOrResolver: ProjectGraphStore | (() => ProjectGraphStore | null),
    opts: { workspaceFolder: string },
  ) {
    this.getStore =
      typeof storeOrResolver === 'function'
        ? storeOrResolver
        : (): ProjectGraphStore | null => storeOrResolver;
    this.workspaceFolder = opts.workspaceFolder;
  }

  ingestEvent(event: AgentEvent): void {
    const store = this.getStore();
    if (!store) return;
    try {
      if (event.type === 'task.complete' || event.type === 'task.fail') {
        this.handleTaskEvent(store, event);
      } else if (event.type === 'file.write' || event.type === 'file.read') {
        this.handleFileEvent(store, event);
      }
    } catch {
      // Never crash the event pipeline
    }
  }

  ingestKnowledge(entry: KnowledgeEntry, op: 'write' | 'delete'): void {
    const store = this.getStore();
    if (!store) return;
    try {
      const nodeId = `knowledge:${entry.key}`;
      if (op === 'delete') {
        this.deleteKnowledgeNode(store, nodeId);
      } else {
        this.writeKnowledgeNode(store, nodeId, entry);
      }
    } catch {
      // Never crash
    }
  }

  private handleTaskEvent(store: ProjectGraphStore, event: AgentEvent): void {
    const now = Date.now();
    const nodeId = `activity:${event.id}`;
    const payload = event.payload as Record<string, unknown>;

    store.upsertNode({
      id: nodeId,
      label: `${event.agentId} ${event.type}`,
      type: 'agent_activity',
      properties: {
        taskId: payload['taskId'] ?? null,
        agentId: event.agentId,
        agentType: event.agentType,
        status: event.type === 'task.complete' ? 'complete' : 'failed',
        timestamp: event.timestamp,
        note: payload['note'] ?? null,
      },
      tag: 'EXTRACTED',
      confidence: 1.0,
      createdAt: now,
      updatedAt: now,
    });

    const existing = this.agentLastActivity.get(event.agentId);
    if (!existing || event.timestamp > existing.timestamp) {
      this.agentLastActivity.set(event.agentId, { id: nodeId, timestamp: event.timestamp });
    }
  }

  private handleFileEvent(store: ProjectGraphStore, event: AgentEvent): void {
    const payload = event.payload as Record<string, unknown>;
    const rawPath = (payload['path'] ?? payload['file'] ?? payload['filePath']) as string | undefined;
    if (!rawPath) return;

    const absPath = path.isAbsolute(rawPath)
      ? rawPath
      : path.join(this.workspaceFolder, rawPath);

    const moduleNodeId = `module:${absPath}`;
    const moduleNode = store.getNodeById(moduleNodeId);

    // Never create edges to non-existent nodes (covers empty-graph case too)
    if (!moduleNode) {
      this.ensureActivityNode(store, event);
      return;
    }

    const activityNodeId = this.ensureActivityNode(store, event);
    const relationType: 'touched' | 'authored' = event.type === 'file.read' ? 'touched' : 'authored';
    const edgeId = `edge:${activityNodeId}:${moduleNodeId}:${relationType}`;
    const now = Date.now();

    store.upsertEdge({
      id: edgeId,
      sourceId: activityNodeId,
      targetId: moduleNodeId,
      relationType,
      tag: 'EXTRACTED',
      confidence: 1.0,
      createdAt: now,
    });
  }

  private ensureActivityNode(store: ProjectGraphStore, event: AgentEvent): string {
    const lastActivity = this.agentLastActivity.get(event.agentId);
    if (lastActivity) return lastActivity.id;

    if (!this.agentSessionStart.has(event.agentId)) {
      this.agentSessionStart.set(event.agentId, event.timestamp);
    }
    const sessionStart = this.agentSessionStart.get(event.agentId)!;
    const syntheticId = `activity:session:${event.agentId}:${sessionStart}`;

    if (!store.getNodeById(syntheticId)) {
      const now = Date.now();
      store.upsertNode({
        id: syntheticId,
        label: `${event.agentId} session`,
        type: 'agent_activity',
        properties: {
          agentId: event.agentId,
          kind: 'session',
          timestamp: sessionStart,
        },
        tag: 'EXTRACTED',
        confidence: 1.0,
        createdAt: now,
        updatedAt: now,
      });
    }

    this.agentLastActivity.set(event.agentId, { id: syntheticId, timestamp: sessionStart });
    return syntheticId;
  }

  private writeKnowledgeNode(store: ProjectGraphStore, nodeId: string, entry: KnowledgeEntry): void {
    const now = Date.now();

    // Delete prior references edges before re-writing to avoid stale links
    const priorEdges = store.getEdges({ sourceId: nodeId, relationType: 'references' });
    for (const edge of priorEdges) {
      store.deleteEdge(edge.id);
    }

    store.upsertNode({
      id: nodeId,
      label: entry.key,
      type: 'knowledge',
      properties: {
        key: entry.key,
        scope: entry.scope,
        author: entry.author,
        tier: entry.tier ?? null,
        validUntil: entry.validUntil ?? null,
      },
      tag: 'EXTRACTED',
      confidence: 1.0,
      createdAt: now,
      updatedAt: now,
    });

    // Emit references edges to function nodes for each backticked identifier
    const backtickPattern = /`([^`]+)`/g;
    let match: RegExpExecArray | null;
    while ((match = backtickPattern.exec(entry.value)) !== null) {
      const identifier = match[1].trim();
      if (!identifier) continue;
      const hits = store.searchNodes(identifier, { type: 'function' });
      for (const node of hits) {
        store.upsertEdge({
          id: `edge:${nodeId}:${node.id}:references`,
          sourceId: nodeId,
          targetId: node.id,
          relationType: 'references',
          tag: 'INFERRED',
          confidence: 0.6,
          createdAt: now,
        });
      }
    }
  }

  private deleteKnowledgeNode(store: ProjectGraphStore, nodeId: string): void {
    const edges = store.getEdges({ sourceId: nodeId });
    for (const edge of edges) {
      store.deleteEdge(edge.id);
    }
    store.deleteNode(nodeId);
  }
}
