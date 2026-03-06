/**
 * Central black hole with fiery accretion disk (yellow/orange/red spiral).
 * @event-horizon/renderer
 */

import { Container, Graphics } from 'pixi.js';

const CORE_RADIUS = 24;
const DISK_INNER = 32;
const DISK_OUTER = 70;
const SEGMENTS = 24;

export interface SingularityProps {
  x: number;
  y: number;
}

export function createSingularity(props: SingularityProps): Container {
  const { x, y } = props;
  const container = new Container();
  container.x = x;
  container.y = y;

  // Outer glow (dark red fade)
  const outerGlow = new Graphics();
  outerGlow.circle(0, 0, DISK_OUTER + 20).fill({
    color: 0x220808,
    alpha: 0.6,
  });
  container.addChild(outerGlow);

  // Accretion disk: spiral segments, bright inner (yellow/white) to dark outer (red)
  const disk = new Graphics();
  for (let i = 0; i < SEGMENTS; i++) {
    const a0 = (i / SEGMENTS) * Math.PI * 2;
    const a1 = ((i + 1) / SEGMENTS) * Math.PI * 2;
    const r0 = DISK_INNER;
    const r1 = DISK_OUTER + (i % 3) * 4;
    const t = i / SEGMENTS;
    const red = Math.round(255 - t * 120);
    const green = Math.round(180 - t * 140);
    const blue = Math.round(80 - t * 80);
    const color = (red << 16) | (green << 8) | blue;
    const alpha = 0.5 + (1 - t) * 0.5;
    disk.moveTo(Math.cos(a0) * r0, Math.sin(a0) * r0);
    disk.lineTo(Math.cos(a0) * r1, Math.sin(a0) * r1);
    disk.lineTo(Math.cos(a1) * r1, Math.sin(a1) * r1);
    disk.lineTo(Math.cos(a1) * r0, Math.sin(a1) * r0);
    disk.closePath();
    disk.fill({ color, alpha });
  }
  container.addChild(disk);

  // Inner bright ring (white-hot)
  const innerRing = new Graphics();
  innerRing.circle(0, 0, DISK_INNER + 4).fill({
    color: 0xffcc66,
    alpha: 0.9,
  });
  innerRing.circle(0, 0, DISK_INNER).fill({ color: 0x000000, alpha: 1 });
  container.addChild(innerRing);

  // Event horizon (black core)
  const core = new Graphics();
  core.circle(0, 0, CORE_RADIUS).fill({ color: 0x000000, alpha: 1 });
  container.addChild(core);

  return container;
}
