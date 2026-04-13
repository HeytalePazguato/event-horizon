/**
 * Spawn Registry tests — process tracking, SIGTERM→SIGKILL fallback, auto-removal.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { SpawnRegistry, killChildProcess, type SpawnedAgentInfo } from '../spawnRegistry.js';

/** Minimal fake ChildProcess that can exit promptly or refuse to exit. */
class FakeChildProcess extends EventEmitter {
  pid = 12345;
  private _exitCode: number | null = null;
  private _killed = false;
  lastSignal: string | null = null;
  stdout = null;
  stderr = null;
  exitAfterMs: number | null;

  constructor(opts: { pid?: number; exitAfterMs?: number | null } = {}) {
    super();
    if (opts.pid) this.pid = opts.pid;
    this.exitAfterMs = opts.exitAfterMs ?? null;
  }

  get exitCode(): number | null { return this._exitCode; }
  get killed(): boolean { return this._killed; }

  exit(code: number): void {
    if (this._exitCode !== null) return;
    this._exitCode = code;
    this._killed = true;
    this.emit('exit', code);
  }

  kill(signal?: string): boolean {
    this.lastSignal = signal ?? 'SIGTERM';
    if (signal === 'SIGKILL') {
      this.exit(137);
    } else if (this.exitAfterMs != null) {
      setTimeout(() => this.exit(143), this.exitAfterMs);
    }
    // If exitAfterMs is null and signal !== SIGKILL, the process "ignores" SIGTERM.
    return true;
  }
}

function asChildProcess(fake: FakeChildProcess): import('child_process').ChildProcess {
  return fake as unknown as import('child_process').ChildProcess;
}

describe('killChildProcess', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('sends SIGTERM first and resolves true when the process exits promptly', async () => {
    const fake = new FakeChildProcess({ exitAfterMs: 100 });
    const promise = killChildProcess(asChildProcess(fake), 3000);
    expect(fake.lastSignal).toBe('SIGTERM');
    await vi.advanceTimersByTimeAsync(150);
    const result = await promise;
    expect(result).toBe(true);
  });

  it('escalates to SIGKILL when the process does not exit within 3s', async () => {
    const fake = new FakeChildProcess({ exitAfterMs: null });
    const promise = killChildProcess(asChildProcess(fake), 3000);
    expect(fake.lastSignal).toBe('SIGTERM');
    await vi.advanceTimersByTimeAsync(3000);
    expect(fake.lastSignal).toBe('SIGKILL');
    await vi.advanceTimersByTimeAsync(600);
    const result = await promise;
    expect(result).toBe(true);
  });

  it('returns true immediately if the process is already dead', async () => {
    const fake = new FakeChildProcess({ exitAfterMs: null });
    fake.exit(0);
    const result = await killChildProcess(asChildProcess(fake), 3000);
    expect(result).toBe(true);
  });
});

describe('SpawnRegistry', () => {
  let registry: SpawnRegistry;

  beforeEach(() => {
    registry = new SpawnRegistry();
  });

  function trackFakeAgent(agentId: string, opts: { exitAfterMs?: number | null } = {}): FakeChildProcess {
    const fake = new FakeChildProcess({ exitAfterMs: opts.exitAfterMs ?? null });
    const info: SpawnedAgentInfo = {
      type: 'claude-code',
      terminalName: 'mock-terminal',
      terminal: { dispose: () => {} } as unknown as import('vscode').Terminal,
      role: 'implementer',
      taskId: 'task-1',
      spawnedAt: Date.now(),
      process: asChildProcess(fake),
      pid: fake.pid,
    };
    registry.trackAgent(agentId, info);
    return fake;
  }

  it('tracks a spawned agent with its pid and process reference', () => {
    trackFakeAgent('agent-1');
    const info = registry.getSpawnedAgent('agent-1');
    expect(info).toBeDefined();
    expect(info?.pid).toBe(12345);
    expect(info?.process).toBeDefined();
  });

  it('stop() sends SIGTERM first', async () => {
    vi.useFakeTimers();
    const fake = trackFakeAgent('agent-1', { exitAfterMs: 50 });
    const stopPromise = registry.stop('agent-1');
    expect(fake.lastSignal).toBe('SIGTERM');
    await vi.advanceTimersByTimeAsync(100);
    await stopPromise;
    vi.useRealTimers();
  });

  it('does not send SIGKILL when the process exits within 3s', async () => {
    vi.useFakeTimers();
    const fake = trackFakeAgent('agent-1', { exitAfterMs: 500 });
    const stopPromise = registry.stop('agent-1');
    await vi.advanceTimersByTimeAsync(600);
    await stopPromise;
    expect(fake.lastSignal).toBe('SIGTERM');
    vi.useRealTimers();
  });

  it('sends SIGKILL when the process refuses to exit within 3s', async () => {
    vi.useFakeTimers();
    const fake = trackFakeAgent('agent-1', { exitAfterMs: null });
    const stopPromise = registry.stop('agent-1');
    expect(fake.lastSignal).toBe('SIGTERM');
    await vi.advanceTimersByTimeAsync(3000);
    expect(fake.lastSignal).toBe('SIGKILL');
    await vi.advanceTimersByTimeAsync(600);
    await stopPromise;
    vi.useRealTimers();
  });

  it('removes the agent from the registry after stop()', async () => {
    vi.useFakeTimers();
    trackFakeAgent('agent-1', { exitAfterMs: 50 });
    const stopPromise = registry.stop('agent-1');
    await vi.advanceTimersByTimeAsync(100);
    await stopPromise;
    expect(registry.getSpawnedAgent('agent-1')).toBeUndefined();
    vi.useRealTimers();
  });

  it('untrackAgent removes the agent and notifies listeners', () => {
    trackFakeAgent('agent-1');
    let notified = 0;
    registry.onChange(() => { notified++; });
    registry.untrackAgent('agent-1');
    expect(registry.getSpawnedAgent('agent-1')).toBeUndefined();
    expect(notified).toBe(1);
  });

  it('getAgentRoleMap returns the role for each spawned agent', () => {
    trackFakeAgent('agent-1');
    trackFakeAgent('agent-2');
    const map = registry.getAgentRoleMap();
    expect(map['agent-1']).toBe('implementer');
    expect(map['agent-2']).toBe('implementer');
  });

  it('trackAgent triggers onChange listeners', () => {
    let count = 0;
    registry.onChange(() => { count++; });
    trackFakeAgent('agent-1');
    expect(count).toBe(1);
  });
});
