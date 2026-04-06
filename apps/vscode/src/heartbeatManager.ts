/**
 * Heartbeat Manager — tracks agent liveness via periodic heartbeat signals.
 * Agents call eh_heartbeat to report alive status; the extension host
 * periodically checks and marks agents as stale or lost.
 */

export type HeartbeatStatus = 'alive' | 'stale' | 'lost';

export interface HeartbeatInfo {
  agentId: string;
  lastBeat: number;
  status: HeartbeatStatus;
}

export class HeartbeatManager {
  private beats = new Map<string, number>();
  /** Interval in ms — default 60s. Stale = 2x, lost = 5x. */
  private intervalMs: number;

  constructor(intervalMs = 60_000) {
    this.intervalMs = intervalMs;
  }

  /** Record a heartbeat from an agent. */
  beat(agentId: string): void {
    this.beats.set(agentId, Date.now());
  }

  /** Get heartbeat status for a single agent. */
  getStatus(agentId: string): HeartbeatStatus {
    const lastBeat = this.beats.get(agentId);
    if (!lastBeat) return 'lost';
    const elapsed = Date.now() - lastBeat;
    if (elapsed <= this.intervalMs * 2) return 'alive';
    if (elapsed <= this.intervalMs * 5) return 'stale';
    return 'lost';
  }

  /** Get all agents with their heartbeat info. */
  getAll(): HeartbeatInfo[] {
    const result: HeartbeatInfo[] = [];
    for (const [agentId, lastBeat] of this.beats) {
      result.push({
        agentId,
        lastBeat,
        status: this.getStatus(agentId),
      });
    }
    return result;
  }

  /** Remove tracking for an agent (e.g. on terminate). */
  remove(agentId: string): void {
    this.beats.delete(agentId);
  }

  /** Get the configured interval in ms. */
  getIntervalMs(): number {
    return this.intervalMs;
  }
}
