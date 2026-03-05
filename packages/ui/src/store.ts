/**
 * Zustand store for Command Center UI state.
 * @event-horizon/ui
 */

import { create } from 'zustand';
import type { AgentState } from '@event-horizon/core';
import type { AgentMetrics } from '@event-horizon/core';

export interface CommandCenterState {
  selectedAgentId: string | null;
  selectedAgent: AgentState | null;
  selectedMetrics: AgentMetrics | null;
  setSelectedAgent: (id: string | null) => void;
  setSelectedAgentData: (agent: AgentState | null, metrics: AgentMetrics | null) => void;
}

export const useCommandCenterStore = create<CommandCenterState>((set) => ({
  selectedAgentId: null,
  selectedAgent: null,
  selectedMetrics: null,
  setSelectedAgent: (id) => set({ selectedAgentId: id, selectedAgent: null, selectedMetrics: null }),
  setSelectedAgentData: (agent, metrics) =>
    set({
      selectedAgentId: agent?.id ?? null,
      selectedAgent: agent ?? null,
      selectedMetrics: metrics ?? null,
    }),
}));
