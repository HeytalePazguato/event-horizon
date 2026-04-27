/**
 * MCP Server tests — exercises JSON-RPC protocol, all 6 tools, and error handling.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { McpServer, FileActivityTracker } from '../mcpServer.js';
import { LockManager } from '../lockManager.js';
import { AgentStateManager } from '@event-horizon/core';
import { PlanBoardManager } from '../planBoard.js';
import { MessageQueue } from '../messageQueue.js';
import { RoleManager } from '../roleManager.js';
import { AgentProfiler } from '../agentProfiler.js';
import { SharedKnowledgeStore } from '../sharedKnowledge.js';
import { EventHorizonDB } from '../persistence.js';
import { GraphQueryEngine } from '../projectGraph/queryEngine.js';

let lockManager: LockManager;
let agentStateManager: AgentStateManager;
let fileActivityTracker: FileActivityTracker;
let mcp: McpServer;

beforeEach(() => {
  lockManager = new LockManager(100); // 100ms TTL for fast tests
  lockManager.setEnabled(true);
  agentStateManager = new AgentStateManager();
  fileActivityTracker = new FileActivityTracker();
  mcp = new McpServer({ lockManager, agentStateManager, fileActivityTracker, planBoardManager: new PlanBoardManager(), messageQueue: new MessageQueue(), roleManager: new RoleManager(), agentProfiler: new AgentProfiler(), sharedKnowledge: new SharedKnowledgeStore() });
});

function rpc(method: string, params?: Record<string, unknown>, id: number | string = 1) {
  return mcp.handleRequest({ jsonrpc: '2.0', method, params, id });
}

function callTool(name: string, args: Record<string, unknown>, id: number | string = 1) {
  return rpc('tools/call', { name, arguments: args }, id);
}

// ── Protocol tests ──────────────────────────────────────────────────────────

describe('JSON-RPC protocol', () => {
  it('rejects non-2.0 requests', async () => {
    const res = await mcp.handleRequest({ jsonrpc: '1.0', method: 'initialize', id: 1 });
    expect(res.error?.code).toBe(-32600);
  });

  it('rejects missing method', async () => {
    const res = await mcp.handleRequest({ jsonrpc: '2.0', id: 1 });
    expect(res.error?.code).toBe(-32600);
  });

  it('rejects unknown method', async () => {
    const res = await rpc('unknown/method');
    expect(res.error?.code).toBe(-32601);
  });
});

// ── initialize ──────────────────────────────────────────────────────────────

describe('initialize', () => {
  it('returns server info and capabilities', async () => {
    const res = await rpc('initialize');
    expect(res.result).toMatchObject({
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'Event Horizon' },
    });
  });
});

// ── tools/list ──────────────────────────────────────────────────────────────

describe('tools/list', () => {
  it('returns all tools', async () => {
    const res = await rpc('tools/list');
    const result = res.result as { tools: Array<{ name: string }> };
    expect(result.tools).toHaveLength(48);
    const names = result.tools.map((t) => t.name);
    expect(names).toContain('eh_check_lock');
    expect(names).toContain('eh_acquire_lock');
    expect(names).toContain('eh_release_lock');
    expect(names).toContain('eh_list_agents');
    expect(names).toContain('eh_file_activity');
    expect(names).toContain('eh_query_graph');
    expect(names).toContain('eh_wait_for_unlock');
    expect(names).toContain('eh_load_plan');
    expect(names).toContain('eh_get_plan');
    expect(names).toContain('eh_claim_task');
    expect(names).toContain('eh_update_task');
    expect(names).toContain('eh_send_message');
    expect(names).toContain('eh_get_messages');
  });
});

// ── eh_check_lock ───────────────────────────────────────────────────────────

describe('eh_check_lock', () => {
  it('returns not locked for a free file', async () => {
    const res = await callTool('eh_check_lock', { file_path: 'src/index.ts', agent_id: 'a1' });
    const content = (res.result as { content: Array<{ text: string }> }).content[0];
    expect(JSON.parse(content.text)).toEqual({ locked: false });
  });

  it('returns locked with owner info when another agent holds it', async () => {
    lockManager.acquire('src/index.ts', 'a1', 'Agent A', 'Refactoring');
    const res = await callTool('eh_check_lock', { file_path: 'src/index.ts', agent_id: 'a2' });
    const content = (res.result as { content: Array<{ text: string }> }).content[0];
    const parsed = JSON.parse(content.text);
    expect(parsed.locked).toBe(true);
    expect(parsed.owner).toBe('Agent A');
    expect(parsed.reason).toBe('Refactoring');
  });

  it('returns not locked for the lock owner', async () => {
    lockManager.acquire('src/index.ts', 'a1', 'Agent A');
    const res = await callTool('eh_check_lock', { file_path: 'src/index.ts', agent_id: 'a1' });
    const content = (res.result as { content: Array<{ text: string }> }).content[0];
    expect(JSON.parse(content.text)).toEqual({ locked: false });
  });
});

// ── eh_acquire_lock ─────────────────────────────────────────────────────────

describe('eh_acquire_lock', () => {
  it('acquires a free file', async () => {
    const res = await callTool('eh_acquire_lock', { file_path: 'src/a.ts', agent_id: 'a1', agent_name: 'Agent A' });
    const content = (res.result as { content: Array<{ text: string }> }).content[0];
    expect(JSON.parse(content.text)).toEqual({ acquired: true });
  });

  it('fails when another agent holds the lock', async () => {
    lockManager.acquire('src/a.ts', 'a1', 'Agent A', 'editing');
    const res = await callTool('eh_acquire_lock', { file_path: 'src/a.ts', agent_id: 'a2', agent_name: 'Agent B' });
    const content = (res.result as { content: Array<{ text: string }> }).content[0];
    const parsed = JSON.parse(content.text);
    expect(parsed.acquired).toBe(false);
    expect(parsed.owner).toBe('Agent A');
  });
});

// ── eh_release_lock ─────────────────────────────────────────────────────────

describe('eh_release_lock', () => {
  it('releases a held lock', async () => {
    lockManager.acquire('src/a.ts', 'a1', 'Agent A');
    const res = await callTool('eh_release_lock', { file_path: 'src/a.ts', agent_id: 'a1' });
    const content = (res.result as { content: Array<{ text: string }> }).content[0];
    expect(JSON.parse(content.text)).toEqual({ released: true });

    // Verify the lock is actually released
    const check = lockManager.query('src/a.ts', 'a2');
    expect(check.allowed).toBe(true);
  });
});

// ── eh_list_agents ──────────────────────────────────────────────────────────

describe('eh_list_agents', () => {
  it('returns empty list when no agents', async () => {
    const res = await callTool('eh_list_agents', { agent_id: 'a1' });
    const content = (res.result as { content: Array<{ text: string }> }).content[0];
    expect(JSON.parse(content.text)).toEqual({ agents: [] });
  });

  it('lists agents with their locks', async () => {
    // Spawn an agent
    agentStateManager.apply({
      id: 'ev1', agentId: 'a1', agentName: 'Claude', agentType: 'claude-code',
      type: 'agent.spawn', timestamp: Date.now(), payload: { cwd: '/project' },
    });
    lockManager.acquire('src/index.ts', 'a1', 'Claude', 'editing');

    const res = await callTool('eh_list_agents', { agent_id: 'a2' });
    const content = (res.result as { content: Array<{ text: string }> }).content[0];
    const parsed = JSON.parse(content.text);
    expect(parsed.agents).toHaveLength(1);
    expect(parsed.agents[0].name).toBe('Claude');
    expect(parsed.agents[0].locks).toHaveLength(1);
    expect(parsed.agents[0].locks[0].file).toContain('src/index.ts');
  });
});

// ── eh_file_activity ────────────────────────────────────────────────────────

describe('eh_file_activity', () => {
  it('returns empty when no activity', async () => {
    const res = await callTool('eh_file_activity', { agent_id: 'a1' });
    const content = (res.result as { content: Array<{ text: string }> }).content[0];
    expect(JSON.parse(content.text)).toEqual({ entries: [] });
  });

  it('returns recorded activity', async () => {
    fileActivityTracker.record({
      filePath: 'src/index.ts', agentId: 'a1', agentName: 'Claude', action: 'write', timestamp: 1000,
    });
    fileActivityTracker.record({
      filePath: 'src/utils.ts', agentId: 'a2', agentName: 'Copilot', action: 'read', timestamp: 2000,
    });

    const res = await callTool('eh_file_activity', { agent_id: 'a1' });
    const content = (res.result as { content: Array<{ text: string }> }).content[0];
    const parsed = JSON.parse(content.text);
    expect(parsed.entries).toHaveLength(2);
  });

  it('filters by file_path', async () => {
    fileActivityTracker.record({
      filePath: 'src/index.ts', agentId: 'a1', agentName: 'Claude', action: 'write', timestamp: 1000,
    });
    fileActivityTracker.record({
      filePath: 'src/utils.ts', agentId: 'a2', agentName: 'Copilot', action: 'read', timestamp: 2000,
    });

    const res = await callTool('eh_file_activity', { file_path: 'src/index.ts', agent_id: 'a1' });
    const content = (res.result as { content: Array<{ text: string }> }).content[0];
    const parsed = JSON.parse(content.text);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0].filePath).toBe('src/index.ts');
  });
});

// ── eh_wait_for_unlock ──────────────────────────────────────────────────────

describe('eh_wait_for_unlock', () => {
  it('returns immediately for a free file', async () => {
    const res = await callTool('eh_wait_for_unlock', { file_path: 'src/a.ts', agent_id: 'a1', agent_name: 'Agent A' });
    const content = (res.result as { content: Array<{ text: string }> }).content[0];
    expect(JSON.parse(content.text)).toEqual({ acquired: true });
  });

  it('waits and acquires after release', async () => {
    lockManager.acquire('src/a.ts', 'a1', 'Agent A');
    const promise = callTool('eh_wait_for_unlock', { file_path: 'src/a.ts', agent_id: 'a2', agent_name: 'Agent B', timeout_seconds: 5 });
    setTimeout(() => lockManager.release('src/a.ts', 'a1'), 50);
    const res = await promise;
    const content = (res.result as { content: Array<{ text: string }> }).content[0];
    expect(JSON.parse(content.text).acquired).toBe(true);
  });
});

// ── Error handling ──────────────────────────────────────────────────────────

describe('error handling', () => {
  it('rejects unknown tool name', async () => {
    const res = await callTool('eh_nonexistent', { agent_id: 'a1' });
    expect(res.error?.code).toBe(-32602);
    expect(res.error?.message).toContain('Unknown tool');
  });

  it('rejects missing required params', async () => {
    const res = await callTool('eh_check_lock', { agent_id: 'a1' });
    expect(res.error?.code).toBe(-32602);
    expect(res.error?.message).toContain('file_path');
  });

  it('rejects missing tool name', async () => {
    const res = await rpc('tools/call', { arguments: {} });
    expect(res.error?.code).toBe(-32602);
  });
});

// ── FileActivityTracker ─────────────────────────────────────────────────────

describe('FileActivityTracker', () => {
  it('respects max entries', () => {
    const tracker = new FileActivityTracker(3);
    for (let i = 0; i < 5; i++) {
      tracker.record({ filePath: `f${i}.ts`, agentId: 'a1', agentName: 'A', action: 'read', timestamp: i });
    }
    expect(tracker.query(undefined, 100)).toHaveLength(3);
  });

  it('respects limit param', () => {
    for (let i = 0; i < 10; i++) {
      fileActivityTracker.record({ filePath: `f${i}.ts`, agentId: 'a1', agentName: 'A', action: 'read', timestamp: i });
    }
    expect(fileActivityTracker.query(undefined, 5)).toHaveLength(5);
  });
});

// ── eh_query_graph ──────────────────────────────────────────────────────────

describe('eh_query_graph', () => {
  let db: EventHorizonDB;
  let mcpWithGraph: McpServer;

  beforeEach(async () => {
    db = await EventHorizonDB.create();
    const store = db.getProjectGraphStore();
    const engine = new GraphQueryEngine(store);
    mcpWithGraph = new McpServer({
      lockManager,
      agentStateManager,
      fileActivityTracker,
      planBoardManager: new PlanBoardManager(),
      messageQueue: new MessageQueue(),
      roleManager: new RoleManager(),
      agentProfiler: new AgentProfiler(),
      sharedKnowledge: new SharedKnowledgeStore(),
      projectGraphQueryEngine: engine,
    });

    store.upsertNode({
      id: 'fn:parseToken',
      label: 'parseToken',
      type: 'function',
      sourceFile: '/src/auth.ts',
      tag: 'EXTRACTED',
      confidence: 1.0,
      properties: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  afterEach(() => {
    db.close();
  });

  function graphCall(args: Record<string, unknown>) {
    return mcpWithGraph.handleRequest({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'eh_query_graph', arguments: args }, id: 1 });
  }

  it('returns informative message when engine is not wired', async () => {
    const bare = new McpServer({ lockManager, agentStateManager, fileActivityTracker, planBoardManager: new PlanBoardManager(), messageQueue: new MessageQueue(), roleManager: new RoleManager(), agentProfiler: new AgentProfiler(), sharedKnowledge: new SharedKnowledgeStore() });
    const res = await bare.handleRequest({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'eh_query_graph', arguments: { op: 'search', query: 'foo' } }, id: 1 });
    const content = (res.result as { content: Array<{ text: string }> }).content[0];
    const parsed = JSON.parse(content.text);
    expect(parsed.ok).toBe(false);
    expect(parsed.message).toContain('No project graph');
  });

  it('search op returns matching nodes', async () => {
    const res = await graphCall({ op: 'search', query: 'parseToken' });
    const content = (res.result as { content: Array<{ text: string }> }).content[0];
    const nodes = JSON.parse(content.text);
    expect(Array.isArray(nodes)).toBe(true);
    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes[0].label).toBe('parseToken');
  });

  it('search op returns error when query missing', async () => {
    const res = await graphCall({ op: 'search' });
    const content = (res.result as { content: Array<{ text: string }> }).content[0];
    const parsed = JSON.parse(content.text);
    expect(parsed.error).toContain('query is required');
  });

  it('callers op returns error when node_id missing', async () => {
    const res = await graphCall({ op: 'callers' });
    const content = (res.result as { content: Array<{ text: string }> }).content[0];
    const parsed = JSON.parse(content.text);
    expect(parsed.error).toContain('node_id is required');
  });

  it('callers op returns empty array for leaf node', async () => {
    const res = await graphCall({ op: 'callers', node_id: 'fn:parseToken' });
    const content = (res.result as { content: Array<{ text: string }> }).content[0];
    const nodes = JSON.parse(content.text);
    expect(Array.isArray(nodes)).toBe(true);
    expect(nodes).toHaveLength(0);
  });

  it('explain op returns full node detail', async () => {
    const res = await graphCall({ op: 'explain', node_id: 'fn:parseToken' });
    const content = (res.result as { content: Array<{ text: string }> }).content[0];
    const result = JSON.parse(content.text);
    expect(result.node).not.toBeNull();
    expect(result.node.label).toBe('parseToken');
    expect(Array.isArray(result.in)).toBe(true);
    expect(Array.isArray(result.out)).toBe(true);
  });

  it('explain op returns null for unknown node', async () => {
    const res = await graphCall({ op: 'explain', node_id: 'fn:nonexistent' });
    const content = (res.result as { content: Array<{ text: string }> }).content[0];
    const result = JSON.parse(content.text);
    expect(result).toBeNull();
  });

  it('path op returns error when source_id missing', async () => {
    const res = await graphCall({ op: 'path', target_id: 'fn:parseToken' });
    const content = (res.result as { content: Array<{ text: string }> }).content[0];
    const parsed = JSON.parse(content.text);
    expect(parsed.error).toContain('source_id is required');
  });

  it('recent_activity op returns error when file_path missing', async () => {
    const res = await graphCall({ op: 'recent_activity' });
    const content = (res.result as { content: Array<{ text: string }> }).content[0];
    const parsed = JSON.parse(content.text);
    expect(parsed.error).toContain('file_path is required');
  });

  it('recent_activity op returns empty result for unknown file', async () => {
    const res = await graphCall({ op: 'recent_activity', file_path: '/src/auth.ts' });
    const content = (res.result as { content: Array<{ text: string }> }).content[0];
    const result = JSON.parse(content.text);
    expect(Array.isArray(result.agents)).toBe(true);
    expect(Array.isArray(result.activities)).toBe(true);
  });
});
