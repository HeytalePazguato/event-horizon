/**
 * Astronaut system — gravity, jet propulsion, boundary bounce, singularity capture.
 * Extracted from Universe.tsx ticker (Phase F.2).
 *
 * This module handles the physics and state transitions. PixiJS container
 * manipulation (scale, alpha, destroy) remains in Universe.tsx since it's
 * tightly coupled to the rendering lifecycle.
 */

import type { Container, Graphics } from 'pixi.js';

// ── Constants ───────────────────────────────────────────────────────────────

export const ASTRONAUT_MAX_SPEED = 3;
export const ASTRONAUT_SUCK_RADIUS = 92;
export const ASTRONAUT_GRAZE_RADIUS = 120;
export const ASTRONAUT_DESTROY_RADIUS = 30;
export const ASTRONAUT_JET_MIN_MS = 45_000;
export const ASTRONAUT_JET_MAX_MS = 120_000;
const GRAVITY_STRENGTH = 0.8;
const SINGULARITY_PULL = 1.2;

// ── Types ───────────────────────────────────────────────────────────────────

export interface AstronautState {
  id: number;
  c: Container;
  vx: number; vy: number;
  mass: number;
  inGravityWell?: boolean;
  inGrazeZone?: boolean;
  escapeCount?: number;
  nextJetTime?: number;
  bounceCount: number;
  edgesHit: Set<string>;
  jetFiredAt: number;
  hasBouncedSinceJet: boolean;
}

export interface PlanetInfo {
  x: number;
  y: number;
  radius: number;
  agentId?: string;
}

export interface AstronautCallbacks {
  onTrapped: () => void;
  onEscaped: () => void;
  onGrazed: () => void;
  onConsumed: () => void;
  onLanded: (agentId: string) => void;
  onBounced: (id: number, count: number, edges: Set<string>) => void;
  onRocketMan: () => void;
  onTrickShot: () => void;
  onKamikaze: () => void;
}

export interface ViewportBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface JetSprayParticle {
  g: Graphics;
  x: number; y: number;
  vx: number; vy: number;
  life: number;
  maxLife: number;
}

// ── Astronaut physics step ──────────────────────────────────────────────────

export interface AstronautUpdateResult {
  removed: boolean;
  jetFired: boolean;
  jetAngle: number;
  jetPower: number;
  bounced: boolean;
}

/**
 * Compute one physics step for a single astronaut.
 * Returns whether the astronaut was removed, and jet/bounce info for visual effects.
 * Does NOT modify PixiJS containers — caller handles that.
 */
export function updateAstronaut(
  a: AstronautState,
  singX: number, singY: number,
  planets: PlanetInfo[],
  bounds: ViewportBounds,
  dt: number,
  callbacks: AstronautCallbacks,
): AstronautUpdateResult {
  const result: AstronautUpdateResult = { removed: false, jetFired: false, jetAngle: 0, jetPower: 0, bounced: false };

  const dx = singX - a.c.x;
  const dy = singY - a.c.y;
  const r2 = dx * dx + dy * dy + 1;
  const r = Math.sqrt(r2);

  // Gravity well entry/exit
  if (!a.inGravityWell && r < ASTRONAUT_SUCK_RADIUS) {
    a.inGravityWell = true;
    callbacks.onTrapped();
  }
  if (a.inGravityWell && r >= ASTRONAUT_SUCK_RADIUS) {
    a.inGravityWell = false;
    a.escapeCount = (a.escapeCount ?? 0) + 1;
    callbacks.onEscaped();
  }

  // Graze zone
  if (!a.inGravityWell && !a.inGrazeZone && r < ASTRONAUT_GRAZE_RADIUS) {
    a.inGrazeZone = true;
  }
  if (a.inGrazeZone && r >= ASTRONAUT_GRAZE_RADIUS) {
    a.inGrazeZone = false;
    if (!a.inGravityWell) callbacks.onGrazed();
  }

  // Destruction check
  if (r < ASTRONAUT_DESTROY_RADIUS) {
    if (a.jetFiredAt > 0) {
      if (a.hasBouncedSinceJet) callbacks.onTrickShot();
      else callbacks.onKamikaze();
    }
    result.removed = true;
    callbacks.onConsumed();
    return result;
  }

  // Physics
  const invMass = 1 / a.mass;
  let ax: number, ay: number;
  if (a.inGravityWell) {
    const inward = (0.10 + (ASTRONAUT_SUCK_RADIUS - r) * 0.003) * invMass;
    ax = (dx / r) * inward;
    ay = (dy / r) * inward;
  } else {
    ax = (dx / r) * (SINGULARITY_PULL * invMass / r2) * dt * 60;
    ay = (dy / r) * (SINGULARITY_PULL * invMass / r2) * dt * 60;
  }

  // Planet gravity + landing
  for (const p of planets) {
    const px = p.x - a.c.x;
    const py = p.y - a.c.y;
    const pr2 = px * px + py * py + 1;
    const pr = Math.sqrt(pr2);
    const influenceRadius = Math.max(80, p.radius * 3);
    if (pr < influenceRadius) {
      const planetMass = p.radius / 15;
      const t = 1 - pr / influenceRadius;
      const falloff = t * t * t * t * t * t; // t^6
      ax += (px / pr) * (GRAVITY_STRENGTH * planetMass * invMass * falloff) * dt * 60;
      ay += (py / pr) * (GRAVITY_STRENGTH * planetMass * invMass * falloff) * dt * 60;
    }
    if (pr < p.radius + 8) {
      if (p.agentId) callbacks.onLanded(p.agentId);
      result.removed = true;
      return result;
    }
  }

  // Apply acceleration + speed cap
  a.vx += ax;
  a.vy += ay;
  const maxSpeed = ASTRONAUT_MAX_SPEED / Math.sqrt(a.mass);
  if (!a.inGravityWell) {
    const speed = Math.sqrt(a.vx * a.vx + a.vy * a.vy);
    if (speed > maxSpeed) {
      a.vx = (a.vx / speed) * maxSpeed;
      a.vy = (a.vy / speed) * maxSpeed;
    }
  }
  a.c.x += a.vx;
  a.c.y += a.vy;

  // Jet propulsion
  const now = Date.now();
  if (!a.nextJetTime) {
    a.nextJetTime = now + ASTRONAUT_JET_MIN_MS + Math.random() * (ASTRONAUT_JET_MAX_MS - ASTRONAUT_JET_MIN_MS);
  }
  if (now >= a.nextJetTime) {
    const inWell = !!a.inGravityWell;
    const escapeAngle = Math.atan2(a.c.y, a.c.x);
    const jetAngle = inWell
      ? escapeAngle + (Math.random() - 0.5) * 1.2
      : Math.random() * Math.PI * 2;
    const jetPower = inWell ? 4.0 + Math.random() * 2.5 : 2.5 + Math.random() * 1.5;
    a.vx += Math.cos(jetAngle) * jetPower;
    a.vy += Math.sin(jetAngle) * jetPower;
    a.jetFiredAt = now;
    a.hasBouncedSinceJet = false;
    callbacks.onRocketMan();
    a.nextJetTime = inWell
      ? now + 15_000 + Math.random() * 15_000
      : now + ASTRONAUT_JET_MIN_MS + Math.random() * (ASTRONAUT_JET_MAX_MS - ASTRONAUT_JET_MIN_MS);

    result.jetFired = true;
    result.jetAngle = jetAngle;
    result.jetPower = jetPower;
  }

  // Boundary bounce
  const margin = 8;
  let bounced = false;
  if (a.c.x < bounds.left + margin)  { a.c.x = bounds.left + margin;  a.vx = Math.abs(a.vx) * 0.6;  bounced = true; a.edgesHit.add('left'); }
  if (a.c.x > bounds.right - margin) { a.c.x = bounds.right - margin; a.vx = -Math.abs(a.vx) * 0.6; bounced = true; a.edgesHit.add('right'); }
  if (a.c.y < bounds.top + margin)   { a.c.y = bounds.top + margin;   a.vy = Math.abs(a.vy) * 0.6;  bounced = true; a.edgesHit.add('top'); }
  if (a.c.y > bounds.bottom - margin){ a.c.y = bounds.bottom - margin; a.vy = -Math.abs(a.vy) * 0.6; bounced = true; a.edgesHit.add('bottom'); }
  if (bounced) {
    a.bounceCount++;
    a.hasBouncedSinceJet = true;
    callbacks.onBounced(a.id, a.bounceCount, a.edgesHit);
    result.bounced = true;
  }

  return result;
}

/**
 * Update jet spray particles — decelerate, fade, clean up.
 * Mutates the array in place.
 */
export function updateJetSpray(particles: JetSprayParticle[], dt: number, releaseParticle?: (g: Graphics) => void): void {
  for (let i = particles.length - 1; i >= 0; i--) {
    const jp = particles[i];
    jp.life += dt;
    jp.x += jp.vx;
    jp.y += jp.vy;
    jp.vx *= 0.96;
    jp.vy *= 0.96;
    jp.g.x = jp.x;
    jp.g.y = jp.y;
    const frac = jp.life / jp.maxLife;
    jp.g.alpha = (1 - frac) * 0.8;
    jp.g.scale.set(1 - frac * 0.5);
    if (jp.life >= jp.maxLife) {
      if (releaseParticle) {
        releaseParticle(jp.g);
      } else {
        jp.g.destroy();
      }
      particles.splice(i, 1);
    }
  }
}
