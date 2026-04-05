/**
 * Station System — manages MCP server station lifecycle and orbit animation.
 * Stations orbit their parent planet at a fixed distance.
 * @event-horizon/renderer
 */

import { Container, Graphics } from 'pixi.js';
import { createStation } from '../entities/Station.js';
import type { ExtendedStation } from '../entities/Station.js';

export interface McpServerData {
  name: string;
  connected: boolean;
  toolCount: number;
}

interface StationEntry {
  station: ExtendedStation;
  agentId: string;
  serverName: string;
}

const ORBIT_DISTANCE = 35;
const ORBIT_SPEED = 0.3; // radians per second

export class StationSystem {
  private stations: StationEntry[] = [];
  private container: Container;
  private dockingTubes: Graphics;

  constructor(container: Container) {
    this.container = container;
    this.dockingTubes = new Graphics();
    this.container.addChild(this.dockingTubes);
  }

  /** Sync stations with current MCP server data. */
  sync(
    mcpServers: Record<string, McpServerData[]>,
    _planetPositions: Record<string, { x: number; y: number }>,
  ): void {
    // Remove stations for agents that no longer exist
    const agentIds = new Set(Object.keys(mcpServers));
    this.stations = this.stations.filter((entry) => {
      if (!agentIds.has(entry.agentId)) {
        this.container.removeChild(entry.station);
        return false;
      }
      // Also remove if server no longer in list
      const servers = mcpServers[entry.agentId] ?? [];
      if (!servers.some((s) => s.name === entry.serverName)) {
        this.container.removeChild(entry.station);
        return false;
      }
      return true;
    });

    // Add/update stations
    for (const [agentId, servers] of Object.entries(mcpServers)) {
      for (const server of servers) {
        const existing = this.stations.find(
          (e) => e.agentId === agentId && e.serverName === server.name,
        );
        if (existing) {
          // Update state
          existing.station.__connected = server.connected;
          existing.station.__toolCount = server.toolCount;
        } else {
          // Create new station
          const station = createStation(server);
          this.container.addChild(station);
          this.stations.push({ station, agentId, serverName: server.name });
        }
      }
    }

    // Distribute orbit angles evenly per agent
    const byAgent = new Map<string, StationEntry[]>();
    for (const entry of this.stations) {
      const list = byAgent.get(entry.agentId) ?? [];
      list.push(entry);
      byAgent.set(entry.agentId, list);
    }
    for (const entries of byAgent.values()) {
      const step = (Math.PI * 2) / entries.length;
      entries.forEach((entry, i) => {
        if (entry.station.__orbitAngle === undefined) {
          entry.station.__orbitAngle = step * i;
        }
      });
    }
  }

  /** Animate stations — orbit around parent planet + pulse on tool calls + docking tubes. */
  update(
    dt: number,
    tickTime: number,
    planetPositions: Record<string, { x: number; y: number }>,
  ): void {
    this.dockingTubes.clear();

    for (const entry of this.stations) {
      const pos = planetPositions[entry.agentId];
      if (!pos) {
        entry.station.visible = false;
        continue;
      }
      entry.station.visible = true;

      // Orbit animation
      const angle = (entry.station.__orbitAngle ?? 0) + ORBIT_SPEED * dt;
      entry.station.__orbitAngle = angle % (Math.PI * 2);

      entry.station.x = pos.x + Math.cos(angle) * ORBIT_DISTANCE;
      entry.station.y = pos.y + Math.sin(angle) * ORBIT_DISTANCE;

      // Docking tube: thin line from station to parent planet
      this.dockingTubes.moveTo(entry.station.x, entry.station.y);
      this.dockingTubes.lineTo(pos.x, pos.y);
      this.dockingTubes.stroke({
        width: 0.6,
        color: 0x1a3020,
        alpha: entry.station.__connected ? 0.4 : 0.2,
      });

      // Pulse animation when tool is being called
      if (entry.station.__isPulsing) {
        const pulse = 1 + 0.15 * Math.sin(tickTime * 8);
        entry.station.scale.set(pulse);
        entry.station.alpha = 0.7 + 0.3 * Math.sin(tickTime * 6);
      } else {
        entry.station.scale.set(1);
        entry.station.alpha = entry.station.__connected ? 0.85 : 0.5;
      }
    }
  }

  /** Trigger pulse on a station when its tools are being called. */
  triggerPulse(agentId: string, serverName?: string): void {
    for (const entry of this.stations) {
      if (entry.agentId === agentId && (!serverName || entry.serverName === serverName)) {
        entry.station.__isPulsing = true;
        // Auto-reset after 2 seconds
        setTimeout(() => {
          entry.station.__isPulsing = false;
        }, 2000);
      }
    }
  }

  /** Clean up all stations. */
  destroy(): void {
    for (const entry of this.stations) {
      this.container.removeChild(entry.station);
    }
    this.stations = [];
    this.container.removeChild(this.dockingTubes);
    this.dockingTubes.destroy();
  }
}
