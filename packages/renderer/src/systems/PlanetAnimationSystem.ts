/**
 * Planet animation system — pulse rhythm, thinking ring, error glow, waiting ring.
 * Extracted from Universe.tsx ticker (Phase F — 6.4.8).
 */

import type { Container, Graphics } from 'pixi.js';

export type PlanetVariant = 'gas' | 'icy' | 'rocky' | 'volcanic';

export interface AnimatedPlanet {
  __agentId?: string;
  __variant?: string;
  __thinkingRing?: Container & { rotation: number; alpha: number; visible: boolean };
  __errorGlow?: Graphics & { alpha: number; visible: boolean };
  __waitingRing?: Container & { alpha: number; visible: boolean; scale: { set: (v: number) => void } };
  __radius?: number;
  alpha: number;
  scale: { set: (v: number) => void };
}

export interface PlanetAnimationContext {
  tickTime: number;
  agentStates: Record<string, string>;
  metrics: Record<string, { load: number }>;
  pausedAgentIds: Record<string, boolean>;
  boostedAgentIds: Record<string, boolean>;
  isolatedAgentId: string | null;
}

/** Animate all planets — pulse, thinking ring, error glow, waiting ring. */
export function animatePlanets(planets: AnimatedPlanet[], ctx: PlanetAnimationContext): void {
  const { tickTime: t, agentStates, metrics, pausedAgentIds, boostedAgentIds, isolatedAgentId } = ctx;

  for (const p of planets) {
    const agentId = p.__agentId ?? '';
    const state = agentStates[agentId] ?? 'idle';
    const variant = (p.__variant ?? 'rocky') as PlanetVariant;
    const isPaused = Boolean(pausedAgentIds[agentId]);
    const isBoosted = Boolean(boostedAgentIds[agentId]);

    // Isolation dimming
    if (isolatedAgentId) {
      p.alpha = isolatedAgentId === agentId ? 1 : 0.18;
    } else {
      p.alpha = 1;
    }

    // Pulse rhythm per variant × state
    let pulse: number;
    if (state === 'thinking') {
      if (variant === 'icy')           pulse = 1 + 0.07 * Math.sin(t * 11);
      else if (variant === 'gas')      pulse = 1 + 0.04 * Math.sin(t * 4);
      else if (variant === 'volcanic') pulse = 1 + 0.05 * Math.sin(t * 6) * Math.sin(t * 2.3);
      else                             pulse = 1 + 0.05 * Math.sin(t * 7);
    } else if (state === 'waiting') {
      pulse = 1 + 0.025 * Math.sin(t * 2.0);
    } else if (state === 'error') {
      pulse = 1 + 0.04 * Math.sin(t * 15);
    } else {
      if (variant === 'gas')           pulse = 1 + 0.008 * Math.sin(t * 1.2);
      else if (variant === 'icy')      pulse = 1 + 0.030 * Math.sin(t * 5.5);
      else if (variant === 'volcanic') pulse = 1 + 0.022 * Math.abs(Math.sin(t * 2.8));
      else                             pulse = 1 + 0.015 * Math.sin(t * 2.2);
    }
    if (!isPaused) p.scale.set(pulse * (isBoosted ? 1.22 : 1));
    if (isPaused) p.scale.set(1);

    // Thinking ring
    const ring = p.__thinkingRing;
    if (ring) {
      ring.visible = state === 'thinking';
      if (state === 'thinking' && !isPaused) {
        const load = metrics[agentId]?.load ?? 0.3;
        ring.rotation = (ring.rotation + 0.015 + load * 0.06) % (Math.PI * 2);
        ring.alpha = 0.55 + 0.35 * Math.sin(t * 5);
      }
    }

    // Error glow
    const eg = p.__errorGlow;
    if (eg) {
      eg.visible = state === 'error';
      if (state === 'error' && !isPaused) {
        eg.alpha = 0.25 + 0.2 * Math.sin(t * 12);
      }
    }

    // Waiting ring
    const wr = p.__waitingRing;
    if (wr) {
      wr.visible = state === 'waiting';
      if (state === 'waiting' && !isPaused) {
        const breathe = Math.sin(t * 1.8);
        wr.scale.set(0.95 + 0.1 * breathe);
        wr.alpha = 0.45 + 0.35 * breathe;
      }
    }
  }
}
