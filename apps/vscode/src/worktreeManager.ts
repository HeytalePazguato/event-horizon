/**
 * Worktree Manager — creates and removes git worktrees for workspace isolation.
 * Each agent+task pair can get its own worktree so agents don't collide on the
 * working tree.
 */

import * as cp from 'child_process';
import * as path from 'path';

export interface WorktreeInfo {
  agentId: string;
  taskId: string;
  branch: string;
  path: string;
  createdAt: number;
}

export class WorktreeManager {
  private worktrees = new Map<string, WorktreeInfo>();

  private key(agentId: string, taskId: string): string {
    return `${agentId}::${taskId}`;
  }

  /**
   * Create a git worktree for an agent+task pair.
   * Runs: git worktree add .eh-worktrees/<agentId>-<taskId> -b eh/<taskId>
   * Returns the absolute path to the worktree.
   */
  async create(agentId: string, taskId: string, cwd: string): Promise<{ path: string; branch: string }> {
    const sanitizedAgent = agentId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30);
    const sanitizedTask = taskId.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 40);
    const worktreeDir = `.eh-worktrees/${sanitizedAgent}-${sanitizedTask}`;
    const branch = `eh/${sanitizedTask}`;
    const absolutePath = path.resolve(cwd, worktreeDir);

    await this.exec(`git worktree add "${worktreeDir}" -b "${branch}"`, cwd);

    const info: WorktreeInfo = {
      agentId,
      taskId,
      branch,
      path: absolutePath,
      createdAt: Date.now(),
    };
    this.worktrees.set(this.key(agentId, taskId), info);

    return { path: absolutePath, branch };
  }

  /**
   * Remove a worktree. Optionally merge the branch first.
   */
  async remove(agentId: string, taskId: string, cwd: string, merge = false): Promise<void> {
    const k = this.key(agentId, taskId);
    const info = this.worktrees.get(k);
    if (!info) return;

    if (merge) {
      try {
        await this.exec(`git merge "${info.branch}" --no-edit`, cwd);
      } catch {
        // Merge conflict — user must resolve manually
      }
    }

    try {
      await this.exec(`git worktree remove "${info.path}" --force`, cwd);
    } catch {
      // Worktree already removed or doesn't exist
    }

    try {
      await this.exec(`git branch -d "${info.branch}"`, cwd);
    } catch {
      // Branch not found or not merged
    }

    this.worktrees.delete(k);
  }

  /** List all tracked worktrees. */
  list(): WorktreeInfo[] {
    return Array.from(this.worktrees.values());
  }

  /** Get worktree info for a specific agent+task pair. */
  getForTask(agentId: string, taskId: string): WorktreeInfo | undefined {
    return this.worktrees.get(this.key(agentId, taskId));
  }

  private exec(command: string, cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      cp.exec(command, { cwd, timeout: 30_000 }, (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout.trim());
      });
    });
  }
}
