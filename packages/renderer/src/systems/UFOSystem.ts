/**
 * UFO system — 5-phase state machine (fly, beam, flyaway, flyby, sucked, cow_falling).
 * Extracted from Universe.tsx ticker (Phase F.2).
 */

import type { Container } from 'pixi.js';

export interface UFOState {
  phase: 'idle' | 'fly' | 'beam' | 'flyaway' | 'flyby' | 'sucked' | 'cow_falling';
  t: number;
  targetX: number; targetY: number;
  startX?: number; startY?: number;
  beam?: Container;
  cow?: Container;
  beamLen?: number;
  waypoints?: Array<{ x: number; y: number }>;
  waypointIndex?: number;
  segT?: number;
  cowFallFromY?: number;
  cowFallToY?: number;
}

export interface UFOCallbacks {
  onAbduction: () => void;
  onConsumed: () => void;
  scheduleNext: () => void;
}

/**
 * Update the UFO state machine each tick.
 * Returns early if phase is 'idle' (nothing to do).
 */
export function updateUFO(
  ufo: Container,
  state: UFOState,
  dt: number,
  callbacks: UFOCallbacks,
): void {
  if (state.phase === 'idle') return;

  if (state.phase === 'fly') {
    state.t += dt;
    ufo.rotation = 0;
    const tv = Math.min(1, state.t * 0.5);
    const ease = tv * tv * (3 - 2 * tv);
    const sx = state.startX ?? -250;
    const sy = state.startY ?? -200;
    ufo.x = sx + (state.targetX - sx) * ease;
    ufo.y = sy + (state.targetY - sy) * ease;
    if (tv >= 1) {
      state.phase = 'beam';
      state.t = 0;
      if (state.beam) state.beam.visible = true;
      if (state.cow) {
        state.cow.visible = true;
        state.cow.y = state.beamLen ?? 70;
      }
    }
  } else if (state.phase === 'beam') {
    state.t += dt;
    ufo.rotation = 0;
    const beamLen = state.beamLen ?? 70;
    const beamT = Math.min(1, state.t / 2.0);
    if (state.cow) state.cow.y = beamLen - beamT * (beamLen + 2);
    if (state.t > 2.4) {
      if (state.beam) state.beam.visible = false;
      if (state.cow) { state.cow.visible = false; state.cow.y = beamLen; }
      callbacks.onAbduction();
      const angle = Math.random() * Math.PI * 2;
      const dist = 280 + Math.random() * 120;
      state.phase = 'flyaway';
      state.t = 0;
      state.startX = ufo.x;
      state.startY = ufo.y;
      state.targetX = ufo.x + Math.cos(angle) * dist;
      state.targetY = ufo.y + Math.sin(angle) * dist;
    }
  } else if (state.phase === 'flyaway') {
    state.t += dt;
    const tv = Math.min(1, state.t * 0.6);
    const ease = tv * tv * (3 - 2 * tv);
    const sx = state.startX ?? ufo.x;
    const sy = state.startY ?? ufo.y;
    ufo.x = sx + (state.targetX - sx) * ease;
    ufo.y = sy + (state.targetY - sy) * ease;
    const flyDist = Math.sqrt(ufo.x * ufo.x + ufo.y * ufo.y);
    if (flyDist < 55) {
      state.phase = 'sucked';
      state.t = 0;
      state.startX = ufo.x;
      state.startY = ufo.y;
    } else if (tv >= 1) {
      ufo.visible = false;
      state.phase = 'idle';
      callbacks.scheduleNext();
    }
  } else if (state.phase === 'flyby') {
    const wps = state.waypoints;
    let idx = state.waypointIndex ?? 0;
    let segT = (state.segT ?? 0) + 0.012;
    if (!wps || wps.length < 2) {
      ufo.visible = false;
      state.phase = 'idle';
      callbacks.scheduleNext();
    } else {
      if (segT >= 1) { segT = 0; idx++; state.waypointIndex = idx; }
      if (idx >= wps.length - 1) {
        ufo.visible = false;
        state.phase = 'idle';
        callbacks.scheduleNext();
      } else {
        state.segT = segT;
        const from = wps[idx];
        const to = wps[idx + 1];
        const ease = segT * segT * (3 - 2 * segT);
        ufo.x = from.x + (to.x - from.x) * ease;
        ufo.y = from.y + (to.y - from.y) * ease;
        ufo.rotation = Math.atan2(to.y - from.y, to.x - from.x) * 0.15;
        const ufoDist = Math.sqrt(ufo.x * ufo.x + ufo.y * ufo.y);
        if (ufoDist < 55) {
          state.phase = 'sucked';
          state.t = 0;
          state.startX = ufo.x;
          state.startY = ufo.y;
        }
      }
    }
  } else if (state.phase === 'sucked') {
    state.t += dt;
    const suckT = Math.min(1, state.t * 0.6);
    const startDist = Math.sqrt((state.startX ?? 50) ** 2 + (state.startY ?? 50) ** 2);
    const currentDist = startDist * (1 - suckT);
    const baseAngle = Math.atan2(state.startY ?? 0, state.startX ?? 0);
    const spiralAngle = baseAngle + suckT * Math.PI * 4;
    ufo.x = Math.cos(spiralAngle) * currentDist;
    ufo.y = Math.sin(spiralAngle) * currentDist;
    ufo.scale.set(1 - suckT * 0.9);
    ufo.rotation = suckT * Math.PI * 6;
    ufo.alpha = 1 - suckT * 0.7;
    if (suckT >= 1) {
      ufo.visible = false;
      ufo.scale.set(1);
      ufo.alpha = 1;
      ufo.rotation = 0;
      state.phase = 'idle';
      callbacks.onConsumed();
      callbacks.scheduleNext();
    }
  } else if (state.phase === 'cow_falling') {
    state.t += dt;
    const fallT = Math.min(1, state.t / 0.8);
    if (state.cow) {
      const fromY = state.cowFallFromY ?? 0;
      const toY = state.cowFallToY ?? 70;
      const eased = fallT * fallT;
      state.cow.y = fromY + (toY - fromY) * eased;
      state.cow.visible = true;
    }
    if (fallT >= 1) {
      if (state.cow) state.cow.visible = false;
      const angle = Math.random() * Math.PI * 2;
      const dist = 280 + Math.random() * 120;
      state.phase = 'flyaway';
      state.t = 0;
      state.startX = ufo.x;
      state.startY = ufo.y;
      state.targetX = ufo.x + Math.cos(angle) * dist;
      state.targetY = ufo.y + Math.sin(angle) * dist;
    }
  }
}
