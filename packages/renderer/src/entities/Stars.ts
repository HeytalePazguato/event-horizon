/**
 * Background starfield. Density scales with view area so resizing fills the view.
 * @event-horizon/renderer
 */

import { Container, Graphics } from 'pixi.js';

const BASE_WIDTH = 640;
const BASE_HEIGHT = 400;
const BASE_AREA = BASE_WIDTH * BASE_HEIGHT;
const BASE_STAR_COUNT = 500;
const BASE_FAR_COUNT = 200;
const MAX_STARS = 2000;
const MAX_FAR_STARS = 800;
const MAX_RADIUS = 1.8;

function starCountForArea(area: number, base: number, max: number): number {
  const count = Math.round(base * (area / BASE_AREA));
  return Math.min(max, Math.max(base, count));
}

export function createStars(width: number, height: number): Container {
  const area = width * height;
  const starCount = starCountForArea(area, BASE_STAR_COUNT, MAX_STARS);
  const farCount = starCountForArea(area, BASE_FAR_COUNT, MAX_FAR_STARS);

  const container = new Container();
  const random = (min: number, max: number) => min + Math.random() * (max - min);

  const farLayer = new Graphics();
  for (let i = 0; i < farCount; i++) {
    const x = random(0, width);
    const y = random(0, height);
    const r = random(0.15, 0.5);
    const alpha = random(0.15, 0.45);
    farLayer.circle(x, y, r).fill({ color: 0xe8eef8, alpha });
  }
  container.addChild(farLayer);

  const g = new Graphics();
  for (let i = 0; i < starCount; i++) {
    const x = random(0, width);
    const y = random(0, height);
    const r = random(0.25, MAX_RADIUS);
    const alpha = random(0.35, 1);
    g.circle(x, y, r).fill({ color: 0xffffff, alpha });
  }
  container.addChild(g);
  return container;
}
