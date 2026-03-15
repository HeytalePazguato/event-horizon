/**
 * Tiny SVG sparkline showing events/minute over the last 5 minutes.
 * @event-horizon/ui
 */

import type { FC } from 'react';
import { useMemo } from 'react';

export interface SparklineProps {
  /** Raw event timestamps (ms) — will be bucketed into 1-minute bins. */
  timestamps: number[];
  width?: number;
  height?: number;
  /** Stroke color (CSS). */
  color?: string;
}

/** Number of 1-minute buckets. */
const BUCKETS = 5;

/**
 * Bucket timestamps into events-per-minute for the last 5 minutes.
 * Returns an array of length BUCKETS (oldest first).
 */
export function bucketize(timestamps: number[], now: number): number[] {
  const bins = new Array<number>(BUCKETS).fill(0);
  const windowMs = BUCKETS * 60_000;
  for (const t of timestamps) {
    const age = now - t;
    if (age < 0 || age >= windowMs) continue;
    const idx = BUCKETS - 1 - Math.floor(age / 60_000);
    bins[idx]++;
  }
  return bins;
}

export const Sparkline: FC<SparklineProps> = ({
  timestamps,
  width = 100,
  height = 24,
  color = '#4a8a5a',
}) => {
  const bins = useMemo(() => bucketize(timestamps, Date.now()), [timestamps]);
  const max = Math.max(...bins, 1);
  const padY = 2;
  const padX = 1;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;

  // Build polyline points
  const points = bins.map((v, i) => {
    const x = padX + (i / (BUCKETS - 1)) * innerW;
    const y = padY + innerH - (v / max) * innerH;
    return `${x},${y}`;
  });

  // Build fill polygon (area under curve)
  const fillPoints = [
    `${padX},${padY + innerH}`,
    ...points,
    `${padX + innerW},${padY + innerH}`,
  ];

  const current = bins[BUCKETS - 1];

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <svg width={width} height={height} style={{ display: 'block' }}>
        <polygon
          points={fillPoints.join(' ')}
          fill={color}
          fillOpacity={0.15}
        />
        <polyline
          points={points.join(' ')}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* Current value dot */}
        {bins.length > 0 && (
          <circle
            cx={padX + innerW}
            cy={padY + innerH - (bins[BUCKETS - 1] / max) * innerH}
            r={2.5}
            fill={color}
          />
        )}
      </svg>
      <span style={{ color, fontSize: 9, fontWeight: 600, minWidth: 24 }}>
        {current}/m
      </span>
    </div>
  );
};
