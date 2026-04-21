import { Graphics } from 'pixi.js';
import { GraphicsPool } from './GraphicsPool.js';

const JET_SPRAY_INITIAL_SIZE = 32;

export function createJetSprayPool(): GraphicsPool {
  return new GraphicsPool(
    JET_SPRAY_INITIAL_SIZE,
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
    },
  );
}
