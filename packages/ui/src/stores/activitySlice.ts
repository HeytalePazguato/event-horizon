/**
 * Activity slice — file activity heatmap, timeline buffer, logs.
 * Part of the CommandCenterState store (Phase E — Store Split).
 */

import type { LogEntry, FileActivity, FileAgentActivity, TimelineEntry } from './types.js';

const TIMELINE_CAP = 500;
const LOG_CAP = 200;
const FILE_ACTIVITY_CAP = 200;

// Timeline: oldest-first append. head = next write position.
function buildTimeline(buf: (TimelineEntry | undefined)[], head: number, size: number): TimelineEntry[] {
  if (size === 0) return [];
  const arr = new Array<TimelineEntry>(size);
  const start = (head - size + TIMELINE_CAP) % TIMELINE_CAP;
  for (let i = 0; i < size; i++) arr[i] = buf[(start + i) % TIMELINE_CAP]!;
  return arr;
}

// Logs: newest-first prepend. head = next write position; (head-1) = newest entry.
function buildLogs(buf: (LogEntry | undefined)[], head: number, size: number): LogEntry[] {
  if (size === 0) return [];
  const arr = new Array<LogEntry>(size);
  for (let i = 0; i < size; i++) arr[i] = buf[(head - 1 - i + LOG_CAP) % LOG_CAP]!;
  return arr;
}

// LRU node for file-activity eviction (doubly-linked list over paths).
interface FileOrderNode { prev: string | null; next: string | null; }

export interface ActivitySlice {
  // ── Timeline ring buffer (internal) ─────────────────────────────────────
  _tlBuf: (TimelineEntry | undefined)[];
  _tlHead: number;
  _tlSize: number;
  _tlRev: number;
  // ── Logs ring buffer (internal) ──────────────────────────────────────────
  _lgBuf: (LogEntry | undefined)[];
  _lgHead: number;
  _lgSize: number;
  _lgRev: number;
  // ── File-activity LRU (internal) ─────────────────────────────────────────
  _flOrder: Map<string, FileOrderNode>;
  _flHead: string | null;
  _flTail: string | null;
  // ── Public API ───────────────────────────────────────────────────────────
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
    _tlBuf: new Array<TimelineEntry | undefined>(TIMELINE_CAP),
    _tlHead: 0,
    _tlSize: 0,
    _tlRev: 0,
    timeline: [],

    addTimelineEntry: (entry) => set((s) => {
      s._tlBuf[s._tlHead] = entry;
      const head = (s._tlHead + 1) % TIMELINE_CAP;
      const size = Math.min(s._tlSize + 1, TIMELINE_CAP);
      const rev = s._tlRev + 1;
      return { _tlHead: head, _tlSize: size, _tlRev: rev, timeline: buildTimeline(s._tlBuf, head, size) };
    }),

    clearTimeline: () => set((s) => {
      s._tlHead = 0;
      s._tlSize = 0;
      return { _tlHead: 0, _tlSize: 0, _tlRev: s._tlRev + 1, timeline: [] };
    }),

    fileActivity: {},
    _flOrder: new Map<string, FileOrderNode>(),
    _flHead: null,
    _flTail: null,
    recordFileOp: (normalizedPath, basename, agentId, agentName, agentType, op, cwd) =>
      set((s) => {
        // Detect state reset via setState(getInitialState()) in tests: primitives
        // are restored to null but the Map reference persists with stale entries.
        if (s._flHead === null && s._flOrder.size > 0) s._flOrder.clear();

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

        // Incremental aggregates — matches the previous full-scan semantics
        // (totalOps = sum of reads+writes only; errors don't count).
        const totalOps = (prev?.totalOps ?? 0) + (op === 'error' ? 0 : 1);
        const agentCount = (prev?.agentCount ?? 0) + (agentPrev ? 0 : 1);
        const hasErrors = (prev?.hasErrors ?? false) || op === 'error';

        const entry: FileActivity = { path: normalizedPath, name: basename, agents, totalOps, agentCount, hasErrors, lastTs: now };
        const nextActivity: Record<string, FileActivity> = { ...s.fileActivity, [normalizedPath]: entry };

        // LRU: move-to-head (O(1)); new entry may evict tail (O(1)).
        const order = s._flOrder;
        let head = s._flHead;
        let tail = s._flTail;
        const existing = order.get(normalizedPath);
        if (existing) {
          if (existing.prev !== null) {
            order.get(existing.prev)!.next = existing.next;
          } else {
            head = existing.next;
          }
          if (existing.next !== null) {
            order.get(existing.next)!.prev = existing.prev;
          } else {
            tail = existing.prev;
          }
          existing.prev = null;
          existing.next = head;
          if (head !== null) order.get(head)!.prev = normalizedPath;
          head = normalizedPath;
          if (tail === null) tail = normalizedPath;
        } else {
          const node: FileOrderNode = { prev: null, next: head };
          order.set(normalizedPath, node);
          if (head !== null) order.get(head)!.prev = normalizedPath;
          head = normalizedPath;
          if (tail === null) tail = normalizedPath;
          if (order.size > FILE_ACTIVITY_CAP) {
            const evictPath = tail!;
            const tailNode = order.get(evictPath)!;
            const newTail = tailNode.prev;
            if (newTail !== null) order.get(newTail)!.next = null;
            else head = null;
            tail = newTail;
            order.delete(evictPath);
            delete nextActivity[evictPath];
          }
        }

        return { fileActivity: nextActivity, _flHead: head, _flTail: tail };
      }),
    clearFileActivity: () => set((s) => {
      s._flOrder.clear();
      return { fileActivity: {}, _flHead: null, _flTail: null };
    }),

    _lgBuf: new Array<LogEntry | undefined>(LOG_CAP),
    _lgHead: 0,
    _lgSize: 0,
    _lgRev: 0,
    logsOpen: false,
    logs: [],

    openLogs: () => set(() => ({ logsOpen: true })),
    closeLogs: () => set(() => ({ logsOpen: false })),

    addLog: (entry) => set((s) => {
      const e = { ...entry, id: entry.id || `log-${Date.now()}-${Math.random().toString(36).slice(2, 9)}` };
      s._lgBuf[s._lgHead] = e;
      const head = (s._lgHead + 1) % LOG_CAP;
      const size = Math.min(s._lgSize + 1, LOG_CAP);
      const rev = s._lgRev + 1;
      return { _lgHead: head, _lgSize: size, _lgRev: rev, logs: buildLogs(s._lgBuf, head, size) };
    }),
  };
}
