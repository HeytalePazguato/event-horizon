/**
 * Zustand store tests — exercises CommandCenter state management, achievements, and singularity stats.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useCommandCenterStore, clearAllBoostTimers, EMPTY_SINGULARITY_STATS, DEFAULT_VISUAL_SETTINGS } from '../store.js';

// Reset store state before each test
beforeEach(() => {
  clearAllBoostTimers();
  useCommandCenterStore.setState({
    viewMode: 'universe',
    timeline: [],
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
  });
});

// ── Agent selection ──────────────────────────────────────────────────────────

describe('agent selection', () => {
  it('sets selectedAgentId and clears singularity', () => {
    const { setSelectedAgent } = useCommandCenterStore.getState();
    setSelectedAgent('agent-1');
    const s = useCommandCenterStore.getState();
    expect(s.selectedAgentId).toBe('agent-1');
    expect(s.singularitySelected).toBe(false);
  });

  it('clears agent when set to null', () => {
    const { setSelectedAgent } = useCommandCenterStore.getState();
    setSelectedAgent('agent-1');
    setSelectedAgent(null);
    expect(useCommandCenterStore.getState().selectedAgentId).toBeNull();
  });

  it('follows isolation when selecting a new agent', () => {
    const { toggleIsolate, setSelectedAgent } = useCommandCenterStore.getState();
    setSelectedAgent('agent-1');
    toggleIsolate('agent-1');
    expect(useCommandCenterStore.getState().isolatedAgentId).toBe('agent-1');

    setSelectedAgent('agent-2');
    expect(useCommandCenterStore.getState().isolatedAgentId).toBe('agent-2');
  });
});

// ── Singularity ──────────────────────────────────────────────────────────────

describe('singularity', () => {
  it('selectSingularity clears agent and sets flag', () => {
    const store = useCommandCenterStore.getState();
    store.setSelectedAgent('agent-1');
    store.selectSingularity();
    const s = useCommandCenterStore.getState();
    expect(s.singularitySelected).toBe(true);
    expect(s.selectedAgentId).toBeNull();
    expect(s.selectedAgent).toBeNull();
  });

  it('incrementSingularityStat increments numeric stats', () => {
    const { incrementSingularityStat } = useCommandCenterStore.getState();
    incrementSingularityStat('planetsSwallowed');
    incrementSingularityStat('planetsSwallowed');
    incrementSingularityStat('shipsObserved', 5);
    const stats = useCommandCenterStore.getState().singularityStats;
    expect(stats.planetsSwallowed).toBe(2);
    expect(stats.shipsObserved).toBe(5);
  });

  it('firstEventAt is set once and never overwritten', () => {
    const { incrementSingularityStat } = useCommandCenterStore.getState();
    incrementSingularityStat('firstEventAt');
    const first = useCommandCenterStore.getState().singularityStats.firstEventAt;
    expect(first).toBeGreaterThan(0);

    incrementSingularityStat('firstEventAt');
    expect(useCommandCenterStore.getState().singularityStats.firstEventAt).toBe(first);
  });

  it('setSingularityStats replaces the whole object', () => {
    const custom = { ...EMPTY_SINGULARITY_STATS, agentsSeen: 42 };
    useCommandCenterStore.getState().setSingularityStats(custom);
    expect(useCommandCenterStore.getState().singularityStats.agentsSeen).toBe(42);
  });
});

// ── Pause / Isolate / Boost ──────────────────────────────────────────────────

describe('pause, isolate, boost', () => {
  it('togglePause toggles the paused state for an agent', () => {
    const { togglePause } = useCommandCenterStore.getState();
    togglePause('a1');
    expect(useCommandCenterStore.getState().pausedAgentIds['a1']).toBe(true);
    togglePause('a1');
    expect(useCommandCenterStore.getState().pausedAgentIds['a1']).toBe(false);
  });

  it('toggleIsolate sets and clears isolation', () => {
    const { toggleIsolate } = useCommandCenterStore.getState();
    toggleIsolate('a1');
    expect(useCommandCenterStore.getState().isolatedAgentId).toBe('a1');
    toggleIsolate('a1');
    expect(useCommandCenterStore.getState().isolatedAgentId).toBeNull();
  });

  it('toggleIsolate switches to a different agent', () => {
    const { toggleIsolate } = useCommandCenterStore.getState();
    toggleIsolate('a1');
    toggleIsolate('a2');
    expect(useCommandCenterStore.getState().isolatedAgentId).toBe('a2');
  });

  it('triggerBoost sets boosted flag', () => {
    const { triggerBoost } = useCommandCenterStore.getState();
    triggerBoost('a1');
    expect(useCommandCenterStore.getState().boostedAgentIds['a1']).toBe(true);
  });

  it('clearBoost removes the boosted flag', () => {
    const { triggerBoost, clearBoost } = useCommandCenterStore.getState();
    triggerBoost('a1');
    clearBoost('a1');
    expect(useCommandCenterStore.getState().boostedAgentIds['a1']).toBeUndefined();
  });
});

// ── Logs ─────────────────────────────────────────────────────────────────────

describe('logs', () => {
  it('openLogs / closeLogs toggles the flag', () => {
    const { openLogs, closeLogs } = useCommandCenterStore.getState();
    openLogs();
    expect(useCommandCenterStore.getState().logsOpen).toBe(true);
    closeLogs();
    expect(useCommandCenterStore.getState().logsOpen).toBe(false);
  });

  it('addLog prepends entries and caps at 200', () => {
    const { addLog } = useCommandCenterStore.getState();
    for (let i = 0; i < 210; i++) {
      addLog({ id: `log-${i}`, ts: '00:00', agentId: 'a', agentName: 'A', type: 'test' });
    }
    const logs = useCommandCenterStore.getState().logs;
    expect(logs.length).toBe(200);
    // Most recent entry is first
    expect(logs[0].id).toBe('log-209');
  });
});

// ── Achievements ─────────────────────────────────────────────────────────────

describe('achievements', () => {
  it('unlockAchievement adds to unlocked list and creates a toast', () => {
    const { unlockAchievement } = useCommandCenterStore.getState();
    unlockAchievement('first_contact');
    const s = useCommandCenterStore.getState();
    expect(s.unlockedAchievements).toContain('first_contact');
    expect(s.activeToasts).toHaveLength(1);
    expect(s.activeToasts[0].achievementId).toBe('first_contact');
  });

  it('unlockAchievement is idempotent (no-op if already unlocked)', () => {
    const { unlockAchievement } = useCommandCenterStore.getState();
    unlockAchievement('first_contact');
    unlockAchievement('first_contact');
    const s = useCommandCenterStore.getState();
    expect(s.unlockedAchievements.filter((id) => id === 'first_contact')).toHaveLength(1);
    expect(s.activeToasts).toHaveLength(1);
  });

  it('unlockAchievement is blocked during demo mode (except demo_activated)', () => {
    useCommandCenterStore.setState({ demoMode: true });
    const { unlockAchievement } = useCommandCenterStore.getState();
    unlockAchievement('first_contact');
    expect(useCommandCenterStore.getState().unlockedAchievements).toHaveLength(0);

    unlockAchievement('demo_activated');
    expect(useCommandCenterStore.getState().unlockedAchievements).toContain('demo_activated');
  });

  it('incrementTieredAchievement upgrades tier when threshold met', () => {
    // gravity_well has tiers [1, 5, 25] based on the def
    const { incrementTieredAchievement } = useCommandCenterStore.getState();
    incrementTieredAchievement('gravity_well');
    const s = useCommandCenterStore.getState();
    expect(s.achievementCounts['gravity_well']).toBe(1);
    expect(s.achievementTiers['gravity_well']).toBe(0); // first tier reached
    expect(s.unlockedAchievements).toContain('gravity_well');
    expect(s.activeToasts).toHaveLength(1);
  });

  it('incrementTieredAchievement is blocked during demo mode', () => {
    useCommandCenterStore.setState({ demoMode: true });
    const { incrementTieredAchievement } = useCommandCenterStore.getState();
    incrementTieredAchievement('gravity_well');
    expect(useCommandCenterStore.getState().achievementCounts['gravity_well']).toBeUndefined();
  });

  it('dismissToast removes the specified toast', () => {
    const { unlockAchievement, dismissToast } = useCommandCenterStore.getState();
    unlockAchievement('first_contact');
    const toast = useCommandCenterStore.getState().activeToasts[0];
    dismissToast(toast.instanceId);
    expect(useCommandCenterStore.getState().activeToasts).toHaveLength(0);
  });
});

// ── Toggles and misc ─────────────────────────────────────────────────────────

describe('toggles', () => {
  it('toggleInfo flips infoOpen', () => {
    const { toggleInfo } = useCommandCenterStore.getState();
    toggleInfo();
    expect(useCommandCenterStore.getState().infoOpen).toBe(true);
    toggleInfo();
    expect(useCommandCenterStore.getState().infoOpen).toBe(false);
  });

  it('requestDemo flips demoRequested', () => {
    const { requestDemo } = useCommandCenterStore.getState();
    requestDemo();
    expect(useCommandCenterStore.getState().demoRequested).toBe(true);
    requestDemo();
    expect(useCommandCenterStore.getState().demoRequested).toBe(false);
  });

  it('toggleConnect flips connectOpen', () => {
    const { toggleConnect } = useCommandCenterStore.getState();
    toggleConnect();
    expect(useCommandCenterStore.getState().connectOpen).toBe(true);
  });

  it('toggleSpawn flips spawnOpen', () => {
    const { toggleSpawn } = useCommandCenterStore.getState();
    toggleSpawn();
    expect(useCommandCenterStore.getState().spawnOpen).toBe(true);
  });

  it('requestConnectAgent sets pending and closes connect dropdown', () => {
    useCommandCenterStore.setState({ connectOpen: true });
    const { requestConnectAgent } = useCommandCenterStore.getState();
    requestConnectAgent('claude-code');
    const s = useCommandCenterStore.getState();
    expect(s.pendingConnectAgent).toBe('claude-code');
    expect(s.connectOpen).toBe(false);
  });

  it('clearConnectAgent resets pendingConnectAgent', () => {
    useCommandCenterStore.setState({ pendingConnectAgent: 'opencode' });
    useCommandCenterStore.getState().clearConnectAgent();
    expect(useCommandCenterStore.getState().pendingConnectAgent).toBeNull();
  });

  it('requestCenter updates centerRequestedAt', () => {
    const before = Date.now();
    useCommandCenterStore.getState().requestCenter();
    expect(useCommandCenterStore.getState().centerRequestedAt).toBeGreaterThanOrEqual(before);
  });
});

// ── Visual settings ─────────────────────────────────────────────────────────

describe('visual settings', () => {
  it('initializes to DEFAULT_VISUAL_SETTINGS', () => {
    const s = useCommandCenterStore.getState();
    expect(s.visualSettings).toEqual(DEFAULT_VISUAL_SETTINGS);
  });

  it('setAgentColor updates only the target agent color', () => {
    const { setAgentColor } = useCommandCenterStore.getState();
    setAgentColor('claude-code', '#ff0000');
    const s = useCommandCenterStore.getState();
    expect(s.visualSettings['claude-code'].color).toBe('#ff0000');
    expect(s.visualSettings['claude-code'].sizeMult).toBe(DEFAULT_VISUAL_SETTINGS['claude-code'].sizeMult);
    expect(s.visualSettings['copilot']).toEqual(DEFAULT_VISUAL_SETTINGS['copilot']);
  });

  it('setAgentSizeMult clamps to 0.4–2.0 range', () => {
    const { setAgentSizeMult } = useCommandCenterStore.getState();
    setAgentSizeMult('opencode', 0.1);
    expect(useCommandCenterStore.getState().visualSettings['opencode'].sizeMult).toBe(0.4);
    setAgentSizeMult('opencode', 3.0);
    expect(useCommandCenterStore.getState().visualSettings['opencode'].sizeMult).toBe(2.0);
    setAgentSizeMult('opencode', 1.5);
    expect(useCommandCenterStore.getState().visualSettings['opencode'].sizeMult).toBe(1.5);
  });

  it('resetVisualSettings restores defaults', () => {
    const { setAgentColor, resetVisualSettings } = useCommandCenterStore.getState();
    setAgentColor('copilot', '#000000');
    resetVisualSettings();
    expect(useCommandCenterStore.getState().visualSettings).toEqual(DEFAULT_VISUAL_SETTINGS);
  });

  it('setVisualSettings replaces entire object (hydration)', () => {
    const custom = {
      ...DEFAULT_VISUAL_SETTINGS,
      'claude-code': { color: '#112233', sizeMult: 1.8 },
    };
    useCommandCenterStore.getState().setVisualSettings(custom);
    expect(useCommandCenterStore.getState().visualSettings).toEqual(custom);
  });
});

// ── View mode ────────────────────────────────────────────────────────────────

describe('viewMode', () => {
  it('defaults to universe', () => {
    expect(useCommandCenterStore.getState().viewMode).toBe('universe');
  });

  it('toggleViewMode flips between universe and operations', () => {
    useCommandCenterStore.getState().toggleViewMode();
    expect(useCommandCenterStore.getState().viewMode).toBe('operations');
    useCommandCenterStore.getState().toggleViewMode();
    expect(useCommandCenterStore.getState().viewMode).toBe('universe');
  });

  it('setViewMode sets directly', () => {
    useCommandCenterStore.getState().setViewMode('operations');
    expect(useCommandCenterStore.getState().viewMode).toBe('operations');
  });
});

// ── Timeline ─────────────────────────────────────────────────────────────────

describe('timeline', () => {
  const makeEntry = (i: number) => ({
    ts: Date.now() + i,
    agentId: `agent-${i}`,
    agentName: `Agent ${i}`,
    agentType: 'claude-code',
    kind: 'tool' as const,
    label: `tool-${i}`,
  });

  it('addTimelineEntry appends entries', () => {
    useCommandCenterStore.getState().addTimelineEntry(makeEntry(1));
    useCommandCenterStore.getState().addTimelineEntry(makeEntry(2));
    expect(useCommandCenterStore.getState().timeline).toHaveLength(2);
  });

  it('caps at 500 entries', () => {
    for (let i = 0; i < 510; i++) {
      useCommandCenterStore.getState().addTimelineEntry(makeEntry(i));
    }
    expect(useCommandCenterStore.getState().timeline).toHaveLength(500);
    // Oldest entries pruned — first entry should be entry 10
    expect(useCommandCenterStore.getState().timeline[0].label).toBe('tool-10');
  });

  it('clearTimeline empties the buffer', () => {
    useCommandCenterStore.getState().addTimelineEntry(makeEntry(1));
    useCommandCenterStore.getState().clearTimeline();
    expect(useCommandCenterStore.getState().timeline).toHaveLength(0);
  });
});
