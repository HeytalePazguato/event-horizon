/**
 * Central black hole / singularity.
 * @event-horizon/renderer
 */

import { Container, Graphics } from 'pixi.js';

const CORE_RADIUS = 25;
const GLOW_RADIUS = 60;

export interface SingularityProps {
  x: number;
  y: number;
}

export function createSingularity(props: SingularityProps): Container {
  const { x, y } = props;
  const container = new Container();
  container.x = x;
  container.y = y;

  const glow = new Graphics();
  glow.circle(0, 0, GLOW_RADIUS).fill({ color: 0x220033, alpha: 0.6 });
  container.addChild(glow);

  const core = new Graphics();
  core.circle(0, 0, CORE_RADIUS).fill({ color: 0x000000, alpha: 1 });
  container.addChild(core);

  return container;
}
