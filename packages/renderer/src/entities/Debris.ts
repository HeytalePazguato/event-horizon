/**
 * Plan task debris — small orbital fragments representing plan tasks.
 * Each debris piece orbits around the associated planet (agent that loaded the plan).
 * Color and behavior encode task status.
 * @event-horizon/renderer
 */

import { Container, Graphics } from 'pixi.js';

// ── Task status → visual mapping ────────────────────────────────────────────

export type DebrisStatus = 'pending' | 'claimed' | 'in_progress' | 'done' | 'failed' | 'blocked';

/** Map task status to debris color (0xRRGGBB). */
export function debrisColor(status: DebrisStatus): number {
  switch (status) {
    case 'pending':     return 0x4a7a58;   // dim green
    case 'claimed':     return 0x6aa0d4;   // cyan
    case 'in_progress': return 0xd4a84a;   // gold
    case 'done':        return 0x40a060;   // bright green
    case 'failed':      return 0xc65858;   // red
    case 'blocked':     return 0x8a6a2a;   // amber-dim
    default:            return 0x4a7a58;
  }
}

// ── Debris factory ──────────────────────────────────────────────────────────

export interface DebrisProps {
  taskId: string;
  status: DebrisStatus;
  orbitDistance: number;
  orbitSpeed: number;
  size: number;
}

export type ExtendedDebris = Container & {
  __taskId?: string;
  __status?: DebrisStatus;
  __orbitDistance?: number;
  __orbitSpeed?: number;
  __orbitAngle?: number;
  __parentAgentId?: string;
  __gfx?: Graphics;
  __baseAlpha?: number;
  __flashPhase?: number;
};

const MIN_SIZE = 2;
const MAX_SIZE = 4;

export function createDebris(props: DebrisProps): ExtendedDebris {
  const container = new Container() as ExtendedDebris;
  container.__taskId = props.taskId;
  container.__status = props.status;
  container.__orbitDistance = props.orbitDistance;
  container.__orbitSpeed = props.orbitSpeed;
  container.__orbitAngle = Math.random() * Math.PI * 2;
  container.__baseAlpha = props.status === 'done' ? 0.5 : 0.85;
  container.__flashPhase = Math.random() * Math.PI * 2;

  const size = Math.max(MIN_SIZE, Math.min(MAX_SIZE, props.size));
  const color = debrisColor(props.status);

  const g = new Graphics();

  // Shape varies by status: diamonds for active, circles for done, squares for blocked
  if (props.status === 'in_progress' || props.status === 'claimed') {
    // Diamond shape — active task
    g.poly([0, -size, size * 0.7, 0, 0, size, -size * 0.7, 0]);
    g.fill({ color, alpha: container.__baseAlpha });
  } else if (props.status === 'done') {
    // Small circle — completed, fading
    g.circle(0, 0, size * 0.6);
    g.fill({ color, alpha: 0.4 });
  } else if (props.status === 'failed') {
    // X-shaped cross — failed
    g.moveTo(-size, -size).lineTo(size, size);
    g.moveTo(size, -size).lineTo(-size, size);
    g.stroke({ color, width: 1.5, alpha: 0.8 });
  } else {
    // Square — pending/blocked
    g.rect(-size * 0.5, -size * 0.5, size, size);
    g.fill({ color, alpha: container.__baseAlpha });
  }

  container.__gfx = g;
  container.addChild(g);

  return container;
}

/**
 * Rebuild the debris graphics when status changes.
 */
export function updateDebrisStatus(debris: ExtendedDebris, newStatus: DebrisStatus): void {
  if (debris.__status === newStatus) return;
  debris.__status = newStatus;
  debris.__baseAlpha = newStatus === 'done' ? 0.5 : 0.85;

  const g = debris.__gfx;
  if (!g) return;

  const size = 3; // default rebuild size
  const color = debrisColor(newStatus);

  g.clear();

  if (newStatus === 'in_progress' || newStatus === 'claimed') {
    g.poly([0, -size, size * 0.7, 0, 0, size, -size * 0.7, 0]);
    g.fill({ color, alpha: debris.__baseAlpha });
  } else if (newStatus === 'done') {
    g.circle(0, 0, size * 0.6);
    g.fill({ color, alpha: 0.4 });
  } else if (newStatus === 'failed') {
    g.moveTo(-size, -size).lineTo(size, size);
    g.moveTo(size, -size).lineTo(-size, size);
    g.stroke({ color, width: 1.5, alpha: 0.8 });
  } else {
    g.rect(-size * 0.5, -size * 0.5, size, size);
    g.fill({ color, alpha: debris.__baseAlpha });
  }
}
