/**
 * Universe slice — agent selection, pause, isolate, boost, center, reset layout.
 * Part of the CommandCenterState store (Phase E — Store Split).
 */

import type { AgentState, AgentMetrics } from '@event-horizon/core';
import type { SingularityStats } from './types.js';
import { EMPTY_SINGULARITY_STATS } from './types.js';

export interface UniverseSlice {
  selectedAgentId: string | null;
  selectedAgent: AgentState | null;
  selectedMetrics: AgentMetrics | null;
  singularitySelected: boolean;
  singularityStats: SingularityStats;
  centerRequestedAt: number;
  resetLayoutRequestedAt: number;
  pausedAgentIds: Record<string, boolean>;
  isolatedAgentId: string | null;
  boostedAgentIds: Record<string, boolean>;
  exportRequestedAt: number;
  screenshotRequestedAt: number;
  demoRequested: boolean;
  demoMode: boolean;
  demoStartedAt: number;

  setSelectedAgent: (id: string | null) => void;
  setSelectedAgentData: (agent: AgentState | null, metrics: AgentMetrics | null) => void;
  selectSingularity: () => void;
  incrementSingularityStat: (key: keyof SingularityStats, amount?: number) => void;
  setSingularityStats: (stats: SingularityStats) => void;
  requestCenter: () => void;
  requestResetLayout: () => void;
  requestExport: () => void;
  requestScreenshot: () => void;
  togglePause: (id: string) => void;
  toggleIsolate: (id: string) => void;
  triggerBoost: (id: string) => void;
  clearBoost: (id: string) => void;
  requestDemo: () => void;
  setDemoMode: (active: boolean) => void;
}

const boostTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function clearAllBoostTimers(): void {
  for (const t of boostTimers.values()) clearTimeout(t);
  boostTimers.clear();
}

type SetFn = (fn: (s: UniverseSlice) => Partial<UniverseSlice>) => void;
type GetFn = () => UniverseSlice;

export function createUniverseSlice(set: SetFn, get: GetFn): UniverseSlice {
  return {
    selectedAgentId: null,
    selectedAgent: null,
    selectedMetrics: null,
    singularitySelected: false,
    singularityStats: { ...EMPTY_SINGULARITY_STATS },
    centerRequestedAt: 0,
    resetLayoutRequestedAt: 0,
    pausedAgentIds: {},
    isolatedAgentId: null,
    boostedAgentIds: {},
    exportRequestedAt: 0,
    screenshotRequestedAt: 0,
    demoRequested: false,
    demoMode: false,
    demoStartedAt: 0,

    setSelectedAgent: (id) => set((s) => ({
      selectedAgentId: id, selectedAgent: null, selectedMetrics: null, singularitySelected: false,
      isolatedAgentId: s.isolatedAgentId && id ? id : s.isolatedAgentId,
    })),
    setSelectedAgentData: (agent, metrics) => set((s) => ({
      selectedAgentId: agent?.id ?? null, selectedAgent: agent ?? null, selectedMetrics: metrics ?? null,
      singularitySelected: false,
      isolatedAgentId: s.isolatedAgentId && agent?.id ? agent.id : s.isolatedAgentId,
    })),
    selectSingularity: () => set((s) => ({
      selectedAgentId: null, selectedAgent: null, selectedMetrics: null, singularitySelected: true,
      isolatedAgentId: s.isolatedAgentId ? '__singularity__' : null,
    })),
    incrementSingularityStat: (key, amount = 1) => set((s) => {
      const stats = { ...s.singularityStats };
      if (key === 'firstEventAt') { if (!stats.firstEventAt) stats.firstEventAt = Date.now(); }
      else { (stats[key] as number) += amount; }
      return { singularityStats: stats };
    }),
    setSingularityStats: (stats) => set(() => ({ singularityStats: stats })),
    requestCenter: () => set(() => ({ centerRequestedAt: Date.now() })),
    requestResetLayout: () => set(() => ({ resetLayoutRequestedAt: Date.now() })),
    requestExport: () => set(() => ({ exportRequestedAt: Date.now() })),
    requestScreenshot: () => set(() => ({ screenshotRequestedAt: Date.now() })),
    togglePause: (id) => set((s) => ({ pausedAgentIds: { ...s.pausedAgentIds, [id]: !s.pausedAgentIds[id] } })),
    toggleIsolate: (id) => set((s) => ({ isolatedAgentId: s.isolatedAgentId === id ? null : id })),
    triggerBoost: (id) => {
      set((s) => ({ boostedAgentIds: { ...s.boostedAgentIds, [id]: true } }));
      const existing = boostTimers.get(id);
      if (existing) clearTimeout(existing);
      const timerId = setTimeout(() => { boostTimers.delete(id); get().clearBoost(id); }, 5000);
      boostTimers.set(id, timerId);
    },
    clearBoost: (id) => set((s) => {
      const next = { ...s.boostedAgentIds }; delete next[id]; return { boostedAgentIds: next };
    }),
    requestDemo: () => set((s) => ({ demoRequested: !s.demoRequested })),
    setDemoMode: (active) => set(() => ({ demoMode: active, demoStartedAt: active ? Date.now() : 0 })),
  };
}
