/**
 * Zustand store for Command Center UI state.
 * @event-horizon/ui
 */

import { create } from 'zustand';

export interface CommandCenterState {
  selectedAgentId: string | null;
  setSelectedAgent: (id: string | null) => void;
}

export const useCommandCenterStore = create<CommandCenterState>((set) => ({
  selectedAgentId: null,
  setSelectedAgent: (id) => set({ selectedAgentId: id }),
}));
