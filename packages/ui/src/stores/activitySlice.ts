/**
 * Activity slice — file activity heatmap, timeline buffer, logs.
 * Part of the CommandCenterState store (Phase E — Store Split).
 */

import type { LogEntry, FileActivity, FileAgentActivity, TimelineEntry } from './types.js';

const TIMELINE_CAP = 500;

export interface ActivitySlice {
  timeline: TimelineEntry[];
  addTimelineEntry: (entry: TimelineEntry) => void;
  clearTimeline: () => void;
  fileActivity: Record<string, FileActivity>;
  recordFileOp: (normalizedPath: string, basename: string, agentId: string, agentName: string, agentType: string, op: 'read' | 'write' | 'error', cwd?: string) => void;
  clearFileActivity: () => void;
  logsOpen: boolean;
  logs: LogEntry[];
  openLogs: () => void;
  closeLogs: () => void;
  addLog: (entry: LogEntry) => void;
}

type SetFn = (fn: (s: ActivitySlice) => Partial<ActivitySlice>) => void;

export function createActivitySlice(set: SetFn): ActivitySlice {
  return {
    timeline: [],
    addTimelineEntry: (entry) => set((s) => {
      const next = [...s.timeline, entry];
      return { timeline: next.length > TIMELINE_CAP ? next.slice(next.length - TIMELINE_CAP) : next };
    }),
    clearTimeline: () => set(() => ({ timeline: [] })),

    fileActivity: {},
    recordFileOp: (normalizedPath, basename, agentId, agentName, agentType, op, cwd) =>
      set((s) => {
        const prev = s.fileActivity[normalizedPath];
        const agentPrev = prev?.agents[agentId];
        const now = Date.now();
        const agent: FileAgentActivity = {
          agentId, agentName, agentType, cwd: cwd ?? agentPrev?.cwd,
          reads: (agentPrev?.reads ?? 0) + (op === 'read' ? 1 : 0),
          writes: (agentPrev?.writes ?? 0) + (op === 'write' ? 1 : 0),
          errors: (agentPrev?.errors ?? 0) + (op === 'error' ? 1 : 0),
          lastTs: now,
        };
        const agents = { ...(prev?.agents ?? {}), [agentId]: agent };
        const agentCount = Object.keys(agents).length;
        const totalOps = Object.values(agents).reduce((sum, a) => sum + a.reads + a.writes, 0);
        const hasErrors = Object.values(agents).some((a) => a.errors > 0);
        const entry: FileActivity = { path: normalizedPath, name: basename, agents, totalOps, agentCount, hasErrors, lastTs: now };
        return { fileActivity: { ...s.fileActivity, [normalizedPath]: entry } };
      }),
    clearFileActivity: () => set(() => ({ fileActivity: {} })),

    logsOpen: false,
    logs: [],
    openLogs: () => set(() => ({ logsOpen: true })),
    closeLogs: () => set(() => ({ logsOpen: false })),
    addLog: (entry) => set((s) => ({
      logs: [{ ...entry, id: entry.id || `log-${Date.now()}-${Math.random().toString(36).slice(2, 9)}` }, ...s.logs].slice(0, 200),
    })),
  };
}
