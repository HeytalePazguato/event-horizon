/**
 * Wormhole — animated portal connection between two correlated agents.
 * Visualizes cross-agent file collaboration: when 2+ agents touch the same files,
 * a wormhole appears between their planets. Stronger correlations are more opaque.
 * @event-horizon/renderer
 */

import { Container, Graphics } from 'pixi.js';

export interface WormholeProps {
  id: string;
  sourceAgentId: string;
  targetAgentId: string;
  /** 0..1 — drives alpha and particle density. */
  strength: number;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
}

export type ExtendedWormhole = Container & {
  __id?: string;
  __sourceAgentId?: string;
  __targetAgentId?: string;
  __strength?: number;
  __sourceX?: number;
  __sourceY?: number;
  __targetX?: number;
  __targetY?: number;
  __sourcePortal?: Graphics;
  __targetPortal?: Graphics;
  __connection?: Graphics;
  /** Particle dots flowing along the connection. Each: { progress: 0..1, g: Graphics } */
  __particles?: Array<{ progress: number; g: Graphics }>;
  /** Cache for connection line endpoints to avoid redraw when stationary. */
  __lastConnSx?: number;
  __lastConnSy?: number;
  __lastConnTx?: number;
  __lastConnTy?: number;
};

const PORTAL_RADIUS = 14;
const WORMHOLE_COLOR = 0x9944ff; // violet
const WORMHOLE_GLOW = 0xcc88ff;

export function createWormhole(props: WormholeProps): ExtendedWormhole {
  const container = new Container() as ExtendedWormhole;
  container.__id = props.id;
  container.__sourceAgentId = props.sourceAgentId;
  container.__targetAgentId = props.targetAgentId;
  container.__strength = props.strength;
  container.__sourceX = props.sourceX;
  container.__sourceY = props.sourceY;
  container.__targetX = props.targetX;
  container.__targetY = props.targetY;

  // Connection line — drawn each frame as the planets may move
  const connection = new Graphics();
  container.addChild(connection);
  container.__connection = connection;

  // Source portal (spiral)
  const sourcePortal = new Graphics();
  drawPortal(sourcePortal, PORTAL_RADIUS);
  sourcePortal.x = props.sourceX;
  sourcePortal.y = props.sourceY;
  container.addChild(sourcePortal);
  container.__sourcePortal = sourcePortal;

  // Target portal (spiral)
  const targetPortal = new Graphics();
  drawPortal(targetPortal, PORTAL_RADIUS);
  targetPortal.x = props.targetX;
  targetPortal.y = props.targetY;
  container.addChild(targetPortal);
  container.__targetPortal = targetPortal;

  // Flowing particles — count scales with strength
  const particleCount = Math.max(2, Math.round(props.strength * 6));
  const particles: Array<{ progress: number; g: Graphics }> = [];
  for (let i = 0; i < particleCount; i++) {
    const g = new Graphics();
    g.circle(0, 0, 2).fill({ color: WORMHOLE_GLOW, alpha: 0.9 });
    container.addChild(g);
    particles.push({ progress: i / particleCount, g });
  }
  container.__particles = particles;

  // Initial alpha based on strength
  container.alpha = 0.3 + 0.7 * Math.min(1, props.strength);

  return container;
}

function drawPortal(g: Graphics, r: number): void {
  g.clear();
  // Outer glow
  g.circle(0, 0, r * 1.5).fill({ color: WORMHOLE_COLOR, alpha: 0.15 });
  g.circle(0, 0, r * 1.2).fill({ color: WORMHOLE_COLOR, alpha: 0.25 });
  // Spiral arms
  for (let arm = 0; arm < 3; arm++) {
    const startAngle = (arm / 3) * Math.PI * 2;
    g.moveTo(0, 0);
    let a = startAngle;
    for (let step = 0; step < 12; step++) {
      a += 0.4;
      const sr = (step / 12) * r;
      g.lineTo(Math.cos(a) * sr, Math.sin(a) * sr);
    }
    g.stroke({ width: 1.2, color: WORMHOLE_GLOW, alpha: 0.7 });
  }
  // Center dark pupil
  g.circle(0, 0, r * 0.25).fill({ color: 0x000000, alpha: 0.8 });
}
