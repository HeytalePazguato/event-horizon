/**
 * Lock-aware, coalesced write-back of task checkbox state to plan files.
 */
import { createHash } from 'node:crypto';

/** Set `- [ ]` / `- [x]` for each task ID line in a plan file's content. */
export function applyCheckboxes(content: string, statuses: Map<string, boolean>): string {
  let updated = content;
  for (const [taskId, isDone] of statuses) {
    const escapedId = taskId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^(\\s*- \\[)[ xX](\\]\\s+${escapedId}\\s)`, 'gm');
    updated = updated.replace(re, `$1${isDone ? 'x' : ' '}$2`);
  }
  return updated;
}

export interface PlanWriteBackDeps {
  readFile(p: string): Promise<string>;
  writeFile(p: string, s: string): Promise<void>;
  isLockedByOther(absPath: string): boolean;
  setSelfWriteHash(planId: string, hash: string): void;
  coalesceMs?: number;
  retryMs?: number;
  log?: (msg: string) => void;
}

const MAX_RETRIES = 30;

interface Pending {
  absPath: string;
  statuses: Map<string, boolean>;
  retries: number;
  timer: ReturnType<typeof setTimeout> | null;
}

export class PlanWriteBack {
  private readonly pending = new Map<string, Pending>();
  private readonly coalesceMs: number;
  private readonly retryMs: number;
  private disposed = false;

  constructor(private readonly deps: PlanWriteBackDeps) {
    this.coalesceMs = deps.coalesceMs ?? 2000;
    this.retryMs = deps.retryMs ?? 1000;
  }

  schedule(planId: string, absPath: string, statuses: Map<string, boolean>): void {
    if (this.disposed) return;
    const existing = this.pending.get(planId);
    if (existing) {
      // Latest statuses win; the already-running timer keeps coalescing.
      existing.absPath = absPath;
      existing.statuses = new Map(statuses);
      return;
    }
    const entry: Pending = { absPath, statuses: new Map(statuses), retries: 0, timer: null };
    this.pending.set(planId, entry);
    entry.timer = setTimeout(() => void this.flush(planId), this.coalesceMs);
  }

  /** Drop any pending write for a plan (call when the plan is archived or deleted). */
  cancel(planId: string): void {
    const entry = this.pending.get(planId);
    if (entry?.timer) clearTimeout(entry.timer);
    this.pending.delete(planId);
  }

  dispose(): void {
    this.disposed = true;
    for (const p of this.pending.values()) if (p.timer) clearTimeout(p.timer);
    this.pending.clear();
  }

  private async flush(planId: string): Promise<void> {
    const entry = this.pending.get(planId);
    if (!entry || this.disposed) return;
    entry.timer = null;

    if (this.deps.isLockedByOther(entry.absPath)) {
      if (entry.retries >= MAX_RETRIES) {
        this.pending.delete(planId);
        this.deps.log?.(`plan write-back dropped (still locked after ${MAX_RETRIES} retries): ${entry.absPath}`);
        return;
      }
      entry.retries++;
      entry.timer = setTimeout(() => void this.flush(planId), this.retryMs);
      return;
    }

    // Unlock the slot before the async work so schedules during I/O start a new cycle.
    this.pending.delete(planId);
    try {
      const content = await this.deps.readFile(entry.absPath);
      const updated = applyCheckboxes(content, entry.statuses);
      if (updated === content) return;
      this.deps.setSelfWriteHash(planId, createHash('sha256').update(updated).digest('hex'));
      await this.deps.writeFile(entry.absPath, updated);
    } catch (err) {
      this.deps.log?.(`plan write-back failed for ${entry.absPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
