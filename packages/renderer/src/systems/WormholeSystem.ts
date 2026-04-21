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

  // Offset each portal away from the planet center toward the other end so
  // the violet spiral isn't covered by the planet sprite. ~24 px sits just
  // outside the largest demo planet but stays close enough to read as
  // belonging to that planet.
  const PORTAL_OFFSET = 24;
  const offsetEndpoints = (sp: { x: number; y: number }, tp: { x: number; y: number }) => {
    const dx = tp.x - sp.x;
    const dy = tp.y - sp.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const ux = dx / dist;
    const uy = dy / dist;
    return {
      sourceX: sp.x + ux * PORTAL_OFFSET,
      sourceY: sp.y + uy * PORTAL_OFFSET,
      targetX: tp.x - ux * PORTAL_OFFSET,
      targetY: tp.y - uy * PORTAL_OFFSET,
    };
  };

  for (const w of data) {
    const sp = planetPositions.get(w.sourceAgentId);
    const tp = planetPositions.get(w.targetAgentId);
    if (!sp || !tp) continue; // skip if either planet doesn't exist on screen
    seen.add(w.id);
    const ep = offsetEndpoints(sp, tp);

    const exists = existing.get(w.id);
    if (!exists) {
      const props: WormholeProps = {
        id: w.id,
        sourceAgentId: w.sourceAgentId,
        targetAgentId: w.targetAgentId,
        strength: w.strength,
        sourceX: ep.sourceX,
        sourceY: ep.sourceY,
        targetX: ep.targetX,
        targetY: ep.targetY,
      };
      const wh = createWormhole(props);
      parent.addChild(wh);
      existing.set(w.id, wh);
    } else {
      // Update positions + strength
      exists.__sourceX = ep.sourceX;
      exists.__sourceY = ep.sourceY;
      exists.__targetX = ep.targetX;
      exists.__targetY = ep.targetY;
      exists.__strength = w.strength;
      if (exists.__sourcePortal) { exists.__sourcePortal.x = ep.sourceX; exists.__sourcePortal.y = ep.sourceY; }
      if (exists.__targetPortal) { exists.__targetPortal.x = ep.targetX; exists.__targetPortal.y = ep.targetY; }
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

    // Redraw connection line (only if endpoints moved)
    const sx = wh.__sourceX ?? 0;
    const sy = wh.__sourceY ?? 0;
    const tx = wh.__targetX ?? 0;
    const ty = wh.__targetY ?? 0;
    const conn = wh.__connection;
    if (conn && !(sx === wh.__lastConnSx && sy === wh.__lastConnSy && tx === wh.__lastConnTx && ty === wh.__lastConnTy)) {
      conn.clear();
      // Dashed-effect with alpha — actually a single line with low alpha
      conn.moveTo(sx, sy).lineTo(tx, ty).stroke({ width: 1, color: 0x9944ff, alpha: 0.25 });
      wh.__lastConnSx = sx;
      wh.__lastConnSy = sy;
      wh.__lastConnTx = tx;
      wh.__lastConnTy = ty;
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
