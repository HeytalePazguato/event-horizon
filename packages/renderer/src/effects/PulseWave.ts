/**
 * Pulse wave effect when task completes (radiates from singularity).
 * @event-horizon/renderer
 */

import { Container, Graphics } from 'pixi.js';

const MAX_RADIUS = 120;
const DURATION_MS = 800;

export function createPulseWave(x: number, y: number): Container {
  const container = new Container();
  container.x = x;
  container.y = y;

  const ring = new Graphics();
  container.addChild(ring);

  const startTime = performance.now();
  (container as Container & { __startTime?: number }).__startTime = startTime;
  (container as Container & { __ring?: Graphics }).__ring = ring;

  return container;
}

export function updatePulseWave(container: Container): boolean {
  const startTime = (container as Container & { __startTime?: number }).__startTime ?? 0;
  const ring = (container as Container & { __ring?: Graphics }).__ring;
  if (!ring) return true;

  const elapsed = performance.now() - startTime;
  const t = Math.min(1, elapsed / DURATION_MS);
  const radius = t * MAX_RADIUS;
  const alpha = 1 - t;

  ring.clear();
  ring.circle(0, 0, radius).stroke({ width: 3, color: 0x4488ff, alpha });

  return t >= 1;
}
