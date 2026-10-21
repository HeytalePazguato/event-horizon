/**
 * Agent Lifecycle Manager — the single authority on whether an agent is alive.
 * Every death signal (process exit, SessionEnd, OpenCode session events, heartbeat
 * loss, plan-task completion, manual purge) is funnelled through registerSignal();
 * onTerminate subscribers are the only path to `agent.terminate`.
 *
 * No `vscode` import: all host knowledge comes in through LifecycleDeps so the
 * class is unit-testable.
 */

import type { HeartbeatManager } from './heartbeatManager.js';

export type DeathSignal =
  | 'process-exit'
  | 'terminal-closed'
  | 'session-end'
  | 'opencode-session-idle'
  | 'opencode-session-deleted'
  | 'heartbeat-lost'
  | 'work-complete'
  | 'user-purge'
  /**
   * Not a death signal: any sign the agent is working again (OpenCode
   * `session.execution.started`, `session.status` busy, `message.*`, `tool.*`,
   * a Claude hook, a fresh heartbeat). Cancels a pending quiet-period timer and
   * clears heartbeat-lost eligibility.
   */
  | 'activity';

export interface LifecycleDeps {
  /** True while the agent holds a `claimed` / `in_progress` plan task. */
  hasActiveTask: (agentId: string) => boolean;
  heartbeat: Pick<HeartbeatManager, 'getStatus'>;
  /** Every agent the host currently tracks. Only consulted by `purgeStale({ includeStale: true })`. */
  knownAgentIds?: () => string[];
  /** True while the agent's OS process (spawned child or reported pid) is running. */
  isProcessAlive: (agentId: string) => boolean;
  /** True only for agents EH spawned in non-interactive mode (e.g. `opencode run` workers). */
  isSpawnedNonInteractive: (agentId: string) => boolean;
  /** Quiet period after a turn-end signal before a non-interactive worker is retired. Default 15s. */
  graceMs?: number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

/** Hard signals: the agent is gone, no further checks. */
const IMMEDIATE: ReadonlySet<DeathSignal> = new Set<DeathSignal>([
  'process-exit',
  'terminal-closed',
  'session-end',
  'opencode-session-deleted',
  'user-purge',
]);

/** Turn-end signals: "this turn finished", not "the agent is done" (spike 0.2). */
const TURN_END: ReadonlySet<DeathSignal> = new Set<DeathSignal>(['work-complete', 'opencode-session-idle']);

/** Interrupt reasons that say nothing about the user leaving (location shutdown / service eviction). */
const IGNORED_INTERRUPT_REASONS = new Set(['shutdown', 'inactivity']);

const DEFAULT_GRACE_MS = 15_000;

export class AgentLifecycleManager {
  private readonly deps: LifecycleDeps;
  private readonly graceMs: number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly terminated = new Set<string>();
  private readonly heartbeatLost = new Set<string>();
  private readonly quietTimers = new Map<string, unknown>();
  private readonly listeners: Array<(agentId: string, reason: DeathSignal) => void> = [];

  constructor(deps: LifecycleDeps) {
    this.deps = deps;
    this.graceMs = deps.graceMs ?? DEFAULT_GRACE_MS;
    // Resolve the globals lazily so fake timers installed after construction still apply.
    this.setTimer = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  /**
   * Feed a lifecycle signal for an agent. Signals for an already-terminated agent
   * are no-ops. `detail.reason` on `opencode-session-idle` carries the OpenCode
   * interrupt reason; `shutdown` / `inactivity` interrupts are ignored.
   */
  registerSignal(agentId: string, signal: DeathSignal, detail?: Record<string, unknown>): void {
    if (this.terminated.has(agentId)) return;

    if (signal === 'activity') {
      this.cancelQuietTimer(agentId);
      this.heartbeatLost.delete(agentId);
      return;
    }

    if (IMMEDIATE.has(signal)) {
      this.terminate(agentId, signal);
      return;
    }

    if (signal === 'heartbeat-lost') {
      // Never terminates on its own: idle interactive sessions stop beating too.
      // It only makes the agent a purgeStale() candidate.
      this.heartbeatLost.add(agentId);
      return;
    }

    if (TURN_END.has(signal)) {
      const reason = detail?.reason;
      if (typeof reason === 'string' && IGNORED_INTERRUPT_REASONS.has(reason)) return;
      // Interactive / user-started agents are never retired on a turn end — the
      // user ends the idle state by typing again.
      if (!this.isRetirable(agentId)) return;
      // Restart the quiet period on every turn end; activity in between cancels it.
      this.cancelQuietTimer(agentId);
      const handle = this.setTimer(() => {
        this.quietTimers.delete(agentId);
        // Re-check: a task may have been claimed during the grace period.
        if (this.isRetirable(agentId)) this.terminate(agentId, signal);
      }, this.graceMs);
      this.quietTimers.set(agentId, handle);
    }
  }

  /**
   * Clear terminated state for an agent that came back under the same id — a
   * resumed Claude session keeps its session id. Call on session start.
   */
  revive(agentId: string): void {
    this.terminated.delete(agentId);
    this.heartbeatLost.delete(agentId);
  }

  /** False once the agent has been terminated. Unknown agents are considered alive. */
  isAlive(agentId: string): boolean {
    return !this.terminated.has(agentId);
  }

  onTerminate(cb: (agentId: string, reason: DeathSignal) => void): void {
    this.listeners.push(cb);
  }

  /**
   * Terminate agents whose heartbeat is `lost` and whose process is not running.
   * Candidates are agents that reported `heartbeat-lost`; with `includeStale`
   * (explicit user purge) every tracked agent whose heartbeat is `stale` or
   * `lost` is also a candidate. Returns the ids terminated by this call.
   */
  purgeStale(options: { includeStale?: boolean } = {}): string[] {
    const purged: string[] = [];
    const candidates = new Set(this.heartbeatLost);
    if (options.includeStale) for (const id of this.deps.knownAgentIds?.() ?? []) candidates.add(id);
    for (const agentId of candidates) {
      if (this.terminated.has(agentId)) {
        this.heartbeatLost.delete(agentId);
        continue;
      }
      const hb = this.deps.heartbeat.getStatus(agentId);
      const eligible = hb === 'lost' || (options.includeStale === true && hb === 'stale');
      if (!eligible) {
        // Heartbeat recovered since the signal — no longer a candidate.
        this.heartbeatLost.delete(agentId);
        continue;
      }
      if (this.deps.isProcessAlive(agentId)) continue;
      this.terminate(agentId, 'heartbeat-lost');
      purged.push(agentId);
    }
    return purged;
  }

  /** Clear all pending quiet-period timers. */
  dispose(): void {
    for (const handle of this.quietTimers.values()) this.clearTimer(handle);
    this.quietTimers.clear();
  }

  private isRetirable(agentId: string): boolean {
    return this.deps.isSpawnedNonInteractive(agentId) && !this.deps.hasActiveTask(agentId);
  }

  private cancelQuietTimer(agentId: string): void {
    const handle = this.quietTimers.get(agentId);
    if (handle === undefined) return;
    this.clearTimer(handle);
    this.quietTimers.delete(agentId);
  }

  private terminate(agentId: string, reason: DeathSignal): void {
    if (this.terminated.has(agentId)) return;
    this.terminated.add(agentId);
    this.cancelQuietTimer(agentId);
    this.heartbeatLost.delete(agentId);
    for (const cb of this.listeners) {
      try {
        cb(agentId, reason);
      } catch {
        // A failing subscriber must not block the others.
      }
    }
  }
}
