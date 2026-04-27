import * as path from 'path';
import type { AgentEvent } from '@event-horizon/core';
import type { ProjectGraphStore } from './index.js';
import type { KnowledgeEntry } from '../sharedKnowledge.js';

export class EventBridge {
  private store: ProjectGraphStore;
  private workspaceFolder: string;
  private agentLastActivity = new Map<string, { id: string; timestamp: number }>();
  private agentSessionStart = new Map<string, number>();

  constructor(store: ProjectGraphStore, opts: { workspaceFolder: string }) {
    this.store = store;
    this.workspaceFolder = opts.workspaceFolder;
  }

  ingestEvent(event: AgentEvent): void {
    try {
      if (event.type === 'task.complete' || event.type === 'task.fail') {
        this.handleTaskEvent(event);
      } else if (event.type === 'file.write' || event.type === 'file.read') {
        this.handleFileEvent(event);
      }
    } catch {
      // Never crash the event pipeline
    }
  }

  ingestKnowledge(entry: KnowledgeEntry, op: 'write' | 'delete'): void {
    try {
      const nodeId = `knowledge:${entry.key}`;
      if (op === 'delete') {
        this.deleteKnowledgeNode(nodeId);
      } else {
        this.writeKnowledgeNode(nodeId, entry);
      }
    } catch {
      // Never crash
    }
  }

  private handleTaskEvent(event: AgentEvent): void {
    const now = Date.now();
    const nodeId = `activity:${event.id}`;
    const payload = event.payload as Record<string, unknown>;

    this.store.upsertNode({
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

  private handleFileEvent(event: AgentEvent): void {
    const payload = event.payload as Record<string, unknown>;
    const rawPath = (payload['path'] ?? payload['file'] ?? payload['filePath']) as string | undefined;
    if (!rawPath) return;

    const absPath = path.isAbsolute(rawPath)
      ? rawPath
      : path.join(this.workspaceFolder, rawPath);

    const moduleNodeId = `module:${absPath}`;
    const moduleNode = this.store.getNodeById(moduleNodeId);

    // Never create edges to non-existent nodes (covers empty-graph case too)
    if (!moduleNode) {
      this.ensureActivityNode(event);
      return;
    }

    const activityNodeId = this.ensureActivityNode(event);
    const relationType: 'touched' | 'authored' = event.type === 'file.read' ? 'touched' : 'authored';
    const edgeId = `edge:${activityNodeId}:${moduleNodeId}:${relationType}`;
    const now = Date.now();

    this.store.upsertEdge({
      id: edgeId,
      sourceId: activityNodeId,
      targetId: moduleNodeId,
      relationType,
      tag: 'EXTRACTED',
      confidence: 1.0,
      createdAt: now,
    });
  }

  private ensureActivityNode(event: AgentEvent): string {
    const lastActivity = this.agentLastActivity.get(event.agentId);
    if (lastActivity) return lastActivity.id;

    if (!this.agentSessionStart.has(event.agentId)) {
      this.agentSessionStart.set(event.agentId, event.timestamp);
    }
    const sessionStart = this.agentSessionStart.get(event.agentId)!;
    const syntheticId = `activity:session:${event.agentId}:${sessionStart}`;

    if (!this.store.getNodeById(syntheticId)) {
      const now = Date.now();
      this.store.upsertNode({
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

  private writeKnowledgeNode(nodeId: string, entry: KnowledgeEntry): void {
    const now = Date.now();

    // Delete prior references edges before re-writing to avoid stale links
    const priorEdges = this.store.getEdges({ sourceId: nodeId, relationType: 'references' });
    for (const edge of priorEdges) {
      this.store.deleteEdge(edge.id);
    }

    this.store.upsertNode({
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
      const hits = this.store.searchNodes(identifier, { type: 'function' });
      for (const node of hits) {
        this.store.upsertEdge({
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

  private deleteKnowledgeNode(nodeId: string): void {
    const edges = this.store.getEdges({ sourceId: nodeId });
    for (const edge of edges) {
      this.store.deleteEdge(edge.id);
    }
    this.store.deleteNode(nodeId);
  }
}
