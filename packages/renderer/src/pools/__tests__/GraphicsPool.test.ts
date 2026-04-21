import { describe, it, expect, vi } from 'vitest';
import { GraphicsPool } from '../GraphicsPool';

describe('GraphicsPool', () => {
  it('pre-allocates initialSize instances in constructor', () => {
    const initialSize = 10;
    const factory = vi.fn(() => ({ destroy: vi.fn() } as any));
    const reset = vi.fn();

    new GraphicsPool(initialSize, factory as any, reset);

    expect(factory).toHaveBeenCalledTimes(initialSize);
  });

  it('serves 1000 balanced acquire/release cycles without exceeding initialSize factory calls', () => {
    const initialSize = 32;
    const factory = vi.fn(() => ({ destroy: vi.fn() } as any));
    const reset = vi.fn();

    const pool = new GraphicsPool(initialSize, factory as any, reset);
    const initialCalls = factory.mock.calls.length;

    for (let i = 0; i < 1000; i++) {
      const graphics = pool.acquire();
      pool.release(graphics);
    }

    expect(factory.mock.calls.length).toBe(initialCalls);
  });

  it('calls factory additional times when acquiring beyond pool without release', () => {
    const initialSize = 5;
    const factory = vi.fn(() => ({ destroy: vi.fn(), parent: null } as any));
    const reset = vi.fn();

    const pool = new GraphicsPool(initialSize, factory as any, reset);

    const graphics: any[] = [];
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
    const factory = vi.fn(() => mockGraphics[graphicsIndex++] as any);
    const reset = vi.fn();

    const pool = new GraphicsPool(initialSize, factory as any, reset);

    pool.destroyAll();

    mockGraphics.forEach((graphics) => {
      expect(graphics.destroy).toHaveBeenCalled();
    });
  });

  it('detaches graphics from parent when releasing', () => {
    const factory = () => ({
      destroy: vi.fn(),
      parent: { removeChild: vi.fn() },
    });
    const reset = vi.fn();

    const pool = new GraphicsPool(1, factory as any, reset);
    const graphics = pool.acquire();
    (graphics as any).parent.removeChild = vi.fn();

    pool.release(graphics);

    expect((graphics as any).parent.removeChild).toHaveBeenCalledWith(graphics);
  });
});
