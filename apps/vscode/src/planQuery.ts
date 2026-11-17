/**
 * Compact plan query projections — pure functions over a PlanBoard.
 * Lets agents fetch a small slice of a plan instead of the full task dump.
 */

import type { PlanBoard, PlanTask, TaskStatus, TaskNote } from './planBoard.js';

export type PlanQueryField =
  | 'notes'
  | 'acceptanceCriteria'
  | 'verifyCommand'
  | 'complexity'
  | 'modelTier'
  | 'verificationStatus'
  | 'role'
  | 'description';

export interface PlanQuery {
  status?: TaskStatus[];
  taskIds?: string[];
  sinceRevision?: number;
  fields?: PlanQueryField[];
}

export interface CompactTask {
  id: string;
  title: string;
  status: TaskStatus;
  assignee: string | null;
  blockedBy: string[];
  [extra: string]: unknown;
}

export interface PlanQueryResult {
  plan_id: string;
  name: string;
  status: PlanBoard['status'];
  revision: number;
  sourceFile: string;
  sourceMissing: boolean;
  counts: Record<TaskStatus, number>;
  tasks: CompactTask[];
  /** With sinceRevision: IDs removed from the board after that revision. */
  removed?: string[];
  unchanged?: true;
}

const ALL_STATUSES: TaskStatus[] = [
  'pending', 'claimed', 'in_progress', 'done', 'failed', 'blocked', 'cancelling', 'aborted',
];

const MAX_NOTES = 20;

function countStatuses(board: PlanBoard): Record<TaskStatus, number> {
  const counts = {} as Record<TaskStatus, number>;
  for (const s of ALL_STATUSES) counts[s] = 0;
  for (const t of board.tasks) counts[t.status] = (counts[t.status] ?? 0) + 1;
  return counts;
}

function compact(t: PlanTask, fields: PlanQueryField[]): CompactTask {
  const out: CompactTask = {
    id: t.id,
    title: t.title,
    status: t.status,
    assignee: t.assigneeName ?? t.assignee,
    blockedBy: t.blockedBy,
  };
  for (const f of fields) out[f] = t[f] ?? null;
  return out;
}

export function queryPlan(board: PlanBoard, q: PlanQuery = {}): PlanQueryResult {
  const base = {
    plan_id: board.id,
    name: board.name,
    status: board.status,
    revision: board.revision,
    sourceFile: board.sourceFile,
    sourceMissing: board.sourceMissing,
    counts: countStatuses(board),
  };

  if (q.sinceRevision !== undefined && q.sinceRevision >= board.revision) {
    return { ...base, tasks: [], unchanged: true };
  }

  const statuses = q.status && q.status.length > 0 ? new Set(q.status) : null;
  const ids = q.taskIds && q.taskIds.length > 0 ? new Set(q.taskIds) : null;
  const fields = q.fields ?? [];

  const tasks = board.tasks
    .filter((t) => !statuses || statuses.has(t.status))
    .filter((t) => !ids || ids.has(t.id))
    .filter((t) => q.sinceRevision === undefined || t.changedAtRevision > q.sinceRevision)
    .map((t) => compact(t, fields));

  if (q.sinceRevision !== undefined) {
    const since = q.sinceRevision;
    const live = new Set(board.tasks.map((t) => t.id));
    // A removed ID that was later re-added is live again; don't report it.
    const removed = [...new Set((board.removedTasks ?? [])
      .filter((r) => r.revision > since && !live.has(r.id))
      .map((r) => r.id))];
    return { ...base, tasks, removed };
  }

  return { ...base, tasks };
}

export function taskDetail(
  board: PlanBoard,
  taskId: string,
): (Omit<PlanTask, 'notes'> & { notes: TaskNote[]; notesTruncated: number }) | null {
  const t = board.tasks.find((x) => x.id === taskId);
  if (!t) return null;
  const truncated = Math.max(0, t.notes.length - MAX_NOTES);
  return { ...t, notes: t.notes.slice(-MAX_NOTES), notesTruncated: truncated };
}
