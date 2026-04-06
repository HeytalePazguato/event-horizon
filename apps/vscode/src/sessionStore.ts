/**
 * Session Store — persists agent session IDs for task resumption.
 * Keyed by `${agentId}:${taskId}`, stores session IDs that can be
 * used to resume agent sessions (e.g. `claude --resume <sessionId>`).
 * Persisted to VS Code globalState externally by extension.ts.
 */

export class SessionStore {
  private sessions = new Map<string, string>();

  private key(agentId: string, taskId: string): string {
    return `${agentId}:${taskId}`;
  }

  save(agentId: string, taskId: string, sessionId: string): void {
    this.sessions.set(this.key(agentId, taskId), sessionId);
  }

  get(agentId: string, taskId: string): string | null {
    return this.sessions.get(this.key(agentId, taskId)) ?? null;
  }

  clear(agentId: string, taskId: string): void {
    this.sessions.delete(this.key(agentId, taskId));
  }

  clearAgent(agentId: string): void {
    for (const k of [...this.sessions.keys()]) {
      if (k.startsWith(agentId + ':')) {
        this.sessions.delete(k);
      }
    }
  }

  serialize(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [k, v] of this.sessions) {
      result[k] = v;
    }
    return result;
  }

  restore(data: Record<string, string>): void {
    this.sessions.clear();
    for (const [k, v] of Object.entries(data)) {
      this.sessions.set(k, v);
    }
  }
}
