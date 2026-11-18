/**
 * MCP Server tests — exercises JSON-RPC protocol, all 6 tools, and error handling.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { McpServer, FileActivityTracker } from '../mcpServer.js';
import { LockManager } from '../lockManager.js';
import { AgentStateManager } from '@event-horizon/core';
import { PlanBoardManager } from '../planBoard.js';
import { MessageQueue } from '../messageQueue.js';
import { RoleManager } from '../roleManager.js';
import { AgentProfiler } from '../agentProfiler.js';
import { SharedKnowledgeStore } from '../sharedKnowledge.js';
import { ProjectGraphDB } from '../projectGraph/projectGraphDb.js';
import { GraphQueryEngine } from '../projectGraph/queryEngine.js';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

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
    expect(result.tools).toHaveLength(54);
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
    expect(names).toContain('eh_rescan_files');
    expect(names).toContain('eh_get_task');
    expect(names).toContain('eh_cancel_task');
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

describe('eh_purge_stale_agents', () => {
  it('reports the ids returned by the lifecycle-owned purge', async () => {
    const purge = vi.fn(() => ['dead-1', 'dead-2']);
    mcp.setPurgeStaleAgents(purge);
    const res = await callTool('eh_purge_stale_agents', { agent_id: 'a1' });
    const content = (res.result as { content: Array<{ text: string }> }).content[0];
    expect(JSON.parse(content.text)).toEqual({ purged: ['dead-1', 'dead-2'], count: 2 });
    expect(purge).toHaveBeenCalledTimes(1);
  });

  it('returns an empty purge when the lifecycle finds nothing to remove', async () => {
    mcp.setPurgeStaleAgents(() => []);
    const res = await callTool('eh_purge_stale_agents', { agent_id: 'a1' });
    const content = (res.result as { content: Array<{ text: string }> }).content[0];
    expect(JSON.parse(content.text)).toEqual({ purged: [], count: 0 });
  });

  it('does not inspect heartbeats or emit terminate events itself', async () => {
    const onEvent = vi.fn();
    mcp.setOnEvent(onEvent);
    agentStateManager.apply({
      id: 'ev1', agentId: 'stale-1', agentName: 'Stale', agentType: 'claude-code',
      type: 'agent.spawn', timestamp: Date.now(), payload: { cwd: '/project' },
    });
    mcp.setPurgeStaleAgents(() => []);
    await callTool('eh_purge_stale_agents', { agent_id: 'a1' });
    expect(onEvent).not.toHaveBeenCalled();
    expect(agentStateManager.getAgent('stale-1')).toBeDefined();
  });

  it('returns an error when no lifecycle purge is wired', async () => {
    const res = await callTool('eh_purge_stale_agents', { agent_id: 'a1' });
    const content = (res.result as { content: Array<{ text: string }> }).content[0];
    expect(JSON.parse(content.text)).toEqual({ error: 'Lifecycle manager not available' });
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
  let db: ProjectGraphDB;
  let mcpWithGraph: McpServer;

  beforeEach(async () => {
    db = await ProjectGraphDB.create();
    const store = db.getStore();
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

// ── eh_rescan_files ─────────────────────────────────────────────────────────

describe('eh_rescan_files', () => {
  type ScanResult = { filesProcessed: number; filesSkipped: number; nodesCreated: number; edgesCreated: number; durationMs: number; filesMatched: number };

  const baseDeps = () => ({
    lockManager,
    agentStateManager,
    fileActivityTracker,
    planBoardManager: new PlanBoardManager(),
    messageQueue: new MessageQueue(),
    roleManager: new RoleManager(),
    agentProfiler: new AgentProfiler(),
    sharedKnowledge: new SharedKnowledgeStore(),
  });

  function parseResult(res: Awaited<ReturnType<McpServer['handleRequest']>>) {
    const content = (res.result as { content: Array<{ text: string }> }).content[0];
    return JSON.parse(content.text);
  }

  function rescanCall(server: McpServer, paths: string[], id: number | string = 1) {
    return server.handleRequest({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'eh_rescan_files', arguments: { paths } }, id });
  }

  it('returns error when scanner not wired', async () => {
    const bare = new McpServer(baseDeps());
    const res = await rescanCall(bare, []);
    expect(parseResult(res).error).toContain('scanner not available');
  });

  it('returns no-workspace error when lifecycle has no active store', async () => {
    const noWorkspace = new McpServer({
      ...baseDeps(),
      projectGraphScanner: { rescanFiles: async () => ({ filesProcessed: 0, filesSkipped: 0, nodesCreated: 0, edgesCreated: 0, durationMs: 1, filesMatched: 0 }) } as never,
      projectGraphLifecycle: { getActiveStore: () => null } as never,
    });
    const res = await rescanCall(noWorkspace, []);
    const parsed = parseResult(res);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain('No workspace');
  });

  it('empty paths returns no-op summary without throwing', async () => {
    const server = new McpServer({
      ...baseDeps(),
      projectGraphScanner: { rescanFiles: async (_p: string[], _o?: unknown) => ({ filesProcessed: 0, filesSkipped: 0, nodesCreated: 0, edgesCreated: 0, durationMs: 1, filesMatched: 0 } as ScanResult) } as never,
    });
    const res = await rescanCall(server, []);
    const parsed = parseResult(res);
    expect(parsed.filesProcessed).toBe(0);
    expect(parsed.filesMatched).toBe(0);
    expect(parsed.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('serializes concurrent calls — second awaits first', async () => {
    const order: string[] = [];
    let resolveFirst!: () => void;

    const server = new McpServer({
      ...baseDeps(),
      projectGraphScanner: {
        rescanFiles: async (paths: string[]) => {
          if (paths[0] === 'first.ts') {
            order.push('first:start');
            await new Promise<void>((r) => { resolveFirst = r; });
            order.push('first:end');
          } else {
            order.push('second:start');
            order.push('second:end');
          }
          return { filesProcessed: 1, filesSkipped: 0, nodesCreated: 0, edgesCreated: 0, durationMs: 1, filesMatched: 1 } as ScanResult;
        },
      } as never,
    });

    const p1 = server.handleRequest({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'eh_rescan_files', arguments: { paths: ['first.ts'] } }, id: 1 });
    const p2 = server.handleRequest({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'eh_rescan_files', arguments: { paths: ['second.ts'] } }, id: 2 });

    // First call runs synchronously to its first await; second is queued behind it.
    expect(order).toContain('first:start');
    expect(order).not.toContain('second:start');

    resolveFirst();
    await Promise.all([p1, p2]);

    expect(order).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
    expect(parseResult(await p1).filesProcessed).toBe(1);
    expect(parseResult(await p2).filesProcessed).toBe(1);
  });
});

// ── eh_build_graph + eh_scan_status (async-start + poll) ────────────────────

describe('eh_build_graph + eh_scan_status', () => {
  type ScanResult = { filesProcessed: number; filesSkipped: number; nodesCreated: number; edgesCreated: number; durationMs: number; filesMatched: number };

  // Lazy import the registry — keeps the rest of the suite from depending on
  // the projectGraph subdir for tests that don't use it.
  let ScanRegistry: typeof import('../projectGraph/scanRegistry.js').ScanRegistry;

  beforeEach(async () => {
    ({ ScanRegistry } = await import('../projectGraph/scanRegistry.js'));
  });

  const baseDeps = () => ({
    lockManager,
    agentStateManager,
    fileActivityTracker,
    planBoardManager: new PlanBoardManager(),
    messageQueue: new MessageQueue(),
    roleManager: new RoleManager(),
    agentProfiler: new AgentProfiler(),
    sharedKnowledge: new SharedKnowledgeStore(),
  });

  function parseResult(res: Awaited<ReturnType<McpServer['handleRequest']>>) {
    const content = (res.result as { content: Array<{ text: string }> }).content[0];
    return JSON.parse(content.text);
  }

  function call(server: McpServer, name: string, args: Record<string, unknown> = {}) {
    return server.handleRequest({ jsonrpc: '2.0', method: 'tools/call', params: { name, arguments: args }, id: 1 });
  }

  it('eh_build_graph returns scanId immediately while scan runs in background', async () => {
    let scanResolve!: (s: ScanResult) => void;
    const scanPromise = new Promise<ScanResult>((r) => { scanResolve = r; });

    const server = new McpServer({
      ...baseDeps(),
      scanRegistry: new ScanRegistry(),
      projectGraphScanner: { scanWorkspace: () => scanPromise } as never,
    });

    // The scan is still running — eh_build_graph must NOT block on it.
    const res = await Promise.race([
      call(server, 'eh_build_graph'),
      new Promise((_r, rej) => setTimeout(() => rej(new Error('eh_build_graph blocked')), 500)),
    ]) as Awaited<ReturnType<McpServer['handleRequest']>>;
    const parsed = parseResult(res);

    expect(parsed.status).toBe('started');
    expect(typeof parsed.scanId).toBe('string');
    expect(parsed.scanId.length).toBeGreaterThan(0);

    // Let the scan finish so the test doesn't leak a pending promise.
    scanResolve({ filesProcessed: 5, filesSkipped: 1, nodesCreated: 12, edgesCreated: 8, durationMs: 42, filesMatched: 6 });
    await scanPromise;
  });

  it('eh_scan_status reports running, then done with summary', async () => {
    let scanResolve!: (s: ScanResult) => void;
    const scanPromise = new Promise<ScanResult>((r) => { scanResolve = r; });
    const registry = new ScanRegistry();

    const server = new McpServer({
      ...baseDeps(),
      scanRegistry: registry,
      projectGraphScanner: { scanWorkspace: () => scanPromise } as never,
    });

    const start = parseResult(await call(server, 'eh_build_graph'));
    const scanId = start.scanId as string;

    // Mid-scan: status should be running with the original scanId.
    const mid = parseResult(await call(server, 'eh_scan_status', { scan_id: scanId }));
    expect(mid.status).toBe('running');
    expect(mid.scanId).toBe(scanId);
    expect(mid.summary).toBeUndefined();

    // Resolve the scan and let the registry catch up.
    const summary: ScanResult = { filesProcessed: 5, filesSkipped: 1, nodesCreated: 12, edgesCreated: 8, durationMs: 42, filesMatched: 6 };
    scanResolve(summary);
    await scanPromise;
    // Yield once so the .then() in the background scan task runs.
    await new Promise((r) => setImmediate(r));

    const done = parseResult(await call(server, 'eh_scan_status', { scan_id: scanId }));
    expect(done.status).toBe('done');
    expect(done.summary).toMatchObject({ filesProcessed: 5, nodesCreated: 12, edgesCreated: 8 });
    expect(done.durationMs).toBe(42);
  });

  it('eh_scan_status reports failed when the scanner throws', async () => {
    const registry = new ScanRegistry();
    const server = new McpServer({
      ...baseDeps(),
      scanRegistry: registry,
      projectGraphScanner: { scanWorkspace: async () => { throw new Error('disk full'); } } as never,
    });

    const start = parseResult(await call(server, 'eh_build_graph'));
    const scanId = start.scanId as string;

    // Wait for the background task's catch to fire.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    const result = parseResult(await call(server, 'eh_scan_status', { scan_id: scanId }));
    expect(result.status).toBe('failed');
    expect(result.error).toContain('disk full');
  });

  it('eh_build_graph returns the existing scanId when a scan is already running', async () => {
    let scanResolve!: (s: ScanResult) => void;
    const scanPromise = new Promise<ScanResult>((r) => { scanResolve = r; });
    const registry = new ScanRegistry();
    const server = new McpServer({
      ...baseDeps(),
      scanRegistry: registry,
      projectGraphScanner: { scanWorkspace: () => scanPromise } as never,
    });

    const first = parseResult(await call(server, 'eh_build_graph'));
    const second = parseResult(await call(server, 'eh_build_graph'));
    expect(second.scanId).toBe(first.scanId);
    expect(second.note).toContain('already in progress');

    scanResolve({ filesProcessed: 0, filesSkipped: 0, nodesCreated: 0, edgesCreated: 0, durationMs: 1, filesMatched: 0 });
    await scanPromise;
  });

  it('eh_scan_status returns error for unknown scanId', async () => {
    const server = new McpServer({
      ...baseDeps(),
      scanRegistry: new ScanRegistry(),
      projectGraphScanner: { scanWorkspace: async () => ({ filesProcessed: 0, filesSkipped: 0, nodesCreated: 0, edgesCreated: 0, durationMs: 0, filesMatched: 0 } as ScanResult) } as never,
    });
    const res = parseResult(await call(server, 'eh_scan_status', { scan_id: 'does-not-exist' }));
    expect(res.error).toContain('Unknown scanId');
  });

  it('eh_build_graph returns error when scanner not wired', async () => {
    const server = new McpServer({ ...baseDeps(), scanRegistry: new ScanRegistry() });
    const res = parseResult(await call(server, 'eh_build_graph'));
    expect(res.error).toContain('scanner not available');
  });

  it('eh_build_graph returns error when scanRegistry not wired', async () => {
    const server = new McpServer({
      ...baseDeps(),
      projectGraphScanner: { scanWorkspace: async () => ({ filesProcessed: 0, filesSkipped: 0, nodesCreated: 0, edgesCreated: 0, durationMs: 0, filesMatched: 0 } as ScanResult) } as never,
    });
    const res = parseResult(await call(server, 'eh_build_graph'));
    expect(res.error).toContain('scan registry not wired');
  });
});

// ── Plan file sync tool surface ─────────────────────────────────────────────

describe('plan tool surface (file-backed)', () => {
  const PLAN = [
    '# Sync Plan',
    '- [ ] 1.1 Setup',
    '- [ ] 1.2 Build',
    '  - depends: 1.1',
    '- [ ] 1.3 Docs',
    '  - **Accept**: docs written',
    '',
  ].join('\n');

  type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  let tmp: string;
  let outside: string;
  let pbm: PlanBoardManager;
  let server: McpServer;
  let loaded: Array<[string, string]>;
  let closed: string[];
  const ws = vscode.workspace as unknown as { workspaceFolders: Array<{ uri: { fsPath: string } }> };
  const prevFolders = ws.workspaceFolders;

  async function t(name: string, args: Record<string, unknown>): Promise<Json> {
    const res = await server.handleRequest({ jsonrpc: '2.0', method: 'tools/call', params: { name, arguments: args }, id: 1 });
    if (res.error) return { __error: res.error.message };
    return JSON.parse((res.result as { content: Array<{ text: string }> }).content[0].text) as Json;
  }

  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'eh-mcp-ws-')));
    outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'eh-mcp-out-')));
    fs.mkdirSync(path.join(tmp, 'docs'));
    fs.writeFileSync(path.join(tmp, 'docs', 'plan.md'), PLAN);
    fs.writeFileSync(path.join(outside, 'plan.md'), PLAN);
    ws.workspaceFolders = [{ uri: { fsPath: tmp } }];
    pbm = new PlanBoardManager();
    loaded = [];
    closed = [];
    server = new McpServer({
      lockManager: new LockManager(100), agentStateManager: new AgentStateManager(), fileActivityTracker: new FileActivityTracker(),
      planBoardManager: pbm, messageQueue: new MessageQueue(), roleManager: new RoleManager(), agentProfiler: new AgentProfiler(),
      sharedKnowledge: new SharedKnowledgeStore(),
      onPlanLoaded: (id, abs) => { loaded.push([id, abs]); },
      onPlanClosed: (id) => { closed.push(id); },
    });
  });

  afterEach(() => {
    ws.workspaceFolders = prevFolders;
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('loads by relative path inside the workspace without content, compact response', async () => {
    const r = await t('eh_load_plan', { agent_id: 'orch', file_path: 'docs/plan.md' });
    expect(r.loaded).toBe(true);
    expect(r.watching).toBe(true);
    expect(r.taskCount).toBe(3);
    expect(r.tasks).toBeUndefined();
    expect(typeof r.revision).toBe('number');
    expect(r.counts.pending).toBe(2);
    expect(r.counts.blocked).toBe(1);
    expect(Object.keys(r).sort()).toEqual(['counts', 'loaded', 'name', 'plan_id', 'revision', 'taskCount', 'watching']);
    expect(loaded).toHaveLength(1);
    expect(loaded[0][0]).toBe(r.plan_id);
    expect(path.normalize(loaded[0][1]).toLowerCase()).toBe(path.join(tmp, 'docs', 'plan.md').toLowerCase());
    expect(pbm.getPlan(r.plan_id)!.orchestratorAgentId).toBe('orch');
  });

  it('rejects a path outside the workspace', async () => {
    const r = await t('eh_load_plan', { agent_id: 'orch', file_path: path.join(outside, 'plan.md') });
    expect(r.loaded).toBe(false);
    expect(r.error).toMatch(/outside/);
    const r2 = await t('eh_load_plan', { agent_id: 'orch', file_path: `../${path.basename(outside)}/plan.md` });
    expect(r2.loaded).toBe(false);
    expect(pbm.getAllPlans()).toHaveLength(0);
    expect(loaded).toHaveLength(0);
  });

  it('ignores content when file_path is given', async () => {
    const r = await t('eh_load_plan', { agent_id: 'orch', file_path: 'docs/plan.md', content: '# Other\n- [ ] 9.9 Nope' });
    expect(r.name).toBe('Sync Plan');
    expect(r.taskCount).toBe(3);
  });

  it('second load of the same path merges and preserves a claim', async () => {
    const first = await t('eh_load_plan', { agent_id: 'orch', file_path: 'docs/plan.md' });
    expect((await t('eh_claim_task', { agent_id: 'w1', task_id: '1.1' })).claimed).toBe(true);
    fs.writeFileSync(path.join(tmp, 'docs', 'plan.md'), PLAN + '- [ ] 1.4 Extra\n');
    const second = await t('eh_load_plan', { agent_id: 'orch', file_path: 'docs/plan.md' });
    expect(second.plan_id).toBe(first.plan_id);
    expect(second.merged).toBe(true);
    expect(second.diff.added).toEqual(['1.4']);
    expect(second.taskCount).toBe(4);
    const task = pbm.getPlan(first.plan_id)!.tasks.find((x) => x.id === '1.1')!;
    expect(task.status).toBe('claimed');
    expect(task.assignee).toBe('w1');
  });

  it('plan_id rebinds an inline plan to the file', async () => {
    const inline = await t('eh_load_plan', { agent_id: 'orch', content: PLAN });
    expect(inline.watching).toBe(false);
    await t('eh_claim_task', { agent_id: 'w1', task_id: '1.1', plan_id: inline.plan_id });
    const r = await t('eh_load_plan', { agent_id: 'orch', file_path: 'docs/plan.md', plan_id: inline.plan_id });
    expect(r.plan_id).toBe(inline.plan_id);
    expect(r.watching).toBe(true);
    const board = pbm.getPlan(inline.plan_id)!;
    expect(board.sourceFile).not.toBe('inline');
    expect(board.tasks.find((x) => x.id === '1.1')!.assignee).toBe('w1');
  });

  it('eh_get_plan default rows have exactly 5 keys; filters and fields work', async () => {
    await t('eh_load_plan', { agent_id: 'orch', file_path: 'docs/plan.md' });
    const r = await t('eh_get_plan', { agent_id: 'orch' });
    expect(r.tasks).toHaveLength(3);
    for (const row of r.tasks) {
      expect(Object.keys(row).sort()).toEqual(['assignee', 'blockedBy', 'id', 'status', 'title']);
    }
    const withFields = await t('eh_get_plan', { agent_id: 'orch', fields: ['acceptanceCriteria'], task_ids: ['1.3'] });
    expect(withFields.tasks).toHaveLength(1);
    expect(withFields.tasks[0].acceptanceCriteria).toBe('docs written');
    const byStatus = await t('eh_get_plan', { agent_id: 'orch', status: ['blocked'] });
    expect(byStatus.tasks.map((x: { id: string }) => x.id)).toEqual(['1.2']);
  });

  it('eh_get_plan since_revision returns only the delta', async () => {
    await t('eh_load_plan', { agent_id: 'orch', file_path: 'docs/plan.md' });
    const base = await t('eh_get_plan', { agent_id: 'orch' });
    const none = await t('eh_get_plan', { agent_id: 'orch', since_revision: base.revision });
    expect(none.unchanged).toBe(true);
    expect(none.tasks).toEqual([]);
    await t('eh_claim_task', { agent_id: 'w1', task_id: '1.3' });
    const delta = await t('eh_get_plan', { agent_id: 'orch', since_revision: base.revision });
    expect(delta.tasks.map((x: { id: string }) => x.id)).toEqual(['1.3']);
    expect(delta.revision).toBeGreaterThan(base.revision);
  });

  it('eh_get_task returns full detail', async () => {
    await t('eh_load_plan', { agent_id: 'orch', file_path: 'docs/plan.md' });
    const r = await t('eh_get_task', { agent_id: 'w1', task_id: '1.3' });
    expect(r.found).toBe(true);
    expect(r.task.acceptanceCriteria).toBe('docs written');
    expect(r.task.notesTruncated).toBe(0);
    const missing = await t('eh_get_task', { agent_id: 'w1', task_id: '9.9' });
    expect(missing.found).toBe(false);
  });

  it('eh_update_task batch updates several tasks and bumps revision once', async () => {
    await t('eh_load_plan', { agent_id: 'orch', file_path: 'docs/plan.md' });
    await t('eh_claim_task', { agent_id: 'w1', task_id: '1.1' });
    await t('eh_claim_task', { agent_id: 'w1', task_id: '1.3' });
    const before = pbm.getPlan()!.revision;
    const r = await t('eh_update_task', { agent_id: 'w1', task_ids: ['1.1', '1.3', '9.9'], status: 'in_progress' });
    expect(Object.keys(r).sort()).toEqual(['failed', 'revision', 'updated']);
    expect(r.updated).toEqual(['1.1', '1.3']);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0].id).toBe('9.9');
    expect(r.revision).toBe(before + 1);
  });

  it('eh_update_task requires task_id or task_ids', async () => {
    await t('eh_load_plan', { agent_id: 'orch', file_path: 'docs/plan.md' });
    const r = await t('eh_update_task', { agent_id: 'w1', status: 'done' });
    expect(r.__error).toMatch(/task_id/);
  });

  it('eh_cancel_task by a non-orchestrator is rejected', async () => {
    await t('eh_load_plan', { agent_id: 'orch', file_path: 'docs/plan.md' });
    const r = await t('eh_cancel_task', { agent_id: 'w1', task_id: '1.3', reason: 'nope' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/orchestrator/);
    expect(pbm.getPlan()!.tasks.find((x) => x.id === '1.3')).toBeDefined();
  });

  it('eh_cancel_task removes an unclaimed task immediately', async () => {
    await t('eh_load_plan', { agent_id: 'orch', file_path: 'docs/plan.md' });
    const r = await t('eh_cancel_task', { agent_id: 'orch', task_id: '1.3', reason: 'not needed' });
    expect(r).toEqual({ success: true, status: 'removed', assignee: null });
    expect(pbm.getPlan()!.tasks.find((x) => x.id === '1.3')).toBeUndefined();
  });

  it('aborted flow via MCP: cancel claimed task, assignee confirms, dependents unblock', async () => {
    await t('eh_load_plan', { agent_id: 'orch', file_path: 'docs/plan.md' });
    await t('eh_claim_task', { agent_id: 'w1', task_id: '1.1' });
    const c = await t('eh_cancel_task', { agent_id: 'orch', task_id: '1.1', reason: 'scope cut' });
    expect(c).toEqual({ success: true, status: 'cancelling', assignee: 'w1' });
    const refused = await t('eh_update_task', { agent_id: 'w1', task_id: '1.1', status: 'done' });
    expect(refused.updated).toEqual([]);
    const other = await t('eh_update_task', { agent_id: 'w2', task_id: '1.1', status: 'aborted' });
    expect(other.updated).toEqual([]);
    const ok = await t('eh_update_task', { agent_id: 'w1', task_id: '1.1', status: 'aborted' });
    expect(ok.updated).toEqual(['1.1']);
    const plan = await t('eh_get_plan', { agent_id: 'orch' });
    expect(plan.tasks.map((x: { id: string }) => x.id)).toEqual(['1.2', '1.3']);
    expect(plan.tasks.find((x: { id: string }) => x.id === '1.2').status).toBe('pending');
  });

  it('archive and delete fire onPlanClosed', async () => {
    const a = await t('eh_load_plan', { agent_id: 'orch', file_path: 'docs/plan.md' });
    expect((await t('eh_archive_plan', { agent_id: 'orch', plan_id: a.plan_id })).archived).toBe(true);
    expect((await t('eh_delete_plan', { agent_id: 'orch', plan_id: a.plan_id })).deleted).toBe(true);
    expect(closed).toEqual([a.plan_id, a.plan_id]);
    await t('eh_delete_plan', { agent_id: 'orch', plan_id: 'missing' });
    expect(closed).toHaveLength(2);
  });
});
