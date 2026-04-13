/**
 * Worker watchdog — detect spawned workers that have gone silent and auto-fail
 * them so the orchestrator's inbox receives a notification (via Phase 3 plumbing).
 *
 * Silence = no AgentEvent received from the worker in `timeoutMs`. A worker
 * actively doing work emits tool.call / tool.result / task.progress events
 * constantly, so real silence almost always means the CLI is stuck on a
 * permission prompt, a network hang, or a crashed subprocess.
 *
 * What is excluded:
 * - Interactive workers (`SpawnedAgentInfo.interactive === true`) — they're
 *   expected to wait for the user.
 * - Workers with no claimed / in_progress task — they're just idle, not stuck.
 */

import type { PlanBoardManager } from './planBoard.js';
import type { SpawnRegistry } from './spawnRegistry.js';

export interface WatchdogDeps {
  spawnRegistry: Pick<SpawnRegistry, 'getSpawnedAgents' | 'stop'>;
  planBoardManager: Pick<PlanBoardManager, 'getAllPlans'>;
  /** Emit a synthetic task.fail event so Phase 3 pushes a notification to the orchestrator. */
  emitTaskFail: (agentId: string, taskId: string, reason: string) => void;
  /** Timeout in milliseconds. 0 disables the watchdog. */
  timeoutMs: number;
  /** How often to tick. Exposed for tests; default 30s. */
  tickMs?: number;
  /** Clock source — swappable for tests. */
  now?: () => number;
}

export class Watchdog {
  private lastActivity = new Map<string, number>();
  private tickHandle: ReturnType<typeof setInterval> | null = null;
  private firedFor = new Set<string>();
  private deps: WatchdogDeps;
  private now: () => number;

  constructor(deps: WatchdogDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
  }

  /** Record activity for an agent — called on every incoming AgentEvent. */
  onActivity(agentId: string): void {
    if (!agentId) return;
    this.lastActivity.set(agentId, this.now());
    // Agent is alive again — allow it to be re-killed on next silence
    this.firedFor.delete(agentId);
  }

  /** Change the timeout at runtime (e.g. setting changed). 0 disables. */
  setTimeoutMs(ms: number): void {
    this.deps.timeoutMs = ms;
    if (ms <= 0) this.stop();
  }

  /** Start the periodic tick. Idempotent. */
  start(): void {
    if (this.tickHandle !== null) return;
    if (this.deps.timeoutMs <= 0) return;
    const tickMs = this.deps.tickMs ?? 30_000;
    this.tickHandle = setInterval(() => this.tick(), tickMs);
    // Node's Timeout has .unref(); guard for environments (browser / tests) without it
    (this.tickHandle as unknown as { unref?: () => void }).unref?.();
  }

  stop(): void {
    if (this.tickHandle !== null) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
  }

  /** Public for tests — run one check pass. */
  tick(): void {
    const timeoutMs = this.deps.timeoutMs;
    if (timeoutMs <= 0) return;

    const spawned = this.deps.spawnRegistry.getSpawnedAgents();
    if (spawned.size === 0) return;

    // Index claimed/in-progress tasks by assignee for O(1) lookup
    const activeTaskByAgent = new Map<string, string>();
    for (const plan of this.deps.planBoardManager.getAllPlans()) {
      if (plan.status !== 'active') continue;
      for (const task of plan.tasks) {
        if (task.status !== 'claimed' && task.status !== 'in_progress') continue;
        if (task.assignee) activeTaskByAgent.set(task.assignee, task.id);
      }
    }

    const now = this.now();
    for (const [agentId, info] of spawned) {
      if (info.interactive) continue;
      if (this.firedFor.has(agentId)) continue;
      const taskId = activeTaskByAgent.get(agentId);
      if (!taskId) continue;

      // Use spawnedAt as the initial baseline — protects against watchdog firing
      // during the brief window between spawn and the agent's first event.
      const last = this.lastActivity.get(agentId) ?? info.spawnedAt;
      const idleMs = now - last;
      if (idleMs < timeoutMs) continue;

      this.firedFor.add(agentId);
      const reason = `watchdog: worker silent for ${Math.round(idleMs / 60_000)} minutes (no events since last activity). Likely stuck on a permission prompt or hung.`;
      try {
        this.deps.emitTaskFail(agentId, taskId, reason);
      } catch { /* ignore emitter errors */ }
      // Also kill the process so it stops burning tokens
      void this.deps.spawnRegistry.stop(agentId).catch(() => { /* ignore */ });
    }
  }
}
