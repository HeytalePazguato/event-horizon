/**
 * Plan merge — merge a freshly parsed plan board into the live board by task ID.
 *
 * Pure: never mutates its inputs. The live board is structuredClone'd and the
 * result returned. Revision handling is left to the caller (PlanBoardManager
 * bumps once per applied merge using the IDs reported in the diff).
 */

import { resolveBlockedStatus } from './planBoard.js';
import type { PlanBoard, PlanTask } from './planBoard.js';

export interface MergeDiff {
  /** IDs present in the parsed plan but not on the live board. */
  added: string[];
  /** Matching IDs where at least one field (content or status) actually changed. */
  updated: string[];
  /** IDs absent from the parsed plan that were dropped from the board. */
  removed: string[];
  /** IDs absent from the parsed plan that were claimed/in progress and now enter `cancelling`. */
  cancelling: string[];
  /** True when the change looks like a mass renumbering; merge not applied. */
  renumberSuspected: boolean;
  /** Task IDs that appear more than once in the parsed plan; merge not applied. */
  duplicateIds: string[];
}

export interface MergeOptions {
  /** Fraction of live tasks that may disappear in one save before the merge is held (default 0.3). */
  renumberThreshold?: number;
}

export interface MergeResult {
  board: PlanBoard;
  diff: MergeDiff;
  applied: boolean;
}

const DEFAULT_RENUMBER_THRESHOLD = 0.3;
const REMOVED_REASON = 'removed from plan file';

/** Fields copied from the parsed (file) task onto a matching live task. */
const FILE_OWNED_FIELDS = [
  'title',
  'description',
  'blockedBy',
  'role',
  'acceptanceCriteria',
  'verifyCommand',
  'complexity',
  'maxRetries',
] as const;

/** Fields compared to decide whether a matching task was `updated`. */
const COMPARED_FIELDS = [...FILE_OWNED_FIELDS, 'modelTier', 'status', 'completedAt', 'cancelReason'] as const;

function emptyDiff(): MergeDiff {
  return { added: [], updated: [], removed: [], cancelling: [], renumberSuspected: false, duplicateIds: [] };
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

function findDuplicateIds(tasks: PlanTask[]): string[] {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const t of tasks) {
    if (seen.has(t.id)) dups.add(t.id);
    else seen.add(t.id);
  }
  return [...dups];
}

/**
 * Re-derive blocked/pending for open tasks after dependencies or statuses changed.
 * `resolveBlockedStatus` only moves pending → blocked, so first release blocked
 * tasks whose dependencies are now all done.
 */
function reresolveBlocked(tasks: PlanTask[]): void {
  const statusById = new Map(tasks.map((t) => [t.id, t.status]));
  for (const task of tasks) {
    if (task.status !== 'blocked') continue;
    if (task.blockedBy.every((dep) => statusById.get(dep) === 'done')) {
      task.status = 'pending';
    }
  }
  resolveBlockedStatus(tasks);
}

export function mergePlan(live: PlanBoard, parsed: PlanBoard, opts?: MergeOptions): MergeResult {
  const diff = emptyDiff();
  const threshold = opts?.renumberThreshold ?? DEFAULT_RENUMBER_THRESHOLD;

  // (a) Duplicate IDs in the file — refuse.
  diff.duplicateIds = findDuplicateIds(parsed.tasks);
  if (diff.duplicateIds.length > 0) {
    return { board: structuredClone(live), diff, applied: false };
  }

  const liveById = new Map(live.tasks.map((t) => [t.id, t]));
  const parsedIds = new Set(parsed.tasks.map((t) => t.id));

  const addedIds = parsed.tasks.filter((t) => !liveById.has(t.id)).map((t) => t.id);
  const missingLive = live.tasks.filter((t) => !parsedIds.has(t.id));

  // (b) Renumber guard: many IDs vanished while new ones appeared.
  if (live.tasks.length > 0 && addedIds.length > 0 && missingLive.length / live.tasks.length > threshold) {
    diff.renumberSuspected = true;
    diff.added = addedIds;
    diff.removed = missingLive.map((t) => t.id);
    return { board: structuredClone(live), diff, applied: false };
  }

  const board = structuredClone(live);
  const clonedById = new Map(board.tasks.map((t) => [t.id, t]));

  // (f) Plan-level settings come from the file; identity/runtime fields stay live.
  board.name = parsed.name;
  board.strategy = parsed.strategy;
  board.onDependencyFailure = parsed.onDependencyFailure;
  board.maxAutoRetries = parsed.maxAutoRetries;
  board.maxBudgetUsd = parsed.maxBudgetUsd;

  const merged: PlanTask[] = [];
  for (const p of parsed.tasks) {
    const existing = clonedById.get(p.id);
    if (!existing) {
      // (d) New task — take parsed state as-is.
      merged.push(structuredClone(p));
      continue;
    }

    // (c) Matching ID — file-owned fields from parsed, runtime state from live.
    const target = existing as unknown as Record<string, unknown>;
    const source = p as unknown as Record<string, unknown>;
    for (const field of FILE_OWNED_FIELDS) {
      const value = source[field];
      target[field] = Array.isArray(value) ? [...value] : value;
    }
    if (p.modelTier !== null) existing.modelTier = p.modelTier;

    const fileDone = p.status === 'done';
    if (fileDone && existing.status !== 'done') {
      existing.status = 'done';
      existing.completedAt ??= Date.now();
    } else if (!fileDone && existing.status === 'done') {
      // Orchestrator reopened the task by unticking it.
      existing.status = 'pending';
      existing.completedAt = null;
    }
    merged.push(existing);
  }

  // (e) Tasks no longer in the file.
  for (const t of missingLive) {
    const kept = clonedById.get(t.id)!;
    if (kept.status === 'claimed' || kept.status === 'in_progress') {
      kept.status = 'cancelling';
      kept.cancelReason = REMOVED_REASON;
      diff.cancelling.push(kept.id);
      merged.push(kept);
    } else if (kept.status === 'cancelling') {
      merged.push(kept);
    } else {
      diff.removed.push(kept.id);
    }
  }

  // (g) Dependencies or statuses may have changed — re-derive blocked state.
  reresolveBlocked(merged);
  board.tasks = merged;

  diff.added = addedIds;
  for (const t of merged) {
    const before = liveById.get(t.id);
    if (!before || !parsedIds.has(t.id)) continue;
    const a = before as unknown as Record<string, unknown>;
    const b = t as unknown as Record<string, unknown>;
    if (COMPARED_FIELDS.some((f) => !sameValue(a[f], b[f]))) diff.updated.push(t.id);
  }

  return { board, diff, applied: true };
}
