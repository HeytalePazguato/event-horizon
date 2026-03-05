/**
 * Task visualization (moon).
 * @event-horizon/renderer
 */

import { Container, Graphics } from 'pixi.js';

export interface MoonProps {
  taskId: string;
  planetId: string;
  orbitSpeed: number;
  orbitDistance: number;
}

const MOON_RADIUS = 4;
const MOON_COLOR = 0xaaccff;

export function createMoon(props: MoonProps): Container {
  const container = new Container();
  (container as Container & { __taskId?: string }).__taskId = props.taskId;
  (container as Container & { __planetId?: string }).__planetId = props.planetId;
  (container as Container & { __orbitSpeed?: number }).__orbitSpeed = props.orbitSpeed;
  (container as Container & { __orbitDistance?: number }).__orbitDistance = props.orbitDistance;
  (container as Container & { __orbitAngle?: number }).__orbitAngle = 0;

  const g = new Graphics();
  g.circle(0, 0, MOON_RADIUS).fill({ color: MOON_COLOR, alpha: 0.9 });
  container.addChild(g);

  return container;
}
