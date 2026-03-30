/**
 * Physics module tests — pure functions, no WebGL needed.
 */

import { describe, it, expect } from 'vitest';
import {
  distance, distanceSq, gravityAccel, singularityPull,
  clampSpeed, boundaryBounce, isInRadius, jetEscape, spiralToward,
} from '../physics.js';

describe('distance', () => {
  it('returns 0 for same point', () => {
    expect(distance({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe(0);
  });

  it('computes correct distance', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});

describe('distanceSq', () => {
  it('returns squared distance', () => {
    expect(distanceSq({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(25);
  });
});

describe('gravityAccel', () => {
  it('returns zero when too close', () => {
    const accel = gravityAccel({ x: 0, y: 0 }, { x: 1, y: 0 }, 1.0, 30);
    expect(accel.x).toBe(0);
    expect(accel.y).toBe(0);
  });

  it('points toward attractor', () => {
    const accel = gravityAccel({ x: 0, y: 0 }, { x: 100, y: 0 }, 1.0);
    expect(accel.x).toBeGreaterThan(0);
    expect(accel.y).toBeCloseTo(0);
  });

  it('falls off with distance squared', () => {
    const close = gravityAccel({ x: 0, y: 0 }, { x: 50, y: 0 }, 1.0);
    const far = gravityAccel({ x: 0, y: 0 }, { x: 100, y: 0 }, 1.0);
    expect(close.x).toBeGreaterThan(far.x);
  });
});

describe('singularityPull', () => {
  it('returns zero outside suck radius', () => {
    const pull = singularityPull({ x: 200, y: 0 }, { x: 0, y: 0 }, 100, 1.0);
    expect(pull.x).toBe(0);
    expect(pull.y).toBe(0);
  });

  it('returns non-zero inside suck radius', () => {
    const pull = singularityPull({ x: 50, y: 0 }, { x: 0, y: 0 }, 100, 1.0);
    expect(pull.x).toBeLessThan(0); // pulling toward 0
  });
});

describe('clampSpeed', () => {
  it('does not change slow velocities', () => {
    const result = clampSpeed(1, 1, 10);
    expect(result.vx).toBe(1);
    expect(result.vy).toBe(1);
  });

  it('clamps fast velocities', () => {
    const result = clampSpeed(30, 40, 5);
    const speed = Math.sqrt(result.vx * result.vx + result.vy * result.vy);
    expect(speed).toBeCloseTo(5);
  });
});

describe('boundaryBounce', () => {
  it('bounces off left edge', () => {
    const result = boundaryBounce({ x: -5, y: 50, vx: -3, vy: 0 }, 0, 0, 100, 100);
    expect(result.x).toBe(0);
    expect(result.vx).toBeGreaterThan(0);
    expect(result.edgesHit).toContain('left');
  });

  it('bounces off right edge', () => {
    const result = boundaryBounce({ x: 105, y: 50, vx: 3, vy: 0 }, 0, 0, 100, 100);
    expect(result.x).toBe(100);
    expect(result.vx).toBeLessThan(0);
    expect(result.edgesHit).toContain('right');
  });

  it('reports multiple edges for corner hits', () => {
    const result = boundaryBounce({ x: -5, y: -5, vx: -1, vy: -1 }, 0, 0, 100, 100);
    expect(result.edgesHit).toContain('left');
    expect(result.edgesHit).toContain('top');
  });
});

describe('isInRadius', () => {
  it('returns true when inside', () => {
    expect(isInRadius({ x: 5, y: 0 }, { x: 0, y: 0 }, 10)).toBe(true);
  });

  it('returns false when outside', () => {
    expect(isInRadius({ x: 15, y: 0 }, { x: 0, y: 0 }, 10)).toBe(false);
  });

  it('returns true at exact boundary', () => {
    expect(isInRadius({ x: 10, y: 0 }, { x: 0, y: 0 }, 10)).toBe(true);
  });
});

describe('jetEscape', () => {
  it('pushes away from center', () => {
    const escape = jetEscape({ x: 50, y: 0 }, { x: 0, y: 0 }, 5);
    expect(escape.x).toBeGreaterThan(0);
    expect(escape.y).toBeCloseTo(0);
  });
});

describe('spiralToward', () => {
  it('has both tangential and radial components', () => {
    const result = spiralToward({ x: 50, y: 0 }, { x: 0, y: 0 }, 2, 1);
    // Tangential component should be in y direction (perpendicular to x-axis)
    expect(Math.abs(result.y)).toBeGreaterThan(0);
    // Radial component should pull toward center (negative x)
    expect(result.x).toBeLessThan(0);
  });
});
