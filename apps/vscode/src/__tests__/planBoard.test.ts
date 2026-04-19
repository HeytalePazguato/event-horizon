/**
 * Plan Board tests — markdown parser, task claiming, dependency resolution, MCP tool integration.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { parsePlanMarkdown, PlanBoardManager } from '../planBoard.js';
import { McpServer, FileActivityTracker } from '../mcpServer.js';
import { LockManager } from '../lockManager.js';
import { AgentStateManager } from '@event-horizon/core';
import { MessageQueue } from '../messageQueue.js';
import { RoleManager } from '../roleManager.js';
import { AgentProfiler } from '../agentProfiler.js';
import { SharedKnowledgeStore } from '../sharedKnowledge.js';

// ── Markdown Parser ─────────────────────────────────────────────────────────

describe('parsePlanMarkdown', () => {
  it('extracts plan title from H1', () => {
    const md = '# My Great Plan\n\n- [ ] 1.1 Do something';
    const plan = parsePlanMarkdown(md, 'plan.md');
    expect(plan.name).toBe('My Great Plan');
    expect(plan.sourceFile).toBe('plan.md');
  });

  it('defaults to "Untitled Plan" when no H1', () => {
    const md = '- [ ] 1.1 Do something';
    const plan = parsePlanMarkdown(md, 'plan.md');
    expect(plan.name).toBe('Untitled Plan');
  });

  it('parses numbered task IDs and titles', () => {
    const md = `# Plan
- [ ] 1.1 First task
- [ ] 1.2 Second task
- [ ] 2.1 Third task`;
    const plan = parsePlanMarkdown(md, 'plan.md');
    expect(plan.tasks).toHaveLength(3);
    expect(plan.tasks[0]).toMatchObject({ id: '1.1', title: 'First task', status: 'pending' });
    expect(plan.tasks[1]).toMatchObject({ id: '1.2', title: 'Second task' });
    expect(plan.tasks[2]).toMatchObject({ id: '2.1', title: 'Third task' });
  });

  it('parses dotted IDs with letter suffixes (e.g. 13.3a)', () => {
    const md = `# Plan
- [ ] 13.3a Load plan tool
- [ ] 13.3b Get plan tool`;
    const plan = parsePlanMarkdown(md, 'plan.md');
    expect(plan.tasks[0].id).toBe('13.3a');
    expect(plan.tasks[1].id).toBe('13.3b');
  });

  it('generates slug IDs for unnumbered tasks', () => {
    const md = '# Plan\n- [ ] Do the important thing';
    const plan = parsePlanMarkdown(md, 'plan.md');
    expect(plan.tasks[0].id).toBe('do-the-important-thing');
    expect(plan.tasks[0].title).toBe('Do the important thing');
  });

  it('marks [x] tasks as done', () => {
    const md = '# Plan\n- [x] 1.1 Already done';
    const plan = parsePlanMarkdown(md, 'plan.md');
    expect(plan.tasks[0].status).toBe('done');
    expect(plan.tasks[0].completedAt).toBeTypeOf('number');
  });

  it('parses dependencies from "depends:" lines', () => {
    const md = `# Plan
- [ ] 1.1 Base task
- [ ] 1.2 Dependent task
  - depends: 1.1`;
    const plan = parsePlanMarkdown(md, 'plan.md');
    expect(plan.tasks[1].blockedBy).toEqual(['1.1']);
  });

  it('parses multiple dependencies', () => {
    const md = `# Plan
- [x] 1.1 Done
- [x] 1.2 Also done
- [ ] 2.1 Needs both
  - depends: 1.1, 1.2`;
    const plan = parsePlanMarkdown(md, 'plan.md');
    expect(plan.tasks[2].blockedBy).toEqual(['1.1', '1.2']);
    // Both deps are done, so task should be pending (not blocked)
    expect(plan.tasks[2].status).toBe('pending');
  });

  it('marks tasks as blocked when dependencies are incomplete', () => {
    const md = `# Plan
- [ ] 1.1 Not done yet
- [ ] 1.2 Waiting for 1.1
  - depends: 1.1`;
    const plan = parsePlanMarkdown(md, 'plan.md');
    expect(plan.tasks[1].status).toBe('blocked');
  });

  it('strips HTML comments from titles', () => {
    const md = '# Plan\n- [ ] 1.1 Task title <!-- becomes task -->';
    const plan = parsePlanMarkdown(md, 'plan.md');
    expect(plan.tasks[0].title).toBe('Task title');
  });

  it('parses acceptance criteria from **Accept** lines', () => {
    const md = `# Plan
- [ ] 1.1 Build auth module
  - **Accept**: All existing tests pass and new auth routes respond with correct status codes.
  - **Verify**: \`pnpm test -- --grep "auth"\``;
    const plan = parsePlanMarkdown(md, 'plan.md');
    expect(plan.tasks[0].acceptanceCriteria).toBe('All existing tests pass and new auth routes respond with correct status codes.');
    expect(plan.tasks[0].verifyCommand).toBe('pnpm test -- --grep "auth"');
  });

  it('parses complexity and modelTier from HTML comments', () => {
    const md = `# Plan
- [ ] 1.1 Simple fix
  <!-- complexity: low -->
  <!-- model: haiku -->`;
    const plan = parsePlanMarkdown(md, 'plan.md');
    expect(plan.tasks[0].complexity).toBe('low');
    expect(plan.tasks[0].modelTier).toBe('haiku');
  });

  it('defaults new fields to null when not present', () => {
    const md = `# Plan
- [ ] 1.1 Basic task`;
    const plan = parsePlanMarkdown(md, 'plan.md');
    expect(plan.tasks[0].acceptanceCriteria).toBeNull();
    expect(plan.tasks[0].verifyCommand).toBeNull();
    expect(plan.tasks[0].complexity).toBeNull();
    expect(plan.tasks[0].modelTier).toBeNull();
    expect(plan.tasks[0].verificationStatus).toBeNull();
  });

  it('parses all new fields together', () => {
    const md = `# Plan
- [ ] 2.1 Implement feature [role: implementer]
  - depends: 1.1
  - **Accept**: Feature works end-to-end with no regressions.
  - **Verify**: \`pnpm test && pnpm build\`
  <!-- complexity: high -->
  <!-- model: opus -->`;
    const plan = parsePlanMarkdown(md, 'plan.md');
    const task = plan.tasks[0];
    expect(task.role).toBe('implementer');
    expect(task.blockedBy).toEqual(['1.1']);
    expect(task.acceptanceCriteria).toBe('Feature works end-to-end with no regressions.');
    expect(task.verifyCommand).toBe('pnpm test && pnpm build');
    expect(task.complexity).toBe('high');
    expect(task.modelTier).toBe('opus');
  });

  it('parses a realistic plan with sections', () => {
    const md = `# Event Horizon v2.0

## Phase A — Quick Wins
- [x] 4.2.1 Extract LockManager from eventServer.ts
- [x] 8.6.2 Extract shared formatters

## Phase B — MCP Server
- [ ] 3.1.1 MCP protocol handler
  - depends: 4.2.1
- [ ] 3.1.2 Six MCP tools
  - depends: 3.1.1`;
    const plan = parsePlanMarkdown(md, 'plan.md');
    expect(plan.name).toBe('Event Horizon v2.0');
    expect(plan.tasks).toHaveLength(4);
    expect(plan.tasks[0].status).toBe('done');
    expect(plan.tasks[1].status).toBe('done');
    // 3.1.1 depends on 4.2.1 which is done → pending
    expect(plan.tasks[2].status).toBe('pending');
    // 3.1.2 depends on 3.1.1 which is NOT done → blocked
    expect(plan.tasks[3].status).toBe('blocked');
  });
});

// ── PlanBoardManager ────────────────────────────────────────────────────────

describe('PlanBoardManager', () => {
  let manager: PlanBoardManager;

  const simplePlan = `# Test Plan
- [ ] 1.1 First task
- [ ] 1.2 Second task
  - depends: 1.1
- [ ] 1.3 Third task`;

  beforeEach(() => {
    manager = new PlanBoardManager();
  });

  describe('loadPlan', () => {
    it('loads and returns a plan', () => {
      const plan = manager.loadPlan(simplePlan, 'test.md');
      expect(plan.name).toBe('Test Plan');
      expect(plan.tasks).toHaveLength(3);
    });

    it('replaces any existing plan', () => {
      manager.loadPlan(simplePlan, 'test.md');
      const plan2 = manager.loadPlan('# Other\n- [ ] 2.1 New task', 'other.md');
      expect(manager.getPlan()!.name).toBe('Other');
      expect(plan2.tasks).toHaveLength(1);
    });
  });

  describe('getPlan', () => {
    it('returns null when no plan loaded', () => {
      expect(manager.getPlan()).toBeNull();
    });

    it('returns the loaded plan', () => {
      manager.loadPlan(simplePlan, 'test.md');
      expect(manager.getPlan()!.name).toBe('Test Plan');
    });
  });

  describe('claimTask', () => {
    beforeEach(() => {
      manager.loadPlan(simplePlan, 'test.md');
    });

    it('claims a pending task', () => {
      const result = manager.claimTask('1.1', 'agent-a', 'Agent A');
      expect(result.success).toBe(true);
      expect(result.task!.status).toBe('claimed');
      expect(result.task!.assignee).toBe('agent-a');
      expect(result.task!.assigneeName).toBe('Agent A');
      expect(result.task!.claimedAt).toBeTypeOf('number');
    });

    it('rejects claiming a blocked task', () => {
      const result = manager.claimTask('1.2', 'agent-a', 'Agent A');
      expect(result.success).toBe(false);
      expect(result.error).toContain('blocked');
    });

    it('rejects claiming a task already owned by another agent', () => {
      manager.claimTask('1.1', 'agent-a', 'Agent A');
      const result = manager.claimTask('1.1', 'agent-b', 'Agent B');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Agent A');
    });

    it('allows same agent to re-claim (idempotent)', () => {
      manager.claimTask('1.1', 'agent-a', 'Agent A');
      const result = manager.claimTask('1.1', 'agent-a', 'Agent A');
      expect(result.success).toBe(true);
    });

    it('rejects claiming a done task', () => {
      manager.claimTask('1.1', 'agent-a');
      manager.updateTask('1.1', 'agent-a', 'done');
      const result = manager.claimTask('1.1', 'agent-b');
      expect(result.success).toBe(false);
      expect(result.error).toContain('already done');
    });

    it('allows re-claiming a failed task', () => {
      manager.claimTask('1.1', 'agent-a');
      manager.updateTask('1.1', 'agent-a', 'failed');
      const result = manager.claimTask('1.1', 'agent-b', 'Agent B');
      expect(result.success).toBe(true);
      expect(result.task!.assignee).toBe('agent-b');
    });

    it('fails when no plan is loaded', () => {
      manager.clear();
      const result = manager.claimTask('1.1', 'agent-a');
      expect(result.success).toBe(false);
      expect(result.error).toContain('No plan');
    });

    it('fails for non-existent task', () => {
      const result = manager.claimTask('99.99', 'agent-a');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('updateTask', () => {
    beforeEach(() => {
      manager.loadPlan(simplePlan, 'test.md');
      manager.claimTask('1.1', 'agent-a', 'Agent A');
    });

    it('updates task to in_progress', () => {
      const result = manager.updateTask('1.1', 'agent-a', 'in_progress');
      expect(result.success).toBe(true);
      expect(result.task!.status).toBe('in_progress');
    });

    it('marks task as done', () => {
      const result = manager.updateTask('1.1', 'agent-a', 'done');
      expect(result.success).toBe(true);
      expect(result.task!.status).toBe('done');
      expect(result.task!.completedAt).toBeTypeOf('number');
    });

    it('adds a note', () => {
      const result = manager.updateTask('1.1', 'agent-a', 'in_progress', 'Working on it', 'Agent A');
      expect(result.success).toBe(true);
      expect(result.task!.notes).toHaveLength(1);
      expect(result.task!.notes[0]).toMatchObject({
        agentId: 'agent-a',
        agentName: 'Agent A',
        text: 'Working on it',
      });
    });

    it('rejects update from non-owner', () => {
      const result = manager.updateTask('1.1', 'agent-b', 'done');
      expect(result.success).toBe(false);
      expect(result.error).toContain('owned by');
    });

    it('unblocks dependents when task completes', () => {
      // 1.2 depends on 1.1 and should be blocked
      expect(manager.getPlan()!.tasks[1].status).toBe('blocked');
      // Complete 1.1
      manager.updateTask('1.1', 'agent-a', 'done');
      // 1.2 should now be pending
      expect(manager.getPlan()!.tasks[1].status).toBe('pending');
    });

    it('auto-assigns unclaimed tasks on in_progress update', () => {
      const result = manager.updateTask('1.3', 'agent-b', 'in_progress', undefined, 'Agent B');
      expect(result.success).toBe(true);
      expect(result.task!.assignee).toBe('agent-b');
      expect(result.task!.assigneeName).toBe('Agent B');
    });

    it('fails when no plan loaded', () => {
      manager.clear();
      const result = manager.updateTask('1.1', 'agent-a', 'done');
      expect(result.success).toBe(false);
    });
  });

  describe('clear', () => {
    it('removes the loaded plan', () => {
      manager.loadPlan(simplePlan, 'test.md');
      manager.clear();
      expect(manager.getPlan()).toBeNull();
    });
  });
});

// ── MCP Tool Integration ────────────────────────────────────────────────────

describe('Plan MCP tools', () => {
  let mcp: McpServer;
  let planBoardManager: PlanBoardManager;

  const planMarkdown = `# Integration Test Plan
- [ ] 1.1 Setup project
- [ ] 1.2 Build feature
  - depends: 1.1
- [ ] 1.3 Write tests`;

  beforeEach(() => {
    const lockManager = new LockManager(100);
    lockManager.setEnabled(true);
    const agentStateManager = new AgentStateManager();
    const fileActivityTracker = new FileActivityTracker();
    planBoardManager = new PlanBoardManager();
    mcp = new McpServer({ lockManager, agentStateManager, fileActivityTracker, planBoardManager, messageQueue: new MessageQueue(), roleManager: new RoleManager(), agentProfiler: new AgentProfiler(), sharedKnowledge: new SharedKnowledgeStore() });
  });

  function rpc(method: string, params?: Record<string, unknown>, id: number | string = 1) {
    return mcp.handleRequest({ jsonrpc: '2.0', method, params, id });
  }

  function callTool(name: string, args: Record<string, unknown>) {
    return rpc('tools/call', { name, arguments: args });
  }

  function parseResult(res: { result?: unknown }): unknown {
    const content = (res.result as { content: Array<{ text: string }> }).content[0];
    return JSON.parse(content.text);
  }

  it('tools/list includes plan tools', async () => {
    const res = await rpc('tools/list');
    const result = res.result as { tools: Array<{ name: string }> };
    const names = result.tools.map((t) => t.name);
    expect(names).toContain('eh_load_plan');
    expect(names).toContain('eh_get_plan');
    expect(names).toContain('eh_claim_task');
    expect(names).toContain('eh_update_task');
    expect(result.tools).toHaveLength(43); // 6 lock + 7 plan + 1 verify + 2 messaging + 4 roles + 6 phase1 + 8 phase2 + 5 phase3 + 1 phase4 (traces) + 1 eh_search_events (CIP phase 4) + 1 eh_purge_stale_agents
  });

  describe('eh_load_plan', () => {
    it('loads a plan from content', async () => {
      const res = await callTool('eh_load_plan', { agent_id: 'a1', content: planMarkdown });
      const parsed = parseResult(res) as Record<string, unknown>;
      expect(parsed).toMatchObject({
        loaded: true,
        name: 'Integration Test Plan',
        taskCount: 3,
      });
      expect((parsed.tasks as unknown[]).length).toBe(3);
    });

    it('fails without content or file_path', async () => {
      const res = await callTool('eh_load_plan', { agent_id: 'a1' });
      expect(res.error).toBeDefined();
    });
  });

  describe('eh_get_plan', () => {
    it('returns not-loaded when no plan exists', async () => {
      const res = await callTool('eh_get_plan', { agent_id: 'a1' });
      const parsed = parseResult(res) as Record<string, unknown>;
      expect(parsed).toMatchObject({ loaded: false });
    });

    it('returns full plan after loading', async () => {
      await callTool('eh_load_plan', { agent_id: 'a1', content: planMarkdown });
      const res = await callTool('eh_get_plan', { agent_id: 'a1' });
      const parsed = parseResult(res) as Record<string, unknown>;
      expect(parsed).toMatchObject({ loaded: true, name: 'Integration Test Plan' });
      expect((parsed.tasks as unknown[]).length).toBe(3);
    });
  });

  describe('eh_claim_task', () => {
    beforeEach(async () => {
      await callTool('eh_load_plan', { agent_id: 'a1', content: planMarkdown });
    });

    it('claims a pending task', async () => {
      const res = await callTool('eh_claim_task', { task_id: '1.1', agent_id: 'a1', agent_name: 'Alpha' });
      const parsed = parseResult(res) as Record<string, unknown>;
      expect(parsed).toMatchObject({ claimed: true, task: { id: '1.1', status: 'claimed' } });
    });

    it('rejects claiming blocked task', async () => {
      const res = await callTool('eh_claim_task', { task_id: '1.2', agent_id: 'a1' });
      const parsed = parseResult(res) as Record<string, unknown>;
      expect(parsed).toMatchObject({ claimed: false });
      expect((parsed as { error: string }).error).toContain('blocked');
    });

    it('rejects when already claimed by another', async () => {
      await callTool('eh_claim_task', { task_id: '1.1', agent_id: 'a1' });
      const res = await callTool('eh_claim_task', { task_id: '1.1', agent_id: 'a2' });
      const parsed = parseResult(res) as Record<string, unknown>;
      expect(parsed).toMatchObject({ claimed: false });
    });

    it('requires agent_type when task_id is omitted (auto-select)', async () => {
      await callTool('eh_load_plan', { agent_id: 'a1', content: planMarkdown });
      const res = await callTool('eh_claim_task', { agent_id: 'a1' });
      expect(res.error).toBeDefined();
      expect(res.error!.code).toBe(-32000);
      expect(res.error!.message).toContain('agent_type');
    });
  });

  describe('eh_update_task', () => {
    beforeEach(async () => {
      await callTool('eh_load_plan', { agent_id: 'a1', content: planMarkdown });
      await callTool('eh_claim_task', { task_id: '1.1', agent_id: 'a1', agent_name: 'Alpha' });
    });

    it('updates task to in_progress', async () => {
      const res = await callTool('eh_update_task', { task_id: '1.1', agent_id: 'a1', status: 'in_progress' });
      const parsed = parseResult(res) as Record<string, unknown>;
      expect(parsed).toMatchObject({ updated: true, task: { status: 'in_progress' } });
    });

    it('marks task done and unblocks dependents', async () => {
      const res = await callTool('eh_update_task', { task_id: '1.1', agent_id: 'a1', status: 'done' });
      const parsed = parseResult(res) as Record<string, unknown>;
      expect(parsed).toMatchObject({ updated: true, task: { status: 'done' } });

      // 1.2 should now be unblocked
      const planRes = await callTool('eh_get_plan', { agent_id: 'a1' });
      const plan = parseResult(planRes) as { tasks: Array<{ id: string; status: string }> };
      const task12 = plan.tasks.find((t) => t.id === '1.2');
      expect(task12!.status).toBe('pending');
    });

    it('adds a note', async () => {
      await callTool('eh_update_task', {
        task_id: '1.1', agent_id: 'a1', status: 'in_progress',
        note: 'Refactored the module', agent_name: 'Alpha',
      });
      const planRes = await callTool('eh_get_plan', { agent_id: 'a1' });
      const plan = parseResult(planRes) as { tasks: Array<{ id: string; notes: Array<{ text: string }> }> };
      const task = plan.tasks.find((t) => t.id === '1.1');
      expect(task!.notes).toHaveLength(1);
      expect(task!.notes[0].text).toBe('Refactored the module');
    });

    it('rejects invalid status', async () => {
      const res = await callTool('eh_update_task', { task_id: '1.1', agent_id: 'a1', status: 'bogus' });
      expect(res.error).toBeDefined();
    });

    it('rejects update from non-owner', async () => {
      const res = await callTool('eh_update_task', { task_id: '1.1', agent_id: 'a2', status: 'done' });
      const parsed = parseResult(res) as Record<string, unknown>;
      expect(parsed).toMatchObject({ updated: false });
    });
  });

  describe('eh_verify_task', () => {
    const verifyPlan = `# Verify Plan
- [ ] 1.1 Task with verify
  - **Accept**: Output says hello
  - **Verify**: \`echo hello\`
- [ ] 1.2 Task without verify`;

    beforeEach(async () => {
      await callTool('eh_load_plan', { agent_id: 'a1', content: verifyPlan });
      await callTool('eh_claim_task', { task_id: '1.1', agent_id: 'a1' });
      await callTool('eh_claim_task', { task_id: '1.2', agent_id: 'a1' });
    });

    it('rejects verification of non-done task', async () => {
      const res = await callTool('eh_verify_task', { task_id: '1.1', agent_id: 'a1' });
      const parsed = parseResult(res) as Record<string, unknown>;
      expect(parsed).toMatchObject({ verified: false });
      expect((parsed as { error: string }).error).toContain('not done');
    });

    it('auto-passes task with no verify command', async () => {
      await callTool('eh_update_task', { task_id: '1.2', agent_id: 'a1', status: 'done' });
      const res = await callTool('eh_verify_task', { task_id: '1.2', agent_id: 'a1' });
      const parsed = parseResult(res) as Record<string, unknown>;
      expect(parsed).toMatchObject({ verified: true, verificationStatus: 'passed' });
    });

    it('runs verify command and returns result', async () => {
      await callTool('eh_update_task', { task_id: '1.1', agent_id: 'a1', status: 'done' });
      const res = await callTool('eh_verify_task', { task_id: '1.1', agent_id: 'a1' });
      const parsed = parseResult(res) as Record<string, unknown>;
      expect(parsed).toMatchObject({ verified: true, exitCode: 0, verificationStatus: 'passed' });
      expect((parsed as { output: string }).output).toContain('hello');
    });
  });

  describe('full workflow', () => {
    it('two agents claim and complete tasks in parallel', async () => {
      await callTool('eh_load_plan', { agent_id: 'a1', content: planMarkdown });

      // Agent A claims 1.1, Agent B claims 1.3
      const claimA = await callTool('eh_claim_task', { task_id: '1.1', agent_id: 'a1', agent_name: 'Alpha' });
      const claimB = await callTool('eh_claim_task', { task_id: '1.3', agent_id: 'a2', agent_name: 'Beta' });
      expect(parseResult(claimA)).toMatchObject({ claimed: true });
      expect(parseResult(claimB)).toMatchObject({ claimed: true });

      // Agent A completes 1.1
      await callTool('eh_update_task', { task_id: '1.1', agent_id: 'a1', status: 'done' });

      // Now 1.2 is unblocked — Agent A claims it
      const claimA2 = await callTool('eh_claim_task', { task_id: '1.2', agent_id: 'a1', agent_name: 'Alpha' });
      expect(parseResult(claimA2)).toMatchObject({ claimed: true });

      // Agent B completes 1.3
      await callTool('eh_update_task', { task_id: '1.3', agent_id: 'a2', status: 'done' });

      // Final plan state
      const planRes = await callTool('eh_get_plan', { agent_id: 'a1' });
      const plan = parseResult(planRes) as { tasks: Array<{ id: string; status: string; assignee: string | null }> };
      expect(plan.tasks.find((t) => t.id === '1.1')!.status).toBe('done');
      expect(plan.tasks.find((t) => t.id === '1.2')!.status).toBe('claimed');
      expect(plan.tasks.find((t) => t.id === '1.2')!.assignee).toBe('Alpha');
      expect(plan.tasks.find((t) => t.id === '1.3')!.status).toBe('done');
    });
  });
});

// ── Orchestrator map helpers ────────────────────────────────────────────────

describe('PlanBoardManager — orchestrator helpers', () => {
  let manager: PlanBoardManager;

  beforeEach(() => {
    manager = new PlanBoardManager();
  });

  it('getOrchestratorMap returns empty object when no plans loaded', () => {
    expect(manager.getOrchestratorMap()).toEqual({});
  });

  it('getOrchestratorMap excludes plans without an orchestrator', () => {
    manager.loadPlan('# A\n- [ ] 1.1 task', 'a.md');
    expect(manager.getOrchestratorMap()).toEqual({});
  });

  it('getOrchestratorMap maps planId → orchestratorAgentId across multiple plans', () => {
    manager.loadPlan('# A\n- [ ] 1.1 task', 'a.md', 'agent-a');
    manager.loadPlan('# B\n- [ ] 1.1 task', 'b.md', 'agent-b');
    manager.loadPlan('# C\n- [ ] 1.1 task', 'c.md');
    const map = manager.getOrchestratorMap();
    expect(map).toEqual({ a: 'agent-a', b: 'agent-b' });
  });

  it('getAllOrchestratorAgentIds returns empty set when no plans loaded', () => {
    expect(manager.getAllOrchestratorAgentIds().size).toBe(0);
  });

  it('getAllOrchestratorAgentIds returns unique set of agents across plans', () => {
    manager.loadPlan('# A\n- [ ] 1.1 task', 'a.md', 'agent-a');
    manager.loadPlan('# B\n- [ ] 1.1 task', 'b.md', 'agent-a');
    manager.loadPlan('# C\n- [ ] 1.1 task', 'c.md', 'agent-b');
    const ids = manager.getAllOrchestratorAgentIds();
    expect(ids.size).toBe(2);
    expect(ids.has('agent-a')).toBe(true);
    expect(ids.has('agent-b')).toBe(true);
  });
});
