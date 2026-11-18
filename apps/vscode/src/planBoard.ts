/**
 * Plan Board — multi-agent task coordination with multi-plan support.
 * Agents load shared plans from markdown files, claim tasks atomically,
 * and report progress. State is held in-memory (persisted via VS Code
 * globalState externally by extension.ts).
 */

import * as path from 'path';
import type { ModelTierManager } from './modelTierManager.js';
import { mergePlan } from './planMerge.js';
import type { MergeDiff } from './planMerge.js';

// ── Data model ──────────────────────────────────────────────────────────────

export interface TaskNote {
  agentId: string;
  agentName: string;
  text: string;
  ts: number;
}

export type TaskStatus = 'pending' | 'claimed' | 'in_progress' | 'done' | 'failed' | 'blocked' | 'cancelling' | 'aborted';

/** How many removed-task records a board keeps for since_revision pollers. */
const MAX_REMOVED_TRACKED = 500;
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
  /** Board revision at which this task last changed. */
  changedAtRevision: number;
  /** Why the task was cancelled/aborted (set by plan-file sync). */
  cancelReason: string | null;
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
  /** Recently removed task IDs with the revision that removed them, so
   *  since_revision pollers learn about removals. Capped; oldest dropped. */
  removedTasks?: Array<{ id: string; revision: number }>;
  /** Monotonic counter, incremented once per mutating call. Starts at 1. */
  revision: number;
  /** True when the source markdown file is missing on disk. */
  sourceMissing: boolean;
  /** Hash of the last content this extension wrote to the source file (to ignore self-writes). */
  lastSelfWriteHash: string | null;
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
      changedAtRevision: 1,
      cancelReason: null,
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
    revision: 1,
    sourceMissing: false,
    lastSelfWriteHash: null,
  };
}

/** Normalize a plan source path for comparison. `inline` is returned unchanged. */
export function normalizeSourceFile(sourceFile: string): string {
  if (sourceFile === 'inline') return sourceFile;
  const resolved = path.resolve(sourceFile);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export type ApplyFileChangeReason = 'not-orchestrator' | 'renumber' | 'duplicate-ids' | 'parse-error' | 'not-found';

export interface LoadOrMergeResult {
  board: PlanBoard;
  /** Null when the plan was loaded fresh (no merge happened). */
  diff: MergeDiff | null;
  /** False only when a merge was attempted and refused (renumber / duplicate IDs). */
  applied: boolean;
}

export function resolveBlockedStatus(tasks: PlanTask[]): void {
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
  private taskCancellingListeners: Array<(task: PlanTask, planId: string) => void> = [];
  private modelTierManager: ModelTierManager | null;

  constructor(modelTierManager?: ModelTierManager) {
    this.modelTierManager = modelTierManager ?? null;
  }

  /** Provide (or replace) the ModelTierManager used to derive model tiers from task complexity. */
  setModelTierManager(m: ModelTierManager | null): void {
    this.modelTierManager = m;
  }

  onChange(listener: (boards: Map<string, PlanBoard>, changedPlanId: string | null) => void): void {
    this.changeListeners.push(listener);
  }

  onTaskComplete(fn: (task: PlanTask, planId: string) => void): void {
    this.taskCompleteListeners.push(fn);
  }

  onTaskClaim(fn: (task: PlanTask, planId: string) => void): void {
    this.taskClaimListeners.push(fn);
  }

  /** Fired whenever a task enters `cancelling` (from a file merge or `cancelTask`). */
  onTaskCancelling(fn: (task: PlanTask, planId: string) => void): void {
    this.taskCancellingListeners.push(fn);
  }

  private notifyChange(changedPlanId: string | null): void {
    for (const fn of this.changeListeners) fn(this.boards, changedPlanId);
  }

  private notifyCancelling(board: PlanBoard, taskIds: Iterable<string>): void {
    for (const id of taskIds) {
      const task = board.tasks.find((t) => t.id === id);
      if (!task) continue;
      for (const fn of this.taskCancellingListeners) fn(task, board.id);
    }
  }

  /** Parse markdown and derive model tiers. Separate method so tests can simulate parse failures. */
  private parseWithTiers(markdown: string, sourceFile: string): PlanBoard {
    const board = parsePlanMarkdown(markdown, sourceFile);

    // Derive a model tier from complexity when no explicit <!-- model --> comment
    // was given. An explicit model comment always wins (task.modelTier is already set).
    if (this.modelTierManager) {
      for (const task of board.tasks) {
        if (task.modelTier === null && task.complexity !== null) {
          task.modelTier = this.modelTierManager.getRecommendedModel(task.complexity, task.role ?? '');
        }
      }
    }
    return board;
  }

  /** Find a non-archived board bound to the given source file (never matches `inline`). */
  private findBySourceFile(sourceFile: string): PlanBoard | null {
    if (sourceFile === 'inline') return null;
    const norm = normalizeSourceFile(sourceFile);
    for (const board of this.boards.values()) {
      if (board.status === 'archived' || board.sourceFile === 'inline') continue;
      if (normalizeSourceFile(board.sourceFile) === norm) return board;
    }
    return null;
  }

  /** True when a merge changed anything worth a revision (tasks or plan-level settings). */
  private static mergeChanged(live: PlanBoard, merged: PlanBoard, diff: MergeDiff): boolean {
    return diff.added.length > 0 || diff.updated.length > 0 || diff.removed.length > 0 ||
      diff.cancelling.length > 0 || live.name !== merged.name || live.strategy !== merged.strategy ||
      live.onDependencyFailure !== merged.onDependencyFailure || live.maxAutoRetries !== merged.maxAutoRetries ||
      live.maxBudgetUsd !== merged.maxBudgetUsd ||
      live.tasks.map((t) => t.id).join('\n') !== merged.tasks.map((t) => t.id).join('\n');
  }

  /**
   * Install a merged board in place of the live one: bumps once with the touched
   * IDs, re-evaluates plan completion, notifies, and fires cancelling listeners.
   */
  private commitMerge(live: PlanBoard, merged: PlanBoard, diff: MergeDiff, force = false): void {
    const changed = force || PlanBoardManager.mergeChanged(live, merged, diff);
    if (merged.status === 'completed' && merged.tasks.some((t) => t.status !== 'done' && t.status !== 'aborted')) {
      merged.status = 'active';
    }
    this.checkAutoComplete(merged);
    if (changed || merged.status !== live.status) {
      if (diff.removed.length > 0) this.recordRemoved(merged, diff.removed);
      this.bump(merged, [...diff.added, ...diff.updated, ...diff.cancelling]);
    }
    this.boards.set(merged.id, merged);
    this.notifyChange(merged.id);
    this.notifyCancelling(merged, diff.cancelling);
  }

  /**
   * Load a plan from markdown. If a non-archived board is already bound to the
   * same source file, the new content is merged into it by task ID (claims,
   * notes and verification survive). Otherwise the plan is loaded fresh.
   */
  loadOrMergePlan(markdown: string, sourceFile: string, agentId?: string): LoadOrMergeResult {
    const existing = this.findBySourceFile(sourceFile);
    if (existing) {
      const parsed = this.parseWithTiers(markdown, existing.sourceFile);
      const { board, diff, applied } = mergePlan(existing, parsed);
      if (!applied) return { board: existing, diff, applied: false };
      if (agentId && !board.orchestratorAgentId) board.orchestratorAgentId = agentId;
      const orchestratorChanged = board.orchestratorAgentId !== existing.orchestratorAgentId;
      this.activePlanId = board.id;
      this.commitMerge(existing, board, diff, orchestratorChanged);
      return { board, diff, applied: true };
    }
    return { board: this.loadFresh(markdown, sourceFile, agentId), diff: null, applied: true };
  }

  /** Load a plan from markdown (back-compat wrapper around `loadOrMergePlan`). */
  loadPlan(markdown: string, sourceFile: string, agentId?: string): PlanBoard {
    return this.loadOrMergePlan(markdown, sourceFile, agentId).board;
  }

  /**
   * Bind an existing `inline` plan to a file: merge the file content into it
   * and set its `sourceFile`. The plan keeps its ID.
   */
  rebindPlan(
    planId: string,
    markdown: string,
    absPath: string,
  ): { success: boolean; error?: string; board?: PlanBoard; diff?: MergeDiff; applied?: boolean } {
    const live = this.boards.get(planId);
    if (!live) return { success: false, error: `Plan not found: ${planId}` };
    if (live.sourceFile !== 'inline') {
      return { success: false, error: `Plan ${planId} is already bound to ${live.sourceFile}` };
    }
    let parsed: PlanBoard;
    try {
      parsed = this.parseWithTiers(markdown, absPath);
    } catch (err) {
      return { success: false, error: `Failed to parse plan: ${err instanceof Error ? err.message : String(err)}` };
    }
    const { board, diff, applied } = mergePlan(live, parsed);
    if (!applied) return { success: true, board: live, diff, applied: false };
    board.sourceFile = absPath;
    board.sourceMissing = false;
    this.activePlanId = board.id;
    this.commitMerge(live, board, diff, true);
    return { success: true, board, diff, applied: true };
  }

  /**
   * Apply an on-disk edit of a plan's source file. Only the orchestrator (or an
   * unattributed edit) may change the plan. A failed parse, a suspected mass
   * renumbering, or duplicate IDs leave the live board untouched.
   */
  applyFileChange(
    planId: string,
    markdown: string,
    editorAgentId: string | null,
  ): { applied: boolean; diff?: MergeDiff; reason?: ApplyFileChangeReason } {
    const live = this.boards.get(planId);
    if (!live) return { applied: false, reason: 'not-found' };
    if (editorAgentId && live.orchestratorAgentId && editorAgentId !== live.orchestratorAgentId) {
      return { applied: false, reason: 'not-orchestrator' };
    }

    let result: ReturnType<typeof mergePlan>;
    try {
      const parsed = this.parseWithTiers(markdown, live.sourceFile);
      // A file that parses to zero tasks while the board has some is almost
      // certainly a truncated / half-written save — never wipe the board for it.
      if (parsed.tasks.length === 0 && live.tasks.length > 0) {
        return { applied: false, reason: 'parse-error' };
      }
      result = mergePlan(live, parsed);
    } catch {
      return { applied: false, reason: 'parse-error' };
    }

    const { board, diff, applied } = result;
    if (!applied) {
      return { applied: false, diff, reason: diff.duplicateIds.length > 0 ? 'duplicate-ids' : 'renumber' };
    }
    const wasMissing = board.sourceMissing;
    board.sourceMissing = false;
    this.commitMerge(live, board, diff, wasMissing);
    return { applied: true, diff };
  }

  /** Fresh (non-merge) load. Replaces an existing plan with the same ID. */
  private loadFresh(markdown: string, sourceFile: string, agentId?: string): PlanBoard {
    const board = this.parseWithTiers(markdown, sourceFile);

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

    // Reloading over an existing plan continues its revision sequence
    const previous = this.boards.get(board.id);
    if (previous) {
      board.revision = previous.revision;
      this.bump(board, board.tasks.map((t) => t.id));
    }

    this.boards.set(board.id, board);
    this.activePlanId = board.id;
    this.notifyChange(board.id);
    return board;
  }

  /**
   * Record one mutation: increments the board revision once and stamps the
   * touched tasks with the new revision. Call exactly once per mutating call.
   */
  private bump(board: PlanBoard, taskIds: Iterable<string> = []): void {
    board.revision++;
    board.lastUpdatedAt = Date.now();
    const ids = new Set(taskIds);
    if (ids.size === 0) return;
    for (const t of board.tasks) {
      if (ids.has(t.id)) t.changedAtRevision = board.revision;
    }
  }

  /** Remember the hash of content we just wrote to the source file. Not a revision change. */
  setSelfWriteHash(planId: string, hash: string | null): void {
    const board = this.boards.get(planId);
    if (board) board.lastSelfWriteHash = hash;
  }

  /** Flag whether the plan's source file is missing. Bumps the revision only on change. */
  markSourceMissing(planId: string, missing: boolean): void {
    const board = this.boards.get(planId);
    if (!board || board.sourceMissing === missing) return;
    board.sourceMissing = missing;
    this.bump(board);
    this.notifyChange(board.id);
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
        this.bump(board);
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
      this.bump(activePlans[0]);
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
    this.bump(board);
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

  /** Map of planId → orchestratorAgentId, excluding plans without an orchestrator. */
  getOrchestratorMap(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [id, board] of this.boards) {
      if (board.orchestratorAgentId) {
        result[id] = board.orchestratorAgentId;
      }
    }
    return result;
  }

  /** Unique set of agent IDs currently acting as orchestrator on any plan. */
  getAllOrchestratorAgentIds(): Set<string> {
    const result = new Set<string>();
    for (const board of this.boards.values()) {
      if (board.orchestratorAgentId) {
        result.add(board.orchestratorAgentId);
      }
    }
    return result;
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

    if (task.status === 'cancelling' || task.status === 'aborted') {
      return { success: false, error: `Task is being cancelled (${task.cancelReason ?? 'cancelled by orchestrator'})`, task, planId: board.id };
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
    this.bump(board, [task.id]);
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

    const res = this.applyTaskUpdate(board, taskId, agentId, status, note, agentName);
    if (!res.success) return { success: false, error: res.error, task: res.task, planId: res.task ? board.id : undefined };
    this.bump(board, res.touched);
    this.notifyChange(board.id);
    return { success: true, task: res.task, planId: board.id };
  }

  /**
   * Update several tasks of one plan in a single call. Each task is validated
   * independently; the board revision is bumped once and listeners notified once.
   */
  updateTasks(
    taskIds: string[],
    agentId: string,
    status: TaskStatus,
    note?: string,
    agentName?: string,
    planId?: string,
  ): { updated: string[]; failed: Array<{ id: string; error: string }>; revision: number } {
    const board = this.resolvePlan(planId);
    if (!board) {
      const error = planId ? `Plan not found: ${planId}` : 'No plan loaded';
      return { updated: [], failed: taskIds.map((id) => ({ id, error })), revision: 0 };
    }
    const updated: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];
    const touched = new Set<string>();
    for (const id of taskIds) {
      const res = this.applyTaskUpdate(board, id, agentId, status, note, agentName);
      if (res.success) {
        updated.push(id);
        for (const t of res.touched) touched.add(t);
      } else {
        failed.push({ id, error: res.error ?? 'Update failed' });
      }
    }
    if (updated.length > 0) {
      this.bump(board, touched);
      this.notifyChange(board.id);
    }
    return { updated, failed, revision: board.revision };
  }

  /**
   * Validate and apply one task status change without bumping or notifying.
   * Returns the IDs touched so the caller can bump exactly once.
   */
  private applyTaskUpdate(
    board: PlanBoard,
    taskId: string,
    agentId: string,
    status: TaskStatus,
    note?: string,
    agentName?: string,
  ): { success: true; task: PlanTask; touched: Set<string> } | { success: false; error: string; task?: PlanTask } {
    const task = board.tasks.find((t) => t.id === taskId);
    if (!task) {
      return { success: false, error: `Task not found: ${taskId}` };
    }

    if (status === 'cancelling') {
      return { success: false, error: "Status 'cancelling' can only be set by the orchestrator via cancelTask", task };
    }

    if (status === 'aborted') {
      if (task.status !== 'cancelling') {
        return { success: false, error: `Task is not being cancelled (status: ${task.status}); 'aborted' only confirms a cancellation`, task };
      }
      const isAssignee = task.assignee === agentId;
      const isOrch = board.orchestratorAgentId === agentId;
      if (!isAssignee && !isOrch) {
        return { success: false, error: `Only the assignee (${task.assigneeName ?? task.assignee}) or the orchestrator can confirm the abort`, task };
      }
      if (note) {
        task.notes.push({ agentId, agentName: agentName ?? agentId, text: note, ts: Date.now() });
      }
      const touched = this.removeTasks(board, [task.id]);
      return { success: true, task, touched };
    }

    if (task.assignee && task.assignee !== agentId) {
      return { success: false, error: `Task is owned by ${task.assigneeName ?? task.assignee}`, task };
    }

    if (task.status === 'cancelling') {
      return {
        success: false,
        error: `Task was cancelled by the orchestrator (${task.cancelReason ?? 'no reason given'}). Stop work and set status 'aborted'.`,
        task,
      };
    }

    task.status = status;
    const touched = new Set<string>([task.id]);

    if (status === 'in_progress' && !task.assignee) {
      task.assignee = agentId;
      task.assigneeName = agentName ?? agentId;
      task.claimedAt = Date.now();
    }

    if (status === 'done' || status === 'failed') {
      task.completedAt = Date.now();
      if (status === 'done') {
        for (const id of this.unblockDependents(board, taskId)) touched.add(id);
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
          for (const id of this.applyRetry(board, task).uncascaded) touched.add(id);
          return { success: true, task, touched };
        }
        for (const id of this.cascadeFailure(board, taskId)) touched.add(id);
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

    return { success: true, task, touched };
  }

  /**
   * Cancel a task (orchestrator only). An unclaimed task is removed at once;
   * a claimed / in-progress task enters `cancelling` until its assignee
   * confirms with status `aborted` (or is auto-confirmed when lost).
   */
  cancelTask(
    planId: string | undefined,
    taskId: string,
    byAgentId: string,
    reason: string,
  ): { success: boolean; error?: string; status?: 'removed' | 'cancelling'; assignee?: string | null } {
    const board = this.resolvePlan(planId);
    if (!board) return { success: false, error: planId ? `Plan not found: ${planId}` : 'No plan loaded' };
    if (!this.isOrchestrator(byAgentId, board.id)) {
      return { success: false, error: 'Only the plan orchestrator can cancel tasks' };
    }
    const task = board.tasks.find((t) => t.id === taskId);
    if (!task) return { success: false, error: `Task not found: ${taskId}` };

    if (task.status === 'cancelling') {
      return { success: true, status: 'cancelling', assignee: task.assignee };
    }

    if (task.status === 'claimed' || task.status === 'in_progress') {
      task.status = 'cancelling';
      task.cancelReason = reason;
      this.bump(board, [task.id]);
      this.notifyChange(board.id);
      this.notifyCancelling(board, [task.id]);
      return { success: true, status: 'cancelling', assignee: task.assignee };
    }

    const touched = this.removeTasks(board, [task.id]);
    this.bump(board, touched);
    this.notifyChange(board.id);
    return { success: true, status: 'removed', assignee: null };
  }

  /**
   * Auto-confirm the abort of every `cancelling` task assigned to an agent that
   * is gone (stale / disconnected). Returns the removed task IDs.
   */
  confirmAbortForLostAgent(agentId: string): string[] {
    const removed: string[] = [];
    for (const board of this.boards.values()) {
      const ids = board.tasks.filter((t) => t.status === 'cancelling' && t.assignee === agentId).map((t) => t.id);
      if (ids.length === 0) continue;
      const touched = this.removeTasks(board, ids);
      this.bump(board, touched);
      this.notifyChange(board.id);
      removed.push(...ids);
    }
    return removed;
  }

  /**
   * Remove tasks from a board, strip them from other tasks' `blockedBy`, and
   * re-derive blocked/pending. No bump/notify. Returns IDs of surviving tasks
   * that changed (plus the removed IDs, harmless for `bump`).
   */
  /**
   * Record removed IDs against the NEXT revision. Every caller of removeTasks
   * (and commitMerge) bumps exactly once right after, so revision + 1 is the
   * revision that carries the removal.
   */
  private recordRemoved(board: PlanBoard, ids: Iterable<string>): void {
    const list = board.removedTasks ?? [];
    for (const id of ids) list.push({ id, revision: board.revision + 1 });
    board.removedTasks = list.length > MAX_REMOVED_TRACKED ? list.slice(-MAX_REMOVED_TRACKED) : list;
  }

  private removeTasks(board: PlanBoard, ids: string[]): Set<string> {
    this.recordRemoved(board, ids);
    const gone = new Set(ids);
    const touched = new Set<string>(ids);
    board.tasks = board.tasks.filter((t) => !gone.has(t.id));
    const before = new Map(board.tasks.map((t) => [t.id, t.status]));
    for (const t of board.tasks) {
      if (t.blockedBy.some((d) => gone.has(d))) {
        t.blockedBy = t.blockedBy.filter((d) => !gone.has(d));
        touched.add(t.id);
      }
    }
    const statusById = new Map(board.tasks.map((t) => [t.id, t.status]));
    for (const t of board.tasks) {
      if (t.status === 'blocked' && t.blockedBy.every((d) => statusById.get(d) === 'done')) {
        t.status = 'pending';
      }
    }
    resolveBlockedStatus(board.tasks);
    for (const t of board.tasks) {
      if (before.get(t.id) !== t.status) touched.add(t.id);
    }
    this.checkAutoComplete(board);
    return touched;
  }

  /** Archive a plan (mark as archived). */
  archivePlan(planId: string): { success: boolean; error?: string } {
    const board = this.boards.get(planId);
    if (!board) return { success: false, error: `Plan not found: ${planId}` };
    board.status = 'archived';
    this.bump(board);
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

  private unblockDependents(board: PlanBoard, completedTaskId: string): string[] {
    const unblocked: string[] = [];
    for (const task of board.tasks) {
      if (task.status !== 'blocked') continue;
      if (!task.blockedBy.includes(completedTaskId)) continue;
      const allDepsComplete = task.blockedBy.every((dep) => {
        const depTask = board.tasks.find((t) => t.id === dep);
        return depTask?.status === 'done';
      });
      if (allDepsComplete) {
        task.status = 'pending';
        unblocked.push(task.id);
      }
    }
    return unblocked;
  }

  /**
   * Auto-complete: if all tasks in a plan are done (aborted tasks are ignored),
   * mark plan as completed. A cancelling task is still incomplete.
   */
  private checkAutoComplete(board: PlanBoard): void {
    if (board.status !== 'active') return;
    const relevant = board.tasks.filter((t) => t.status !== 'aborted');
    const allDone = relevant.every((t) => t.status === 'done');
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

    const { uncascaded } = this.applyRetry(board, task);
    this.bump(board, [task.id, ...uncascaded]);
    this.notifyChange(board.id);
    const retryAfterMs = Math.min(1000 * Math.pow(2, task.retryCount - 1), 30000);
    return { success: true, task, uncascaded, planId: board.id, retryAfterMs };
  }

  /** Reset a failed task for retry without bumping/notifying (callers bump once). */
  private applyRetry(board: PlanBoard, task: PlanTask): { uncascaded: string[] } {
    const taskId = task.id;
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

    return { uncascaded };
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
      board.revision ??= 1;
      board.sourceMissing ??= false;
      board.lastSelfWriteHash ??= null;
      for (const t of board.tasks) {
        t.changedAtRevision ??= board.revision;
        t.cancelReason ??= null;
      }
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
