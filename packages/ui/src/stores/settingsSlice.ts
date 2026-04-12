/**
 * Settings slice — visual settings, animation, achievements toggle, tour, file locking, view mode, skills.
 * Part of the CommandCenterState store (Phase E — Store Split).
 */

import type { VisualSettings, VisualAgentType, SkillInfo, MarketplaceEntry } from './types.js';
import { DEFAULT_VISUAL_SETTINGS, DEFAULT_MARKETPLACES } from './types.js';

export interface SettingsSlice {
  viewMode: 'universe' | 'operations';
  setViewMode: (mode: 'universe' | 'operations') => void;
  toggleViewMode: () => void;
  /** True once init-settings message has been processed — prevents default-view flash on startup. */
  settingsHydrated: boolean;
  markSettingsHydrated: () => void;
  visualSettings: VisualSettings;
  settingsOpen: boolean;
  toggleSettings: () => void;
  setAgentColor: (agentType: VisualAgentType, color: string) => void;
  setAgentSizeMult: (agentType: VisualAgentType, sizeMult: number) => void;
  resetVisualSettings: () => void;
  setVisualSettings: (settings: VisualSettings) => void;
  tourCompleted: boolean;
  setTourCompleted: (completed: boolean) => void;
  tourRequestedAt: number;
  requestTour: () => void;
  achievementsEnabled: boolean;
  setAchievementsEnabled: (enabled: boolean) => void;
  animationSpeed: number;
  setAnimationSpeed: (speed: number) => void;
  eventServerPort: number;
  setEventServerPort: (port: number) => void;
  fileLockingEnabled: boolean;
  setFileLockingEnabled: (enabled: boolean) => void;
  worktreeIsolation: boolean;
  setWorktreeIsolation: (enabled: boolean) => void;
  fileLocks: Record<string, { agentId: string; agentName: string; acquiredAt: number }>;
  setFileLocks: (locks: Record<string, { agentId: string; agentName: string; acquiredAt: number }>) => void;
  skills: SkillInfo[];
  setSkills: (skills: SkillInfo[]) => void;
  createSkillOpen: boolean;
  toggleCreateSkill: () => void;
  marketplaceOpen: boolean;
  toggleMarketplace: () => void;
  registeredMarketplaces: MarketplaceEntry[];
  addMarketplace: (entry: MarketplaceEntry) => void;
  removeMarketplace: (url: string) => void;
  setMarketplaces: (entries: MarketplaceEntry[]) => void;
  connectOpen: boolean;
  toggleConnect: () => void;
  spawnOpen: boolean;
  toggleSpawn: () => void;
  pendingConnectAgent: string | null;
  requestConnectAgent: (agentType: string) => void;
  clearConnectAgent: () => void;
  ccMinimized: boolean;
  setCcMinimized: (minimized: boolean) => void;
  infoOpen: boolean;
  toggleInfo: () => void;
  planShowAllColumns: boolean;
  setPlanShowAllColumns: (show: boolean) => void;
  fontSize: 'small' | 'default' | 'large';
  setFontSize: (size: 'small' | 'default' | 'large') => void;
}

type SetFn = (fn: (s: SettingsSlice) => Partial<SettingsSlice>) => void;

export function createSettingsSlice(set: SetFn): SettingsSlice {
  return {
    viewMode: 'universe',
    setViewMode: (mode) => set(() => ({ viewMode: mode })),
    settingsHydrated: false,
    markSettingsHydrated: () => set(() => ({ settingsHydrated: true })),
    toggleViewMode: () => set((s) => ({ viewMode: s.viewMode === 'universe' ? 'operations' : 'universe' })),
    visualSettings: { ...DEFAULT_VISUAL_SETTINGS },
    settingsOpen: false,
    toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen })),
    setAgentColor: (agentType, color) => set((s) => ({
      visualSettings: { ...s.visualSettings, [agentType]: { ...s.visualSettings[agentType], color } },
    })),
    setAgentSizeMult: (agentType, sizeMult) => set((s) => ({
      visualSettings: { ...s.visualSettings, [agentType]: { ...s.visualSettings[agentType], sizeMult: Math.max(0.4, Math.min(2.0, sizeMult)) } },
    })),
    resetVisualSettings: () => set(() => ({ visualSettings: { ...DEFAULT_VISUAL_SETTINGS } })),
    setVisualSettings: (settings) => set(() => ({ visualSettings: settings })),
    tourCompleted: false,
    setTourCompleted: (completed) => set(() => ({ tourCompleted: completed })),
    tourRequestedAt: 0,
    requestTour: () => set(() => ({ tourCompleted: false, tourRequestedAt: Date.now() })),
    achievementsEnabled: true,
    setAchievementsEnabled: (enabled) => set(() => ({ achievementsEnabled: enabled })),
    animationSpeed: 1.0,
    setAnimationSpeed: (speed) => set(() => ({ animationSpeed: Math.max(0.25, Math.min(3.0, speed)) })),
    eventServerPort: 28765,
    setEventServerPort: (port) => set(() => ({ eventServerPort: Math.max(1024, Math.min(65535, port)) })),
    fileLockingEnabled: false,
    setFileLockingEnabled: (enabled) => set(() => ({ fileLockingEnabled: enabled })),
    worktreeIsolation: false,
    setWorktreeIsolation: (enabled) => set(() => ({ worktreeIsolation: enabled })),
    fileLocks: {},
    setFileLocks: (locks) => set(() => ({ fileLocks: locks })),
    skills: [],
    setSkills: (skills) => set(() => ({ skills })),
    createSkillOpen: false,
    toggleCreateSkill: () => set((s) => ({ createSkillOpen: !s.createSkillOpen })),
    marketplaceOpen: false,
    toggleMarketplace: () => set((s) => ({ marketplaceOpen: !s.marketplaceOpen })),
    registeredMarketplaces: [...DEFAULT_MARKETPLACES],
    addMarketplace: (entry) => set((s) => {
      if (s.registeredMarketplaces.some((m) => m.url === entry.url)) return {};
      return { registeredMarketplaces: [...s.registeredMarketplaces, entry] };
    }),
    removeMarketplace: (url) => set((s) => ({
      registeredMarketplaces: s.registeredMarketplaces.filter((m) => m.url !== url),
    })),
    setMarketplaces: (entries) => set(() => ({ registeredMarketplaces: entries })),
    connectOpen: false,
    toggleConnect: () => set((s) => ({ connectOpen: !s.connectOpen })),
    spawnOpen: false,
    toggleSpawn: () => set((s) => ({ spawnOpen: !s.spawnOpen })),
    pendingConnectAgent: null,
    requestConnectAgent: (agentType) => set(() => ({ pendingConnectAgent: agentType, connectOpen: false })),
    clearConnectAgent: () => set(() => ({ pendingConnectAgent: null })),
    ccMinimized: false,
    setCcMinimized: (minimized) => set(() => ({ ccMinimized: minimized })),
    infoOpen: false,
    toggleInfo: () => set((s) => ({ infoOpen: !s.infoOpen })),
    planShowAllColumns: false,
    setPlanShowAllColumns: (show) => set(() => ({ planShowAllColumns: show })),
    fontSize: 'default',
    setFontSize: (size) => set(() => ({ fontSize: size })),
  };
}
