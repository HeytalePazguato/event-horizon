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
  __heartbeatRing?: Graphics & { alpha: number; visible: boolean; scale: { set: (v: number) => void }; tint: number };
  __contextGauge?: Graphics & { visible: boolean; alpha: number; clear: () => Graphics; arc: (x: number, y: number, r: number, start: number, end: number, anti?: boolean) => Graphics; stroke: (opts: { width: number; color: number; alpha: number }) => Graphics };
  __contextUsage?: number;
  __radius?: number;
  __compactionStartTime?: number;
  /** Spawn animation progress: 0 (just spawned) to 1 (fully materialized). */
  __spawnProgress?: number;
  /** Spawn nebula cloud graphics (temporary, destroyed after spawn completes). */
  __spawnNebula?: Graphics & { alpha: number };
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
  heartbeatStatuses?: Record<string, string>;
  compactingAgentIds?: Record<string, boolean>;
  contextUsage?: Record<string, number>;
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
    // Compaction animation: shrink to 0.7x then re-inflate over ~1.5s
    let compactionScale = 1;
    if (ctx.compactingAgentIds?.[agentId]) {
      if (!p.__compactionStartTime) {
        p.__compactionStartTime = t;
      }
      const elapsed = t - p.__compactionStartTime;
      const COMPACTION_DURATION = 1.5;
      if (elapsed < COMPACTION_DURATION) {
        // First half: shrink to 0.7, second half: re-inflate to 1.0
        const progress = elapsed / COMPACTION_DURATION;
        if (progress < 0.4) {
          compactionScale = 1 - 0.3 * (progress / 0.4);
        } else {
          compactionScale = 0.7 + 0.3 * ((progress - 0.4) / 0.6);
        }
      } else {
        p.__compactionStartTime = undefined;
      }
    } else {
      p.__compactionStartTime = undefined;
    }

    // ── Spawn animation ────────────────────────────────────────────────
    let spawnScale = 1;
    if (p.__spawnProgress !== undefined && p.__spawnProgress < 1) {
      p.__spawnProgress = Math.min(1, p.__spawnProgress + (1 / 120)); // ~2s at 60fps
      spawnScale = p.__spawnProgress;

      // Animate nebula cloud
      if (p.__spawnNebula) {
        p.__spawnNebula.alpha = (1 - p.__spawnProgress) * 0.7;
        const nebulaScale = 1.5 + (1 - p.__spawnProgress) * 2;
        p.__spawnNebula.scale.set(nebulaScale);
      }

      // Clean up nebula when spawn is complete
      if (p.__spawnProgress >= 1 && p.__spawnNebula) {
        p.__spawnNebula.alpha = 0;
      }
    }

    if (!isPaused) p.scale.set(pulse * (isBoosted ? 1.22 : 1) * compactionScale * spawnScale);
    if (isPaused) p.scale.set(1 * compactionScale * spawnScale);

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

    // Heartbeat pulse ring
    const hb = p.__heartbeatRing;
    if (hb) {
      const hbStatus = ctx.heartbeatStatuses?.[agentId];
      if (hbStatus === 'alive') {
        hb.visible = true;
        hb.tint = 0x40a060; // green
        // Expanding ring that fades every 4 seconds
        const phase = (t % 4) / 4;
        hb.scale.set(1 + phase * 0.5);
        hb.alpha = 0.5 * (1 - phase);
      } else if (hbStatus === 'stale') {
        hb.visible = true;
        hb.tint = 0xd4944a; // amber
        hb.scale.set(1);
        hb.alpha = 0.3 + 0.15 * Math.sin(t * 2);
      } else if (hbStatus === 'lost') {
        hb.visible = true;
        hb.tint = 0x555555; // grey
        hb.scale.set(1);
        hb.alpha = 0.15;
      } else {
        hb.visible = false;
      }
    }

    // Context fuel gauge — 270° arc showing context window usage
    const cg = p.__contextGauge;
    const usage = ctx.contextUsage?.[agentId] ?? p.__contextUsage ?? 0;
    if (cg) {
      if (usage > 0) {
        cg.visible = true;
        const r = p.__radius ?? 20;
        const gaugeR = r * 1.4;
        const maxAngle = Math.PI * 1.5; // 270 degrees
        const fillAngle = maxAngle * Math.min(1, usage);
        // Start at bottom-left, sweep clockwise
        const startAngle = Math.PI * 0.75; // 135° (bottom-left gap)

        // Color: cyan (<50%) → amber (50-80%) → red (≥80%)
        let gaugeColor: number;
        if (usage < 0.5) gaugeColor = 0x44ddff;      // cyan
        else if (usage < 0.8) gaugeColor = 0xffaa44;  // amber
        else gaugeColor = 0xff4444;                    // red

        cg.clear();
        // Background track (dim)
        cg.arc(0, 0, gaugeR, startAngle, startAngle + maxAngle)
          .stroke({ width: 2, color: 0x333344, alpha: 0.3 });
        // Filled arc
        if (fillAngle > 0.01) {
          cg.arc(0, 0, gaugeR, startAngle, startAngle + fillAngle)
            .stroke({ width: 3, color: gaugeColor, alpha: 0.7 });
        }

        // Critical pulse when >90%
        if (usage > 0.9) {
          cg.alpha = 0.7 + 0.3 * Math.sin(t * 6);
        } else {
          cg.alpha = 1;
        }
      } else {
        cg.visible = false;
      }
    }
  }
}
