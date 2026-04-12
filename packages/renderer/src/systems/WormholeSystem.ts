/**
 * WormholeSystem — manages wormhole entity lifecycle and animation.
 * Wormholes connect agents that worked on shared files (Phase 4 cross-agent correlation).
 */

import type { Container } from 'pixi.js';
import type { ExtendedWormhole, WormholeProps } from '../entities/Wormhole.js';
import { createWormhole } from '../entities/Wormhole.js';

export interface WormholeData {
  id: string;
  sourceAgentId: string;
  targetAgentId: string;
  /** 0..1 — derived from shared file count */
  strength: number;
}

/**
 * Synchronize the visible wormhole entities with the latest data + planet positions.
 * Creates new wormholes, updates positions/strengths of existing ones, removes stale.
 */
export function syncWormholes(
  parent: Container,
  existing: Map<string, ExtendedWormhole>,
  data: WormholeData[],
  planetPositions: Map<string, { x: number; y: number }>,
): void {
  const seen = new Set<string>();

  for (const w of data) {
    const sp = planetPositions.get(w.sourceAgentId);
    const tp = planetPositions.get(w.targetAgentId);
    if (!sp || !tp) continue; // skip if either planet doesn't exist on screen
    seen.add(w.id);

    const exists = existing.get(w.id);
    if (!exists) {
      const props: WormholeProps = {
        id: w.id,
        sourceAgentId: w.sourceAgentId,
        targetAgentId: w.targetAgentId,
        strength: w.strength,
        sourceX: sp.x,
        sourceY: sp.y,
        targetX: tp.x,
        targetY: tp.y,
      };
      const wh = createWormhole(props);
      parent.addChild(wh);
      existing.set(w.id, wh);
    } else {
      // Update positions + strength
      exists.__sourceX = sp.x;
      exists.__sourceY = sp.y;
      exists.__targetX = tp.x;
      exists.__targetY = tp.y;
      exists.__strength = w.strength;
      if (exists.__sourcePortal) { exists.__sourcePortal.x = sp.x; exists.__sourcePortal.y = sp.y; }
      if (exists.__targetPortal) { exists.__targetPortal.x = tp.x; exists.__targetPortal.y = tp.y; }
      exists.alpha = 0.3 + 0.7 * Math.min(1, w.strength);
    }
  }

  // Remove wormholes no longer in data
  for (const [id, wh] of existing) {
    if (!seen.has(id)) {
      parent.removeChild(wh);
      wh.destroy({ children: true });
      existing.delete(id);
    }
  }
}

/**
 * Per-frame animation: rotate spirals, advance particles along the connection line.
 */
export function animateWormholes(wormholes: Iterable<ExtendedWormhole>, tickDelta: number): void {
  for (const wh of wormholes) {
    // Spin the portals
    if (wh.__sourcePortal) wh.__sourcePortal.rotation += tickDelta * 0.04;
    if (wh.__targetPortal) wh.__targetPortal.rotation -= tickDelta * 0.04;

    // Redraw connection line
    const sx = wh.__sourceX ?? 0;
    const sy = wh.__sourceY ?? 0;
    const tx = wh.__targetX ?? 0;
    const ty = wh.__targetY ?? 0;
    const conn = wh.__connection;
    if (conn) {
      conn.clear();
      // Dashed-effect with alpha — actually a single line with low alpha
      conn.moveTo(sx, sy).lineTo(tx, ty).stroke({ width: 1, color: 0x9944ff, alpha: 0.25 });
    }

    // Advance + draw particles along the line
    const particles = wh.__particles;
    if (particles) {
      for (const p of particles) {
        p.progress += tickDelta * 0.012;
        if (p.progress > 1) p.progress -= 1;
        p.g.x = sx + (tx - sx) * p.progress;
        p.g.y = sy + (ty - sy) * p.progress;
      }
    }
  }
}
