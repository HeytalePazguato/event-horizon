/**
 * Achievement registry — single source of truth.
 * Import all defs here; the rest of the app consumes ACHIEVEMENTS and TIERED_THRESHOLDS.
 *
 * To add a new achievement:
 *   1. Create a file in defs/ (copy an existing one as template)
 *   2. Import and add it to the ALL_DEFS array below
 *   3. Add trigger logic in apps/vscode/webview/index.tsx
 *
 * See packages/ui/src/achievements/README.md for the full guide.
 */

import type { FC } from 'react';
import type { AchievementDef } from './types.js';

import { firstContact } from './defs/first-contact.js';
import { groundControl } from './defs/ground-control.js';
import { theHorde } from './defs/the-horde.js';
import { trafficControl } from './defs/traffic-control.js';
import { supernova } from './defs/supernova.js';
import { gravityWell } from './defs/gravity-well.js';
import { ufoHunter } from './defs/ufo-hunter.js';
import { closeEncounter } from './defs/close-encounter.js';
import { uplink } from './defs/uplink.js';
import { oneSmallStep } from './defs/one-small-step.js';
import { abyss } from './defs/abyss.js';
import { simulationTheory } from './defs/simulation-theory.js';
import { eventHorizon } from './defs/event-horizon.js';
import { slingshot } from './defs/slingshot.js';
import { trickShot } from './defs/trick-shot.js';
import { rocketMan } from './defs/rocket-man.js';
import { bouncyBoy } from './defs/bouncy-boy.js';
import { traveler } from './defs/traveler.js';
import { kamikaze } from './defs/kamikaze.js';
import { butterfingers } from './defs/butterfingers.js';

/** Ordered list of all achievement definitions. */
const ALL_DEFS: AchievementDef[] = [
  firstContact,
  groundControl,
  theHorde,
  trafficControl,
  supernova,
  gravityWell,
  ufoHunter,
  closeEncounter,
  uplink,
  oneSmallStep,
  abyss,
  simulationTheory,
  eventHorizon,
  slingshot,
  trickShot,
  rocketMan,
  bouncyBoy,
  traveler,
  kamikaze,
  butterfingers,
];

/** Legacy-compatible shape consumed by AchievementsBar / AchievementToasts. */
export interface Achievement {
  id: string;
  name: string;
  desc: string;
  secret?: boolean;
  tiers?: number[];
}

/** All achievements (legacy shape — id/name/desc/secret/tiers). */
export const ACHIEVEMENTS: Achievement[] = ALL_DEFS.map((d) => ({
  id: d.id,
  name: d.name,
  desc: d.desc,
  ...(d.secret ? { secret: true } : {}),
  ...(d.tiers ? { tiers: d.tiers } : {}),
}));

/** Medal component lookup by achievement ID. */
const MEDAL_MAP = new Map<string, FC<{ size?: number }>>(
  ALL_DEFS.map((d) => [d.id, d.Medal]),
);

/** Returns the Medal component for a given achievement ID, or a fallback. */
export function getMedal(id: string): FC<{ size?: number }> {
  return MEDAL_MAP.get(id) ?? FallbackMedal;
}

const FallbackMedal: FC<{ size?: number }> = ({ size: s = 36 }) => (
  <svg width={s} height={s} viewBox="0 0 36 36">
    <rect width="36" height="36" rx="4" fill="#1a1a2a" />
    <text x="18" y="23" textAnchor="middle" fontSize="18" fill="#aaa">🏅</text>
  </svg>
);

/**
 * Auto-built tiered thresholds from achievement definitions.
 * Consumed by the store — no manual sync needed.
 */
export const TIERED_THRESHOLDS: Record<string, number[]> = Object.fromEntries(
  ALL_DEFS.filter((d) => d.tiers).map((d) => [d.id, d.tiers!]),
);
