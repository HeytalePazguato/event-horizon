/**
 * Beam System — glowing beams between orchestrator stars and target planets.
 * Used for:
 *   1. Task assignment beams (orchestrator → worker) on agent spawn
 *   2. Synthesis beams (workers → orchestrator) on plan completion
 * Each beam fades over ~2 seconds.
 * @event-horizon/renderer
 */

import { Container, Graphics } from 'pixi.js';

export interface SpawnBeam {
  fromAgentId: string;
  toAgentId: string;
  color: number;
  startTime: number;
}

const BEAM_DURATION = 2.0; // seconds
const BEAM_WIDTH = 2.5;
const GLOW_WIDTH = 8;

export class BeamSystem {
  private container: Container;
  private beamGraphics: Map<string, Graphics> = new Map();

  constructor(container: Container) {
    this.container = container;
  }

  /**
   * Update all active beams — draw glowing lines that fade over time.
   * Returns the set of beam keys that are still alive.
   */
  update(
    beams: SpawnBeam[],
    tickTime: number,
    posMap: Map<string, { x: number; y: number }>,
  ): SpawnBeam[] {
    const alive: SpawnBeam[] = [];

    // Clean up stale graphics
    const activeKeys = new Set<string>();

    for (const beam of beams) {
      const elapsed = tickTime - beam.startTime;
      if (elapsed > BEAM_DURATION) {
        continue; // expired
      }
      alive.push(beam);

      const key = `${beam.fromAgentId}->${beam.toAgentId}-${beam.startTime.toFixed(2)}`;
      activeKeys.add(key);

      const fromPos = posMap.get(beam.fromAgentId);
      const toPos = posMap.get(beam.toAgentId);
      if (!fromPos || !toPos) continue;

      let g = this.beamGraphics.get(key);
      if (!g) {
        g = new Graphics();
        this.container.addChild(g);
        this.beamGraphics.set(key, g);
      }

      g.clear();

      const progress = elapsed / BEAM_DURATION;
      const alpha = 1 - progress; // fade from 1 to 0

      // Beam travels from source to target — animate head position
      const headProgress = Math.min(1, elapsed / (BEAM_DURATION * 0.4)); // beam reaches target in 40% of duration
      const dx = toPos.x - fromPos.x;
      const dy = toPos.y - fromPos.y;
      const headX = fromPos.x + dx * headProgress;
      const headY = fromPos.y + dy * headProgress;

      // Glow pass (wide, soft)
      g.moveTo(fromPos.x, fromPos.y);
      g.lineTo(headX, headY);
      g.stroke({ width: GLOW_WIDTH, color: beam.color, alpha: alpha * 0.15 });

      // Core beam (thin, bright)
      g.moveTo(fromPos.x, fromPos.y);
      g.lineTo(headX, headY);
      g.stroke({ width: BEAM_WIDTH, color: beam.color, alpha: alpha * 0.7 });

      // Inner core (very thin, white-ish)
      g.moveTo(fromPos.x, fromPos.y);
      g.lineTo(headX, headY);
      g.stroke({ width: 1, color: 0xffffff, alpha: alpha * 0.4 });

      // Head glow dot
      if (headProgress < 1) {
        g.circle(headX, headY, 3 + (1 - progress) * 2);
        g.fill({ color: beam.color, alpha: alpha * 0.6 });
      }
    }

    // Remove graphics for expired beams
    for (const [key, g] of this.beamGraphics) {
      if (!activeKeys.has(key)) {
        this.container.removeChild(g);
        g.destroy();
        this.beamGraphics.delete(key);
      }
    }

    return alive;
  }

  destroy(): void {
    for (const g of this.beamGraphics.values()) {
      this.container.removeChild(g);
      g.destroy();
    }
    this.beamGraphics.clear();
  }
}
