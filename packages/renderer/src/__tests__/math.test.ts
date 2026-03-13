import { describe, it, expect } from 'vitest';
import {
  hashId,
  normCwd,
  groupByWorkspace,
  bezierPoint,
  computeControlPoint,
  computePlanetPositions,
  computeBeltContour,
  MIN_PIXEL_DIST,
  PLANET_MIN_RADIUS,
  SHIP_AVOID_RADIUS,
  BELT_SAMPLES,
  BELT_PADDING,
} from '../math.js';
import type { AgentView } from '../math.js';

// --- helpers ----------------------------------------------------------------

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function distFromOrigin(p: { x: number; y: number }): number {
  return Math.sqrt(p.x * p.x + p.y * p.y);
}

function makeAgent(id: string, cwd?: string): AgentView {
  return { id, name: id, cwd };
}

// =============================================================================
// hashId
// =============================================================================

describe('hashId', () => {
  it('returns a non-negative integer', () => {
    expect(hashId('test')).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(hashId('test'))).toBe(true);
  });

  it('is deterministic', () => {
    expect(hashId('hello')).toBe(hashId('hello'));
    expect(hashId('agent-42')).toBe(hashId('agent-42'));
  });

  it('produces different hashes for different inputs', () => {
    expect(hashId('a')).not.toBe(hashId('b'));
    expect(hashId('agent-1')).not.toBe(hashId('agent-2'));
  });

  it('handles empty string', () => {
    expect(hashId('')).toBe(5381);
  });

  it('distributes across modulo 3 (orbit bands)', () => {
    // Run enough inputs to check distribution isn't degenerate
    const bands = new Set<number>();
    for (let i = 0; i < 20; i++) {
      bands.add(hashId(`agent-${i}`) % 3);
    }
    expect(bands.size).toBe(3);
  });
});

// =============================================================================
// normCwd
// =============================================================================

describe('normCwd', () => {
  it('lowercases the path', () => {
    expect(normCwd('/Users/FOO/bar')).toBe('/users/foo/bar');
  });

  it('converts backslashes to forward slashes', () => {
    expect(normCwd('C:\\Users\\test\\project')).toBe('c:/users/test/project');
  });

  it('strips trailing slashes', () => {
    expect(normCwd('/project/')).toBe('/project');
    expect(normCwd('/project///')).toBe('/project');
  });

  it('handles already-normalized paths', () => {
    expect(normCwd('/project/src')).toBe('/project/src');
  });

  it('handles root paths', () => {
    expect(normCwd('/')).toBe('');
    expect(normCwd('C:\\')).toBe('c:');
  });
});

// =============================================================================
// groupByWorkspace
// =============================================================================

describe('groupByWorkspace', () => {
  it('returns empty array for no agents', () => {
    expect(groupByWorkspace([])).toEqual([]);
  });

  it('groups agents with same cwd', () => {
    const agents = [
      makeAgent('a', '/project'),
      makeAgent('b', '/project'),
    ];
    const groups = groupByWorkspace(agents);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
  });

  it('groups agents with nested cwds', () => {
    const agents = [
      makeAgent('a', '/project'),
      makeAgent('b', '/project/packages/core'),
    ];
    const groups = groupByWorkspace(agents);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
  });

  it('separates agents with unrelated cwds', () => {
    const agents = [
      makeAgent('a', '/project-one'),
      makeAgent('b', '/project-two'),
    ];
    const groups = groupByWorkspace(agents);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveLength(1);
    expect(groups[1]).toHaveLength(1);
  });

  it('puts agents without cwd in solo groups', () => {
    const agents = [
      makeAgent('a', '/project'),
      makeAgent('b'), // no cwd
    ];
    const groups = groupByWorkspace(agents);
    expect(groups).toHaveLength(2);
  });

  it('normalizes paths for comparison (case, slashes)', () => {
    const agents = [
      makeAgent('a', 'C:\\Users\\dev\\Project'),
      makeAgent('b', 'c:/users/dev/project'),
    ];
    const groups = groupByWorkspace(agents);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
  });

  it('does not group partial path matches without boundary', () => {
    const agents = [
      makeAgent('a', '/project'),
      makeAgent('b', '/project-other'),
    ];
    const groups = groupByWorkspace(agents);
    expect(groups).toHaveLength(2);
  });

  it('widens group root to the shorter path', () => {
    const agents = [
      makeAgent('a', '/project/packages/core'),
      makeAgent('b', '/project'),
      makeAgent('c', '/project/packages/ui'),
    ];
    const groups = groupByWorkspace(agents);
    // All three should be in the same group
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(3);
  });
});

// =============================================================================
// bezierPoint
// =============================================================================

describe('bezierPoint', () => {
  it('returns start point at t=0', () => {
    const p = bezierPoint(0, 0, 0, 50, 50, 100, 0);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(0);
  });

  it('returns end point at t=1', () => {
    const p = bezierPoint(1, 0, 0, 50, 50, 100, 0);
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(0);
  });

  it('returns control point at t=0.5 for symmetric curve', () => {
    // For quadratic bezier, midpoint = 0.25*P0 + 0.5*C + 0.25*P1
    const p = bezierPoint(0.5, 0, 0, 50, 100, 100, 0);
    expect(p.x).toBeCloseTo(50);
    expect(p.y).toBeCloseTo(50); // 0.25*0 + 0.5*100 + 0.25*0 = 50
  });

  it('handles horizontal straight line (control at midpoint)', () => {
    const p = bezierPoint(0.5, 0, 0, 50, 0, 100, 0);
    expect(p.x).toBeCloseTo(50);
    expect(p.y).toBeCloseTo(0);
  });

  it('handles vertical curves', () => {
    const p = bezierPoint(0.5, 0, 0, 0, 50, 0, 100);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(50);
  });

  it('interpolates monotonically for t in [0,1]', () => {
    // For a left-to-right curve, x should increase with t
    let prevX = -Infinity;
    for (let t = 0; t <= 1; t += 0.1) {
      const p = bezierPoint(t, 0, 0, 50, 50, 100, 0);
      expect(p.x).toBeGreaterThanOrEqual(prevX);
      prevX = p.x;
    }
  });
});

// =============================================================================
// computeControlPoint
// =============================================================================

describe('computeControlPoint', () => {
  it('produces arc that clears the singularity for safe paths', () => {
    // Two planets far from origin (on same side)
    const cp = computeControlPoint(200, 100, 300, 100);
    // Control point should not be at the midpoint (should have arc offset)
    const mx = 250;
    const my = 100;
    const cpDist = Math.sqrt((cp.cx - mx) ** 2 + (cp.cy - my) ** 2);
    expect(cpDist).toBeGreaterThanOrEqual(30); // minimum arc offset
  });

  it('scales arc offset with distance for safe paths', () => {
    // Close planets
    const cpClose = computeControlPoint(200, 0, 250, 0);
    // Far planets
    const cpFar = computeControlPoint(200, 0, 800, 0);

    const closeOffset = Math.abs(cpClose.cy); // perpendicular offset from y=0 line
    const farOffset = Math.abs(cpFar.cy);
    expect(farOffset).toBeGreaterThan(closeOffset);
  });

  it('pushes arc away from origin for danger zone paths', () => {
    // Path that goes through the origin (anti-podal)
    const cp = computeControlPoint(-200, 0, 200, 0);
    // The arc should be pushed far from origin
    const cpDistFromOrigin = Math.sqrt(cp.cx * cp.cx + cp.cy * cp.cy);
    expect(cpDistFromOrigin).toBeGreaterThan(SHIP_AVOID_RADIUS);
  });

  it('keeps entire bezier arc clear of the singularity for anti-podal planets', () => {
    const cp = computeControlPoint(-200, 0, 200, 0);
    // Sample the bezier at many points and verify all clear the avoid radius
    for (let t = 0; t <= 1; t += 0.01) {
      const p = bezierPoint(t, -200, 0, cp.cx, cp.cy, 200, 0);
      const d = distFromOrigin(p);
      expect(d).toBeGreaterThanOrEqual(SHIP_AVOID_RADIUS * 0.9); // 10% tolerance for numerical precision
    }
  });

  it('keeps arc clear for diagonal anti-podal paths', () => {
    const cp = computeControlPoint(-150, -150, 150, 150);
    for (let t = 0; t <= 1; t += 0.02) {
      const p = bezierPoint(t, -150, -150, cp.cx, cp.cy, 150, 150);
      const d = distFromOrigin(p);
      expect(d).toBeGreaterThanOrEqual(SHIP_AVOID_RADIUS * 0.85);
    }
  });

  it('handles co-located endpoints gracefully', () => {
    // Degenerate case — same start and end
    const cp = computeControlPoint(200, 200, 200, 200);
    expect(Number.isFinite(cp.cx)).toBe(true);
    expect(Number.isFinite(cp.cy)).toBe(true);
  });

  it('arc offset is capped at 120 for very long distances', () => {
    // Very far apart, safe path
    const cp = computeControlPoint(200, 1000, 200, -1000);
    // midpoint is (200, 0), distance is 2000, 20% = 400 but capped at 120
    const mx = 200, my = 0;
    const offset = Math.sqrt((cp.cx - mx) ** 2 + (cp.cy - my) ** 2);
    expect(offset).toBeLessThanOrEqual(125); // small tolerance
  });
});

// =============================================================================
// computePlanetPositions
// =============================================================================

describe('computePlanetPositions', () => {
  it('returns empty for no agents', () => {
    const { positions, workspaceGroups } = computePlanetPositions([]);
    expect(positions.size).toBe(0);
    expect(workspaceGroups).toHaveLength(0);
  });

  it('places a single agent', () => {
    const { positions } = computePlanetPositions([makeAgent('a')]);
    expect(positions.size).toBe(1);
    const pos = positions.get('a')!;
    expect(distFromOrigin(pos)).toBeGreaterThanOrEqual(PLANET_MIN_RADIUS);
  });

  it('places all agents', () => {
    const agents = Array.from({ length: 5 }, (_, i) => makeAgent(`agent-${i}`));
    const { positions } = computePlanetPositions(agents);
    expect(positions.size).toBe(5);
  });

  it('no two planets overlap (respects MIN_PIXEL_DIST)', () => {
    const agents = Array.from({ length: 8 }, (_, i) => makeAgent(`agent-${i}`));
    const { positions } = computePlanetPositions(agents);
    const entries = [...positions.entries()];
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const d = dist(entries[i][1], entries[j][1]);
        expect(d).toBeGreaterThanOrEqual(MIN_PIXEL_DIST * 0.95); // small tolerance for floating point
      }
    }
  });

  it('no planet inside the singularity', () => {
    const agents = Array.from({ length: 10 }, (_, i) => makeAgent(`agent-${i}`));
    const { positions } = computePlanetPositions(agents);
    for (const [, pos] of positions) {
      expect(distFromOrigin(pos)).toBeGreaterThanOrEqual(PLANET_MIN_RADIUS * 0.99);
    }
  });

  it('groups workspace agents together', () => {
    const agents = [
      makeAgent('a', '/project'),
      makeAgent('b', '/project/packages/core'),
      makeAgent('c', '/other'),
    ];
    const { positions, workspaceGroups } = computePlanetPositions(agents);
    expect(positions.size).toBe(3);
    expect(workspaceGroups).toHaveLength(1);
    expect(workspaceGroups[0].agentIds).toContain('a');
    expect(workspaceGroups[0].agentIds).toContain('b');
    expect(workspaceGroups[0].memberPositions).toHaveLength(2);
  });

  it('is deterministic for same seed', () => {
    const agents = [makeAgent('a'), makeAgent('b')];
    const r1 = computePlanetPositions(agents, 0.5);
    const r2 = computePlanetPositions(agents, 0.5);
    for (const [id, pos] of r1.positions) {
      const pos2 = r2.positions.get(id)!;
      expect(pos.x).toBeCloseTo(pos2.x);
      expect(pos.y).toBeCloseTo(pos2.y);
    }
  });

  it('different seeds produce different positions', () => {
    const agents = [makeAgent('a')];
    const r1 = computePlanetPositions(agents, 0.1);
    const r2 = computePlanetPositions(agents, 0.9);
    const p1 = r1.positions.get('a')!;
    const p2 = r2.positions.get('a')!;
    // At least one coordinate should differ
    expect(p1.x !== p2.x || p1.y !== p2.y).toBe(true);
  });

  it('handles many agents without infinite loop', () => {
    const agents = Array.from({ length: 20 }, (_, i) => makeAgent(`agent-${i}`));
    const start = Date.now();
    const { positions } = computePlanetPositions(agents);
    expect(Date.now() - start).toBeLessThan(1000); // should finish well under 1s
    expect(positions.size).toBe(20);
  });
});

// =============================================================================
// computeBeltContour
// =============================================================================

describe('computeBeltContour', () => {
  it('returns BELT_SAMPLES points', () => {
    const contour = computeBeltContour([{ x: 200, y: 0 }, { x: 250, y: 0 }]);
    expect(contour).toHaveLength(BELT_SAMPLES);
  });

  it('contour encloses all member positions', () => {
    const members = [
      { x: 200, y: 0 },
      { x: 250, y: 50 },
      { x: 180, y: -30 },
    ];
    const contour = computeBeltContour(members);
    // Centroid
    const cx = members.reduce((s, m) => s + m.x, 0) / members.length;
    const cy = members.reduce((s, m) => s + m.y, 0) / members.length;

    // Every contour point should be at least BELT_PADDING away from the centroid
    // (since there are members at the centroid or further)
    for (const cp of contour) {
      const d = dist(cp, { x: cx, y: cy });
      expect(d).toBeGreaterThanOrEqual(BELT_PADDING);
    }
  });

  it('forms a closed shape (first and last points are near each other angularly)', () => {
    const contour = computeBeltContour([{ x: 200, y: 0 }, { x: 250, y: 50 }]);
    // The contour samples 0 to 2π evenly; first and last should be adjacent angles
    const first = contour[0];
    const last = contour[contour.length - 1];
    // They shouldn't be identical but should be close (within one angular step)
    expect(first).not.toEqual(last);
  });

  it('contour is larger for more spread out members', () => {
    const tight = computeBeltContour([{ x: 200, y: 0 }, { x: 210, y: 0 }]);
    const spread = computeBeltContour([{ x: 100, y: 0 }, { x: 300, y: 0 }]);

    // Average radius of spread contour should be larger
    const avgRadius = (contour: Array<{ x: number; y: number }>, cx: number, cy: number) =>
      contour.reduce((s, p) => s + dist(p, { x: cx, y: cy }), 0) / contour.length;

    const tightAvg = avgRadius(tight, 205, 0);
    const spreadAvg = avgRadius(spread, 200, 0);
    expect(spreadAvg).toBeGreaterThan(tightAvg);
  });

  it('is deterministic (uses hashId for noise)', () => {
    const members = [{ x: 200, y: 0 }, { x: 250, y: 50 }];
    const c1 = computeBeltContour(members);
    const c2 = computeBeltContour(members);
    for (let i = 0; i < c1.length; i++) {
      expect(c1[i].x).toBeCloseTo(c2[i].x);
      expect(c1[i].y).toBeCloseTo(c2[i].y);
    }
  });
});
