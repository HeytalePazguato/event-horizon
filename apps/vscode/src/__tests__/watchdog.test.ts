/**
 * Watchdog tests — silence detection, exclusions, timeout changes.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Watchdog } from '../watchdog.js';
import type { SpawnedAgentInfo } from '../spawnRegistry.js';
import type { PlanBoard } from '../planBoard.js';

interface FakeSpawnRegistry {
  agents: Map<string, SpawnedAgentInfo>;
  stopped: string[];
  getSpawnedAgents(): Map<string, SpawnedAgentInfo>;
  stop(agentId: string): Promise<{ stopped: boolean; message: string }>;
}

function makeFakeRegistry(): FakeSpawnRegistry {
  const agents = new Map<string, SpawnedAgentInfo>();
  const stopped: string[] = [];
  return {
    agents,
    stopped,
    getSpawnedAgents() { return agents; },
    async stop(agentId: string) {
      stopped.push(agentId);
      agents.delete(agentId);
      return { stopped: true, message: 'ok' };
    },
  };
}

function addAgent(
  reg: FakeSpawnRegistry,
  agentId: string,
  opts: { interactive?: boolean; spawnedAt?: number } = {},
): void {
  reg.agents.set(agentId, {
    type: 'claude-code',
    terminalName: 'n',
    terminal: {} as unknown as import('vscode').Terminal,
    role: 'implementer',
    taskId: 'task-x',
    spawnedAt: opts.spawnedAt ?? 0,
    interactive: opts.interactive,
  });
}

function makePlans(assignments: Array<{ agentId: string; taskId: string; status?: 'claimed' | 'in_progress' | 'pending' | 'done' }>): PlanBoard[] {
  return [{
    id: 'p',
    name: 'P',
    sourceFile: 'p.md',
    status: 'active',
    tasks: assignments.map((a) => ({
      id: a.taskId,
      title: a.taskId,
      description: '',
      status: a.status ?? 'in_progress',
      assignee: a.agentId,
      assigneeName: a.agentId,
      claimedAt: 0,
      completedAt: null,
      blockedBy: [],
      role: null,
      notes: [],
      retryCount: 0,
      maxRetries: 0,
      failedReason: null,
      acceptanceCriteria: null,
      verifyCommand: null,
      complexity: null,
      modelTier: null,
      verificationStatus: null,
    })),
    createdAt: 0,
    lastUpdatedAt: 0,
    onDependencyFailure: 'cascade',
    maxAutoRetries: 0,
    orchestratorAgentId: 'orch',
    strategy: 'manual',
    maxBudgetUsd: null,
  }];
}

describe('Watchdog', () => {
  let registry: FakeSpawnRegistry;
  let emitted: Array<{ agentId: string; taskId: string; reason: string }>;
  let fakeNow: number;

  beforeEach(() => {
    registry = makeFakeRegistry();
    emitted = [];
    fakeNow = 10_000;
  });

  function make(plans: PlanBoard[], timeoutMs: number): Watchdog {
    return new Watchdog({
      spawnRegistry: registry,
      planBoardManager: { getAllPlans: () => plans } as never,
      timeoutMs,
      now: () => fakeNow,
      emitTaskFail: (agentId, taskId, reason) => emitted.push({ agentId, taskId, reason }),
    });
  }

  it('fails a silent worker with an active task after the timeout', () => {
    addAgent(registry, 'worker-1');
    const plans = makePlans([{ agentId: 'worker-1', taskId: '1.1' }]);
    const wd = make(plans, 5 * 60_000);
    wd.onActivity('worker-1');
    fakeNow += 6 * 60_000; // 6 minutes later — past timeout
    wd.tick();
    expect(emitted).toHaveLength(1);
    expect(emitted[0].agentId).toBe('worker-1');
    expect(emitted[0].taskId).toBe('1.1');
    expect(emitted[0].reason).toContain('watchdog');
    expect(registry.stopped).toContain('worker-1');
  });

  it('does not fire when activity is recent', () => {
    addAgent(registry, 'worker-1');
    const plans = makePlans([{ agentId: 'worker-1', taskId: '1.1' }]);
    const wd = make(plans, 5 * 60_000);
    wd.onActivity('worker-1');
    fakeNow += 60_000; // only 1 minute
    wd.tick();
    expect(emitted).toHaveLength(0);
    expect(registry.stopped).toHaveLength(0);
  });

  it('skips interactive workers even if silent', () => {
    addAgent(registry, 'worker-1', { interactive: true });
    const plans = makePlans([{ agentId: 'worker-1', taskId: '1.1' }]);
    const wd = make(plans, 5 * 60_000);
    fakeNow += 60 * 60_000; // 1 hour — way past timeout
    wd.tick();
    expect(emitted).toHaveLength(0);
    expect(registry.stopped).toHaveLength(0);
  });

  it('skips workers with no active task', () => {
    addAgent(registry, 'worker-1');
    const plans = makePlans([{ agentId: 'worker-1', taskId: '1.1', status: 'done' }]);
    const wd = make(plans, 5 * 60_000);
    fakeNow += 60 * 60_000;
    wd.tick();
    expect(emitted).toHaveLength(0);
    expect(registry.stopped).toHaveLength(0);
  });

  it('uses spawnedAt as the baseline when no activity recorded yet', () => {
    addAgent(registry, 'worker-1', { spawnedAt: fakeNow });
    const plans = makePlans([{ agentId: 'worker-1', taskId: '1.1' }]);
    const wd = make(plans, 5 * 60_000);
    // Advance just past timeout — no events fired yet
    fakeNow += 6 * 60_000;
    wd.tick();
    expect(emitted).toHaveLength(1);
  });

  it('setTimeoutMs(0) disables — tick becomes a no-op', () => {
    addAgent(registry, 'worker-1');
    const plans = makePlans([{ agentId: 'worker-1', taskId: '1.1' }]);
    const wd = make(plans, 5 * 60_000);
    wd.setTimeoutMs(0);
    fakeNow += 60 * 60_000;
    wd.tick();
    expect(emitted).toHaveLength(0);
  });

  it('does not re-fire for the same agent on consecutive ticks', () => {
    addAgent(registry, 'worker-1');
    // Worker stays in the "active task" list even after stop() because this fake
    // plan board doesn't track task status changes — still shouldn't fire twice.
    const plans = makePlans([{ agentId: 'worker-1', taskId: '1.1' }]);
    const wd = make(plans, 5 * 60_000);
    fakeNow += 6 * 60_000;
    wd.tick();
    expect(emitted).toHaveLength(1);
    // Re-add the agent to the registry to simulate it somehow still being there
    addAgent(registry, 'worker-1');
    fakeNow += 6 * 60_000;
    wd.tick();
    expect(emitted).toHaveLength(1); // still 1, no re-fire
  });

  it('resets firedFor when the worker emits activity again', () => {
    addAgent(registry, 'worker-1');
    const plans = makePlans([{ agentId: 'worker-1', taskId: '1.1' }]);
    const wd = make(plans, 5 * 60_000);
    fakeNow += 6 * 60_000;
    wd.tick();
    expect(emitted).toHaveLength(1);

    // Worker comes back to life, fires activity, then goes silent again
    addAgent(registry, 'worker-1');
    wd.onActivity('worker-1');
    fakeNow += 6 * 60_000;
    wd.tick();
    expect(emitted).toHaveLength(2);
  });

  it('handles multiple workers independently', () => {
    addAgent(registry, 'worker-a');
    addAgent(registry, 'worker-b');
    const plans = makePlans([
      { agentId: 'worker-a', taskId: '1.1' },
      { agentId: 'worker-b', taskId: '1.2' },
    ]);
    const wd = make(plans, 5 * 60_000);
    wd.onActivity('worker-a');
    wd.onActivity('worker-b');
    fakeNow += 3 * 60_000;
    wd.onActivity('worker-b'); // b is alive, a is silent
    fakeNow += 3 * 60_000;      // total 6 min since a's last activity, 3 min since b's
    wd.tick();
    expect(emitted.map((e) => e.agentId)).toEqual(['worker-a']);
  });
});
