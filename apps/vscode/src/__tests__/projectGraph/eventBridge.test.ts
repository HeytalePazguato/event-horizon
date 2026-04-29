/**
 * EventBridge tests — AgentEvent and KnowledgeEntry ingestion into the project graph.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import { ProjectGraphDB } from '../../projectGraph/projectGraphDb.js';
import { EventBridge } from '../../projectGraph/eventBridge.js';
import type { ProjectGraphStore } from '../../projectGraph/store.js';
import type { AgentEvent } from '@event-horizon/core';
import type { KnowledgeEntry } from '../../sharedKnowledge.js';

const WORKSPACE = path.resolve('eh-test-workspace');

function absFile(relPath: string): string {
  return path.join(WORKSPACE, relPath);
}

function makeEvent(overrides: Partial<AgentEvent> & Pick<AgentEvent, 'type'>): AgentEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2, 8)}`,
    agentId: 'agent-1',
    agentName: 'TestAgent',
    agentType: 'claude-code',
    timestamp: Date.now(),
    payload: {},
    ...overrides,
  };
}

function makeKnowledgeEntry(overrides?: Partial<KnowledgeEntry>): KnowledgeEntry {
  return {
    key: 'test-entry',
    value: 'some value',
    scope: 'workspace',
    author: 'TestAgent',
    authorId: 'agent-1',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('EventBridge', () => {
  let db: ProjectGraphDB;
  let store: ProjectGraphStore;
  let bridge: EventBridge;

  beforeEach(async () => {
    db = await ProjectGraphDB.create();
    store = db.getStore();
    bridge = new EventBridge(store, { workspaceFolder: WORKSPACE });
  });

  afterEach(() => {
    db.close();
  });

  it('task.complete event creates an agent_activity node with matching properties', () => {
    const event = makeEvent({
      id: 'evt-tc-1',
      type: 'task.complete',
      agentId: 'agent-1',
      agentType: 'claude-code',
      timestamp: 1000,
      payload: { taskId: 'task-42', note: 'all done' },
    });

    bridge.ingestEvent(event);

    const node = store.getNodeById('activity:evt-tc-1');
    expect(node).not.toBeNull();
    expect(node?.type).toBe('agent_activity');
    expect(node?.properties['agentId']).toBe('agent-1');
    expect(node?.properties['agentType']).toBe('claude-code');
    expect(node?.properties['status']).toBe('complete');
    expect(node?.properties['taskId']).toBe('task-42');
    expect(node?.properties['timestamp']).toBe(1000);
    expect(node?.properties['note']).toBe('all done');
  });

  it('file.write after task.complete from the same agent creates an authored edge to the module node', () => {
    const filePath = absFile('src/auth.ts');
    const modId = `module:${filePath}`;
    const now = Date.now();

    store.upsertNode({
      id: modId,
      label: 'auth.ts',
      type: 'module',
      properties: {},
      tag: 'EXTRACTED',
      confidence: 1.0,
      createdAt: now,
      updatedAt: now,
    });

    bridge.ingestEvent(makeEvent({
      id: 'evt-tc-2',
      type: 'task.complete',
      agentId: 'agent-1',
      timestamp: 1000,
      payload: {},
    }));

    bridge.ingestEvent(makeEvent({
      id: 'evt-fw-2',
      type: 'file.write',
      agentId: 'agent-1',
      timestamp: 2000,
      payload: { path: filePath },
    }));

    const edges = store.getEdges({ sourceId: 'activity:evt-tc-2', relationType: 'authored' });
    expect(edges).toHaveLength(1);
    expect(edges[0].targetId).toBe(modId);
  });

  it('file.read event creates a touched edge to the module node', () => {
    const filePath = absFile('src/config.ts');
    const modId = `module:${filePath}`;
    const now = Date.now();

    store.upsertNode({
      id: modId,
      label: 'config.ts',
      type: 'module',
      properties: {},
      tag: 'EXTRACTED',
      confidence: 1.0,
      createdAt: now,
      updatedAt: now,
    });

    bridge.ingestEvent(makeEvent({
      id: 'evt-tc-3',
      type: 'task.complete',
      agentId: 'agent-1',
      timestamp: 1000,
      payload: {},
    }));

    bridge.ingestEvent(makeEvent({
      id: 'evt-fr-3',
      type: 'file.read',
      agentId: 'agent-1',
      timestamp: 2000,
      payload: { path: filePath },
    }));

    const edges = store.getEdges({ sourceId: 'activity:evt-tc-3', relationType: 'touched' });
    expect(edges).toHaveLength(1);
    expect(edges[0].targetId).toBe(modId);
  });

  it('file.write with no prior activity creates a synthetic activity node and the authored edge', () => {
    const filePath = absFile('src/utils.ts');
    const modId = `module:${filePath}`;
    const now = Date.now();

    store.upsertNode({
      id: modId,
      label: 'utils.ts',
      type: 'module',
      properties: {},
      tag: 'EXTRACTED',
      confidence: 1.0,
      createdAt: now,
      updatedAt: now,
    });

    const ts = 5000;
    bridge.ingestEvent(makeEvent({
      id: 'evt-fw-4',
      type: 'file.write',
      agentId: 'agent-4',
      timestamp: ts,
      payload: { path: filePath },
    }));

    const syntheticId = `activity:session:agent-4:${ts}`;
    const syntheticNode = store.getNodeById(syntheticId);
    expect(syntheticNode).not.toBeNull();
    expect(syntheticNode?.type).toBe('agent_activity');
    expect(syntheticNode?.properties['kind']).toBe('session');

    const edges = store.getEdges({ sourceId: syntheticId, relationType: 'authored' });
    expect(edges).toHaveLength(1);
    expect(edges[0].targetId).toBe(modId);
  });

  it('ingestKnowledge creates a references edge when a matching function node exists', () => {
    const now = Date.now();
    const fnNodeId = 'func:validateToken';
    store.upsertNode({
      id: fnNodeId,
      label: 'validateToken',
      type: 'function',
      properties: {},
      tag: 'EXTRACTED',
      confidence: 1.0,
      createdAt: now,
      updatedAt: now,
    });

    const entry = makeKnowledgeEntry({
      key: 'auth-note',
      value: 'mentions `validateToken` for JWT validation',
    });

    bridge.ingestKnowledge(entry, 'write');

    const knowledgeNodeId = 'knowledge:auth-note';
    const node = store.getNodeById(knowledgeNodeId);
    expect(node).not.toBeNull();
    expect(node?.type).toBe('knowledge');

    const edges = store.getEdges({ sourceId: knowledgeNodeId, relationType: 'references' });
    expect(edges).toHaveLength(1);
    expect(edges[0].targetId).toBe(fnNodeId);
  });

  it('re-writing the same knowledge entry replaces prior references edges without duplication', () => {
    const now = Date.now();
    const fnNodeId = 'func:validateToken-2';
    store.upsertNode({
      id: fnNodeId,
      label: 'validateToken',
      type: 'function',
      properties: {},
      tag: 'EXTRACTED',
      confidence: 1.0,
      createdAt: now,
      updatedAt: now,
    });

    const entry = makeKnowledgeEntry({
      key: 'auth-note-2',
      value: 'mentions `validateToken` for JWT validation',
    });

    bridge.ingestKnowledge(entry, 'write');
    bridge.ingestKnowledge(entry, 'write');

    const edges = store.getEdges({ sourceId: 'knowledge:auth-note-2', relationType: 'references' });
    expect(edges).toHaveLength(1);
  });

  it('ingestKnowledge with delete removes the knowledge node and all its outgoing edges', () => {
    const now = Date.now();
    const fnNodeId = 'func:validateToken-del';
    store.upsertNode({
      id: fnNodeId,
      label: 'validateToken',
      type: 'function',
      properties: {},
      tag: 'EXTRACTED',
      confidence: 1.0,
      createdAt: now,
      updatedAt: now,
    });

    const entry = makeKnowledgeEntry({
      key: 'auth-note-del',
      value: 'mentions `validateToken` for JWT validation',
    });

    bridge.ingestKnowledge(entry, 'write');

    const knowledgeNodeId = 'knowledge:auth-note-del';
    expect(store.getNodeById(knowledgeNodeId)).not.toBeNull();

    bridge.ingestKnowledge(entry, 'delete');

    expect(store.getNodeById(knowledgeNodeId)).toBeNull();
    const edgesAfter = store.getEdges({ sourceId: knowledgeNodeId });
    expect(edgesAfter).toHaveLength(0);
  });
});
