/**
 * Tests for eh_spawn_agent agent_type resolution.
 *
 * The server must fill in the orchestrator's own runtime type as the default
 * when agent_type is omitted, so an OpenCode orchestrator gets OpenCode
 * workers without having to know and pass its own type.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { McpServer, FileActivityTracker } from '../mcpServer.js';
import { LockManager } from '../lockManager.js';
import { AgentStateManager } from '@event-horizon/core';
import { PlanBoardManager } from '../planBoard.js';
import { MessageQueue } from '../messageQueue.js';
import { RoleManager } from '../roleManager.js';
import { AgentProfiler } from '../agentProfiler.js';
import { SharedKnowledgeStore } from '../sharedKnowledge.js';
import type { SpawnOpts, SpawnResult } from '../spawnRegistry.js';

/** Minimal fake spawnRegistry that records calls. */
function makeSpawnRegistry() {
  const calls: Array<{ type: string; opts: SpawnOpts }> = [];
  return {
    calls,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registry: {
      async spawn(type: string, opts: SpawnOpts): Promise<SpawnResult> {
        calls.push({ type, opts });
        return { agentId: 'worker-1', type, status: 'spawned', message: 'test', terminalName: 'test' };
      },
      async stop() { return { stopped: true, message: 'test' }; },
      async getAvailableTypes() { return ['claude-code', 'opencode', 'cursor']; },
      getSpawnedAgents() { return new Map(); },
      getSpawnedAgent() { return undefined; },
      trackAgent() { /* no-op */ },
      untrackAgent() { /* no-op */ },
      getTerminal() { return undefined; },
      findTerminalForAgent() { return undefined; },
    } as any,
  };
}

type AgentTypeForTest = 'claude-code' | 'opencode' | 'cursor' | 'copilot' | 'unknown';

function setup(orchestratorType?: AgentTypeForTest) {
  const lockManager = new LockManager(100);
  const agentStateManager = new AgentStateManager();
  const planBoardManager = new PlanBoardManager();
  const spawn = makeSpawnRegistry();

  const mcp = new McpServer({
    lockManager,
    agentStateManager,
    fileActivityTracker: new FileActivityTracker(),
    planBoardManager,
    messageQueue: new MessageQueue(),
    roleManager: new RoleManager(),
    agentProfiler: new AgentProfiler(),
    sharedKnowledge: new SharedKnowledgeStore(),
    spawnRegistry: spawn.registry,
    syncSkills: async () => ({ synced: true }),
  });

  // Load a plan so the orchestrator can claim it
  planBoardManager.loadPlan('# Test Plan\n\n- [ ] 1.1 Test task [role: implementer]\n  - **Do**: x\n  - **Accept**: y\n  - **Verify**: z\n', 'test-plan.md');

  // Register orchestrator in agent state manager with the desired runtime type
  if (orchestratorType) {
    agentStateManager.apply({
      id: 'test-event-1',
      type: 'agent.spawn',
      agentId: 'orchestrator-1',
      agentName: 'test-orchestrator',
      agentType: orchestratorType,
      timestamp: Date.now(),
      payload: {},
    });
  }

  // Claim orchestrator
  planBoardManager.claimOrchestrator('orchestrator-1');

  return { mcp, spawn };
}

async function callSpawn(mcp: McpServer, args: Record<string, unknown>) {
  return mcp.handleRequest({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'eh_spawn_agent', arguments: args },
  });
}

describe('eh_spawn_agent — agent_type resolution', () => {
  let mcp: McpServer;
  let spawn: ReturnType<typeof makeSpawnRegistry>;

  beforeEach(() => {
    const harness = setup('opencode');
    mcp = harness.mcp;
    spawn = harness.spawn;
  });

  it('defaults worker agent_type to the orchestrator\'s own runtime when omitted', async () => {
    await callSpawn(mcp, {
      agent_id: 'orchestrator-1',
      prompt: 'hello',
    });
    expect(spawn.calls).toHaveLength(1);
    expect(spawn.calls[0].type).toBe('opencode');
  });

  it('honors explicit agent_type override (user --agent flag)', async () => {
    await callSpawn(mcp, {
      agent_id: 'orchestrator-1',
      agent_type: 'claude-code',
      prompt: 'hello',
    });
    expect(spawn.calls).toHaveLength(1);
    expect(spawn.calls[0].type).toBe('claude-code');
  });

  it('treats empty-string agent_type the same as omitted', async () => {
    await callSpawn(mcp, {
      agent_id: 'orchestrator-1',
      agent_type: '   ',
      prompt: 'hello',
    });
    expect(spawn.calls).toHaveLength(1);
    expect(spawn.calls[0].type).toBe('opencode');
  });

  it('returns an informative error when the orchestrator is unregistered and no agent_type is given', async () => {
    // New harness without registering the orchestrator
    const lockManager = new LockManager(100);
    const agentStateManager = new AgentStateManager();
    const planBoardManager = new PlanBoardManager();
    const s = makeSpawnRegistry();
    const m = new McpServer({
      lockManager,
      agentStateManager,
      fileActivityTracker: new FileActivityTracker(),
      planBoardManager,
      messageQueue: new MessageQueue(),
      roleManager: new RoleManager(),
      agentProfiler: new AgentProfiler(),
      sharedKnowledge: new SharedKnowledgeStore(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      spawnRegistry: s.registry as any,
      syncSkills: async () => ({ synced: true }),
    });
    planBoardManager.loadPlan('# Plan\n- [ ] 1.1 x [role: tester]\n', 'p.md');
    planBoardManager.claimOrchestrator('orchestrator-1');

    const res = await m.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'eh_spawn_agent', arguments: { agent_id: 'orchestrator-1', prompt: 'hello' } },
    });
    // Tool errors come back as result.content text with isError=true or a direct error
    const err = (res.result as { content?: Array<{ text: string }>; isError?: boolean })?.content?.[0]?.text ?? JSON.stringify(res);
    expect(err).toMatch(/agent_type could not be resolved/i);
    expect(s.calls).toHaveLength(0);
  });

  it('returns an informative error when orchestrator type is literal "unknown"', async () => {
    const harness = setup('unknown');
    const res = await callSpawn(harness.mcp, {
      agent_id: 'orchestrator-1',
      prompt: 'hello',
    });
    const err = (res.result as { content?: Array<{ text: string }> })?.content?.[0]?.text ?? JSON.stringify(res);
    expect(err).toMatch(/agent_type could not be resolved/i);
    expect(harness.spawn.calls).toHaveLength(0);
  });
});
