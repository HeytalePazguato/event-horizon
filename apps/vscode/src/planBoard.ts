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

export type DependencyFailurePolicy = 'cascade' | 'block' | 'ignore';

export type SchedulingStrategy = 'manual' | 'round-robin' | 'least-busy' | 'capability-match' | 'dependency-first';

export type TaskComplexity = 'low' | 'medium' | 'high';
export type VerificationStatus = 'pending' | 'passed' | 'failed';

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
  retryCount: number;
  maxRetries: number;
  failedReason: string | null;
  acceptanceCriteria: string | null;
  verifyCommand: string | null;
  complexity: TaskComplexity | null;
  modelTier: string | null;
  verificationStatus: VerificationStatus | null;
}

export interface PlanBoard {
  id: string;
  name: string;
  sourceFile: string;
  status: PlanStatus;
  tasks: PlanTask[];
  createdAt: number;
  lastUpdatedAt: number;
  onDependencyFailure: DependencyFailurePolicy;
  maxAutoRetries: number;
  orchestratorAgentId: string | null;
  strategy: SchedulingStrategy;
  maxBudgetUsd: number | null;
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
  let onDependencyFailure: DependencyFailurePolicy = 'cascade';
  let maxAutoRetries = 0;
  let strategy: SchedulingStrategy = 'manual';
  let maxBudgetUsd: number | null = null;

  for (const line of lines) {
    const h1Match = line.match(/^#\s+(.+)/);
    if (h1Match) {
      planName = h1Match[1].trim();
      break;
    }
  }

  // Parse plan metadata from HTML comments: <!-- onDependencyFailure: cascade --> <!-- maxAutoRetries: 2 -->
  for (const line of lines) {
    const policyMatch = line.match(/onDependencyFailure:\s*(cascade|block|ignore)/i);
    if (policyMatch) {
      onDependencyFailure = policyMatch[1].toLowerCase() as DependencyFailurePolicy;
    }
    const retryMatch = line.match(/maxAutoRetries:\s*(\d+)/i);
    if (retryMatch) {
      maxAutoRetries = parseInt(retryMatch[1], 10);
    }
    const strategyMatch = line.match(/strategy:\s*(manual|round-robin|least-busy|capability-match|dependency-first)/i);
    if (strategyMatch) {
      strategy = strategyMatch[1].toLowerCase() as SchedulingStrategy;
    }
    const budgetMatch = line.match(/maxBudgetUsd:\s*([\d.]+)/i);
    if (budgetMatch) {
      maxBudgetUsd = parseFloat(budgetMatch[1]);
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
    let acceptanceCriteria: string | null = null;
    let verifyCommand: string | null = null;
    let complexity: TaskComplexity | null = null;
    let modelTier: string | null = null;
    for (let j = i + 1; j < lines.length; j++) {
      const nextLine = lines[j];
      if (/^\s*- \[[ xX]\]/.test(nextLine) || /^#{1,3}\s/.test(nextLine)) break;

      const depMatch = nextLine.match(/^\s+-\s*depends:\s*(.+)/i);
      if (depMatch) {
        const deps = depMatch[1].split(',').map((d) => d.trim()).filter(Boolean);
        blockedBy.push(...deps);
        continue;
      }

      // Parse acceptance criteria: - **Accept**: ...
      const acceptMatch = nextLine.match(/^\s+-\s*\*\*Accept\*\*:\s*(.+)/i);
      if (acceptMatch) {
        acceptanceCriteria = acceptMatch[1].trim();
        continue;
      }

      // Parse verify command: - **Verify**: ...
      const verifyMatch = nextLine.match(/^\s+-\s*\*\*Verify\*\*:\s*(.+)/i);
      if (verifyMatch) {
        verifyCommand = verifyMatch[1].trim().replace(/^`+|`+$/g, '');
        continue;
      }

      // Parse complexity from HTML comment: <!-- complexity: low|medium|high -->
      const complexityMatch = nextLine.match(/<!--\s*complexity:\s*(low|medium|high)\s*-->/i);
      if (complexityMatch) {
        complexity = complexityMatch[1].toLowerCase() as TaskComplexity;
        // Don't continue — the line may also contain description text
      }

      // Parse model tier from HTML comment: <!-- model: haiku|sonnet|opus|... -->
      const modelMatch = nextLine.match(/<!--\s*model:\s*(\S+)\s*-->/i);
      if (modelMatch) {
        modelTier = modelMatch[1].toLowerCase();
        // Don't continue — the line may also contain description text
      }

      const trimmed = nextLine.trim();
      if (trimmed && !trimmed.startsWith('-')) {
        // Strip any HTML comments from the line before adding to description
        let descLine = trimmed;
        let cs = descLine.indexOf('<!--');
        while (cs !== -1) {
          const ce = descLine.indexOf('-->', cs + 4);
          if (ce === -1) break;
          descLine = descLine.slice(0, cs) + descLine.slice(ce + 3);
          cs = descLine.indexOf('<!--');
        }
        descLine = descLine.trim();
        if (descLine) {
          description += (description ? ' ' : '') + descLine;
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
      retryCount: 0,
      maxRetries: 0,
      failedReason: null,
      acceptanceCriteria,
      verifyCommand,
      complexity,
      modelTier,
      verificationStatus: null,
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
    onDependencyFailure,
    maxAutoRetries,
    orchestratorAgentId: null,
    strategy,
    maxBudgetUsd,
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
  loadPlan(markdown: string, sourceFile: string, agentId?: string): PlanBoard {
    const board = parsePlanMarkdown(markdown, sourceFile);

    // Handle ID collisions from different files
    if (this.boards.has(board.id) && this.boards.get(board.id)!.sourceFile !== sourceFile) {
      let suffix = 2;
      while (this.boards.has(`${board.id}-${suffix}`)) suffix++;
      board.id = `${board.id}-${suffix}`;
    }

    // Auto-promote the creating agent to orchestrator
    if (agentId) {
      board.orchestratorAgentId = agentId;
    }

    this.boards.set(board.id, board);
    this.activePlanId = board.id;
    this.notifyChange(board.id);
    return board;
  }

  /** Check if an agent is orchestrator for a given plan (or any plan).
   *  Auto-promotes if no orchestrator is set and there's only one active plan. */
  isOrchestrator(agentId: string, planId?: string): boolean {
    if (planId) {
      const board = this.boards.get(planId);
      if (!board) return false;
      if (board.orchestratorAgentId === agentId) return true;
      // Auto-promote if no orchestrator is set
      if (!board.orchestratorAgentId) {
        board.orchestratorAgentId = agentId;
        board.lastUpdatedAt = Date.now();
        this.notifyChange(board.id);
        return true;
      }
      return false;
    }
    // Check all plans
    for (const board of this.boards.values()) {
      if (board.orchestratorAgentId === agentId) return true;
    }
    // Auto-promote: if there's exactly one active plan with no orchestrator, claim it
    const activePlans = Array.from(this.boards.values()).filter((b) => b.status === 'active');
    if (activePlans.length === 1 && !activePlans[0].orchestratorAgentId) {
      activePlans[0].orchestratorAgentId = agentId;
      activePlans[0].lastUpdatedAt = Date.now();
      this.notifyChange(activePlans[0].id);
      return true;
    }
    return false;
  }

  /** Claim orchestrator role for a plan. Only succeeds if current orchestrator is null or disconnected. */
  claimOrchestrator(agentId: string, planId?: string, connectedAgentIds?: Set<string>): { success: boolean; error?: string } {
    const board = this.resolvePlan(planId);
    if (!board) {
      return { success: false, error: planId ? `Plan not found: ${planId}` : 'No plan loaded' };
    }
    if (board.orchestratorAgentId === agentId) {
      return { success: true }; // Already orchestrator
    }
    if (board.orchestratorAgentId) {
      // Only allow claiming if current orchestrator is disconnected
      if (connectedAgentIds && connectedAgentIds.has(board.orchestratorAgentId)) {
        return { success: false, error: `Orchestrator ${board.orchestratorAgentId} is still connected` };
      }
    }
    board.orchestratorAgentId = agentId;
    board.lastUpdatedAt = Date.now();
    this.notifyChange(board.id);
    return { success: true };
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
      } else if (status === 'failed') {
        if (note) {
          task.failedReason = note;
        }
        // Auto-retry: if the plan has maxAutoRetries configured and the task hasn't exceeded it
        if (board.maxAutoRetries > 0 && task.retryCount < board.maxAutoRetries) {
          // Don't cascade — schedule an auto-retry instead
          if (note) {
            task.notes.push({ agentId, agentName: agentName ?? agentId, text: note, ts: Date.now() });
          }
          board.lastUpdatedAt = Date.now();
          this.notifyChange(board.id);
          this.retryTask(taskId, board.id);
          return { success: true, task, planId: board.id };
        }
        this.cascadeFailure(board, taskId);
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

  /**
   * Cascade failure: when a task fails, recursively mark all transitive dependents as failed.
   * Respects the plan's onDependencyFailure policy.
   */
  private cascadeFailure(board: PlanBoard, failedTaskId: string): string[] {
    if (board.onDependencyFailure !== 'cascade') return [];

    const cascaded: string[] = [];
    const queue = [failedTaskId];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      for (const task of board.tasks) {
        if (task.status === 'done' || task.status === 'failed') continue;
        if (!task.blockedBy.includes(currentId)) continue;
        task.status = 'failed';
        task.completedAt = Date.now();
        task.failedReason = `Cascade: dependency '${currentId}' failed`;
        cascaded.push(task.id);
        queue.push(task.id);
      }
    }

    return cascaded;
  }

  /**
   * Un-cascade: when a root task is retried, reset all cascade-failed dependents back to blocked.
   */
  private uncascade(board: PlanBoard, retriedTaskId: string): string[] {
    const uncascaded: string[] = [];
    const queue = [retriedTaskId];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      for (const task of board.tasks) {
        if (task.status !== 'failed') continue;
        if (!task.failedReason?.includes(`'${currentId}'`)) continue;
        task.status = 'blocked';
        task.completedAt = null;
        task.failedReason = null;
        uncascaded.push(task.id);
        queue.push(task.id);
      }
    }

    return uncascaded;
  }

  /**
   * Retry a failed task: reset it to pending, increment retry count,
   * and un-cascade any dependents that were failed due to this task.
   */
  retryTask(
    taskId: string,
    planId?: string,
  ): { success: boolean; error?: string; task?: PlanTask; uncascaded?: string[]; planId?: string; retryAfterMs?: number } {
    const board = this.resolvePlan(planId);
    if (!board) {
      return { success: false, error: planId ? `Plan not found: ${planId}` : 'No plan loaded' };
    }

    const task = board.tasks.find((t) => t.id === taskId);
    if (!task) {
      return { success: false, error: `Task not found: ${taskId}` };
    }

    if (task.status !== 'failed') {
      return { success: false, error: `Task is not failed (status: ${task.status})` };
    }

    if (task.maxRetries > 0 && task.retryCount >= task.maxRetries) {
      return { success: false, error: `Max retries (${task.maxRetries}) exceeded` };
    }

    task.retryCount++;
    task.status = 'pending';
    task.assignee = null;
    task.assigneeName = null;
    task.claimedAt = null;
    task.completedAt = null;
    task.failedReason = null;

    // Re-check if this task should be blocked (its own deps may not be done)
    const allDepsComplete = task.blockedBy.every((dep) => {
      const depTask = board.tasks.find((t) => t.id === dep);
      return depTask?.status === 'done';
    });
    if (!allDepsComplete && task.blockedBy.length > 0) {
      task.status = 'blocked';
    }

    // Un-cascade: reset dependents that were cascade-failed
    const uncascaded = this.uncascade(board, taskId);

    // Plan may have been completed — re-activate
    if (board.status === 'completed') {
      board.status = 'active';
    }

    board.lastUpdatedAt = Date.now();
    this.notifyChange(board.id);
    const retryAfterMs = Math.min(1000 * Math.pow(2, task.retryCount - 1), 30000);
    return { success: true, task, uncascaded, planId: board.id, retryAfterMs };
  }

  /**
   * Validate task dependencies: detect cycles using DFS coloring.
   * Returns array of cycle descriptions, empty if no cycles.
   */
  validateDependencies(planId?: string): string[] {
    const board = this.resolvePlan(planId);
    if (!board) return [];

    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<string, number>();
    const cycles: string[] = [];

    for (const task of board.tasks) {
      color.set(task.id, WHITE);
    }

    const taskById = new Map(board.tasks.map((t) => [t.id, t]));

    function dfs(taskId: string, path: string[]): void {
      color.set(taskId, GRAY);
      path.push(taskId);

      const task = taskById.get(taskId);
      if (task) {
        for (const dep of task.blockedBy) {
          if (color.get(dep) === GRAY) {
            const cycleStart = path.indexOf(dep);
            cycles.push(`Cycle: ${path.slice(cycleStart).join(' → ')} → ${dep}`);
          } else if (color.get(dep) === WHITE) {
            dfs(dep, path);
          }
        }
      }

      path.pop();
      color.set(taskId, BLACK);
    }

    for (const task of board.tasks) {
      if (color.get(task.id) === WHITE) {
        dfs(task.id, []);
      }
    }

    return cycles;
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
