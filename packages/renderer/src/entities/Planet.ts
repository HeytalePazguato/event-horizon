/**
 * Agent visualization (planet).
 * @event-horizon/renderer
 */

import { Container, Graphics } from 'pixi.js';

export interface PlanetProps {
  agentId: string;
  x: number;
  y: number;
  size: number;
  brightness: number;
}

const BASE_COLOR = 0x4488aa;

export function createPlanet(props: PlanetProps): Container {
  const { x, y, size, brightness } = props;
  const container = new Container();
  container.x = x;
  container.y = y;
  container.eventMode = 'static';
  container.cursor = 'pointer';
  (container as Container & { __agentId?: string }).__agentId = props.agentId;

  const glowRadius = size * 1.3;
  const glow = new Graphics();
  glow.circle(0, 0, glowRadius).fill({
    color: BASE_COLOR,
    alpha: 0.2 * brightness,
  });
  container.addChild(glow);

  const body = new Graphics();
  body.circle(0, 0, size).fill({
    color: BASE_COLOR,
    alpha: 0.5 + 0.5 * brightness,
  });
  container.addChild(body);

  return container;
}
