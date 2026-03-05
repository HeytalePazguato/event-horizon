/**
 * Background starfield.
 * @event-horizon/renderer
 */

import { Container, Graphics } from 'pixi.js';

const STAR_COUNT = 200;
const MAX_RADIUS = 1.5;

export function createStars(width: number, height: number): Container {
  const container = new Container();
  const g = new Graphics();
  const random = (min: number, max: number) => min + Math.random() * (max - min);

  for (let i = 0; i < STAR_COUNT; i++) {
    const x = random(0, width);
    const y = random(0, height);
    const r = random(0.3, MAX_RADIUS);
    const alpha = random(0.3, 1);
    g.circle(x, y, r).fill({ color: 0xffffff, alpha });
  }

  container.addChild(g);
  return container;
}
