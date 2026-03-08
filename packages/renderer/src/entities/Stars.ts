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
  // Colored star tints — subtle, dim so they read as distant background stars
  const COLORED_STARS: Array<{ color: number; alpha: [number, number] }> = [
    { color: 0x88aaff, alpha: [0.20, 0.45] },  // blue
    { color: 0xff9988, alpha: [0.18, 0.40] },  // red
    { color: 0xffdd88, alpha: [0.18, 0.38] },  // yellow
  ];
  const COLORED_RATIO = 0.08; // ~8 % of near-layer stars get a colour tint

  for (let i = 0; i < starCount; i++) {
    const x = random(0, width);
    const y = random(0, height);
    const r = random(0.25, MAX_RADIUS);
    if (Math.random() < COLORED_RATIO) {
      const cs = COLORED_STARS[Math.floor(Math.random() * COLORED_STARS.length)];
      const a = random(cs.alpha[0], cs.alpha[1]);
      // Keep colored stars small so they can't be mistaken for planets
      g.circle(x, y, Math.min(r, 1.0)).fill({ color: cs.color, alpha: a });
    } else {
      const alpha = random(0.35, 1);
      g.circle(x, y, r).fill({ color: 0xffffff, alpha });
    }
  }
  container.addChild(g);
  return container;
}
