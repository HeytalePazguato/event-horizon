/**
 * Central black hole / singularity — completed tasks disappear here.
 * @event-horizon/renderer
 */

import { Container, Graphics } from 'pixi.js';

const CORE_RADIUS = 28;
const GLOW_RADIUS = 72;
const RING_INNER = 38;
const RING_OUTER = 58;

export interface SingularityProps {
  x: number;
  y: number;
}

export function createSingularity(props: SingularityProps): Container {
  const { x, y } = props;
  const container = new Container();
  container.x = x;
  container.y = y;

  const outerGlow = new Graphics();
  outerGlow.circle(0, 0, GLOW_RADIUS).fill({ color: 0x1a0a2a, alpha: 0.85 });
  container.addChild(outerGlow);

  const glow = new Graphics();
  glow.circle(0, 0, RING_OUTER).fill({ color: 0x330044, alpha: 0.7 });
  container.addChild(glow);

  const ring = new Graphics();
  ring.circle(0, 0, RING_OUTER).fill({ color: 0x550077, alpha: 0.85 });
  ring.circle(0, 0, RING_INNER).fill({ color: 0x000000, alpha: 1 });
  container.addChild(ring);

  const innerGlow = new Graphics();
  innerGlow.circle(0, 0, RING_INNER).fill({ color: 0x440066, alpha: 0.5 });
  container.addChild(innerGlow);

  const core = new Graphics();
  core.circle(0, 0, CORE_RADIUS).fill({ color: 0x000000, alpha: 1 });
  container.addChild(core);

  return container;
}
