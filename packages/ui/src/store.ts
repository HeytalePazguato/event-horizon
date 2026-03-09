/**
 * Zustand store for Command Center UI state.
 * @event-horizon/ui
 */

import { create } from 'zustand';
import type { AgentState } from '@event-horizon/core';
import type { AgentMetrics } from '@event-horizon/core';

/**
 * Tier thresholds for tiered achievements.
 * Kept here (not imported from Achievements.tsx) to avoid circular dependency.
 */
const TIERED_THRESHOLDS: Record<string, number[]> = {
  gravity_well:    [1, 10, 50, 100, 1000, 10000],
  ufo_hunter:      [1, 10, 50, 100, 500],
  supernova:       [1, 5, 10, 50],
  traffic_control: [10, 50, 100, 500, 1000],
  abduction:       [1, 5, 25, 100],
  event_horizon:   [1, 5, 25, 100],
  slingshot:       [1, 5, 25, 100],
  agent_connected: [1, 3, 5, 10],
  trick_shot:      [1, 5, 25],
  rocket_man:      [1, 10, 50, 100, 500],
  kamikaze:        [1, 5, 25],
  cow_drop:        [1, 5, 25, 100],
};

export interface LogEntry {
  id: string;
  ts: string;
  agentId: string;
  agentName: string;
  type: string;
}

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

  setSelectedAgent: (id: string | null) => void;
  setSelectedAgentData: (agent: AgentState | null, metrics: AgentMetrics | null) => void;
  selectSingularity: () => void;
  incrementSingularityStat: (key: keyof SingularityStats, amount?: number) => void;
  setSingularityStats: (stats: SingularityStats) => void;
  requestCenter: () => void;
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
  /** Remove a toast by instanceId (called when the animation finishes). */
  dismissToast: (instanceId: string) => void;
  toggleConnect: () => void;
  toggleSpawn: () => void;
  requestConnectAgent: (agentType: string) => void;
  clearConnectAgent: () => void;
}

const boostTimers = new Map<string, ReturnType<typeof setTimeout>>();

export const useCommandCenterStore = create<CommandCenterState>((set, get) => ({
  selectedAgentId: null,
  selectedAgent: null,
  selectedMetrics: null,
  singularitySelected: false,
  singularityStats: { ...EMPTY_SINGULARITY_STATS },
  centerRequestedAt: 0,
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

  dismissToast: (instanceId) =>
    set((s) => ({
      activeToasts: s.activeToasts.filter((t) => t.instanceId !== instanceId),
    })),

  toggleConnect: () => set((s) => ({ connectOpen: !s.connectOpen })),
  toggleSpawn: () => set((s) => ({ spawnOpen: !s.spawnOpen })),
  requestConnectAgent: (agentType) => set({ pendingConnectAgent: agentType, connectOpen: false }),
  clearConnectAgent: () => set({ pendingConnectAgent: null }),
}));
