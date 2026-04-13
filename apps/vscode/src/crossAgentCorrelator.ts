/**
 * CrossAgentCorrelator — detects when multiple agents work on related files
 * and creates "wormhole" connections between them.
 */

import type { AgentEvent } from '@event-horizon/core';

export interface FileCorrelation {
  file: string;
  agents: string[];     // agentIds that touched this file
  lastAccess: number;
  accessCount: number;
}

export interface WormholeConnection {
  id: string;
  sourceAgentId: string;
  targetAgentId: string;
  sharedFiles: string[];
  strength: number;     // 0-1 based on number of shared files
}

const WINDOW_MS = 10 * 60 * 1000;   // 10 minutes
const PRUNE_MS  = 30 * 60 * 1000;   // 30 minutes

export class CrossAgentCorrelator {
  /** file path → correlation entry */
  private correlations = new Map<string, FileCorrelation>();

  /** Record a file-access event from an agent. */
  onEvent(event: AgentEvent): void {
    if (event.type !== 'file.read' && event.type !== 'file.write') return;

    const filePath =
      (event.payload?.filePath as string | undefined) ??
      (event.payload?.file as string | undefined);
    if (!filePath) return;

    const now = event.timestamp ?? Date.now();
    const existing = this.correlations.get(filePath);

    if (!existing) {
      this.correlations.set(filePath, {
        file: filePath,
        agents: [event.agentId],
        lastAccess: now,
        accessCount: 1,
      });
    } else {
      if (!existing.agents.includes(event.agentId)) {
        existing.agents.push(event.agentId);
      }
      existing.lastAccess = now;
      existing.accessCount += 1;
    }
  }

  /** Prune correlations whose lastAccess is older than 30 minutes. */
  prune(now = Date.now()): void {
    for (const [file, corr] of this.correlations) {
      if (now - corr.lastAccess > PRUNE_MS) {
        this.correlations.delete(file);
      }
    }
  }

  /** Compute active wormhole connections from correlations within 10-minute window. */
  getActiveWormholes(now = Date.now()): WormholeConnection[] {
    // Build per-agent-pair → shared files map
    const pairFiles = new Map<string, Set<string>>();

    for (const corr of this.correlations.values()) {
      if (now - corr.lastAccess > WINDOW_MS) continue;
      if (corr.agents.length < 2) continue;

      // All unique pairs in this file's agent list
      for (let i = 0; i < corr.agents.length; i++) {
        for (let j = i + 1; j < corr.agents.length; j++) {
          const a = corr.agents[i];
          const b = corr.agents[j];
          // Canonical pair key (lexicographic order)
          const key = a < b ? `${a}|||${b}` : `${b}|||${a}`;
          let files = pairFiles.get(key);
          if (!files) {
            files = new Set();
            pairFiles.set(key, files);
          }
          files.add(corr.file);
        }
      }
    }

    const wormholes: WormholeConnection[] = [];
    for (const [key, files] of pairFiles) {
      const [sourceAgentId, targetAgentId] = key.split('|||');
      const sharedFiles = Array.from(files);
      const strength = Math.min(sharedFiles.length / 10, 1.0);
      wormholes.push({
        id: key,
        sourceAgentId,
        targetAgentId,
        sharedFiles,
        strength,
      });
    }
    return wormholes;
  }
}
