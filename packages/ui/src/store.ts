/**
 * Zustand store for Command Center UI state.
 * @event-horizon/ui
 */

import { create } from 'zustand';
import type { AgentState } from '@event-horizon/core';
import type { AgentMetrics } from '@event-horizon/core';
import { TIERED_THRESHOLDS } from './achievements/registry.js';

export interface LogEntry {
  id: string;
  ts: string;
  agentId: string;
  agentName: string;
  type: string;
  /** Skill name if this event is a skill invocation. */
  skillName?: string;
}

export interface SkillInfo {
  name: string;
  description: string;
  scope: 'personal' | 'project' | 'plugin' | 'legacy';
  filePath: string;
  userInvocable: boolean;
  disableModelInvocation: boolean;
  allowedTools: string[];
  model: string | null;
  context: 'inline' | 'fork';
  agent: string | null;
  argumentHint: string | null;
  pluginName: string | null;
  /** Category folder (e.g. 'documentation') — null if at root level. */
  category: string | null;
  /** Which agent types can use this skill. */
  agentTypes: Array<'claude-code' | 'opencode' | 'copilot'>;
}

export interface MarketplaceEntry {
  name: string;
  url: string;
  /** 'api' = has searchable API (inline results), 'browse' = open in browser */
  type: 'browse' | 'api';
}

export interface MarketplaceSkillResult {
  name: string;
  description: string;
  author: string;
  url: string;
  source: string;
}

export interface AgentVisualConfig {
  /** Hex color string for thinking ring and UI badges (e.g. '#88aaff'). */
  color: string;
  /** Size multiplier (0.4 – 2.0). Applied to base planet radius. */
  sizeMult: number;
}

export type VisualAgentType = 'claude-code' | 'copilot' | 'opencode' | 'cursor' | 'unknown';

export type VisualSettings = Record<VisualAgentType, AgentVisualConfig>;

export const DEFAULT_VISUAL_SETTINGS: VisualSettings = {
  'claude-code': { color: '#88aaff', sizeMult: 1.35 },
  'copilot':     { color: '#cc88ff', sizeMult: 0.72 },
  'opencode':    { color: '#88ffaa', sizeMult: 1.0 },
  'cursor':      { color: '#44ddcc', sizeMult: 0.92 },
  'unknown':     { color: '#aaccff', sizeMult: 1.12 },
};

export const DEFAULT_MARKETPLACES: MarketplaceEntry[] = [
  { name: 'SkillHub', url: 'https://www.skillhub.club/', type: 'api' },
  { name: 'SkillsMP', url: 'https://skillsmp.com', type: 'browse' },
  { name: 'Anthropic Official', url: 'https://github.com/anthropics/skills', type: 'browse' },
  { name: 'MCP Market', url: 'https://mcpmarket.com/tools/skills', type: 'browse' },
];

export interface ToastEntry {
  instanceId: string;
  achievementId: string;
}

/** Persistent stats for the black hole — everything it has consumed. */
export interface SingularityStats {
  /** Agents that terminated — their planet was consumed. */
  planetsSwallowed: number;
  /** Astronauts that drifted into the gravity well. */
  astronautsConsumed: number;
  /** UFOs that flew too close and spiralled in. */
  ufosConsumed: number;
  /** Cows abducted by UFOs (cosmic event witnessed from the center). */
  cowsAbducted: number;
  /** Data-transfer ships observed flying between planets. */
  shipsObserved: number;
  /** Total unique agents that ever connected to the universe. */
  agentsSeen: number;
  /** Total events processed across all agents. */
  eventsWitnessed: number;
  /** Total errors witnessed across all agents. */
  errorsWitnessed: number;
  /** Timestamp of first ever event. */
  firstEventAt: number;
}

export const EMPTY_SINGULARITY_STATS: SingularityStats = {
  planetsSwallowed: 0,
  astronautsConsumed: 0,
  ufosConsumed: 0,
  cowsAbducted: 0,
  shipsObserved: 0,
  agentsSeen: 0,
  eventsWitnessed: 0,
  errorsWitnessed: 0,
  firstEventAt: 0,
};

export interface CommandCenterState {
  selectedAgentId: string | null;
  selectedAgent: AgentState | null;
  selectedMetrics: AgentMetrics | null;
  /** When true, the black hole is selected instead of a planet. */
  singularitySelected: boolean;
  /** Persistent cosmic ledger. */
  singularityStats: SingularityStats;
  centerRequestedAt: number;
  /** Agent IDs whose pulse animation is frozen. */
  pausedAgentIds: Record<string, boolean>;
  /** When set, all other planets are dimmed. */
  isolatedAgentId: string | null;
  /** Agents with a temporary visual boost (expires automatically). */
  boostedAgentIds: Record<string, boolean>;
  /** Whether the center panel is showing logs vs info. */
  logsOpen: boolean;
  /** Event log entries (capped at 200). */
  logs: LogEntry[];
  /** When true, show the in-universe info overlay. */
  infoOpen: boolean;
  /** Whether the demo simulation is running (owned here so Commands panel can toggle it). */
  demoRequested: boolean;
  /** True while demo simulation is active — guards achievements from firing. */
  demoMode: boolean;
  /** Active toast notifications. */
  activeToasts: ToastEntry[];
  /** Achievement IDs that have already been unlocked (one-shot). */
  unlockedAchievements: string[];
  /** Cumulative counts for tiered achievements (e.g. gravity_well → 42). */
  achievementCounts: Record<string, number>;
  /** Current tier index for tiered achievements. */
  achievementTiers: Record<string, number>;
  /** Whether the "Connect Agent" dropdown is open. */
  connectOpen: boolean;
  /** Whether the "Spawn Agent" modal is open. */
  spawnOpen: boolean;
  /** Non-null when the user requested connecting a specific agent type; cleared after handling. */
  pendingConnectAgent: string | null;
  /** Per-agent-type visual customization (colors, planet sizes). */
  visualSettings: VisualSettings;
  /** Whether the settings modal is open. */
  settingsOpen: boolean;
  toggleSettings: () => void;
  setAgentColor: (agentType: VisualAgentType, color: string) => void;
  setAgentSizeMult: (agentType: VisualAgentType, sizeMult: number) => void;
  resetVisualSettings: () => void;
  setVisualSettings: (settings: VisualSettings) => void;
  /** Whether achievements and toasts are enabled. */
  achievementsEnabled: boolean;
  setAchievementsEnabled: (enabled: boolean) => void;
  /** Animation speed multiplier (0.25 – 3.0). 1.0 = normal. */
  animationSpeed: number;
  setAnimationSpeed: (speed: number) => void;
  /** Event server port. Changing this requires an extension restart. */
  eventServerPort: number;
  setEventServerPort: (port: number) => void;
  /** Installed skills discovered from disk. */
  skills: SkillInfo[];
  setSkills: (skills: SkillInfo[]) => void;
  /** Whether the "Create Skill" wizard is open. */
  createSkillOpen: boolean;
  toggleCreateSkill: () => void;
  /** Whether the marketplace browser is open. */
  marketplaceOpen: boolean;
  toggleMarketplace: () => void;
  /** Registered marketplace sources. */
  registeredMarketplaces: MarketplaceEntry[];
  addMarketplace: (entry: MarketplaceEntry) => void;
  removeMarketplace: (url: string) => void;
  setMarketplaces: (entries: MarketplaceEntry[]) => void;

  setSelectedAgent: (id: string | null) => void;
  setSelectedAgentData: (agent: AgentState | null, metrics: AgentMetrics | null) => void;
  selectSingularity: () => void;
  incrementSingularityStat: (key: keyof SingularityStats, amount?: number) => void;
  setSingularityStats: (stats: SingularityStats) => void;
  requestCenter: () => void;
  /** Timestamp-based signal to trigger stats export from webview. */
  exportRequestedAt: number;
  requestExport: () => void;
  /** Timestamp-based signal to trigger screenshot from webview. */
  screenshotRequestedAt: number;
  requestScreenshot: () => void;
  togglePause: (id: string) => void;
  toggleIsolate: (id: string) => void;
  triggerBoost: (id: string) => void;
  clearBoost: (id: string) => void;
  openLogs: () => void;
  closeLogs: () => void;
  addLog: (entry: LogEntry) => void;
  toggleInfo: () => void;
  requestDemo: () => void;
  setDemoMode: (active: boolean) => void;
  /** Unlock an achievement and show a toast. No-op if already unlocked. For tiered achievements, use incrementTieredAchievement instead. */
  unlockAchievement: (id: string) => void;
  /** Increment the count for a tiered achievement and upgrade tier if threshold is met. */
  incrementTieredAchievement: (id: string) => void;
  /** Set the absolute count for a tiered achievement (idempotent — only toasts on tier upgrade). */
  setTieredAchievementCount: (id: string, count: number) => void;
  /** Recalibrate a tiered achievement to the correct count (allows downward correction, no toast). */
  recalibrateTieredAchievement: (id: string, count: number) => void;
  /** Remove a toast by instanceId (called when the animation finishes). */
  dismissToast: (instanceId: string) => void;
  toggleConnect: () => void;
  toggleSpawn: () => void;
  requestConnectAgent: (agentType: string) => void;
  clearConnectAgent: () => void;
}

const boostTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Clear all pending boost timers — call on webview init/reload to prevent stale timeouts. */
export function clearAllBoostTimers(): void {
  for (const t of boostTimers.values()) clearTimeout(t);
  boostTimers.clear();
}

export const useCommandCenterStore = create<CommandCenterState>((set, get) => ({
  selectedAgentId: null,
  selectedAgent: null,
  selectedMetrics: null,
  singularitySelected: false,
  singularityStats: { ...EMPTY_SINGULARITY_STATS },
  centerRequestedAt: 0,
  exportRequestedAt: 0,
  screenshotRequestedAt: 0,
  pausedAgentIds: {},
  isolatedAgentId: null,
  boostedAgentIds: {},
  logsOpen: false,
  logs: [],
  infoOpen: false,
  demoRequested: false,
  demoMode: false,
  activeToasts: [],
  unlockedAchievements: [],
  achievementCounts: {},
  achievementTiers: {},
  connectOpen: false,
  spawnOpen: false,
  pendingConnectAgent: null,
  visualSettings: { ...DEFAULT_VISUAL_SETTINGS },
  settingsOpen: false,
  toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen })),
  achievementsEnabled: true,
  setAchievementsEnabled: (enabled) => set({ achievementsEnabled: enabled }),
  animationSpeed: 1.0,
  setAnimationSpeed: (speed) => set({ animationSpeed: Math.max(0.25, Math.min(3.0, speed)) }),
  eventServerPort: 28765,
  setEventServerPort: (port) => set({ eventServerPort: Math.max(1024, Math.min(65535, port)) }),
  setAgentColor: (agentType, color) =>
    set((s) => ({
      visualSettings: { ...s.visualSettings, [agentType]: { ...s.visualSettings[agentType], color } },
    })),
  setAgentSizeMult: (agentType, sizeMult) =>
    set((s) => ({
      visualSettings: {
        ...s.visualSettings,
        [agentType]: { ...s.visualSettings[agentType], sizeMult: Math.max(0.4, Math.min(2.0, sizeMult)) },
      },
    })),
  resetVisualSettings: () => set({ visualSettings: { ...DEFAULT_VISUAL_SETTINGS } }),
  setVisualSettings: (settings) => set({ visualSettings: settings }),
  skills: [],
  setSkills: (skills) => set({ skills }),
  createSkillOpen: false,
  toggleCreateSkill: () => set((s) => ({ createSkillOpen: !s.createSkillOpen })),
  marketplaceOpen: false,
  toggleMarketplace: () => set((s) => ({ marketplaceOpen: !s.marketplaceOpen })),
  registeredMarketplaces: [...DEFAULT_MARKETPLACES],
  addMarketplace: (entry) => set((s) => {
    if (s.registeredMarketplaces.some((m) => m.url === entry.url)) return s;
    return { registeredMarketplaces: [...s.registeredMarketplaces, entry] };
  }),
  removeMarketplace: (url) => set((s) => ({
    registeredMarketplaces: s.registeredMarketplaces.filter((m) => m.url !== url),
  })),
  setMarketplaces: (entries) => set({ registeredMarketplaces: entries }),

  setSelectedAgent: (id) => set((s) => ({
    selectedAgentId: id,
    selectedAgent: null,
    selectedMetrics: null,
    singularitySelected: false,
    // If isolation is active, follow the selection to the new planet
    isolatedAgentId: s.isolatedAgentId && id ? id : s.isolatedAgentId,
  })),

  setSelectedAgentData: (agent, metrics) =>
    set((s) => ({
      selectedAgentId: agent?.id ?? null,
      selectedAgent: agent ?? null,
      selectedMetrics: metrics ?? null,
      singularitySelected: false,
      // If isolation is active, follow the selection to the new planet
      isolatedAgentId: s.isolatedAgentId && agent?.id ? agent.id : s.isolatedAgentId,
    })),

  selectSingularity: () => set((s) => ({
    selectedAgentId: null,
    selectedAgent: null,
    selectedMetrics: null,
    singularitySelected: true,
    // If isolation is active, isolate the singularity (sentinel dims all planets)
    isolatedAgentId: s.isolatedAgentId ? '__singularity__' : null,
  })),

  incrementSingularityStat: (key, amount = 1) =>
    set((s) => {
      const stats = { ...s.singularityStats };
      if (key === 'firstEventAt') {
        if (!stats.firstEventAt) stats.firstEventAt = Date.now();
      } else {
        (stats[key] as number) += amount;
      }
      return { singularityStats: stats };
    }),

  setSingularityStats: (stats) => set({ singularityStats: stats }),

  requestCenter: () => set({ centerRequestedAt: Date.now() }),
  requestExport: () => set({ exportRequestedAt: Date.now() }),
  requestScreenshot: () => set({ screenshotRequestedAt: Date.now() }),

  togglePause: (id) =>
    set((s) => ({
      pausedAgentIds: { ...s.pausedAgentIds, [id]: !s.pausedAgentIds[id] },
    })),

  toggleIsolate: (id) =>
    set((s) => ({ isolatedAgentId: s.isolatedAgentId === id ? null : id })),

  triggerBoost: (id) => {
    set((s) => ({ boostedAgentIds: { ...s.boostedAgentIds, [id]: true } }));
    // Clear any existing boost timer for this agent
    const existing = boostTimers.get(id);
    if (existing) clearTimeout(existing);
    const timerId = setTimeout(() => {
      boostTimers.delete(id);
      get().clearBoost(id);
    }, 5000);
    boostTimers.set(id, timerId);
  },

  clearBoost: (id) =>
    set((s) => {
      const next = { ...s.boostedAgentIds };
      delete next[id];
      return { boostedAgentIds: next };
    }),

  openLogs: () => set({ logsOpen: true }),
  closeLogs: () => set({ logsOpen: false }),

  addLog: (entry) =>
    set((s) => ({
      logs: [{ ...entry, id: entry.id || `log-${Date.now()}-${Math.random().toString(36).slice(2, 9)}` }, ...s.logs].slice(0, 200),
    })),

  toggleInfo: () => set((s) => ({ infoOpen: !s.infoOpen })),

  requestDemo: () => set((s) => ({ demoRequested: !s.demoRequested })),
  setDemoMode: (active) => set({ demoMode: active }),

  unlockAchievement: (id) => {
    // Achievements disabled guard
    if (!get().achievementsEnabled && id !== 'demo_activated') return;
    // Demo guard: only demo_activated can fire during demo mode
    if (get().demoMode && id !== 'demo_activated') return;
    if (get().unlockedAchievements.includes(id)) return;
    const instanceId = `${id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    set((s) => ({
      unlockedAchievements: [...s.unlockedAchievements, id],
      activeToasts: [...s.activeToasts, { instanceId, achievementId: id }],
    }));
  },

  incrementTieredAchievement: (id) => {
    // Achievements disabled guard
    if (!get().achievementsEnabled) return;
    // Demo guard: no tiered achievements during demo mode
    if (get().demoMode) return;
    const tiers = TIERED_THRESHOLDS[id];
    if (!tiers) return;
    const state = get();
    const newCount = (state.achievementCounts[id] ?? 0) + 1;
    const currentTier = state.achievementTiers[id] ?? -1;
    // Find the next tier threshold that was just reached
    let newTier = currentTier;
    for (let i = currentTier + 1; i < tiers.length; i++) {
      if (newCount >= tiers[i]) newTier = i;
      else break;
    }
    const tierUpgraded = newTier > currentTier;
    const updates: Partial<CommandCenterState> = {
      achievementCounts: { ...state.achievementCounts, [id]: newCount },
    };
    if (tierUpgraded) {
      updates.achievementTiers = { ...state.achievementTiers, [id]: newTier };
      // Ensure it's in unlockedAchievements (first unlock) or just toast on upgrade
      if (!state.unlockedAchievements.includes(id)) {
        updates.unlockedAchievements = [...state.unlockedAchievements, id];
      }
      const instanceId = `${id}-t${newTier}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      updates.activeToasts = [...state.activeToasts, { instanceId, achievementId: id }];
    }
    set(updates);
  },

  setTieredAchievementCount: (id, count) => {
    if (!get().achievementsEnabled) return;
    if (get().demoMode) return;
    const tiers = TIERED_THRESHOLDS[id];
    if (!tiers) return;
    const state = get();
    const oldCount = state.achievementCounts[id] ?? 0;
    if (count <= oldCount) return; // only allow upward movement
    const currentTier = state.achievementTiers[id] ?? -1;
    let newTier = currentTier;
    for (let i = currentTier + 1; i < tiers.length; i++) {
      if (count >= tiers[i]) newTier = i;
      else break;
    }
    const tierUpgraded = newTier > currentTier;
    const updates: Partial<CommandCenterState> = {
      achievementCounts: { ...state.achievementCounts, [id]: count },
    };
    if (tierUpgraded) {
      updates.achievementTiers = { ...state.achievementTiers, [id]: newTier };
      if (!state.unlockedAchievements.includes(id)) {
        updates.unlockedAchievements = [...state.unlockedAchievements, id];
      }
      const instanceId = `${id}-t${newTier}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      updates.activeToasts = [...state.activeToasts, { instanceId, achievementId: id }];
    }
    set(updates);
  },

  recalibrateTieredAchievement: (id, count) => {
    const tiers = TIERED_THRESHOLDS[id];
    if (!tiers) return;
    // Compute the correct tier for this count
    let correctTier = -1;
    for (let i = 0; i < tiers.length; i++) {
      if (count >= tiers[i]) correctTier = i;
      else break;
    }
    const state = get();
    const oldCount = state.achievementCounts[id] ?? 0;
    const oldTier = state.achievementTiers[id] ?? -1;
    if (count === oldCount && correctTier === oldTier) return; // already correct
    const updates: Partial<CommandCenterState> = {
      achievementCounts: { ...state.achievementCounts, [id]: count },
      achievementTiers: { ...state.achievementTiers, [id]: correctTier },
    };
    // If count dropped below tier 0 threshold, remove from unlocked
    if (correctTier < 0 && state.unlockedAchievements.includes(id)) {
      updates.unlockedAchievements = state.unlockedAchievements.filter((a) => a !== id);
    }
    // If count reached tier 0+ but wasn't unlocked, add it
    if (correctTier >= 0 && !state.unlockedAchievements.includes(id)) {
      updates.unlockedAchievements = [...state.unlockedAchievements, id];
    }
    set(updates);
  },

  dismissToast: (instanceId) =>
    set((s) => ({
      activeToasts: s.activeToasts.filter((t) => t.instanceId !== instanceId),
    })),

  toggleConnect: () => set((s) => ({ connectOpen: !s.connectOpen })),
  toggleSpawn: () => set((s) => ({ spawnOpen: !s.spawnOpen })),
  requestConnectAgent: (agentType) => set({ pendingConnectAgent: agentType, connectOpen: false }),
  clearConnectAgent: () => set({ pendingConnectAgent: null }),
}));
