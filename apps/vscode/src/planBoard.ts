/**
 * Plan Board — multi-agent task coordination with multi-plan support.
 * Agents load shared plans from markdown files, claim tasks atomically,
 * and report progress. State is held in-memory (persisted via VS Code
 * globalState externally by extension.ts).
 */

// ── Data model ──────────────────────────────────────────────────────────────

export interface TaskNote {
  agentId: string;
  agentName: string;
  text: string;
  ts: number;
}

export type TaskStatus = 'pending' | 'claimed' | 'in_progress' | 'done' | 'failed' | 'blocked';
export type PlanStatus = 'active' | 'completed' | 'archived';

export interface PlanTask {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  assignee: string | null;
  assigneeName: string | null;
  claimedAt: number | null;
  completedAt: number | null;
  blockedBy: string[];
  role: string | null;
  notes: TaskNote[];
}

export interface PlanBoard {
  id: string;
  name: string;
  sourceFile: string;
  status: PlanStatus;
  tasks: PlanTask[];
  createdAt: number;
  lastUpdatedAt: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Derive a plan ID from a file path (e.g. "AUTH_PLAN.md" → "auth-plan"). */
export function slugifyFilename(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop()?.replace(/\.md$/i, '') ?? 'inline';
  return base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'plan';
}

// ── Markdown parser ─────────────────────────────────────────────────────────

export function parsePlanMarkdown(markdown: string, sourceFile: string): PlanBoard {
  const lines = markdown.split(/\r?\n/);
  const tasks: PlanTask[] = [];
  let planName = 'Untitled Plan';

  for (const line of lines) {
    const h1Match = line.match(/^#\s+(.+)/);
    if (h1Match) {
      planName = h1Match[1].trim();
      break;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const taskMatch = line.match(/^(\s*)- \[([ xX])\]\s+(.+)/);
    if (!taskMatch) continue;

    const isDone = taskMatch[2].toLowerCase() === 'x';
    const rawTitle = taskMatch[3].trim();

    const idMatch = rawTitle.match(/^([\d]+(?:\.[\d]+(?:[a-z])?)*)\s+(.+)/);
    let taskId: string;
    let title: string;
    if (idMatch) {
      taskId = idMatch[1];
      title = idMatch[2];
    } else {
      taskId = rawTitle
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40);
      title = rawTitle;
    }

    // Strip HTML comments — use indexOf loop instead of regex to avoid CodeQL "Bad HTML filtering regexp"
    let cleaned = title;
    let commentStart = cleaned.indexOf('<!--');
    while (commentStart !== -1) {
      const commentEnd = cleaned.indexOf('-->', commentStart + 4);
      if (commentEnd === -1) break;
      cleaned = cleaned.slice(0, commentStart) + cleaned.slice(commentEnd + 3);
      commentStart = cleaned.indexOf('<!--');
    }
    title = cleaned.trim();

    const roleMatch = title.match(/\[role:\s*(\w[\w-]*)\]\s*$/);
    let role: string | null = null;
    if (roleMatch) {
      role = roleMatch[1];
      title = title.replace(roleMatch[0], '').trim();
    }

    const blockedBy: string[] = [];
    let description = '';
    for (let j = i + 1; j < lines.length; j++) {
      const nextLine = lines[j];
      if (/^\s*- \[[ xX]\]/.test(nextLine) || /^#{1,3}\s/.test(nextLine)) break;

      const depMatch = nextLine.match(/^\s+-\s*depends:\s*(.+)/i);
      if (depMatch) {
        const deps = depMatch[1].split(',').map((d) => d.trim()).filter(Boolean);
        blockedBy.push(...deps);
      } else {
        const trimmed = nextLine.trim();
        if (trimmed && !trimmed.startsWith('-')) {
          description += (description ? ' ' : '') + trimmed;
        }
      }
    }

    let status: TaskStatus = isDone ? 'done' : 'pending';
    if (!isDone && blockedBy.length > 0) {
      status = 'pending';
    }

    tasks.push({
      id: taskId,
      title,
      description,
      status,
      assignee: null,
      assigneeName: null,
      claimedAt: null,
      completedAt: isDone ? Date.now() : null,
      blockedBy,
      role,
      notes: [],
    });
  }

  resolveBlockedStatus(tasks);

  const now = Date.now();
  return {
    id: slugifyFilename(sourceFile),
    name: planName,
    sourceFile,
    status: 'active',
    tasks,
    createdAt: now,
    lastUpdatedAt: now,
  };
}

function resolveBlockedStatus(tasks: PlanTask[]): void {
  const statusById = new Map(tasks.map((t) => [t.id, t.status]));
  for (const task of tasks) {
    if (task.status === 'done' || task.status === 'failed') continue;
    if (task.blockedBy.length === 0) continue;
    const allDepsComplete = task.blockedBy.every((dep) => statusById.get(dep) === 'done');
    if (!allDepsComplete && task.status === 'pending') {
      task.status = 'blocked';
    }
  }
}

// ── Plan Board Manager (multi-plan) ─────────────────────────────────────────

export class PlanBoardManager {
  private boards = new Map<string, PlanBoard>();
  private activePlanId: string | null = null;
  private changeListeners: Array<(boards: Map<string, PlanBoard>, changedPlanId: string | null) => void> = [];
  private taskCompleteListeners: Array<(task: PlanTask, planId: string) => void> = [];
  private taskClaimListeners: Array<(task: PlanTask, planId: string) => void> = [];

  onChange(listener: (boards: Map<string, PlanBoard>, changedPlanId: string | null) => void): void {
    this.changeListeners.push(listener);
  }

  onTaskComplete(fn: (task: PlanTask, planId: string) => void): void {
    this.taskCompleteListeners.push(fn);
  }

  onTaskClaim(fn: (task: PlanTask, planId: string) => void): void {
    this.taskClaimListeners.push(fn);
  }

  private notifyChange(changedPlanId: string | null): void {
    for (const fn of this.changeListeners) fn(this.boards, changedPlanId);
  }

  /** Load a plan from parsed markdown. Replaces existing plan with same ID. */
  loadPlan(markdown: string, sourceFile: string): PlanBoard {
    const board = parsePlanMarkdown(markdown, sourceFile);

    // Handle ID collisions from different files
    if (this.boards.has(board.id) && this.boards.get(board.id)!.sourceFile !== sourceFile) {
      let suffix = 2;
      while (this.boards.has(`${board.id}-${suffix}`)) suffix++;
      board.id = `${board.id}-${suffix}`;
    }

    this.boards.set(board.id, board);
    this.activePlanId = board.id;
    this.notifyChange(board.id);
    return board;
  }

  /** Get a plan by ID, or the active plan if no ID given. */
  getPlan(planId?: string): PlanBoard | null {
    if (planId) return this.boards.get(planId) ?? null;
    if (this.activePlanId) return this.boards.get(this.activePlanId) ?? null;
    return null;
  }

  /** Get all plans. */
  getAllPlans(): PlanBoard[] {
    return Array.from(this.boards.values());
  }

  /** Resolve a plan — by explicit ID, or fallback to active plan. */
  private resolvePlan(planId?: string): PlanBoard | null {
    return this.getPlan(planId);
  }

  claimTask(
    taskId: string,
    agentId: string,
    agentName?: string,
    planId?: string,
  ): { success: boolean; error?: string; task?: PlanTask; planId?: string } {
    const board = this.resolvePlan(planId);
    if (!board) {
      return { success: false, error: planId ? `Plan not found: ${planId}` : 'No plan loaded' };
    }

    const task = board.tasks.find((t) => t.id === taskId);
    if (!task) {
      return { success: false, error: `Task not found: ${taskId}` };
    }

    if (task.blockedBy.length > 0) {
      const allDepsComplete = task.blockedBy.every((dep) => {
        const depTask = board.tasks.find((t) => t.id === dep);
        return depTask?.status === 'done';
      });
      if (!allDepsComplete) {
        return { success: false, error: `Task is blocked by incomplete dependencies: ${task.blockedBy.join(', ')}`, task, planId: board.id };
      }
    }

    if (task.status === 'claimed' || task.status === 'in_progress') {
      if (task.assignee !== agentId) {
        return { success: false, error: `Task already claimed by ${task.assigneeName ?? task.assignee}`, task, planId: board.id };
      }
      return { success: true, task, planId: board.id };
    }

    if (task.status === 'done') {
      return { success: false, error: 'Task is already done', task, planId: board.id };
    }

    // Allow re-claiming failed tasks
    task.status = 'claimed';
    task.assignee = agentId;
    task.assigneeName = agentName ?? agentId;
    task.claimedAt = Date.now();
    board.lastUpdatedAt = Date.now();
    this.notifyChange(board.id);
    for (const fn of this.taskClaimListeners) fn(task, board.id);
    return { success: true, task, planId: board.id };
  }

  updateTask(
    taskId: string,
    agentId: string,
    status: TaskStatus,
    note?: string,
    agentName?: string,
    planId?: string,
  ): { success: boolean; error?: string; task?: PlanTask; planId?: string } {
    const board = this.resolvePlan(planId);
    if (!board) {
      return { success: false, error: planId ? `Plan not found: ${planId}` : 'No plan loaded' };
    }

    const task = board.tasks.find((t) => t.id === taskId);
    if (!task) {
      return { success: false, error: `Task not found: ${taskId}` };
    }

    if (task.assignee && task.assignee !== agentId) {
      return { success: false, error: `Task is owned by ${task.assigneeName ?? task.assignee}`, task, planId: board.id };
    }

    task.status = status;

    if (status === 'in_progress' && !task.assignee) {
      task.assignee = agentId;
      task.assigneeName = agentName ?? agentId;
      task.claimedAt = Date.now();
    }

    if (status === 'done' || status === 'failed') {
      task.completedAt = Date.now();
      if (status === 'done') {
        this.unblockDependents(board, taskId);
        this.checkAutoComplete(board);
      }
      for (const fn of this.taskCompleteListeners) fn(task, board.id);
    }

    if (note) {
      task.notes.push({
        agentId,
        agentName: agentName ?? agentId,
        text: note,
        ts: Date.now(),
      });
    }

    board.lastUpdatedAt = Date.now();
    this.notifyChange(board.id);
    return { success: true, task, planId: board.id };
  }

  /** Archive a plan (mark as archived). */
  archivePlan(planId: string): { success: boolean; error?: string } {
    const board = this.boards.get(planId);
    if (!board) return { success: false, error: `Plan not found: ${planId}` };
    board.status = 'archived';
    board.lastUpdatedAt = Date.now();
    if (this.activePlanId === planId) {
      this.activePlanId = this.findNextActivePlanId();
    }
    this.notifyChange(planId);
    return { success: true };
  }

  /** Delete a plan permanently. */
  deletePlan(planId: string): { success: boolean; error?: string } {
    if (!this.boards.has(planId)) return { success: false, error: `Plan not found: ${planId}` };
    this.boards.delete(planId);
    if (this.activePlanId === planId) {
      this.activePlanId = this.findNextActivePlanId();
    }
    this.notifyChange(planId);
    return { success: true };
  }

  private findNextActivePlanId(): string | null {
    for (const [id, board] of this.boards) {
      if (board.status === 'active') return id;
    }
    return null;
  }

  private unblockDependents(board: PlanBoard, completedTaskId: string): void {
    for (const task of board.tasks) {
      if (task.status !== 'blocked') continue;
      if (!task.blockedBy.includes(completedTaskId)) continue;
      const allDepsComplete = task.blockedBy.every((dep) => {
        const depTask = board.tasks.find((t) => t.id === dep);
        return depTask?.status === 'done';
      });
      if (allDepsComplete) {
        task.status = 'pending';
      }
    }
  }

  /** Auto-complete: if all tasks in a plan are done, mark plan as completed. */
  private checkAutoComplete(board: PlanBoard): void {
    if (board.status !== 'active') return;
    const allDone = board.tasks.every((t) => t.status === 'done');
    if (allDone) {
      board.status = 'completed';
    }
  }

  /** Get source file and task statuses for a specific plan (for checkbox sync). */
  getSourceFileSync(planId?: string): { sourceFile: string; taskStatuses: Map<string, boolean> } | null {
    const board = this.resolvePlan(planId);
    if (!board) return null;
    const taskStatuses = new Map<string, boolean>();
    for (const task of board.tasks) {
      taskStatuses.set(task.id, task.status === 'done');
    }
    return { sourceFile: board.sourceFile, taskStatuses };
  }

  /** Serialize all plans for persistence. */
  serialize(): PlanBoard[] {
    return Array.from(this.boards.values()).map((b) => structuredClone(b));
  }

  /** Restore from persistence (no notification). */
  restore(boards: PlanBoard[]): void {
    this.boards.clear();
    for (const board of boards) {
      this.boards.set(board.id, board);
    }
    this.activePlanId = this.findNextActivePlanId();
  }

  /** Restore and notify listeners. */
  restoreAndNotify(boards: PlanBoard[]): void {
    this.restore(boards);
    this.notifyChange(null);
  }

  /** Clear all plans. */
  clear(): void {
    this.boards.clear();
    this.activePlanId = null;
    this.notifyChange(null);
  }
}
