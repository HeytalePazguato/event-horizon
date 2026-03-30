/**
 * Ship system — bezier animation + trail rendering.
 * Extracted from Universe.tsx ticker (Phase F.2).
 */

import type { Graphics } from 'pixi.js';
import { bezierPoint } from '../math.js';

const SHIP_PROGRESS_SPEED = 0.008;
const MAX_TRAIL_POINTS = 32;

export interface ActiveShip {
  id: string;
  c: import('pixi.js').Container;
  fromX: number; fromY: number;
  cx: number; cy: number;
  toX: number; toY: number;
  progress: number;
  trailG: Graphics;
  routeG: Graphics;
  trailPoints: Array<{ x: number; y: number }>;
  trailColor: number;
}

export interface ShipSystemCallbacks {
  onShipRemoved: (shipId: string) => void;
}

/**
 * Update all active ships — advance bezier, draw trail, clean up finished.
 * Mutates the ships array in place (splice on completion).
 */
export function updateShips(ships: ActiveShip[], callbacks: ShipSystemCallbacks): void {
  for (let i = ships.length - 1; i >= 0; i--) {
    const s = ships[i];
    s.progress += SHIP_PROGRESS_SPEED;

    if (s.progress >= 1) {
      s.c.destroy({ children: true });
      try { s.trailG.destroy(); } catch { /* ignore */ }
      try { s.routeG.destroy(); } catch { /* ignore */ }
      ships.splice(i, 1);
      callbacks.onShipRemoved(s.id);
      continue;
    }

    // Position along bezier curve
    const pos = bezierPoint(s.progress, s.fromX, s.fromY, s.cx, s.cy, s.toX, s.toY);
    s.c.x = pos.x;
    s.c.y = pos.y;

    // Rotation from tangent (sample slightly ahead)
    const ahead = bezierPoint(
      Math.min(1, s.progress + 0.02),
      s.fromX, s.fromY, s.cx, s.cy, s.toX, s.toY,
    );
    s.c.rotation = Math.atan2(ahead.y - pos.y, ahead.x - pos.x);

    // Trail rendering
    s.trailPoints.push({ x: pos.x, y: pos.y });
    if (s.trailPoints.length > MAX_TRAIL_POINTS) s.trailPoints.shift();

    s.trailG.clear();
    const pts = s.trailPoints;
    if (pts.length >= 2) {
      for (let j = 1; j < pts.length; j++) {
        const alpha = (j / pts.length) * 0.5;
        const strokeWidth = 0.8 + (j / pts.length) * 0.6;
        s.trailG
          .moveTo(pts[j - 1].x, pts[j - 1].y)
          .lineTo(pts[j].x, pts[j].y)
          .stroke({ width: strokeWidth, color: s.trailColor, alpha });
      }
    }
  }
}
