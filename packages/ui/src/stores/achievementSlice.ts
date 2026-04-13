/**
 * Achievement slice — unlock logic, tiered achievements, counts, toast queue.
 * Part of the CommandCenterState store (Phase E — Store Split).
 */

import type { ToastEntry } from './types.js';
import { TIERED_THRESHOLDS } from '../achievements/registry.js';

export interface AchievementSlice {
  activeToasts: ToastEntry[];
  unlockedAchievements: string[];
  achievementCounts: Record<string, number>;
  achievementTiers: Record<string, number>;
  /** True once init-medals has been processed. Prevents spurious toasts on startup before restored state arrives. */
  medalsHydrated: boolean;

  unlockAchievement: (id: string) => void;
  incrementTieredAchievement: (id: string) => void;
  setTieredAchievementCount: (id: string, count: number) => void;
  recalibrateTieredAchievement: (id: string, count: number) => void;
  dismissToast: (instanceId: string) => void;
  markMedalsHydrated: () => void;
}

/** Context needed from other slices for demo/achievement guards. */
interface AchievementContext {
  achievementsEnabled: boolean;
  demoMode: boolean;
}

type SetFn = (fn: (s: AchievementSlice) => Partial<AchievementSlice>) => void;
type GetFn = () => AchievementSlice & AchievementContext;

export function createAchievementSlice(set: SetFn, get: GetFn): AchievementSlice {
  return {
    activeToasts: [],
    unlockedAchievements: [],
    achievementCounts: {},
    achievementTiers: {},
    medalsHydrated: false,

    markMedalsHydrated: () => set(() => ({ medalsHydrated: true })),

    unlockAchievement: (id) => {
      const ctx = get();
      if (!ctx.achievementsEnabled && id !== 'demo_activated') return;
      if (ctx.demoMode && id !== 'demo_activated') return;
      // Suppress unlocks (and their toasts) until medals have been restored from globalState.
      // Prevents spurious first_contact/ground_control toasts on every reload.
      if (!ctx.medalsHydrated && id !== 'demo_activated') return;
      if (ctx.unlockedAchievements.includes(id)) return;
      const instanceId = `${id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      set((s) => ({
        unlockedAchievements: [...s.unlockedAchievements, id],
        activeToasts: [...s.activeToasts, { instanceId, achievementId: id }],
      }));
    },

    incrementTieredAchievement: (id) => {
      const ctx = get();
      if (!ctx.achievementsEnabled) return;
      if (ctx.demoMode) return;
      const tiers = TIERED_THRESHOLDS[id];
      if (!tiers) return;
      const newCount = (ctx.achievementCounts[id] ?? 0) + 1;
      const currentTier = ctx.achievementTiers[id] ?? -1;
      let newTier = currentTier;
      for (let i = currentTier + 1; i < tiers.length; i++) {
        if (newCount >= tiers[i]) newTier = i; else break;
      }
      const tierUpgraded = newTier > currentTier;
      const updates: Partial<AchievementSlice> = { achievementCounts: { ...ctx.achievementCounts, [id]: newCount } };
      if (tierUpgraded) {
        updates.achievementTiers = { ...ctx.achievementTiers, [id]: newTier };
        if (!ctx.unlockedAchievements.includes(id)) {
          updates.unlockedAchievements = [...ctx.unlockedAchievements, id];
        }
        const instanceId = `${id}-t${newTier}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        updates.activeToasts = [...ctx.activeToasts, { instanceId, achievementId: id }];
      }
      set(() => updates as Partial<AchievementSlice>);
    },

    setTieredAchievementCount: (id, count) => {
      const ctx = get();
      if (!ctx.achievementsEnabled || ctx.demoMode) return;
      const tiers = TIERED_THRESHOLDS[id];
      if (!tiers) return;
      const oldCount = ctx.achievementCounts[id] ?? 0;
      if (count <= oldCount) return;
      const currentTier = ctx.achievementTiers[id] ?? -1;
      let newTier = currentTier;
      for (let i = currentTier + 1; i < tiers.length; i++) { if (count >= tiers[i]) newTier = i; else break; }
      const tierUpgraded = newTier > currentTier;
      const updates: Partial<AchievementSlice> = { achievementCounts: { ...ctx.achievementCounts, [id]: count } };
      if (tierUpgraded) {
        updates.achievementTiers = { ...ctx.achievementTiers, [id]: newTier };
        if (!ctx.unlockedAchievements.includes(id)) { updates.unlockedAchievements = [...ctx.unlockedAchievements, id]; }
        const instanceId = `${id}-t${newTier}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        updates.activeToasts = [...ctx.activeToasts, { instanceId, achievementId: id }];
      }
      set(() => updates as Partial<AchievementSlice>);
    },

    recalibrateTieredAchievement: (id, count) => {
      const tiers = TIERED_THRESHOLDS[id];
      if (!tiers) return;
      let correctTier = -1;
      for (let i = 0; i < tiers.length; i++) { if (count >= tiers[i]) correctTier = i; else break; }
      const ctx = get();
      const oldCount = ctx.achievementCounts[id] ?? 0;
      const oldTier = ctx.achievementTiers[id] ?? -1;
      if (count === oldCount && correctTier === oldTier) return;
      const updates: Partial<AchievementSlice> = {
        achievementCounts: { ...ctx.achievementCounts, [id]: count },
        achievementTiers: { ...ctx.achievementTiers, [id]: correctTier },
      };
      if (correctTier < 0 && ctx.unlockedAchievements.includes(id)) {
        updates.unlockedAchievements = ctx.unlockedAchievements.filter((a) => a !== id);
      }
      if (correctTier >= 0 && !ctx.unlockedAchievements.includes(id)) {
        updates.unlockedAchievements = [...ctx.unlockedAchievements, id];
      }
      set(() => updates as Partial<AchievementSlice>);
    },

    dismissToast: (instanceId) => set((s) => ({
      activeToasts: s.activeToasts.filter((t) => t.instanceId !== instanceId),
    })),
  };
}
