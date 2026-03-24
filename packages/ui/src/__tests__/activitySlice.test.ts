/**
 * Activity slice tests — logs, timeline, file activity.
 * Phase H — Test Coverage.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useCommandCenterStore } from '../store.js';

beforeEach(() => {
  useCommandCenterStore.setState(useCommandCenterStore.getInitialState());
});

// ── addLog ──────────────────────────────────────────────────────────────────

describe('addLog', () => {
  it('adds a log entry', () => {
    useCommandCenterStore.getState().addLog({
      id: 'log-1', ts: '2026-01-01T00:00:00Z', agentId: 'a1', agentName: 'Claude', type: 'info',
    });
    expect(useCommandCenterStore.getState().logs).toHaveLength(1);
    expect(useCommandCenterStore.getState().logs[0].id).toBe('log-1');
  });

  it('prepends new entries (newest first)', () => {
    const { addLog } = useCommandCenterStore.getState();
    addLog({ id: 'log-1', ts: '2026-01-01T00:00:00Z', agentId: 'a1', agentName: 'Claude', type: 'info' });
    addLog({ id: 'log-2', ts: '2026-01-01T00:00:01Z', agentId: 'a1', agentName: 'Claude', type: 'info' });
    const logs = useCommandCenterStore.getState().logs;
    expect(logs[0].id).toBe('log-2');
    expect(logs[1].id).toBe('log-1');
  });

  it('caps at 200 entries', () => {
    for (let i = 0; i < 210; i++) {
      useCommandCenterStore.getState().addLog({
        id: `log-${i}`, ts: '2026-01-01T00:00:00Z', agentId: 'a1', agentName: 'Claude', type: 'info',
      });
    }
    expect(useCommandCenterStore.getState().logs).toHaveLength(200);
  });
});

// ── addTimelineEntry ────────────────────────────────────────────────────────

describe('addTimelineEntry', () => {
  it('adds a timeline entry', () => {
    useCommandCenterStore.getState().addTimelineEntry({
      ts: Date.now(), agentId: 'a1', agentName: 'Claude', agentType: 'claude-code', kind: 'state', label: 'Started',
    });
    expect(useCommandCenterStore.getState().timeline).toHaveLength(1);
  });

  it('appends entries in order', () => {
    const { addTimelineEntry } = useCommandCenterStore.getState();
    addTimelineEntry({ ts: 1, agentId: 'a1', agentName: 'Claude', agentType: 'claude-code', kind: 'state', label: 'A' });
    addTimelineEntry({ ts: 2, agentId: 'a1', agentName: 'Claude', agentType: 'claude-code', kind: 'tool', label: 'B' });
    const timeline = useCommandCenterStore.getState().timeline;
    expect(timeline[0].label).toBe('A');
    expect(timeline[1].label).toBe('B');
  });

  it('caps at 500 entries', () => {
    for (let i = 0; i < 510; i++) {
      useCommandCenterStore.getState().addTimelineEntry({
        ts: i, agentId: 'a1', agentName: 'Claude', agentType: 'claude-code', kind: 'state', label: `Entry ${i}`,
      });
    }
    expect(useCommandCenterStore.getState().timeline).toHaveLength(500);
  });
});

// ── recordFileOp ────────────────────────────────────────────────────────────

describe('recordFileOp', () => {
  it('records a read operation for a new file', () => {
    useCommandCenterStore.getState().recordFileOp('/src/index.ts', 'index.ts', 'a1', 'Claude', 'claude-code', 'read');
    const activity = useCommandCenterStore.getState().fileActivity['/src/index.ts'];
    expect(activity).toBeDefined();
    expect(activity.name).toBe('index.ts');
    expect(activity.totalOps).toBe(1);
    expect(activity.agentCount).toBe(1);
    expect(activity.agents['a1'].reads).toBe(1);
    expect(activity.agents['a1'].writes).toBe(0);
  });

  it('records a write operation', () => {
    useCommandCenterStore.getState().recordFileOp('/src/index.ts', 'index.ts', 'a1', 'Claude', 'claude-code', 'write');
    const agent = useCommandCenterStore.getState().fileActivity['/src/index.ts'].agents['a1'];
    expect(agent.writes).toBe(1);
    expect(agent.reads).toBe(0);
  });

  it('accumulates operations for the same agent and file', () => {
    const { recordFileOp } = useCommandCenterStore.getState();
    recordFileOp('/src/index.ts', 'index.ts', 'a1', 'Claude', 'claude-code', 'read');
    recordFileOp('/src/index.ts', 'index.ts', 'a1', 'Claude', 'claude-code', 'write');
    recordFileOp('/src/index.ts', 'index.ts', 'a1', 'Claude', 'claude-code', 'read');
    const activity = useCommandCenterStore.getState().fileActivity['/src/index.ts'];
    expect(activity.agents['a1'].reads).toBe(2);
    expect(activity.agents['a1'].writes).toBe(1);
    expect(activity.totalOps).toBe(3);
  });

  it('tracks multiple agents on the same file', () => {
    useCommandCenterStore.getState().recordFileOp('/src/index.ts', 'index.ts', 'a1', 'Claude', 'claude-code', 'read');
    useCommandCenterStore.getState().recordFileOp('/src/index.ts', 'index.ts', 'a2', 'Copilot', 'copilot', 'write');
    const activity = useCommandCenterStore.getState().fileActivity['/src/index.ts'];
    expect(activity.agentCount).toBe(2);
    expect(activity.totalOps).toBe(2);
  });

  it('tracks errors and sets hasErrors flag', () => {
    useCommandCenterStore.getState().recordFileOp('/src/index.ts', 'index.ts', 'a1', 'Claude', 'claude-code', 'error');
    const activity = useCommandCenterStore.getState().fileActivity['/src/index.ts'];
    expect(activity.hasErrors).toBe(true);
    expect(activity.agents['a1'].errors).toBe(1);
  });
});

// ── clearFileActivity ───────────────────────────────────────────────────────

describe('clearFileActivity', () => {
  it('clears all file activity', () => {
    useCommandCenterStore.getState().recordFileOp('/src/index.ts', 'index.ts', 'a1', 'Claude', 'claude-code', 'read');
    useCommandCenterStore.getState().clearFileActivity();
    expect(useCommandCenterStore.getState().fileActivity).toEqual({});
  });
});

// ── clearTimeline ───────────────────────────────────────────────────────────

describe('clearTimeline', () => {
  it('clears all timeline entries', () => {
    useCommandCenterStore.getState().addTimelineEntry({
      ts: Date.now(), agentId: 'a1', agentName: 'Claude', agentType: 'claude-code', kind: 'state', label: 'Test',
    });
    useCommandCenterStore.getState().clearTimeline();
    expect(useCommandCenterStore.getState().timeline).toEqual([]);
  });
});
