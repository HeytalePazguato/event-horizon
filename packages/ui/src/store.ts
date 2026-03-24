/**
 * Zustand store for Command Center UI state.
 * Composed from domain slices (Phase E — Store Split).
 *
 * All types and the main store hook are re-exported here for backward compatibility.
 * New code can import directly from './stores/types.js' or individual slices.
 */

import { create } from 'zustand';

// Re-export all types from the shared types module
export type {
  LogEntry, SkillInfo, MarketplaceEntry, MarketplaceSkillResult,
  AgentVisualConfig, VisualAgentType, VisualSettings,
  FileActivity, FileAgentActivity, ToastEntry, SingularityStats, TimelineEntry,
  CreateSkillRequest,
} from './stores/types.js';

export {
  DEFAULT_VISUAL_SETTINGS, DEFAULT_MARKETPLACES, EMPTY_SINGULARITY_STATS,
} from './stores/types.js';

// Import slice creators
import { createUniverseSlice, clearAllBoostTimers as _clearAllBoostTimers } from './stores/universeSlice.js';
import type { UniverseSlice } from './stores/universeSlice.js';
import { createSettingsSlice } from './stores/settingsSlice.js';
import type { SettingsSlice } from './stores/settingsSlice.js';
import { createAchievementSlice } from './stores/achievementSlice.js';
import type { AchievementSlice } from './stores/achievementSlice.js';
import { createActivitySlice } from './stores/activitySlice.js';
import type { ActivitySlice } from './stores/activitySlice.js';

/** Full store type — union of all slices. */
export type CommandCenterState = UniverseSlice & SettingsSlice & AchievementSlice & ActivitySlice;

export { _clearAllBoostTimers as clearAllBoostTimers };

export const useCommandCenterStore = create<CommandCenterState>((set, get) => ({
  ...createUniverseSlice(
    set as unknown as (fn: (s: UniverseSlice) => Partial<UniverseSlice>) => void,
    get as unknown as () => UniverseSlice,
  ),
  ...createSettingsSlice(
    set as unknown as (fn: (s: SettingsSlice) => Partial<SettingsSlice>) => void,
  ),
  ...createAchievementSlice(
    set as unknown as (fn: (s: AchievementSlice) => Partial<AchievementSlice>) => void,
    get as unknown as () => AchievementSlice & { achievementsEnabled: boolean; demoMode: boolean },
  ),
  ...createActivitySlice(
    set as unknown as (fn: (s: ActivitySlice) => Partial<ActivitySlice>) => void,
  ),
}));
