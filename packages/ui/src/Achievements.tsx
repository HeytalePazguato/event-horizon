/**
 * Achievement system — re-exports from achievements/ module.
 * This file is kept for backwards compatibility. New code should import from './achievements/index.js'.
 * @event-horizon/ui
 */

export {
  ACHIEVEMENTS,
  getMedal,
  TIER_LABELS,
  tierBorderColor,
  AchievementsBar,
  AchievementToasts,
} from './achievements/index.js';

export type { Achievement } from './achievements/index.js';

// Legacy: Medal was previously a component with { id, size } props.
// New code should use getMedal(id) which returns a component with { size } props.
import { getMedal } from './achievements/index.js';
import type { FC } from 'react';

export const Medal: FC<{ id: string; size?: number }> = ({ id, size }) => {
  const M = getMedal(id);
  return <M size={size} />;
};
