/**
 * Plan Board — multi-agent task coordination.
 * Agents load a shared plan from a markdown file, claim tasks atomically,
 * and report progress. State is held in-memory (persisted via VS Code
 * globalState externally by extension.ts if needed).
 */

// ── Data model ──────────────────────────────────────────────────────────────

export interface TaskNote {
  agentId: string;
  agentName: string;
  text: string;
  ts: number;
}

export type TaskStatus = 'pending' | 'claimed' | 'in_progress' | 'done' | 'failed' | 'blocked';

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
  notes: TaskNote[];
}

export interface PlanBoard {
  name: string;
  sourceFile: string;
  tasks: PlanTask[];
  createdAt: number;
  lastUpdatedAt: number;
}

// ── Markdown parser ─────────────────────────────────────────────────────────

/**
 * Parse a plan markdown file into a PlanBoard.
 *
 * Supported format:
 * ```markdown
 * # Plan Title
 *
 * ## Phase A — Description
 * - [ ] 1.1 Task title here
 *   - depends: 1.0
 * - [x] 1.2 Already done task
 *
 * ## Phase B
 * - [ ] 2.1 Another task
 *   - depends: 1.1, 1.2
 * ```
 *
 * Task IDs are extracted from the numbered prefix (e.g. "1.1", "3.1.2").
 * If no numbered prefix exists, a slug is generated from the title.
 * Dependencies are parsed from `- depends: id1, id2` lines indented under a task.
 */
export function parsePlanMarkdown(markdown: string, sourceFile: string): PlanBoard {
  const lines = markdown.split(/\r?\n/);
  const tasks: PlanTask[] = [];
  let planName = 'Untitled Plan';

  // Extract plan title from first H1
  for (const line of lines) {
    const h1Match = line.match(/^#\s+(.+)/);
    if (h1Match) {
      planName = h1Match[1].trim();
      break;
    }
  }

  // Parse tasks from checklist items
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match checklist items: "- [ ] ..." or "- [x] ..."
    const taskMatch = line.match(/^(\s*)- \[([ xX])\]\s+(.+)/);
    if (!taskMatch) continue;

    const isDone = taskMatch[2].toLowerCase() === 'x';
    const rawTitle = taskMatch[3].trim();

    // Extract task ID from numbered prefix (e.g. "3.1.2 Title" → id="3.1.2", title="Title")
    const idMatch = rawTitle.match(/^([\d]+(?:\.[\d]+(?:[a-z])?)*)\s+(.+)/);
    let taskId: string;
    let title: string;
    if (idMatch) {
      taskId = idMatch[1];
      title = idMatch[2];
    } else {
      // Generate ID from title slug
      taskId = rawTitle
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40);
      title = rawTitle;
    }

    // Remove trailing HTML comments (<!-- ... -->)
    title = title.replace(/<!--.*?-->/g, '').trim();

    // Look ahead for dependency lines and description
    const blockedBy: string[] = [];
    let description = '';
    for (let j = i + 1; j < lines.length; j++) {
      const nextLine = lines[j];
      // Stop at the next task or section header
      if (/^\s*- \[[ xX]\]/.test(nextLine) || /^#{1,3}\s/.test(nextLine)) break;

      // Check for dependency annotation
      const depMatch = nextLine.match(/^\s+-\s*depends:\s*(.+)/i);
      if (depMatch) {
        const deps = depMatch[1].split(',').map((d) => d.trim()).filter(Boolean);
        blockedBy.push(...deps);
      } else {
        // Treat as description text
        const trimmed = nextLine.trim();
        if (trimmed && !trimmed.startsWith('-')) {
          description += (description ? ' ' : '') + trimmed;
        }
      }
    }

    // Determine initial status
    let status: TaskStatus = isDone ? 'done' : 'pending';
    if (!isDone && blockedBy.length > 0) {
      // Will be resolved to 'blocked' or 'pending' at load time
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
      notes: [],
    });
  }

  // Resolve blocked status: if any dependency is not 'done', mark as 'blocked'
  resolveBlockedStatus(tasks);

  const now = Date.now();
  return {
    name: planName,
    sourceFile,
    tasks,
    createdAt: now,
    lastUpdatedAt: now,
  };
}

/** Recalculate 'blocked' status based on dependency completion. */
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

// ── Plan Board Manager ──────────────────────────────────────────────────────

export class PlanBoardManager {
  private board: PlanBoard | null = null;
  private changeListeners: Array<(board: PlanBoard | null) => void> = [];

  /** Register a callback invoked whenever the plan changes. */
  onChange(listener: (board: PlanBoard | null) => void): void {
    this.changeListeners.push(listener);
  }

  private notifyChange(): void {
    for (const fn of this.changeListeners) fn(this.board);
  }

  /** Load a plan from parsed markdown. Replaces any existing plan. */
  loadPlan(markdown: string, sourceFile: string): PlanBoard {
    this.board = parsePlanMarkdown(markdown, sourceFile);
    this.notifyChange();
    return this.board;
  }

  /** Get the current plan board, or null if none loaded. */
  getPlan(): PlanBoard | null {
    return this.board;
  }

  /**
   * Atomically claim a task. Fails if:
   * - No plan loaded
   * - Task not found
   * - Task is not in a claimable state (pending)
   * - Task is blocked by incomplete dependencies
   */
  claimTask(
    taskId: string,
    agentId: string,
    agentName?: string,
  ): { success: boolean; error?: string; task?: PlanTask } {
    if (!this.board) {
      return { success: false, error: 'No plan loaded' };
    }

    const task = this.board.tasks.find((t) => t.id === taskId);
    if (!task) {
      return { success: false, error: `Task not found: ${taskId}` };
    }

    // Check dependencies
    if (task.blockedBy.length > 0) {
      const allDepsComplete = task.blockedBy.every((dep) => {
        const depTask = this.board!.tasks.find((t) => t.id === dep);
        return depTask?.status === 'done';
      });
      if (!allDepsComplete) {
        return {
          success: false,
          error: `Task is blocked by incomplete dependencies: ${task.blockedBy.join(', ')}`,
          task,
        };
      }
    }

    // Check if already claimed by someone else
    if (task.status === 'claimed' || task.status === 'in_progress') {
      if (task.assignee !== agentId) {
        return {
          success: false,
          error: `Task already claimed by ${task.assigneeName ?? task.assignee}`,
          task,
        };
      }
      // Same agent re-claiming — allow (idempotent)
      return { success: true, task };
    }

    if (task.status === 'done') {
      return { success: false, error: 'Task is already done', task };
    }

    if (task.status === 'failed') {
      // Allow re-claiming a failed task
    }

    // Claim it
    task.status = 'claimed';
    task.assignee = agentId;
    task.assigneeName = agentName ?? agentId;
    task.claimedAt = Date.now();
    this.board.lastUpdatedAt = Date.now();
    this.notifyChange();

    return { success: true, task };
  }

  /**
   * Update a task's status. Only the assignee (or any agent for unclaimed tasks) can update.
   */
  updateTask(
    taskId: string,
    agentId: string,
    status: TaskStatus,
    note?: string,
    agentName?: string,
  ): { success: boolean; error?: string; task?: PlanTask } {
    if (!this.board) {
      return { success: false, error: 'No plan loaded' };
    }

    const task = this.board.tasks.find((t) => t.id === taskId);
    if (!task) {
      return { success: false, error: `Task not found: ${taskId}` };
    }

    // Only the assignee can update a claimed/in-progress task
    if (task.assignee && task.assignee !== agentId) {
      return {
        success: false,
        error: `Task is owned by ${task.assigneeName ?? task.assignee}`,
        task,
      };
    }

    task.status = status;

    if (status === 'in_progress' && !task.assignee) {
      task.assignee = agentId;
      task.assigneeName = agentName ?? agentId;
      task.claimedAt = Date.now();
    }

    if (status === 'done' || status === 'failed') {
      task.completedAt = Date.now();

      // When a task completes, re-evaluate blocked tasks
      if (status === 'done') {
        this.unblockDependents(taskId);
      }
    }

    if (note) {
      task.notes.push({
        agentId,
        agentName: agentName ?? agentId,
        text: note,
        ts: Date.now(),
      });
    }

    this.board.lastUpdatedAt = Date.now();
    this.notifyChange();
    return { success: true, task };
  }

  /** When a task completes, check if any blocked tasks can now proceed. */
  private unblockDependents(completedTaskId: string): void {
    if (!this.board) return;
    for (const task of this.board.tasks) {
      if (task.status !== 'blocked') continue;
      if (!task.blockedBy.includes(completedTaskId)) continue;

      const allDepsComplete = task.blockedBy.every((dep) => {
        const depTask = this.board!.tasks.find((t) => t.id === dep);
        return depTask?.status === 'done';
      });
      if (allDepsComplete) {
        task.status = 'pending';
      }
    }
  }

  /** Clear the current plan. */
  clear(): void {
    this.board = null;
    this.notifyChange();
  }
}
