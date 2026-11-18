/**
 * Plan Board tests — markdown parser, task claiming, dependency resolution, MCP tool integration.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
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

  // ── Plan file sync (task 2.3) ──────────────────────────────────────────────

  describe('loadOrMergePlan (merge-on-reload)', () => {
    it('reload of the same file merges and preserves claims and notes', () => {
      const first = manager.loadPlan(simplePlan, '/ws/plan.md', 'orch');
      manager.claimTask('1.1', 'agent-a', 'Agent A');
      manager.updateTask('1.1', 'agent-a', 'in_progress', 'started');
      const edited = simplePlan.replace('First task', 'First task (renamed)') + '\n- [ ] 1.4 Fourth task';

      const res = manager.loadOrMergePlan(edited, '/ws/plan.md', 'someone-else');
      expect(res.applied).toBe(true);
      expect(res.diff).not.toBeNull();
      expect(res.diff!.added).toEqual(['1.4']);
      expect(res.diff!.updated).toEqual(['1.1']);
      expect(res.board.id).toBe(first.id);
      expect(res.board.orchestratorAgentId).toBe('orch');
      const t11 = res.board.tasks.find((t) => t.id === '1.1')!;
      expect(t11.title).toBe('First task (renamed)');
      expect(t11.status).toBe('in_progress');
      expect(t11.assignee).toBe('agent-a');
      expect(t11.notes).toHaveLength(1);
      expect(manager.getAllPlans()).toHaveLength(1);
      expect(manager.getPlan(first.id)).toBe(res.board);
    });

    it('bumps the revision once and stamps added/updated tasks', () => {
      const first = manager.loadPlan(simplePlan, '/ws/plan.md');
      const rev = first.revision;
      const res = manager.loadOrMergePlan(simplePlan + '\n- [ ] 1.4 Fourth', '/ws/plan.md');
      expect(res.board.revision).toBe(rev + 1);
      expect(res.board.tasks.find((t) => t.id === '1.4')!.changedAtRevision).toBe(rev + 1);
      expect(res.board.tasks.find((t) => t.id === '1.3')!.changedAtRevision).toBe(1);
    });

    it('matches source files after path normalization', () => {
      const first = manager.loadPlan(simplePlan, '/ws/sub/../plan.md');
      const res = manager.loadOrMergePlan(simplePlan, '/ws/plan.md');
      expect(res.diff).not.toBeNull();
      expect(res.board.id).toBe(first.id);
      if (process.platform === 'win32') {
        const res2 = manager.loadOrMergePlan(simplePlan, '/WS/PLAN.md');
        expect(res2.diff).not.toBeNull();
      }
    });

    it('never merges inline plans (loads fresh)', () => {
      manager.loadPlan(simplePlan, 'inline');
      manager.claimTask('1.1', 'agent-a');
      const res = manager.loadOrMergePlan(simplePlan, 'inline');
      expect(res.diff).toBeNull();
      expect(res.board.tasks[0].status).toBe('pending');
    });

    it('refused merge (renumber) leaves the live board intact', () => {
      const first = manager.loadPlan(simplePlan, '/ws/plan.md');
      const rev = first.revision;
      const res = manager.loadOrMergePlan('# Test Plan\n- [ ] 9.1 A\n- [ ] 9.2 B\n- [ ] 9.3 C', '/ws/plan.md');
      expect(res.applied).toBe(false);
      expect(res.diff!.renumberSuspected).toBe(true);
      expect(manager.getPlan(first.id)!.tasks.map((t) => t.id)).toEqual(['1.1', '1.2', '1.3']);
      expect(manager.getPlan(first.id)!.revision).toBe(rev);
    });
  });

  describe('rebindPlan', () => {
    it('merges into an inline plan and binds it to the file', () => {
      const inline = manager.loadPlan(simplePlan, 'inline');
      manager.claimTask('1.1', 'agent-a');
      const res = manager.rebindPlan(inline.id, simplePlan + '\n- [ ] 1.4 Fourth', '/ws/plan.md');
      expect(res.success).toBe(true);
      expect(res.applied).toBe(true);
      const board = manager.getPlan(inline.id)!;
      expect(board.sourceFile).toBe('/ws/plan.md');
      expect(board.tasks.find((t) => t.id === '1.1')!.assignee).toBe('agent-a');
      expect(board.tasks).toHaveLength(4);
      // later loads by path now merge into the same board
      const again = manager.loadOrMergePlan(simplePlan + '\n- [ ] 1.4 Fourth', '/ws/plan.md');
      expect(again.board.id).toBe(inline.id);
      expect(again.diff).not.toBeNull();
    });

    it('rejects rebinding a file-backed plan', () => {
      const b = manager.loadPlan(simplePlan, '/ws/plan.md');
      expect(manager.rebindPlan(b.id, simplePlan, '/ws/other.md').success).toBe(false);
    });
  });

  describe('applyFileChange', () => {
    let planId: string;
    beforeEach(() => {
      planId = manager.loadPlan(simplePlan, '/ws/plan.md', 'orch').id;
      manager.claimTask('1.1', 'agent-a', 'Agent A');
    });

    it('applies an orchestrator edit, bumps once, clears sourceMissing', () => {
      manager.markSourceMissing(planId, true);
      const rev = manager.getPlan(planId)!.revision;
      const res = manager.applyFileChange(planId, simplePlan + '\n- [ ] 1.4 Fourth', 'orch');
      expect(res.applied).toBe(true);
      expect(res.diff!.added).toEqual(['1.4']);
      const board = manager.getPlan(planId)!;
      expect(board.revision).toBe(rev + 1);
      expect(board.sourceMissing).toBe(false);
      expect(board.tasks.find((t) => t.id === '1.1')!.assignee).toBe('agent-a');
    });

    it('applies unattributed edits (editor null)', () => {
      expect(manager.applyFileChange(planId, simplePlan + '\n- [ ] 1.4 Fourth', null).applied).toBe(true);
    });

    it('rejects an edit by a non-orchestrator and leaves the board unchanged', () => {
      const before = structuredClone(manager.getPlan(planId)!);
      const res = manager.applyFileChange(planId, simplePlan + '\n- [ ] 1.4 Fourth', 'agent-a');
      expect(res).toEqual({ applied: false, reason: 'not-orchestrator' });
      expect(manager.getPlan(planId)).toEqual(before);
    });

    it('parse error leaves the board intact', () => {
      const before = structuredClone(manager.getPlan(planId)!);
      vi.spyOn(manager as unknown as { parseWithTiers: () => never }, 'parseWithTiers').mockImplementation(() => {
        throw new Error('boom');
      });
      const res = manager.applyFileChange(planId, 'garbage', 'orch');
      expect(res).toEqual({ applied: false, reason: 'parse-error' });
      expect(manager.getPlan(planId)).toEqual(before);
    });

    it('treats a file that parses to zero tasks as a parse error', () => {
      const res = manager.applyFileChange(planId, '# Test Plan\n', 'orch');
      expect(res.reason).toBe('parse-error');
      expect(manager.getPlan(planId)!.tasks).toHaveLength(3);
    });

    it('reports duplicate IDs and renumbering', () => {
      const dup = manager.applyFileChange(planId, simplePlan + '\n- [ ] 1.3 Again', 'orch');
      expect(dup.reason).toBe('duplicate-ids');
      const ren = manager.applyFileChange(planId, '# T\n- [ ] 9.1 A\n- [ ] 9.2 B\n- [ ] 9.3 C', 'orch');
      expect(ren.reason).toBe('renumber');
      expect(manager.getPlan(planId)!.tasks.map((t) => t.id)).toEqual(['1.1', '1.2', '1.3']);
    });

    it('removing a claimed task line puts it in cancelling and fires onTaskCancelling', () => {
      const fired: string[] = [];
      manager.onTaskCancelling((t, pid) => fired.push(`${pid}:${t.id}`));
      const withoutFirst = `# Test Plan
- [ ] 1.2 Second task
  - depends: 1.1
- [ ] 1.3 Third task`;
      const res = manager.applyFileChange(planId, withoutFirst, 'orch');
      expect(res.applied).toBe(true);
      expect(res.diff!.cancelling).toEqual(['1.1']);
      const t = manager.getPlan(planId)!.tasks.find((x) => x.id === '1.1')!;
      expect(t.status).toBe('cancelling');
      expect(fired).toEqual([`${planId}:1.1`]);
    });
  });

  describe('updateTasks (batch)', () => {
    it('updates 3 tasks with one notification and one revision bump', () => {
      const planId = manager.loadPlan('# P\n- [ ] 1 A\n- [ ] 2 B\n- [ ] 3 C', '/ws/p.md').id;
      for (const id of ['1', '2', '3']) manager.claimTask(id, 'agent-a');
      const rev = manager.getPlan(planId)!.revision;
      const onChange = vi.fn();
      manager.onChange(onChange);

      const res = manager.updateTasks(['1', '2', '3'], 'agent-a', 'done', 'batch');
      expect(res.updated).toEqual(['1', '2', '3']);
      expect(res.failed).toEqual([]);
      expect(res.revision).toBe(rev + 1);
      expect(onChange).toHaveBeenCalledTimes(1);
      const board = manager.getPlan(planId)!;
      expect(board.tasks.every((t) => t.status === 'done' && t.changedAtRevision === rev + 1)).toBe(true);
      expect(board.status).toBe('completed');
    });

    it('reports per-task failures without aborting the batch', () => {
      manager.loadPlan(simplePlan, '/ws/plan.md');
      manager.claimTask('1.1', 'agent-a');
      manager.claimTask('1.3', 'agent-b');
      const res = manager.updateTasks(['1.1', '1.3', '9.9'], 'agent-a', 'in_progress');
      expect(res.updated).toEqual(['1.1']);
      expect(res.failed.map((f) => f.id)).toEqual(['1.3', '9.9']);
    });

    it('does not notify or bump when nothing was updated', () => {
      const b = manager.loadPlan(simplePlan, '/ws/plan.md');
      const rev = b.revision;
      const onChange = vi.fn();
      manager.onChange(onChange);
      manager.updateTasks(['9.9'], 'agent-a', 'done');
      expect(onChange).not.toHaveBeenCalled();
      expect(b.revision).toBe(rev);
    });
  });

  describe('cancel handshake', () => {
    let planId: string;
    beforeEach(() => {
      planId = manager.loadPlan(simplePlan, '/ws/plan.md', 'orch').id;
      manager.claimTask('1.1', 'agent-a', 'Agent A');
      manager.updateTask('1.1', 'agent-a', 'in_progress');
    });

    it('records removed task IDs against the removing revision for since_revision pollers', async () => {
      const { queryPlan } = await import('../planQuery.js');
      manager.cancelTask(planId, '1.1', 'orch', 'scope cut');
      const before = manager.getPlan(planId)!.revision;
      manager.updateTask('1.1', 'agent-a', 'aborted');
      const board = manager.getPlan(planId)!;
      expect(board.removedTasks).toEqual([{ id: '1.1', revision: before + 1 }]);
      expect(queryPlan(board, { sinceRevision: before }).removed).toEqual(['1.1']);
      expect(queryPlan(board, { sinceRevision: before + 1 }).unchanged).toBe(true);
      expect(queryPlan(board, {}).removed).toBeUndefined();
    });

    it('end-to-end: cancel → cancelling → assignee aborted → removed, dependents unblocked', () => {
      const fired: string[] = [];
      manager.onTaskCancelling((t) => fired.push(t.id));

      const c = manager.cancelTask(planId, '1.1', 'orch', 'scope cut');
      expect(c).toEqual({ success: true, status: 'cancelling', assignee: 'agent-a' });
      const t = manager.getPlan(planId)!.tasks.find((x) => x.id === '1.1')!;
      expect(t.status).toBe('cancelling');
      expect(t.cancelReason).toBe('scope cut');
      expect(fired).toEqual(['1.1']);

      // cancelling task can't be claimed or progressed
      expect(manager.claimTask('1.1', 'agent-b').success).toBe(false);
      expect(manager.updateTask('1.1', 'agent-a', 'done').success).toBe(false);

      const rev = manager.getPlan(planId)!.revision;
      const a = manager.updateTask('1.1', 'agent-a', 'aborted');
      expect(a.success).toBe(true);
      const board = manager.getPlan(planId)!;
      expect(board.tasks.map((x) => x.id)).toEqual(['1.2', '1.3']);
      const dep = board.tasks.find((x) => x.id === '1.2')!;
      expect(dep.blockedBy).toEqual([]);
      expect(dep.status).toBe('pending');
      expect(dep.changedAtRevision).toBe(rev + 1);
      expect(board.revision).toBe(rev + 1);
      expect(manager.claimTask('1.2', 'agent-b').success).toBe(true);
    });

    it('orchestrator may confirm the abort; others may not', () => {
      manager.cancelTask(planId, '1.1', 'orch', 'x');
      expect(manager.updateTask('1.1', 'agent-b', 'aborted').success).toBe(false);
      expect(manager.updateTask('1.1', 'orch', 'aborted').success).toBe(true);
      expect(manager.getPlan(planId)!.tasks.find((x) => x.id === '1.1')).toBeUndefined();
    });

    it("'aborted' is rejected unless the task is cancelling", () => {
      const r = manager.updateTask('1.1', 'agent-a', 'aborted');
      expect(r.success).toBe(false);
      expect(manager.getPlan(planId)!.tasks.find((x) => x.id === '1.1')!.status).toBe('in_progress');
    });

    it('workers cannot set cancelling', () => {
      const r = manager.updateTask('1.1', 'agent-a', 'cancelling');
      expect(r.success).toBe(false);
      expect(r.error).toContain('orchestrator');
      expect(manager.getPlan(planId)!.tasks.find((x) => x.id === '1.1')!.status).toBe('in_progress');
    });

    it('cancelTask is orchestrator-only', () => {
      const r = manager.cancelTask(planId, '1.1', 'agent-a', 'x');
      expect(r.success).toBe(false);
      expect(manager.getPlan(planId)!.tasks.find((x) => x.id === '1.1')!.status).toBe('in_progress');
    });

    it('cancelling an unclaimed task removes it immediately', () => {
      const fired: string[] = [];
      manager.onTaskCancelling((t) => fired.push(t.id));
      const r = manager.cancelTask(planId, '1.3', 'orch', 'not needed');
      expect(r).toEqual({ success: true, status: 'removed', assignee: null });
      expect(manager.getPlan(planId)!.tasks.find((x) => x.id === '1.3')).toBeUndefined();
      expect(fired).toEqual([]);
    });

    it('confirmAbortForLostAgent removes the lost agent\'s cancelling tasks', () => {
      manager.claimTask('1.3', 'agent-a');
      manager.cancelTask(planId, '1.1', 'orch', 'x');
      manager.cancelTask(planId, '1.3', 'orch', 'x');
      expect(manager.confirmAbortForLostAgent('agent-b')).toEqual([]);
      const removed = manager.confirmAbortForLostAgent('agent-a');
      expect(removed.sort()).toEqual(['1.1', '1.3']);
      const board = manager.getPlan(planId)!;
      expect(board.tasks.map((x) => x.id)).toEqual(['1.2']);
      expect(board.tasks[0].status).toBe('pending');
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
    expect(result.tools).toHaveLength(54); // base tools + eh_extract_concepts + eh_build_graph + eh_scan_status + eh_query_graph + eh_curate_context + eh_rescan_files + eh_get_cached_read + eh_claim_handle + eh_get_task + eh_cancel_task
  });

  describe('eh_load_plan', () => {
    it('loads a plan from content', async () => {
      const res = await callTool('eh_load_plan', { agent_id: 'a1', content: planMarkdown });
      const parsed = parseResult(res) as Record<string, unknown>;
      expect(parsed).toMatchObject({
        loaded: true,
        name: 'Integration Test Plan',
        taskCount: 3,
        watching: false,
      });
      // Compact response: no task array
      expect(parsed.tasks).toBeUndefined();
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
      expect(parsed).toMatchObject({ updated: ['1.1'], failed: [] });
      expect(typeof parsed.revision).toBe('number');
    });

    it('marks task done and unblocks dependents', async () => {
      const res = await callTool('eh_update_task', { task_id: '1.1', agent_id: 'a1', status: 'done' });
      const parsed = parseResult(res) as Record<string, unknown>;
      expect(parsed).toMatchObject({ updated: ['1.1'], failed: [] });

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
      const planRes = await callTool('eh_get_plan', { agent_id: 'a1', fields: ['notes'] });
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
      const parsed = parseResult(res) as { updated: string[]; failed: Array<{ id: string; error: string }> };
      expect(parsed.updated).toEqual([]);
      expect(parsed.failed[0].id).toBe('1.1');
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

// ── Revision tracking ───────────────────────────────────────────────────────

describe('PlanBoardManager revision tracking', () => {
  let mgr: PlanBoardManager;
  const md = '# Rev\n\n- [ ] 1.1 A\n- [ ] 1.2 B\n  - depends: 1.1\n- [ ] 1.3 C';

  beforeEach(() => {
    mgr = new PlanBoardManager();
  });

  it('starts at revision 1 with default fields', () => {
    const b = mgr.loadPlan(md, 'rev.md');
    expect(b.revision).toBe(1);
    expect(b.sourceMissing).toBe(false);
    expect(b.lastSelfWriteHash).toBeNull();
    expect(b.tasks.every((t) => t.changedAtRevision === 1 && t.cancelReason === null)).toBe(true);
  });

  it('claimTask bumps once and stamps the task', () => {
    const b = mgr.loadPlan(md, 'rev.md');
    mgr.claimTask('1.1', 'a');
    expect(b.revision).toBe(2);
    expect(b.tasks.find((t) => t.id === '1.1')!.changedAtRevision).toBe(2);
    expect(b.tasks.find((t) => t.id === '1.3')!.changedAtRevision).toBe(1);
  });

  it('updateTask done bumps once and stamps unblocked dependents', () => {
    const b = mgr.loadPlan(md, 'rev.md');
    mgr.claimTask('1.1', 'a');
    mgr.updateTask('1.1', 'a', 'done');
    expect(b.revision).toBe(3);
    expect(b.tasks.find((t) => t.id === '1.1')!.changedAtRevision).toBe(3);
    expect(b.tasks.find((t) => t.id === '1.2')!.changedAtRevision).toBe(3);
  });

  it('failed with cascade bumps once and stamps cascaded tasks', () => {
    const b = mgr.loadPlan(md, 'rev.md');
    mgr.claimTask('1.1', 'a');
    mgr.updateTask('1.1', 'a', 'failed', 'boom');
    expect(b.revision).toBe(3);
    expect(b.tasks.find((t) => t.id === '1.2')!.changedAtRevision).toBe(3);
  });

  it('auto-retry in updateTask bumps exactly once', () => {
    const b = mgr.loadPlan('# R\n<!-- maxAutoRetries: 2 -->\n- [ ] 1.1 A', 'rev.md');
    mgr.claimTask('1.1', 'a');
    const before = b.revision;
    mgr.updateTask('1.1', 'a', 'failed', 'x');
    expect(b.revision).toBe(before + 1);
  });

  it('retryTask bumps once', () => {
    const b = mgr.loadPlan(md, 'rev.md');
    mgr.claimTask('1.1', 'a');
    mgr.updateTask('1.1', 'a', 'failed');
    const before = b.revision;
    mgr.retryTask('1.1');
    expect(b.revision).toBe(before + 1);
    expect(b.tasks.find((t) => t.id === '1.2')!.changedAtRevision).toBe(before + 1);
  });

  it('claimOrchestrator and archivePlan bump once', () => {
    const b = mgr.loadPlan(md, 'rev.md');
    mgr.claimOrchestrator('o');
    expect(b.revision).toBe(2);
    mgr.archivePlan(b.id);
    expect(b.revision).toBe(3);
  });

  it('failed claim does not bump', () => {
    const b = mgr.loadPlan(md, 'rev.md');
    mgr.claimTask('1.2', 'a'); // blocked
    expect(b.revision).toBe(1);
  });

  it('setSelfWriteHash does not bump; markSourceMissing bumps only on change', () => {
    const b = mgr.loadPlan(md, 'rev.md');
    mgr.setSelfWriteHash(b.id, 'abc');
    expect(b.lastSelfWriteHash).toBe('abc');
    expect(b.revision).toBe(1);
    mgr.markSourceMissing(b.id, true);
    expect(b.sourceMissing).toBe(true);
    expect(b.revision).toBe(2);
    mgr.markSourceMissing(b.id, true);
    expect(b.revision).toBe(2);
  });

  it('restore defaults missing fields on old boards', () => {
    const b = mgr.loadPlan(md, 'rev.md');
    // A board as persisted before these fields existed.
    const old = structuredClone(b) as unknown as Record<string, unknown> & { tasks: Array<Record<string, unknown>> };
    delete old.revision;
    delete old.sourceMissing;
    delete old.lastSelfWriteHash;
    for (const t of old.tasks) {
      delete t.changedAtRevision;
      delete t.cancelReason;
    }
    const m2 = new PlanBoardManager();
    m2.restore([old as unknown as typeof b]);
    const r = m2.getPlan(b.id)!;
    expect(r.revision).toBe(1);
    expect(r.sourceMissing).toBe(false);
    expect(r.lastSelfWriteHash).toBeNull();
    expect(r.tasks.every((t) => t.changedAtRevision === 1 && t.cancelReason === null)).toBe(true);
  });

  it('checkAutoComplete: aborted ignored, cancelling blocks completion', () => {
    const b = mgr.loadPlan('# R\n- [ ] 1.1 A\n- [ ] 1.2 B', 'rev.md');
    b.tasks[1].status = 'aborted';
    mgr.claimTask('1.1', 'a');
    mgr.updateTask('1.1', 'a', 'done');
    expect(b.status).toBe('completed');

    const b2 = mgr.loadPlan('# R2\n- [ ] 1.1 A\n- [ ] 1.2 B', 'rev2.md');
    b2.tasks[1].status = 'cancelling';
    mgr.claimTask('1.1', 'a', undefined, b2.id);
    mgr.updateTask('1.1', 'a', 'done', undefined, undefined, b2.id);
    expect(b2.status).toBe('active');
  });
});
