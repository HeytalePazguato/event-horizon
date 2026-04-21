import type { Graphics } from 'pixi.js';

class GraphicsPool {
  private pool: Graphics[] = [];
  private factoryCallCount = 0;
  private factory: () => Graphics;
  private resetFn: (g: Graphics) => void;

  constructor(initialSize: number, factory: () => Graphics, reset: (g: Graphics) => void) {
    this.factory = factory;
    this.resetFn = reset;

    for (let i = 0; i < initialSize; i++) {
      this.pool.push(this.factory());
      this.factoryCallCount++;
    }
  }

  acquire(): Graphics {
    let graphics: Graphics;

    if (this.pool.length > 0) {
      graphics = this.pool.pop()!;
    } else {
      graphics = this.factory();
      this.factoryCallCount++;
    }

    this.resetFn(graphics);
    return graphics;
  }

  release(graphics: Graphics): void {
    if ('parent' in graphics && graphics.parent) {
      graphics.parent.removeChild(graphics);
    }
    this.pool.push(graphics);
  }

  destroyAll(): void {
    for (const graphics of this.pool) {
      graphics.destroy();
    }
    this.pool = [];
  }

  get factoryCalls(): number {
    return this.factoryCallCount;
  }
}

export { GraphicsPool };
