/**
 * Lightning system — jagged arcs between planets sharing a file.
 * Extracted from Universe.tsx ticker (Phase F — 6.4.8).
 */

import type { Graphics, Text } from 'pixi.js';

export interface SparkData {
  id: string;
  agentIds: [string, string];
  filePath: string;
}

const BOLT_COLORS = [0x44ddff, 0xaaeeff, 0xffffff];

/**
 * Redraw all lightning arcs for active sparks.
 * Called every tick — arcs are redrawn with random jitter for a flickering effect.
 */
export function updateLightning(
  sparks: SparkData[],
  arcs: Map<string, Graphics>,
  labels: Map<string, Text>,
  posMap: Map<string, { x: number; y: number }>,
): void {
  for (const spark of sparks) {
    const g = arcs.get(spark.id);
    if (!g) continue;
    const posA = posMap.get(spark.agentIds[0]);
    const posB = posMap.get(spark.agentIds[1]);
    if (!posA || !posB) { g.clear(); continue; }

    g.clear();

    const boltCount = 2 + Math.floor(Math.random() * 2);
    for (let b = 0; b < boltCount; b++) {
      const segments = 8 + Math.floor(Math.random() * 6);
      const color = BOLT_COLORS[b % BOLT_COLORS.length];
      const alpha = b === 0 ? 0.9 : 0.4 + Math.random() * 0.3;
      const width = b === 0 ? 1.8 : 0.8 + Math.random() * 0.6;

      const dx = posB.x - posA.x;
      const dy = posB.y - posA.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const perpX = -dy / len;
      const perpY = dx / len;

      g.moveTo(posA.x, posA.y);
      for (let s = 1; s < segments; s++) {
        const frac = s / segments;
        const baseX = posA.x + dx * frac;
        const baseY = posA.y + dy * frac;
        const jitterScale = Math.sin(frac * Math.PI) * len * 0.15;
        const jitter = (Math.random() - 0.5) * 2 * jitterScale;
        g.lineTo(baseX + perpX * jitter, baseY + perpY * jitter);
      }
      g.lineTo(posB.x, posB.y);
      g.stroke({ width, color, alpha });

      // Glow pass
      if (b === 0) {
        g.moveTo(posA.x, posA.y);
        for (let s = 1; s < segments; s++) {
          const frac = s / segments;
          const baseX = posA.x + dx * frac;
          const baseY = posA.y + dy * frac;
          const jitterScale = Math.sin(frac * Math.PI) * len * 0.15;
          const jitter = (Math.random() - 0.5) * 2 * jitterScale;
          g.lineTo(baseX + perpX * jitter, baseY + perpY * jitter);
        }
        g.lineTo(posB.x, posB.y);
        g.stroke({ width: 5, color: 0x44ddff, alpha: 0.12 });
      }
    }

    // Endpoint sparks
    for (const pos of [posA, posB]) {
      for (let i = 0; i < 3; i++) {
        const sparkSize = 1 + Math.random() * 1.5;
        const offsetX = (Math.random() - 0.5) * 12;
        const offsetY = (Math.random() - 0.5) * 12;
        g.circle(pos.x + offsetX, pos.y + offsetY, sparkSize);
        g.fill({ color: 0xaaeeff, alpha: 0.5 + Math.random() * 0.4 });
      }
    }

    // Label at midpoint
    const lbl = labels.get(spark.id);
    if (lbl) {
      lbl.x = (posA.x + posB.x) / 2;
      lbl.y = (posA.y + posB.y) / 2 - 10;
    }
  }
}
