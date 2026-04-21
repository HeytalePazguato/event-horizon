import { Graphics } from 'pixi.js';
import { GraphicsPool } from './GraphicsPool.js';

const SHOOTING_STAR_INITIAL_SIZE = 8;

export function createShootingStarPool(): GraphicsPool {
  return new GraphicsPool(
    SHOOTING_STAR_INITIAL_SIZE,
    () => new Graphics(),
    (g) => {
      g.clear();
      g.alpha = 1;
      g.scale.set(1);
      g.x = 0;
      g.y = 0;
      g.rotation = 0;
      g.tint = 0xffffff;
      g.visible = true;
      g.eventMode = 'none';
    },
  );
}
