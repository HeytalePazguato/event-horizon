/**
 * Shooting star system — linear motion + fade lifecycle.
 * Extracted from Universe.tsx ticker (Phase F.2).
 */

import type { Graphics } from 'pixi.js';

export interface ShootingStar {
  g: Graphics;
  x: number; y: number;
  vx: number; vy: number;
  life: number;
  maxLife: number;
}

/**
 * Update all shooting stars — move, fade, clean up expired.
 * Mutates the array in place.
 */
export function updateShootingStars(stars: ShootingStar[], dt: number): void {
  for (let i = stars.length - 1; i >= 0; i--) {
    const ss = stars[i];
    ss.life += dt;

    // Staggered start (negative life = waiting)
    if (ss.life < 0) { ss.g.alpha = 0; continue; }

    ss.x += ss.vx;
    ss.y += ss.vy;
    ss.g.x = ss.x;
    ss.g.y = ss.y;

    // Fade: ramp up over first 15%, then fade out over remaining 85%
    const frac = ss.life / ss.maxLife;
    const alpha = frac < 0.15 ? frac / 0.15 : 1 - (frac - 0.15) / 0.85;
    ss.g.alpha = alpha * 0.7;

    if (ss.life >= ss.maxLife) {
      ss.g.destroy();
      stars.splice(i, 1);
    }
  }
}
