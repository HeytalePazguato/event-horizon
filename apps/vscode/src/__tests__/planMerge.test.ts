import { describe, it, expect } from 'vitest';
import { parsePlanMarkdown } from '../planBoard.js';
import type { PlanBoard, PlanTask } from '../planBoard.js';
import { mergePlan } from '../planMerge.js';

const SRC = '/ws/PLAN.md';

interface TaskSpec {
  id: string;
  title?: string;
  done?: boolean;
  deps?: string[];
  accept?: string;
  verify?: string;
  complexity?: string;
  model?: string;
}

function taskLines(t: TaskSpec): string[] {
  const out = [`- [${t.done ? 'x' : ' '}] ${t.id} ${t.title ?? `Task ${t.id}`} [role: implementer]`];
  if (t.deps?.length) out.push(`  - depends: ${t.deps.join(', ')}`);
  if (t.accept) out.push(`  - **Accept**: ${t.accept}`);
  if (t.verify) out.push(`  - **Verify**: \`${t.verify}\``);
  if (t.complexity) out.push(`  <!-- complexity: ${t.complexity} -->`);
  if (t.model) out.push(`  <!-- model: ${t.model} -->`);
  return out;
}

function md(tasks: TaskSpec[], name = 'Test Plan', meta = ''): string {
  return [`# ${name}`, meta, '', '## Phase 1', ...tasks.flatMap(taskLines)].join('\n');
}

function parse(tasks: TaskSpec[], name?: string, meta?: string): PlanBoard {
  return parsePlanMarkdown(md(tasks, name, meta), SRC);
}

/** 100 tasks: 1.1 … 1.100, each depending on the previous one every 10th task. */
function hundredSpecs(): TaskSpec[] {
  return Array.from({ length: 100 }, (_, i) => {
    const n = i + 1;
    return {
      id: `1.${n}`,
      accept: `criteria ${n}`,
      verify: `pnpm test ${n}`,
      complexity: 'medium',
      deps: n % 10 === 0 ? [`1.${n - 1}`] : undefined,
    };
  });
}

function task(board: PlanBoard, id: string): PlanTask {
  const t = board.tasks.find((x) => x.id === id);
  if (!t) throw new Error(`no task ${id}`);
  return t;
}

/** Simulate runtime state on a live board. */
function claim(board: PlanBoard, id: string, agent: string, status: 'claimed' | 'in_progress' = 'in_progress'): void {
  const t = task(board, id);
  t.status = status;
  t.assignee = agent;
  t.assigneeName = `${agent}-name`;
  t.claimedAt = 1000;
  t.notes.push({ agentId: agent, agentName: `${agent}-name`, text: `note on ${id}`, ts: 1001 });
}

describe('mergePlan', () => {
  it('no-op merge returns an empty diff and an equal board', () => {
    const live = parse(hundredSpecs());
    claim(live, '1.3', 'a1');
    const { board, diff, applied } = mergePlan(live, parse(hundredSpecs()));
    expect(applied).toBe(true);
    expect(diff).toEqual({ added: [], updated: [], removed: [], cancelling: [], renumberSuspected: false, duplicateIds: [] });
    expect(board).toEqual(live);
  });

  it('add 5 / edit 3 on a 100-task board preserves claims, notes and verification', () => {
    const live = parse(hundredSpecs());
    live.orchestratorAgentId = 'orch';
    live.revision = 42;
    for (let n = 1; n <= 20; n++) claim(live, `1.${n}`, `agent-${n}`, n % 2 ? 'claimed' : 'in_progress');
    task(live, '1.30').status = 'done';
    task(live, '1.30').completedAt = 5000;
    task(live, '1.30').verificationStatus = 'passed';
    task(live, '1.31').status = 'failed';
    task(live, '1.31').failedReason = 'boom';
    task(live, '1.31').retryCount = 1;

    const specs = hundredSpecs();
    specs[1].title = 'Renamed two'; // 1.2 (claimed)
    specs[49].accept = 'new criteria'; // 1.50
    specs[29].verify = 'pnpm new'; // 1.30 (done)
    specs[29].done = true;
    for (let n = 101; n <= 105; n++) specs.push({ id: `1.${n}`, deps: ['1.1'] });

    const parsed = parse(specs);
    const { board, diff, applied } = mergePlan(live, parsed);

    expect(applied).toBe(true);
    expect(diff.added).toEqual(['1.101', '1.102', '1.103', '1.104', '1.105']);
    expect(diff.updated.sort()).toEqual(['1.2', '1.30', '1.50'].sort());
    expect(diff.removed).toEqual([]);
    expect(diff.cancelling).toEqual([]);
    expect(board.tasks).toHaveLength(105);
    expect(board.tasks.map((t) => t.id)).toEqual(parsed.tasks.map((t) => t.id));

    for (let n = 1; n <= 20; n++) {
      const t = task(board, `1.${n}`);
      expect(t.assignee).toBe(`agent-${n}`);
      expect(t.assigneeName).toBe(`agent-${n}-name`);
      expect(t.status).toBe(n % 2 ? 'claimed' : 'in_progress');
      expect(t.claimedAt).toBe(1000);
      expect(t.notes).toEqual([{ agentId: `agent-${n}`, agentName: `agent-${n}-name`, text: `note on 1.${n}`, ts: 1001 }]);
    }
    expect(task(board, '1.2').title).toBe('Renamed two');
    expect(task(board, '1.50').acceptanceCriteria).toBe('new criteria');
    expect(task(board, '1.30')).toMatchObject({ status: 'done', completedAt: 5000, verificationStatus: 'passed', verifyCommand: 'pnpm new' });
    expect(task(board, '1.31')).toMatchObject({ status: 'failed', failedReason: 'boom', retryCount: 1 });

    // New tasks depend on a claimed (not done) task → blocked.
    expect(task(board, '1.101').status).toBe('blocked');

    // Live identity preserved.
    expect(board.orchestratorAgentId).toBe('orch');
    expect(board.revision).toBe(42);
    expect(board.id).toBe(live.id);
    expect(board.createdAt).toBe(live.createdAt);
  });

  it('claimed / in_progress task removed from the file → cancelling, kept on the board', () => {
    const specs: TaskSpec[] = [{ id: '1.1' }, { id: '1.2' }, { id: '1.3' }, { id: '1.4' }];
    const live = parse(specs);
    claim(live, '1.2', 'a1', 'claimed');
    claim(live, '1.3', 'a2', 'in_progress');
    const { board, diff, applied } = mergePlan(live, parse([{ id: '1.1' }, { id: '1.4' }]));

    expect(applied).toBe(true);
    expect(diff.cancelling).toEqual(['1.2', '1.3']);
    expect(diff.removed).toEqual([]);
    expect(board.tasks.map((t) => t.id)).toEqual(['1.1', '1.4', '1.2', '1.3']);
    for (const id of ['1.2', '1.3']) {
      expect(task(board, id).status).toBe('cancelling');
      expect(task(board, id).cancelReason).toBe('removed from plan file');
      expect(task(board, id).assignee).not.toBeNull();
    }
  });

  it('task already cancelling and still absent stays on the board without re-listing', () => {
    const live = parse([{ id: '1.1' }, { id: '1.2' }, { id: '1.3' }, { id: '1.4' }]);
    claim(live, '1.2', 'a1');
    task(live, '1.2').status = 'cancelling';
    task(live, '1.2').cancelReason = 'orchestrator said so';
    const { board, diff } = mergePlan(live, parse([{ id: '1.1' }, { id: '1.3' }, { id: '1.4' }]));
    expect(diff.cancelling).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(task(board, '1.2')).toMatchObject({ status: 'cancelling', cancelReason: 'orchestrator said so' });
  });

  it('unclaimed removed tasks (pending/blocked/failed/done/aborted) are dropped', () => {
    const specs: TaskSpec[] = Array.from({ length: 10 }, (_, i) => ({ id: `1.${i + 1}` }));
    specs[1].deps = ['1.1'];
    const live = parse(specs);
    task(live, '1.3').status = 'failed';
    task(live, '1.4').status = 'done';
    task(live, '1.5').status = 'aborted';
    // 1.1 pending, 1.2 blocked
    expect(task(live, '1.2').status).toBe('blocked');

    const kept = specs.filter((s) => !['1.1', '1.2', '1.3'].includes(s.id));
    const { board, diff, applied } = mergePlan(live, parse(kept));
    expect(applied).toBe(true);
    expect(diff.removed).toEqual(['1.1', '1.2', '1.3']);
    expect(board.tasks.map((t) => t.id)).toEqual(kept.map((s) => s.id));

    const { diff: diff2 } = mergePlan(live, parse(specs.filter((s) => !['1.4', '1.5'].includes(s.id))));
    expect(diff2.removed).toEqual(['1.4', '1.5']);
  });

  it('[x] toggle in the file marks a live task done and unblocks dependents', () => {
    const specs: TaskSpec[] = [{ id: '1.1' }, { id: '1.2', deps: ['1.1'] }];
    const live = parse(specs);
    claim(live, '1.1', 'a1');
    expect(task(live, '1.2').status).toBe('blocked');

    const { board, diff } = mergePlan(live, parse([{ id: '1.1', done: true }, { id: '1.2', deps: ['1.1'] }]));
    expect(task(board, '1.1').status).toBe('done');
    expect(task(board, '1.1').completedAt).not.toBeNull();
    expect(task(board, '1.1').assignee).toBe('a1');
    expect(task(board, '1.2').status).toBe('pending');
    expect(diff.updated.sort()).toEqual(['1.1', '1.2']);
  });

  it('[ ] in the file reopens a live done task and re-blocks dependents', () => {
    const live = parse([{ id: '1.1', done: true }, { id: '1.2', deps: ['1.1'] }]);
    expect(task(live, '1.2').status).toBe('pending');

    const { board, diff } = mergePlan(live, parse([{ id: '1.1' }, { id: '1.2', deps: ['1.1'] }]));
    expect(task(board, '1.1').status).toBe('pending');
    expect(task(board, '1.1').completedAt).toBeNull();
    expect(task(board, '1.2').status).toBe('blocked');
    expect(diff.updated.sort()).toEqual(['1.1', '1.2']);
  });

  it('dependency edits re-resolve blocked status', () => {
    const live = parse([{ id: '1.1' }, { id: '1.2', deps: ['1.1'] }, { id: '1.3' }]);
    const { board, diff } = mergePlan(live, parse([{ id: '1.1' }, { id: '1.2' }, { id: '1.3', deps: ['1.1'] }]));
    expect(task(board, '1.2').status).toBe('pending');
    expect(task(board, '1.3').status).toBe('blocked');
    expect(diff.updated.sort()).toEqual(['1.2', '1.3']);
  });

  it('>30% of IDs renumbered → not applied, live unchanged', () => {
    const live = parse(hundredSpecs());
    const renumbered = hundredSpecs().map((s, i) => (i < 40 ? { ...s, id: `2.${i + 1}`, deps: undefined } : s));
    const { board, diff, applied } = mergePlan(live, parse(renumbered));
    expect(applied).toBe(false);
    expect(diff.renumberSuspected).toBe(true);
    expect(diff.added).toHaveLength(40);
    expect(diff.removed).toHaveLength(40);
    expect(board).toEqual(live);
    expect(board).not.toBe(live);
  });

  it('renumber threshold is configurable and pure removals never trigger it', () => {
    const live = parse(hundredSpecs());
    const renumbered = hundredSpecs().map((s, i) => (i < 20 ? { ...s, id: `2.${i + 1}`, deps: undefined } : s));
    expect(mergePlan(live, parse(renumbered)).applied).toBe(true);
    expect(mergePlan(live, parse(renumbered), { renumberThreshold: 0.1 }).applied).toBe(false);

    const halfRemoved = hundredSpecs().slice(50);
    const r = mergePlan(live, parse(halfRemoved));
    expect(r.applied).toBe(true);
    expect(r.diff.renumberSuspected).toBe(false);
    expect(r.diff.removed).toHaveLength(50);
  });

  it('duplicate IDs in the parsed plan → not applied, live unchanged', () => {
    const live = parse([{ id: '1.1' }, { id: '1.2' }]);
    const parsed = parse([{ id: '1.1' }, { id: '1.2' }, { id: '1.2', title: 'dup' }, { id: '1.3' }]);
    const { board, diff, applied } = mergePlan(live, parsed);
    expect(applied).toBe(false);
    expect(diff.duplicateIds).toEqual(['1.2']);
    expect(diff.added).toEqual([]);
    expect(board).toEqual(live);
  });

  it('copies plan-level settings from the file but keeps live identity fields', () => {
    const live = parse([{ id: '1.1' }]);
    live.orchestratorAgentId = 'orch';
    live.status = 'completed';
    live.revision = 7;
    live.sourceFile = '/ws/original.md';
    const parsed = parse(
      [{ id: '1.1' }],
      'Renamed Plan',
      '<!-- strategy: round-robin --> <!-- onDependencyFailure: block --> <!-- maxAutoRetries: 3 --> <!-- maxBudgetUsd: 12.5 -->',
    );
    parsed.id = 'other-id';
    const { board } = mergePlan(live, parsed);
    expect(board).toMatchObject({
      id: live.id,
      sourceFile: '/ws/original.md',
      createdAt: live.createdAt,
      orchestratorAgentId: 'orch',
      status: 'completed',
      revision: 7,
      name: 'Renamed Plan',
      strategy: 'round-robin',
      onDependencyFailure: 'block',
      maxAutoRetries: 3,
      maxBudgetUsd: 12.5,
    });
  });

  it('modelTier is only overwritten when the file sets it explicitly', () => {
    const live = parse([{ id: '1.1', complexity: 'high' }, { id: '1.2' }]);
    task(live, '1.1').modelTier = 'opus'; // derived from complexity by the manager
    task(live, '1.2').modelTier = 'sonnet';
    const { board, diff } = mergePlan(live, parse([{ id: '1.1', complexity: 'high' }, { id: '1.2', model: 'haiku' }]));
    expect(task(board, '1.1').modelTier).toBe('opus');
    expect(task(board, '1.2').modelTier).toBe('haiku');
    expect(diff.updated).toEqual(['1.2']);
  });

  it('does not mutate its inputs', () => {
    const live = parse(hundredSpecs());
    claim(live, '1.1', 'a1');
    claim(live, '1.2', 'a2');
    const specs = hundredSpecs().filter((s) => s.id !== '1.2' && s.id !== '1.5');
    specs[0].done = true;
    specs[3].title = 'edited';
    specs.push({ id: '1.200', deps: ['1.3'] });
    const parsed = parse(specs);

    const liveSnapshot = structuredClone(live);
    const parsedSnapshot = structuredClone(parsed);
    const { board } = mergePlan(live, parsed);

    expect(live).toEqual(liveSnapshot);
    expect(parsed).toEqual(parsedSnapshot);
    expect(board.tasks).not.toBe(live.tasks);
    for (const t of board.tasks) {
      expect(live.tasks).not.toContain(t);
      expect(parsed.tasks).not.toContain(t);
    }
    // Mutating the result must not leak back.
    task(board, '1.1').notes.push({ agentId: 'x', agentName: 'x', text: 'x', ts: 0 });
    task(board, '1.200').blockedBy.push('zzz');
    expect(live).toEqual(liveSnapshot);
    expect(parsed).toEqual(parsedSnapshot);
  });
});
