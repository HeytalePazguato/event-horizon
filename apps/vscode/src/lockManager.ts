/**
 * Distributed file lock manager for AI agents.
 * When enabled, agents must acquire a lock before accessing a file.
 * Locks auto-expire after a TTL and can be released manually or on agent termination.
 */

export interface FileLock {
  agentId: string;
  agentName: string;
  reason?: string;
  acquiredAt: number;
}

export interface LockResult {
  allowed: boolean;
  owner?: string;
  ownerAgent?: string;
  reason?: string;
}

export class LockManager {
  private locks = new Map<string, FileLock>();
  private enabled = false;
  private readonly ttlMs: number;
  private waitResolvers = new Map<string, Array<() => void>>();

  constructor(ttlMs = 30_000) {
    this.ttlMs = ttlMs;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.locks.clear();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Acquire a lock for writes. Returns allowed:false if another agent holds it. */
  acquire(filePath: string, agentId: string, agentName: string, reason?: string): LockResult {
    if (!this.enabled) return { allowed: true };
    this.pruneExpired();
    const norm = this.normalize(filePath);
    const existing = this.locks.get(norm);

    if (existing && existing.agentId !== agentId) {
      return { allowed: false, owner: existing.agentName, ownerAgent: existing.agentId, reason: existing.reason };
    }

    this.locks.set(norm, { agentId, agentName, reason, acquiredAt: Date.now() });
    return { allowed: true };
  }

  /** Check if locked by someone else, without acquiring (for reads). */
  query(filePath: string, agentId: string): LockResult {
    if (!this.enabled) return { allowed: true };
    this.pruneExpired();
    const norm = this.normalize(filePath);
    const existing = this.locks.get(norm);

    if (existing && existing.agentId !== agentId) {
      return { allowed: false, owner: existing.agentName, ownerAgent: existing.agentId, reason: existing.reason };
    }
    return { allowed: true };
  }

  /** Release a specific lock held by the given agent. */
  release(filePath: string, agentId: string): void {
    const norm = this.normalize(filePath);
    const existing = this.locks.get(norm);
    if (existing && existing.agentId === agentId) {
      this.locks.delete(norm);
      this.notifyWaiters(norm);
    }
  }

  /** Release all locks held by a specific agent (on termination). */
  releaseAll(agentId: string): void {
    const released: string[] = [];
    for (const [path, lock] of this.locks) {
      if (lock.agentId === agentId) {
        this.locks.delete(path);
        released.push(path);
      }
    }
    for (const path of released) this.notifyWaiters(path);
  }

  /** Wait until a file's lock is released, then acquire it. */
  async waitForUnlock(filePath: string, agentId: string, agentName: string, timeoutMs = 30_000): Promise<LockResult> {
    const norm = this.normalize(filePath);

    // Check if already available
    const immediate = this.acquire(filePath, agentId, agentName);
    if (immediate.allowed) return immediate;

    // Wait for release notification or timeout
    return new Promise<LockResult>((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.removeWaiter(norm, onRelease);
        const existing = this.locks.get(norm);
        resolve({
          allowed: false,
          owner: existing?.agentName,
          ownerAgent: existing?.agentId,
          reason: 'Timeout waiting for lock',
        });
      }, timeoutMs);

      const onRelease = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(this.acquire(filePath, agentId, agentName));
      };

      if (!this.waitResolvers.has(norm)) this.waitResolvers.set(norm, []);
      this.waitResolvers.get(norm)!.push(onRelease);
    });
  }

  /** Get all active locks (for UI display). */
  getActiveLocks(): Array<{ path: string } & FileLock> {
    this.pruneExpired();
    return [...this.locks.entries()].map(([p, l]) => ({ path: p, ...l }));
  }

  private normalize(filePath: string): string {
    return filePath.split('\\').join('/').toLowerCase();
  }

  private pruneExpired(): void {
    const now = Date.now();
    const expired: string[] = [];
    for (const [path, lock] of this.locks) {
      if (now - lock.acquiredAt > this.ttlMs) expired.push(path);
    }
    for (const path of expired) {
      this.locks.delete(path);
      this.notifyWaiters(path);
    }
  }

  private notifyWaiters(normalizedPath: string): void {
    const waiters = this.waitResolvers.get(normalizedPath);
    if (waiters && waiters.length > 0) {
      // Notify first waiter only (FIFO queue)
      const first = waiters.shift()!;
      if (waiters.length === 0) this.waitResolvers.delete(normalizedPath);
      first();
    }
  }

  private removeWaiter(normalizedPath: string, fn: () => void): void {
    const waiters = this.waitResolvers.get(normalizedPath);
    if (waiters) {
      const idx = waiters.indexOf(fn);
      if (idx >= 0) waiters.splice(idx, 1);
      if (waiters.length === 0) this.waitResolvers.delete(normalizedPath);
    }
  }
}
