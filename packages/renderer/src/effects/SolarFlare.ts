/**
 * Red solar flare for agent errors.
 * @event-horizon/renderer
 */

import { Container, Graphics } from 'pixi.js';

const SPIKES = 8;
const MAX_RADIUS = 35;
const DURATION_MS = 600;

export function createSolarFlare(planetX: number, planetY: number): Container {
  const container = new Container();
  container.x = planetX;
  container.y = planetY;

  const g = new Graphics();
  container.addChild(g);

  const startTime = performance.now();
  (container as Container & { __startTime?: number }).__startTime = startTime;
  (container as Container & { __g?: Graphics }).__g = g;

  return container;
}

export function updateSolarFlare(container: Container): boolean {
  const startTime = (container as Container & { __startTime?: number }).__startTime ?? 0;
  const g = (container as Container & { __g?: Graphics }).__g;
  if (!g) return true;

  const elapsed = performance.now() - startTime;
  const t = Math.min(1, elapsed / DURATION_MS);
  const radius = t * MAX_RADIUS;
  const alpha = 1 - t;

  g.clear();
  for (let i = 0; i < SPIKES; i++) {
    const angle = (i / SPIKES) * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    g.moveTo(0, 0).lineTo(x, y).stroke({ width: 2, color: 0xff3333, alpha });
  }

  return t >= 1;
}
