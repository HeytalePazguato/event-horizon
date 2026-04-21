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

interface CachedGeometry {
  // Per-bolt: array of segment jitter values (one per interior segment)
  bolts: number[][];
  glowJitter: number[];
  frameCount: number;
}

// Module-scope cache keyed by spark.id
const geometryCache = new Map<string, CachedGeometry>();

function buildGeometry(segments: number, boltCount: number): CachedGeometry {
  const bolts: number[][] = [];
  for (let b = 0; b < boltCount; b++) {
    const jitters: number[] = [];
    for (let s = 1; s < segments; s++) {
      jitters.push((Math.random() - 0.5) * 2);
    }
    bolts.push(jitters);
  }
  const glowJitter: number[] = [];
  for (let s = 1; s < segments; s++) {
    glowJitter.push((Math.random() - 0.5) * 2);
  }
  return { bolts, glowJitter, frameCount: 0 };
}

/**
 * Redraw all lightning arcs for active sparks.
 * Called every tick — arcs are redrawn with random jitter for a flickering effect.
 * Under load (>3 sparks): reduces bolt count to 1 and endpoint sparks to 2;
 * geometry is recomputed every 3rd frame to preserve flicker while cutting cost.
 */
export function updateLightning(
  sparks: SparkData[],
  arcs: Map<string, Graphics>,
  labels: Map<string, Text>,
  posMap: Map<string, { x: number; y: number }>,
): void {
  const highLoad = sparks.length > 3;

  // Evict stale cache entries
  const activeIds = new Set(sparks.map(s => s.id));
  for (const key of geometryCache.keys()) {
    if (!activeIds.has(key)) geometryCache.delete(key);
  }

  for (const spark of sparks) {
    const g = arcs.get(spark.id);
    if (!g) continue;
    const posA = posMap.get(spark.agentIds[0]);
    const posB = posMap.get(spark.agentIds[1]);
    if (!posA || !posB) { g.clear(); continue; }

    const boltCount = highLoad ? 1 : 2 + Math.floor(Math.random() * 2);
    const segments = 8 + Math.floor(Math.random() * 6);
    const endpointSparks = highLoad ? 2 : 3;

    // Retrieve or build cached jitter geometry; re-jitter every 3rd frame
    let cached = geometryCache.get(spark.id);
    if (!cached || cached.frameCount % 3 === 0 || cached.bolts.length !== boltCount) {
      cached = buildGeometry(segments, boltCount);
      geometryCache.set(spark.id, cached);
    }
    cached.frameCount++;

    g.clear();

    const dx = posB.x - posA.x;
    const dy = posB.y - posA.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const perpX = -dy / len;
    const perpY = dx / len;

    for (let b = 0; b < boltCount; b++) {
      const color = BOLT_COLORS[b % BOLT_COLORS.length];
      const alpha = b === 0 ? 0.9 : 0.4 + Math.random() * 0.3;
      const width = b === 0 ? 1.8 : 0.8 + Math.random() * 0.6;
      const boltJitters = cached.bolts[b];

      g.moveTo(posA.x, posA.y);
      for (let s = 1; s < segments; s++) {
        const frac = s / segments;
        const baseX = posA.x + dx * frac;
        const baseY = posA.y + dy * frac;
        const jitterScale = Math.sin(frac * Math.PI) * len * 0.15;
        const jitter = boltJitters[s - 1] * jitterScale;
        g.lineTo(baseX + perpX * jitter, baseY + perpY * jitter);
      }
      g.lineTo(posB.x, posB.y);
      g.stroke({ width, color, alpha });

      // Glow pass (primary bolt only)
      if (b === 0) {
        g.moveTo(posA.x, posA.y);
        for (let s = 1; s < segments; s++) {
          const frac = s / segments;
          const baseX = posA.x + dx * frac;
          const baseY = posA.y + dy * frac;
          const jitterScale = Math.sin(frac * Math.PI) * len * 0.15;
          const jitter = cached.glowJitter[s - 1] * jitterScale;
          g.lineTo(baseX + perpX * jitter, baseY + perpY * jitter);
        }
        g.lineTo(posB.x, posB.y);
        g.stroke({ width: 5, color: 0x44ddff, alpha: 0.12 });
      }
    }

    // Endpoint sparks
    for (const pos of [posA, posB]) {
      for (let i = 0; i < endpointSparks; i++) {
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
