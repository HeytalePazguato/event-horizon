import { useEffect } from 'react';
import type { SpawnBeam } from '@event-horizon/renderer';

const BEAM_DURATION_MS = 2000;
const BEAM_STALE_GRACE_MS = 500;
const PRUNE_INTERVAL_MS = 1000;

/**
 * Drops expired spawn beams from React state every second so the array doesn't
 * grow unbounded. Beams older than BEAM_DURATION + grace are removed.
 */
export function useSpawnBeamPruner(
  spawnBeams: SpawnBeam[],
  setSpawnBeams: React.Dispatch<React.SetStateAction<SpawnBeam[]>>,
): void {
  useEffect(() => {
    const interval = setInterval(() => {
      const cutoff = Date.now() - (BEAM_DURATION_MS + BEAM_STALE_GRACE_MS);
      setSpawnBeams((prev) => {
        // Only allocate a new array when at least one beam is expired.
        let hasExpired = false;
        for (const b of prev) {
          if ((b.createdAtMs ?? 0) < cutoff) { hasExpired = true; break; }
        }
        if (!hasExpired) return prev;
        return prev.filter((b) => (b.createdAtMs ?? 0) >= cutoff);
      });
    }, PRUNE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [setSpawnBeams]);
}
