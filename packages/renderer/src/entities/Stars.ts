/**
 * Background starfield.
 * @event-horizon/renderer
 */

import { Container, Graphics } from 'pixi.js';

const STAR_COUNT = 450;
const FAR_STAR_COUNT = 180;
const MAX_RADIUS = 1.8;

export function createStars(width: number, height: number): Container {
  const container = new Container();
  const random = (min: number, max: number) => min + Math.random() * (max - min);

  const farLayer = new Graphics();
  for (let i = 0; i < FAR_STAR_COUNT; i++) {
    const x = random(0, width);
    const y = random(0, height);
    const r = random(0.15, 0.5);
    const alpha = random(0.15, 0.45);
    farLayer.circle(x, y, r).fill({ color: 0xe8eef8, alpha });
  }
  container.addChild(farLayer);

  const g = new Graphics();
  for (let i = 0; i < STAR_COUNT; i++) {
    const x = random(0, width);
    const y = random(0, height);
    const r = random(0.25, MAX_RADIUS);
    const alpha = random(0.35, 1);
    g.circle(x, y, r).fill({ color: 0xffffff, alpha });
  }
  container.addChild(g);
  return container;
}
