/**
 * Achievement type definitions and tier utilities.
 * @event-horizon/ui
 */

import type { FC } from 'react';

export interface AchievementDef {
  id: string;
  name: string;
  desc: string;
  secret?: boolean;
  tiers?: number[];
  Medal: FC<{ size?: number }>;
}

/** Tier labels displayed after the name, e.g. "Gravity Well III". */
export const TIER_LABELS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

/** Border colors that upgrade with tier: gray → bronze → silver → gold → platinum → diamond. */
const TIER_BORDER_COLORS = [
  '#6a6a7a',  // I   — gray
  '#a06830',  // II  — bronze
  '#a0a8b8',  // III — silver
  '#d4aa30',  // IV  — gold
  '#88ccdd',  // V   — platinum
  '#b898ff',  // VI  — diamond
];

export function tierBorderColor(tier: number | undefined): string | undefined {
  if (tier == null) return undefined;
  return TIER_BORDER_COLORS[Math.min(tier, TIER_BORDER_COLORS.length - 1)];
}
