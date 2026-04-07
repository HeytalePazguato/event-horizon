/**
 * Settings persistence — debounced sync to extension host globalState.
 * Extracted from index.tsx (Phase D — Webview Decomposition).
 */

import { useEffect, useRef } from 'react';
import { useCommandCenterStore } from '@event-horizon/ui';

export function useSettingsPersistence(vscodeApi: { postMessage: (msg: unknown) => void } | null): void {
  const visualSettings       = useCommandCenterStore((s) => s.visualSettings);
  const animationSpeed       = useCommandCenterStore((s) => s.animationSpeed);
  const achievementsEnabled  = useCommandCenterStore((s) => s.achievementsEnabled);
  const eventServerPort      = useCommandCenterStore((s) => s.eventServerPort);
  const tourCompleted        = useCommandCenterStore((s) => s.tourCompleted);
  const viewMode             = useCommandCenterStore((s) => s.viewMode);
  const fileLockingEnabled   = useCommandCenterStore((s) => s.fileLockingEnabled);
  const worktreeIsolation    = useCommandCenterStore((s) => s.worktreeIsolation);
  const planShowAllColumns   = useCommandCenterStore((s) => s.planShowAllColumns);
  const fontSize             = useCommandCenterStore((s) => s.fontSize);

  const unlockedAchievements = useCommandCenterStore((s) => s.unlockedAchievements);
  const achievementTiers     = useCommandCenterStore((s) => s.achievementTiers);
  const achievementCounts    = useCommandCenterStore((s) => s.achievementCounts);
  const singularityStats     = useCommandCenterStore((s) => s.singularityStats);

  // Persist medals
  useEffect(() => {
    if (unlockedAchievements.length === 0) return;
    vscodeApi?.postMessage({ type: 'persist-medals', unlockedAchievements, achievementTiers, achievementCounts });
  }, [unlockedAchievements, achievementTiers, achievementCounts]);

  // Persist singularity stats
  useEffect(() => {
    if (!singularityStats.firstEventAt) return;
    vscodeApi?.postMessage({ type: 'persist-singularity', stats: singularityStats });
  }, [singularityStats]);

  // Persist all settings (debounced) — skip the first render to avoid overwriting
  // saved VS Code config with Zustand defaults before init-settings arrives.
  const settingsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialRenderRef = useRef(true);
  useEffect(() => {
    if (initialRenderRef.current) {
      initialRenderRef.current = false;
      return;
    }
    if (settingsTimerRef.current) clearTimeout(settingsTimerRef.current);
    settingsTimerRef.current = setTimeout(() => {
      vscodeApi?.postMessage({
        type: 'persist-settings',
        settings: visualSettings,
        achievementsEnabled,
        animationSpeed,
        eventServerPort,
        tourCompleted,
        viewMode,
        fileLockingEnabled,
        worktreeIsolation,
        planShowAllColumns,
        fontSize,
      });
    }, 500);
    return () => { if (settingsTimerRef.current) clearTimeout(settingsTimerRef.current); };
  }, [visualSettings, achievementsEnabled, animationSpeed, eventServerPort, tourCompleted, viewMode, fileLockingEnabled, worktreeIsolation, planShowAllColumns, fontSize]);
}
