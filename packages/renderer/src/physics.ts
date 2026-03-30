/**
 * Pure physics functions — gravity, collision, boundary.
 * No PixiJS or DOM dependencies. Fully testable.
 * Phase F — Universe ECS Refactor.
 */

// ── Constants ───────────────────────────────────────────────────────────────

export const GRAVITY_STRENGTH = 0.8;
export const SINGULARITY_PULL = 1.2;
export const ASTRONAUT_MAX_SPEED = 3;
export const ASTRONAUT_SUCK_RADIUS = 92;
export const ASTRONAUT_GRAZE_RADIUS = 120;
export const ASTRONAUT_DESTROY_RADIUS = 30;
export const ASTRONAUT_JET_MIN_MS = 45_000;
export const ASTRONAUT_JET_MAX_MS = 120_000;

// ── Types ───────────────────────────────────────────────────────────────────

export interface Vec2 {
  x: number;
  y: number;
}

export interface PhysicsBody {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

// ── Functions ───────────────────────────────────────────────────────────────

/** Distance between two points. */
export function distance(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Squared distance (avoid sqrt when only comparing magnitudes). */
export function distanceSq(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/** Compute gravitational acceleration from a point mass at `attractor` on a body at `pos`. */
export function gravityAccel(pos: Vec2, attractor: Vec2, strength: number, minDist = 30): Vec2 {
  const dx = attractor.x - pos.x;
  const dy = attractor.y - pos.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < minDist) return { x: 0, y: 0 };
  const force = strength / (dist * dist);
  return { x: (dx / dist) * force, y: (dy / dist) * force };
}

/** Apply singularity pull — stronger at close range with suck threshold. */
export function singularityPull(pos: Vec2, center: Vec2, suckRadius: number, pullStrength: number): Vec2 {
  const dx = center.x - pos.x;
  const dy = center.y - pos.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist > suckRadius || dist < 1) return { x: 0, y: 0 };
  // Inverse distance gives stronger pull closer to center
  const factor = pullStrength * (1 - dist / suckRadius);
  return { x: (dx / dist) * factor, y: (dy / dist) * factor };
}

/** Clamp velocity magnitude to maxSpeed. */
export function clampSpeed(vx: number, vy: number, maxSpeed: number): { vx: number; vy: number } {
  const speed = Math.sqrt(vx * vx + vy * vy);
  if (speed <= maxSpeed) return { vx, vy };
  const scale = maxSpeed / speed;
  return { vx: vx * scale, vy: vy * scale };
}

/** Bounce a body off rectangular boundaries. Returns new position and velocity. */
export function boundaryBounce(
  body: PhysicsBody,
  minX: number, minY: number, maxX: number, maxY: number,
  damping = 0.6,
): { x: number; y: number; vx: number; vy: number; edgesHit: string[] } {
  let { x, y, vx, vy } = body;
  const edgesHit: string[] = [];

  if (x < minX) { x = minX; vx = Math.abs(vx) * damping; edgesHit.push('left'); }
  if (x > maxX) { x = maxX; vx = -Math.abs(vx) * damping; edgesHit.push('right'); }
  if (y < minY) { y = minY; vy = Math.abs(vy) * damping; edgesHit.push('top'); }
  if (y > maxY) { y = maxY; vy = -Math.abs(vy) * damping; edgesHit.push('bottom'); }

  return { x, y, vx, vy, edgesHit };
}

/** Check if a point is within a circular zone. */
export function isInRadius(pos: Vec2, center: Vec2, radius: number): boolean {
  return distanceSq(pos, center) <= radius * radius;
}

/** Apply jet propulsion (escape velocity boost) away from a point. */
export function jetEscape(pos: Vec2, from: Vec2, boostStrength: number): Vec2 {
  const dx = pos.x - from.x;
  const dy = pos.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1) return { x: boostStrength, y: 0 };
  return { x: (dx / dist) * boostStrength, y: (dy / dist) * boostStrength };
}

/** Spiral motion toward a point (for singularity capture). */
export function spiralToward(pos: Vec2, target: Vec2, angularSpeed: number, inwardSpeed: number): Vec2 {
  const dx = target.x - pos.x;
  const dy = target.y - pos.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1) return { x: 0, y: 0 };
  // Tangential component (perpendicular to radial)
  const tx = -dy / dist;
  const ty = dx / dist;
  // Radial component (toward center)
  const rx = dx / dist;
  const ry = dy / dist;
  return {
    x: tx * angularSpeed + rx * inwardSpeed,
    y: ty * angularSpeed + ry * inwardSpeed,
  };
}
