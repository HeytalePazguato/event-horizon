/**
 * Astronaut — floats in space, affected by gravity.
 * @event-horizon/renderer
 */

import { Container, Graphics } from 'pixi.js';

const SIZE = 6;

export function createAstronaut(): Container {
  const c = new Container();
  const body = new Graphics();
  body.circle(0, 0, SIZE).fill({ color: 0xe8e8e8, alpha: 0.95 });
  body.circle(-1.5, -1, 1.5).fill({ color: 0x2a2a2a, alpha: 0.8 });
  c.addChild(body);
  const helmet = new Graphics();
  helmet.circle(0, -2, 3).fill({ color: 0xd0e0f0, alpha: 0.6 });
  helmet.circle(0.5, -2.2, 0.8).fill({ color: 0x1a1a2a, alpha: 0.9 });
  c.addChild(helmet);
  c.eventMode = 'none';
  c.cursor = 'default';
  return c;
}
