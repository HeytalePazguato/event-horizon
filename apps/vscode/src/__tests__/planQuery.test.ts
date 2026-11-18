import { describe, it, expect } from 'vitest';
import type { PlanBoard, PlanTask, TaskStatus } from '../planBoard.js';
import { queryPlan, taskDetail } from '../planQuery.js';

function makeTask(i: number, over: Partial<PlanTask> = {}): PlanTask {
  const statuses: TaskStatus[] = ['pending', 'in_progress', 'done', 'blocked'];
  return {
    id: `1.${i}`,
    title: `Task number ${i}: implement a reasonably descriptive feature`,
    description: `Long description for task ${i}. `.repeat(10),
    status: statuses[i % 4],
    assignee: i % 2 ? `agent-session-${i}` : null,
    assigneeName: i % 2 ? `worker-${i}` : null,
    claimedAt: null,
    completedAt: null,
    blockedBy: i > 1 ? [`1.${i - 1}`] : [],
    role: 'implementer',
    notes: Array.from({ length: 4 }, (_, n) => ({
      agentId: `agent-session-${i}`,
      agentName: `worker-${i}`,
      text: `Note ${n} on task ${i}: progress detail that takes some space in JSON output.`,
      ts: 1700000000000 + n,
    })),
    retryCount: 0,
    maxRetries: 2,
    failedReason: null,
    acceptanceCriteria: `Criteria for task ${i}: must pass lint, build and tests; must handle edge cases A, B and C.`,
    verifyCommand: 'pnpm vitest run src/__tests__/something.test.ts',
    complexity: 'medium',
    modelTier: 'sonnet',
    verificationStatus: 'pending',
    changedAtRevision: i <= 90 ? 1 : 5,
    cancelReason: null,
    ...over,
  };
}

function makeBoard(n = 100): PlanBoard {
  return {
    id: 'plan-x',
    name: 'Plan X',
    sourceFile: 'docs/plan.md',
    status: 'active',
    tasks: Array.from({ length: n }, (_, i) => makeTask(i + 1)),
    createdAt: 0,
    lastUpdatedAt: 0,
    onDependencyFailure: 'cascade',
    maxAutoRetries: 2,
    orchestratorAgentId: null,
    strategy: 'manual',
    maxBudgetUsd: null,
    revision: 5,
    sourceMissing: false,
    lastSelfWriteHash: null,
  };
}

describe('queryPlan', () => {
  const board = makeBoard();

  it('returns compact tasks and whole-board counts', () => {
    const r = queryPlan(board, {});
    expect(r.tasks).toHaveLength(100);
    expect(Object.keys(r.tasks[0]).sort()).toEqual(['assignee', 'blockedBy', 'id', 'status', 'title']);
    expect(r.counts.pending + r.counts.in_progress + r.counts.done + r.counts.blocked).toBe(100);
    expect(r.counts.failed).toBe(0);
    expect(r.counts.aborted).toBe(0);
    expect(r.revision).toBe(5);
    expect(r.unchanged).toBeUndefined();
  });

  it('prefers assigneeName over assignee', () => {
    const r = queryPlan(board, { taskIds: ['1.1'] });
    expect(r.tasks[0].assignee).toBe('worker-1');
  });

  it('filters by status and keeps counts for whole board', () => {
    const r = queryPlan(board, { status: ['done'] });
    expect(r.tasks.every((t) => t.status === 'done')).toBe(true);
    expect(r.tasks).toHaveLength(25);
    expect(r.counts.pending).toBe(25);
  });

  it('ANDs filters', () => {
    const r = queryPlan(board, { status: ['done'], taskIds: ['1.2', '1.3', '1.4'], sinceRevision: 0 });
    expect(r.tasks.map((t) => t.id)).toEqual(['1.2']);
  });

  it('sinceRevision keeps only newer tasks', () => {
    const r = queryPlan(board, { sinceRevision: 1 });
    expect(r.tasks).toHaveLength(10);
    expect(r.unchanged).toBeUndefined();
  });

  it('sinceRevision >= board.revision is unchanged', () => {
    const r = queryPlan(board, { sinceRevision: 5 });
    expect(r.tasks).toEqual([]);
    expect(r.unchanged).toBe(true);
    expect(queryPlan(board, { sinceRevision: 9 }).unchanged).toBe(true);
  });

  it('includes only requested fields', () => {
    const r = queryPlan(board, { taskIds: ['1.1'], fields: ['verifyCommand', 'role'] });
    expect(r.tasks[0].verifyCommand).toBe('pnpm vitest run src/__tests__/something.test.ts');
    expect(r.tasks[0].role).toBe('implementer');
    expect(r.tasks[0].notes).toBeUndefined();
  });

  it('compact JSON is <= 35% of the full eh_get_plan mapping', () => {
    const full = JSON.stringify(
      board.tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        assignee: t.assigneeName ?? t.assignee,
        assigneeId: t.assignee,
        blockedBy: t.blockedBy,
        notes: t.notes,
        acceptanceCriteria: t.acceptanceCriteria ?? null,
        verifyCommand: t.verifyCommand ?? null,
        complexity: t.complexity ?? null,
        modelTier: t.modelTier ?? null,
        verificationStatus: t.verificationStatus ?? null,
      })),
    );
    const compact = JSON.stringify(queryPlan(board, {}).tasks);
    expect(compact.length).toBeLessThanOrEqual(full.length * 0.35);
  });
});

describe('taskDetail', () => {
  it('returns null for unknown task', () => {
    expect(taskDetail(makeBoard(3), 'nope')).toBeNull();
  });

  it('returns full task without truncation for few notes', () => {
    const d = taskDetail(makeBoard(3), '1.1')!;
    expect(d.notes).toHaveLength(4);
    expect(d.notesTruncated).toBe(0);
    expect(d.description).toContain('Long description');
  });

  it('caps notes to the last 20', () => {
    const b = makeBoard(1);
    b.tasks[0].notes = Array.from({ length: 27 }, (_, n) => ({ agentId: 'a', agentName: 'a', text: `n${n}`, ts: n }));
    const d = taskDetail(b, '1.1')!;
    expect(d.notes).toHaveLength(20);
    expect(d.notes[0].text).toBe('n7');
    expect(d.notes[19].text).toBe('n26');
    expect(d.notesTruncated).toBe(7);
  });
});
