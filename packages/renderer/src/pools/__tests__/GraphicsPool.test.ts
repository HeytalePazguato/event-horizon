import { describe, it, expect, vi } from 'vitest';
import type { Graphics } from 'pixi.js';
import { GraphicsPool } from '../GraphicsPool';

/**
 * The slice of Graphics that GraphicsPool actually touches. Building a real
 * Graphics needs a WebGL context, so the pool is exercised against this
 * instead — narrow enough to stay honest about what is being stubbed.
 */
interface MockGraphics {
  destroy: () => void;
  parent?: { removeChild: (child: unknown) => void } | null;
}

/** Present a mock to APIs typed against the real Graphics. */
const asGraphics = (mock: MockGraphics): Graphics => mock as unknown as Graphics;

/** Read a pooled instance back as its mock shape. */
const asMock = (graphics: Graphics): MockGraphics => graphics as unknown as MockGraphics;

describe('GraphicsPool', () => {
  it('pre-allocates initialSize instances in constructor', () => {
    const initialSize = 10;
    const factory = vi.fn(() => asGraphics({ destroy: vi.fn() }));
    const reset = vi.fn();

    new GraphicsPool(initialSize, factory, reset);

    expect(factory).toHaveBeenCalledTimes(initialSize);
  });

  it('serves 1000 balanced acquire/release cycles without exceeding initialSize factory calls', () => {
    const initialSize = 32;
    const factory = vi.fn(() => asGraphics({ destroy: vi.fn() }));
    const reset = vi.fn();

    const pool = new GraphicsPool(initialSize, factory, reset);
    const initialCalls = factory.mock.calls.length;

    for (let i = 0; i < 1000; i++) {
      const graphics = pool.acquire();
      pool.release(graphics);
    }

    expect(factory.mock.calls.length).toBe(initialCalls);
  });

  it('calls factory additional times when acquiring beyond pool without release', () => {
    const initialSize = 5;
    const factory = vi.fn(() => asGraphics({ destroy: vi.fn(), parent: null }));
    const reset = vi.fn();

    const pool = new GraphicsPool(initialSize, factory, reset);

    const graphics: Graphics[] = [];
    for (let i = 0; i < 10; i++) {
      graphics.push(pool.acquire());
    }

    expect(factory).toHaveBeenCalledTimes(10);
  });

  it('calls destroy on every pooled instance when destroyAll is called', () => {
    const initialSize = 8;
    const mockGraphics = Array.from({ length: initialSize }, () => ({
      destroy: vi.fn(),
    }));

    let graphicsIndex = 0;
    const factory = vi.fn(() => asGraphics(mockGraphics[graphicsIndex++]));
    const reset = vi.fn();

    const pool = new GraphicsPool(initialSize, factory, reset);

    pool.destroyAll();

    mockGraphics.forEach((graphics) => {
      expect(graphics.destroy).toHaveBeenCalled();
    });
  });

  it('detaches graphics from parent when releasing', () => {
    const factory = () => asGraphics({
      destroy: vi.fn(),
      parent: { removeChild: vi.fn() },
    });
    const reset = vi.fn();

    const pool = new GraphicsPool(1, factory, reset);
    const graphics = pool.acquire();
    const removeChild = vi.fn();
    asMock(graphics).parent = { removeChild };

    pool.release(graphics);

    expect(removeChild).toHaveBeenCalledWith(graphics);
  });
});
