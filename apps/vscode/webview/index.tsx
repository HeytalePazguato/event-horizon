/**
 * Webview entry — mounts renderer + UI, handles events from extension.
 */

import { createRoot } from 'react-dom/client';
import { useState, useEffect, useCallback, useRef, useMemo, Component, type ReactNode } from 'react';
import { Universe } from '@event-horizon/renderer';
import type { ShipSpawn } from '@event-horizon/renderer';
import { CommandCenter, Tooltip, AchievementToasts, useCommandCenterStore, clearAllBoostTimers } from '@event-horizon/ui';
import type { AgentState } from '@event-horizon/core';
import type { AgentMetrics } from '@event-horizon/core';

// acquireVsCodeApi() may only be called once per webview lifetime — call at module level.
const vscodeApi = ((): { postMessage: (msg: unknown) => void } | null => {
  const w = window as unknown as Record<string, unknown>;
  if (typeof w['acquireVsCodeApi'] === 'function') {
    return (w['acquireVsCodeApi'] as () => { postMessage: (msg: unknown) => void })();
  }
  return null;
})();

function usePanelSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 640, height: 400 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth || 640;
      const h = el.clientHeight || 400;
      if (w > 0 && h > 0) setSize({ width: w, height: h });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, ...size };
}

function useRandomStars(count: number) {
  const [stars] = useState(() =>
    Array.from({ length: count }, () => ({
      x: Math.random() * 100,
      y: Math.random() * 100,
      r: 0.3 + Math.random() * 1.2,
      opacity: 0.2 + Math.random() * 0.8,
    }))
  );
  return stars;
}

function RandomStarfield() {
  const stars = useRandomStars(180);
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 0,
        overflow: 'hidden',
      }}
      aria-hidden
    >
      {stars.map((s, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: s.r * 4,
            height: s.r * 4,
            borderRadius: '50%',
            background: `rgba(255,255,255,${s.opacity})`,
            boxShadow: s.r > 1 ? `0 0 ${s.r * 2}px rgba(255,255,255,${s.opacity * 0.5})` : undefined,
          }}
        />
      ))}
    </div>
  );
}

interface EventPayload {
  type: string;
  payload?: unknown;
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 16, color: '#e88', fontFamily: 'system-ui', fontSize: 13, background: '#1a0a0a' }}>
          <strong>Event Horizon error</strong>: {this.state.error}
          <br />
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            style={{ marginTop: 10, padding: '4px 12px', background: '#2a1a1a', border: '1px solid #c66', color: '#e88', cursor: 'pointer', fontSize: 12 }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  const [agents, setAgents] = useState<Array<{ id: string; name: string; agentType?: string; cwd?: string }>>([]);
  const [connectedAgentTypes, setConnectedAgentTypes] = useState<string[]>(() => {
    // 1.6 — read initial state from data attribute set by the extension host
    try {
      const el = document.getElementById('root');
      const raw = el?.dataset['ehInit'];
      if (raw) return (JSON.parse(raw) as { connectedAgents: string[] }).connectedAgents ?? [];
    } catch { /* ignore */ }
    return [];
  });
  const [extensionVersion] = useState<string>(() => {
    try {
      const el = document.getElementById('root');
      const raw = el?.dataset['ehInit'];
      if (raw) return (JSON.parse(raw) as { version?: string }).version ?? '';
    } catch { /* ignore */ }
    return '';
  });
  const [agentMap, setAgentMap] = useState<Record<string, AgentState>>({});
  const [metricsMap, setMetricsMap] = useState<Record<string, AgentMetrics>>({});
  const [ships, setShips] = useState<ShipSpawn[]>([]);
  const [hoveredAgentId, setHoveredAgentId] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const setSelectedAgentData = useCommandCenterStore((s) => s.setSelectedAgentData);
  const addLog               = useCommandCenterStore((s) => s.addLog);
  const pausedAgentIds       = useCommandCenterStore((s) => s.pausedAgentIds);
  const isolatedAgentId      = useCommandCenterStore((s) => s.isolatedAgentId);
  const boostedAgentIds      = useCommandCenterStore((s) => s.boostedAgentIds);
  const demoRequested        = useCommandCenterStore((s) => s.demoRequested);
  const infoOpen             = useCommandCenterStore((s) => s.infoOpen);
  const toggleInfo           = useCommandCenterStore((s) => s.toggleInfo);
  const unlockAchievement    = useCommandCenterStore((s) => s.unlockAchievement);
  const incrementTiered      = useCommandCenterStore((s) => s.incrementTieredAchievement);
  const selectedAgentId      = useCommandCenterStore((s) => s.selectedAgentId);
  const centerRequestedAt    = useCommandCenterStore((s) => s.centerRequestedAt);
  const connectOpen          = useCommandCenterStore((s) => s.connectOpen);
  const toggleConnect        = useCommandCenterStore((s) => s.toggleConnect);
  const spawnOpen            = useCommandCenterStore((s) => s.spawnOpen);
  const toggleSpawn          = useCommandCenterStore((s) => s.toggleSpawn);
  const selectSingularity    = useCommandCenterStore((s) => s.selectSingularity);
  const incrementStat        = useCommandCenterStore((s) => s.incrementSingularityStat);
  const singularityStats     = useCommandCenterStore((s) => s.singularityStats);


  // Achievement tracking state
  const abyssTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track last event time per agent for stale-agent timeout
  const agentLastSeenRef = useRef<Record<string, number>>({});
  const agentMapRef = useRef(agentMap);
  agentMapRef.current = agentMap;
  // Track last tool event timestamp per agent — used to suppress stale permission_prompt notifications
  const shipTimerIdsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  // Single merged message handler — 2.6: eliminates duplicate event processing
  useEffect(() => {
    const handler = (e: MessageEvent<EventPayload>) => {
      const msg = e.data;

      // connected-agents: update hook install state
      if (msg?.type === 'connected-agents') {
        setConnectedAgentTypes((msg as unknown as { agentTypes: string[] }).agentTypes ?? []);
        return;
      }

      // init-state: hydrate from extension host accumulated state on (re)open — 2.2
      if (msg?.type === 'init-state') {
        clearAllBoostTimers(); // Clear stale boost timers from previous webview lifecycle
        const init = msg as unknown as { agents: AgentState[]; metrics: AgentMetrics[] };
        setAgents(init.agents.map((a) => ({ id: a.id, name: a.name, agentType: a.type, cwd: a.cwd })));
        setAgentMap(Object.fromEntries(init.agents.map((a) => [a.id, a])));
        setMetricsMap(Object.fromEntries(init.metrics.map((m) => [m.agentId, m])));
        return;
      }

      // init-medals: hydrate persisted achievements from extension globalState
      if (msg?.type === 'init-medals') {
        const data = msg as unknown as { unlockedAchievements: string[]; achievementTiers: Record<string, number>; achievementCounts: Record<string, number> };
        if (data.unlockedAchievements?.length > 0) {
          useCommandCenterStore.setState({
            unlockedAchievements: data.unlockedAchievements,
            achievementTiers: data.achievementTiers ?? {},
            achievementCounts: data.achievementCounts ?? {},
          });
        }
        return;
      }

      // init-singularity: hydrate persisted singularity stats
      if (msg?.type === 'init-singularity') {
        const data = msg as unknown as { stats: import('@event-horizon/ui').SingularityStats };
        if (data.stats) {
          useCommandCenterStore.getState().setSingularityStats(data.stats);
        }
        return;
      }

      if (msg?.type !== 'event' || !msg.payload) return;

      const raw = msg.payload as {
        agentId?: string;
        agentName?: string;
        agentType?: string;
        type?: string;
        payload?: Record<string, unknown>;
      };
      const agentId = raw.agentId ?? 'unknown';
      const agentName = raw.agentName ?? agentId;
      const agentType = raw.agentType ?? 'unknown';
      const type = raw.type ?? 'agent.spawn';

      addLog({ ts: new Date().toLocaleTimeString(), agentId, agentName, type });

      // ── Singularity stats tracking ──
      const store = useCommandCenterStore.getState();
      if (!store.singularityStats.firstEventAt) store.incrementSingularityStat('firstEventAt');
      store.incrementSingularityStat('eventsWitnessed');
      if (type === 'agent.error') store.incrementSingularityStat('errorsWitnessed');
      // agentsSeen is now tracked at upsert time (below) to catch all agent types

      // agent.terminate: clean up all state for this agent — 2.4
      if (type === 'agent.terminate') {
        store.incrementSingularityStat('planetsSwallowed');
        setAgents((prev) => prev.filter((a) => a.id !== agentId));
        setAgentMap((prev) => { const n = { ...prev }; delete n[agentId]; return n; });
        setMetricsMap((prev) => { const n = { ...prev }; delete n[agentId]; return n; });
        delete agentLastSeenRef.current[agentId];
        return;
      }

      if (type === 'data.transfer') {
        const toAgentId = raw.payload?.toAgentId as string | undefined;
        if (toAgentId) {
          const shipId = `ship-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          const payloadSize = (raw.payload?.payloadSize as number | undefined) ?? 1;
          setShips((prev) => [...prev, { id: shipId, fromAgentId: agentId, toAgentId, payloadSize, fromAgentType: agentType }]);
          store.incrementSingularityStat('shipsObserved');
          const timerId = setTimeout(() => {
            setShips((prev) => prev.filter((s) => s.id !== shipId));
            shipTimerIdsRef.current.delete(timerId);
          }, 20000);
          shipTimerIdsRef.current.add(timerId);
        }
        return;
      }

      // Upsert agent — fire agent_connected when a genuinely new agent appears
      const eventCwd = raw.payload?.cwd as string | undefined;
      setAgents((prev) => {
        const existing = prev.find((a) => a.id === agentId);
        if (existing) {
          // Update cwd if it wasn't set yet
          if (eventCwd && !existing.cwd) {
            return prev.map((a) => a.id === agentId ? { ...a, cwd: eventCwd } : a);
          }
          return prev;
        }
        store.incrementTieredAchievement('agent_connected');
        store.incrementSingularityStat('agentsSeen');
        return [...prev, { id: agentId, name: agentName, agentType, cwd: eventCwd }];
      });
      setAgentMap((prev) => {
        const prevAgent = prev[agentId];

        let state: string;
        if (type === 'agent.error') state = 'error';
        else if (type === 'agent.waiting') state = 'waiting';
        else if (type === 'task.start') state = 'thinking';
        else if (type === 'tool.call') state = 'tool_use';
        else if (type === 'task.progress') state = 'working';
        else if (type === 'tool.result') state = 'thinking';
        else if (type === 'task.complete' || type === 'task.fail') state = 'idle';
        else if (type === 'agent.spawn') state = 'idle';
        else state = prevAgent?.state ?? 'idle';  // preserve current state for unknown events

        // Debug: log state transitions
        const prevState = prevAgent?.state ?? '(new)';
        if (state !== prevState) {
          console.log(`[EH webview] ${agentId.slice(0, 12)} state: ${prevState} → ${state} (event=${type}, tool=${raw.payload?.toolName ?? '-'})`);
        }

        // Capture cwd from payload for workspace-aware cooperation detection
        const cwd = (raw.payload?.cwd as string | undefined) ?? prevAgent?.cwd;

        return {
          ...prev,
          [agentId]: {
            id: agentId,
            name: agentName,
            type: agentType,
            state,
            currentTaskId: (raw.payload?.taskId as string | null) ?? prevAgent?.currentTaskId ?? null,
            cwd,
          },
        };
      });

      // Update metrics — all hook-derivable counters tracked here
      const isHighLoad = type === 'task.progress' || type === 'tool.call' || type === 'tool.result';
      const loadTarget = isHighLoad ? 0.7 : 0.3;
      const isSubagent = !!(raw.payload?.isSubagent);
      const isToolFailure = !!(raw.payload?.isToolFailure);
      const toolName = (raw.payload?.toolName as string) ?? undefined;
      // Track last event time for stale-agent detection
      agentLastSeenRef.current[agentId] = Date.now();
      setMetricsMap((prev) => {
        const m = prev[agentId];
        const isTaskStart = type === 'task.start' && !isSubagent;
        const isTaskEnd = (type === 'task.complete' || type === 'task.fail') && !isSubagent;
        const activeTasks = isTaskStart
          ? (m?.activeTasks ?? 0) + 1
          : isTaskEnd
            ? Math.max(0, (m?.activeTasks ?? 0) - 1)
            : (m?.activeTasks ?? 0);
        const activeSubagents = (type === 'task.start' && isSubagent)
          ? (m?.activeSubagents ?? 0) + 1
          : ((type === 'task.complete' || type === 'task.fail') && isSubagent)
            ? Math.max(0, (m?.activeSubagents ?? 0) - 1)
            : (m?.activeSubagents ?? 0);
        const tb = { ...(m?.toolBreakdown ?? {}) };
        if (type === 'tool.call' && toolName) tb[toolName] = (tb[toolName] ?? 0) + 1;
        return {
          ...prev,
          [agentId]: {
            agentId,
            load: (m?.load ?? 0.3) * 0.9 + loadTarget * 0.1,
            toolCalls: (m?.toolCalls ?? 0) + (type === 'tool.call' ? 1 : 0),
            toolFailures: (m?.toolFailures ?? 0) + (isToolFailure ? 1 : 0),
            promptsSubmitted: (m?.promptsSubmitted ?? 0) + (isTaskStart ? 1 : 0),
            subagentSpawns: (m?.subagentSpawns ?? 0) + (type === 'task.start' && isSubagent ? 1 : 0),
            activeSubagents,
            activeTasks,
            errorCount: type === 'agent.error' ? (m?.errorCount ?? 0) + 1 : (m?.errorCount ?? 0),
            sessionStartedAt: m?.sessionStartedAt ?? (type === 'agent.spawn' ? Date.now() : Date.now()),
            toolBreakdown: tb,
            lastUpdated: Date.now(),
          },
        };
      });
    };
    window.addEventListener('message', handler);
    // Signal the extension host that the webview is ready to receive messages
    vscodeApi?.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', handler);
  }, [addLog]);

  // ── Keep selectedMetrics/selectedAgent in sync with live data ────────────
  useEffect(() => {
    if (!selectedAgentId) return;
    const agent = agentMap[selectedAgentId];
    const metric = metricsMap[selectedAgentId];
    if (agent || metric) {
      setSelectedAgentData(agent ?? null, metric ?? null);
    }
  }, [selectedAgentId, agentMap, metricsMap, setSelectedAgentData]);

  // ── Persist medal state to extension host globalState ──
  const unlockedAchievements = useCommandCenterStore((s) => s.unlockedAchievements);
  const achievementTiers = useCommandCenterStore((s) => s.achievementTiers);
  const achievementCounts = useCommandCenterStore((s) => s.achievementCounts);
  useEffect(() => {
    if (unlockedAchievements.length === 0) return;
    vscodeApi?.postMessage({
      type: 'persist-medals',
      unlockedAchievements,
      achievementTiers,
      achievementCounts,
    });
  }, [unlockedAchievements, achievementTiers, achievementCounts]);

  // ── Persist singularity stats to extension host globalState ──
  useEffect(() => {
    if (!singularityStats.firstEventAt) return;
    vscodeApi?.postMessage({ type: 'persist-singularity', stats: singularityStats });
  }, [singularityStats]);

  // ── Stale-agent safety net — fallback cleanup if exit signal was missed ──
  // Only reaps agents that lack a proper exit signal (e.g. Copilot passive listener).
  // Claude Code (sends SessionEnd) and OpenCode (sends session.deleted) are excluded.
  const AGENTS_WITH_EXIT_SIGNAL = new Set(['claude-code', 'opencode']);
  useEffect(() => {
    const STALE_TIMEOUT_MS = 300_000; // 5 minutes — generous for agents without exit signals
    const CHECK_INTERVAL_MS = 30_000;
    const iv = setInterval(() => {
      const now = Date.now();
      for (const [agentId, lastSeen] of Object.entries(agentLastSeenRef.current)) {
        const agent = agentMapRef.current[agentId];
        if (!agent) continue;
        // Skip agents that send explicit terminate events
        if (AGENTS_WITH_EXIT_SIGNAL.has(agent.type)) continue;
        if (now - lastSeen > STALE_TIMEOUT_MS) {
          setAgents((prev) => prev.filter((a) => a.id !== agentId));
          setAgentMap((prev) => { const n = { ...prev }; delete n[agentId]; return n; });
          setMetricsMap((prev) => { const n = { ...prev }; delete n[agentId]; return n; });
          delete agentLastSeenRef.current[agentId];
        }
      }
    }, CHECK_INTERVAL_MS);
    return () => clearInterval(iv);
  }, []);

  // ── Achievement detection ─────────────────────────────────────────────────

  // first_contact / ground_control / the_horde — triggered by agent count
  useEffect(() => {
    if (agents.length >= 1)  unlockAchievement('first_contact');
    if (agents.length >= 3)  unlockAchievement('ground_control');
    if (agents.length >= 10) unlockAchievement('the_horde');
  }, [agents.length, unlockAchievement]);

  // supernova — any agent enters error state (now tiered)
  const prevErrorCountRef = useRef(0);
  useEffect(() => {
    const errorCount = Object.values(agentMap).filter((a) => a.state === 'error').length;
    if (errorCount > prevErrorCountRef.current) {
      for (let i = 0; i < errorCount - prevErrorCountRef.current; i++) incrementTiered('supernova');
    }
    prevErrorCountRef.current = errorCount;
  }, [agentMap, incrementTiered]);

  // traffic_control — count total ships launched (now tiered)
  const prevShipCountRef = useRef(0);
  useEffect(() => {
    const current = ships.length;
    const prev = prevShipCountRef.current;
    if (current > prev) {
      for (let i = 0; i < current - prev; i++) incrementTiered('traffic_control');
    }
    prevShipCountRef.current = current;
  }, [ships.length, incrementTiered]);

  // abyss — selected an agent and kept it selected for 60 seconds
  useEffect(() => {
    if (abyssTimerRef.current) clearTimeout(abyssTimerRef.current);
    if (selectedAgentId) {
      abyssTimerRef.current = setTimeout(() => unlockAchievement('abyss'), 60_000);
    }
    return () => {
      if (abyssTimerRef.current) clearTimeout(abyssTimerRef.current);
    };
  }, [selectedAgentId, unlockAchievement]);

  const handleAstronautConsumed = useCallback(() => {
    incrementTiered('gravity_well');
    incrementStat('astronautsConsumed');
  }, [incrementTiered, incrementStat]);

  const handleAstronautSpawned = useCallback(() => {
    unlockAchievement('lone_astronaut');
  }, [unlockAchievement]);

  const handleUfoAbduction = useCallback(() => {
    incrementTiered('abduction');
    incrementStat('cowsAbducted');
  }, [incrementTiered, incrementStat]);

  const handleUfoClicked = useCallback(() => {
    incrementTiered('ufo_hunter');
  }, [incrementTiered]);

  const handleSingularityClick = useCallback(() => {
    selectSingularity();
  }, [selectSingularity]);

  const handleUfoConsumed = useCallback(() => {
    incrementStat('ufosConsumed');
  }, [incrementStat]);

  const handleAstronautTrapped = useCallback(() => {
    incrementTiered('event_horizon');
  }, [incrementTiered]);

  const handleAstronautEscaped = useCallback(() => {
    incrementTiered('slingshot');
  }, [incrementTiered]);

  const handleAstronautBounced = useCallback((astronautId: number, bounceCount: number, edgesHit: Set<string>) => {
    if (bounceCount >= 4) unlockAchievement('bouncy_boy');
    if (edgesHit.size >= 4) unlockAchievement('traveler');
  }, [unlockAchievement]);

  const handleRocketMan = useCallback(() => {
    incrementTiered('rocket_man');
  }, [incrementTiered]);

  const handleTrickShot = useCallback(() => {
    incrementTiered('trick_shot');
  }, [incrementTiered]);

  const handleKamikaze = useCallback(() => {
    incrementTiered('kamikaze');
  }, [incrementTiered]);

  const handleCowDrop = useCallback(() => {
    incrementTiered('cow_drop');
  }, [incrementTiered]);

  const handleShootingStarClicked = useCallback(() => {
    incrementTiered('star_catcher');
  }, [incrementTiered]);

  const handleAstronautGrazed = useCallback(() => {
    incrementTiered('grazing_shot');
  }, [incrementTiered]);

  const handleAstronautLanded = useCallback((agentId: string) => {
    const agent = agents.find((a) => a.id === agentId);
    const type = agent?.agentType ?? 'unknown';
    const achievementMap: Record<string, string> = {
      'claude-code': 'conqueror_claude',
      'opencode': 'conqueror_opencode',
      'copilot': 'conqueror_copilot',
      'unknown': 'conqueror_unknown',
    };
    const id = achievementMap[type] ?? 'conqueror_unknown';
    unlockAchievement(id);
  }, [agents, unlockAchievement]);

  // ── Planet hover / click ──────────────────────────────────────────────────

  useEffect(() => {
    let rafId = 0;
    const onMove = (e: MouseEvent) => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        setMousePos({ x: e.clientX, y: e.clientY });
        rafId = 0;
      });
    };
    window.addEventListener('mousemove', onMove);
    return () => {
      window.removeEventListener('mousemove', onMove);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  const handlePlanetHover = useCallback((agentId: string | null) => {
    setHoveredAgentId(agentId);
  }, []);

  const handlePlanetClick = useCallback((agentId: string) => {
    const agent = agentMap[agentId];
    const metric = metricsMap[agentId];
    setSelectedAgentData(agent ?? null, metric ?? null);
  }, [agentMap, metricsMap, setSelectedAgentData]);

  const hoveredAgent = hoveredAgentId ? agentMap[hoveredAgentId] : null;
  const hoveredMetrics = hoveredAgentId ? metricsMap[hoveredAgentId] : null;
  const panelSize = usePanelSize();

  const hasAgents = agents.length > 0;
  const agentStates = Object.fromEntries(
    Object.entries(agentMap).map(([k, v]) => [k, v.state ?? 'idle'])
  );

  // Memoize derived props to avoid unnecessary re-renders (audit 2.4/2.5)
  const metricsView = useMemo(
    () => Object.fromEntries(Object.entries(metricsMap).map(([k, v]) => [k, { load: v.load }])),
    [metricsMap],
  );
  const activeSubagentsView = useMemo(
    () => Object.fromEntries(Object.entries(metricsMap).map(([k, v]) => [k, v.activeSubagents ?? 0])),
    [metricsMap],
  );

  const [demoSimRunning, setDemoSimRunning] = useState(false);
  const demoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const runDemoSimulation = useCallback(() => {
    const demoAgents = [
      { id: 'demo-opencode', name: 'OpenCode', agentType: 'opencode' },
      { id: 'demo-claude',   name: 'Claude',   agentType: 'claude-code' },
      { id: 'demo-copilot',  name: 'Copilot',  agentType: 'copilot' },
      { id: 'demo-cursor',   name: 'Cursor',   agentType: 'cursor' },
      { id: 'demo-agent',    name: 'Agent',    agentType: 'unknown' },
    ];
    setAgents((prev) => {
      const existing = new Set(prev.map((a) => a.id));
      const toAdd = demoAgents.filter((a) => !existing.has(a.id));
      return toAdd.length ? [...prev, ...toAdd] : prev;
    });
    const demoAgentTypeMap = Object.fromEntries(demoAgents.map((a) => [a.id, a.agentType]));
    demoAgents.forEach((a) => {
      setAgentMap((m) => ({
        ...m,
        [a.id]: {
          id: a.id,
          name: a.name,
          type: a.agentType,
          state: 'idle',
          currentTaskId: null,
        },
      }));
      setMetricsMap((m) => ({
        ...m,
        [a.id]: {
          agentId: a.id,
          load: 0.3 + Math.random() * 0.5,
          toolCalls: Math.floor(Math.random() * 20),
          toolFailures: 0,
          promptsSubmitted: Math.floor(Math.random() * 5),
          subagentSpawns: Math.floor(Math.random() * 3),
          activeSubagents: Math.random() < 0.3 ? 1 : 0,
          activeTasks: 0,
          errorCount: 0,
          sessionStartedAt: Date.now() - Math.floor(Math.random() * 300000),
          toolBreakdown: { Read: 5, Write: 3, Bash: 2, Edit: 4 },
          lastUpdated: Date.now(),
        },
      }));
    });
    if (demoIntervalRef.current) clearInterval(demoIntervalRef.current);
    demoIntervalRef.current = setInterval(() => {
      setAgentMap((prev) => {
        const next = { ...prev };
        demoAgents.forEach((a) => {
          const s = next[a.id];
          if (!s) return;
          next[a.id] = {
            ...s,
            state: Math.random() > 0.6 ? (s.state === 'thinking' ? 'idle' : 'thinking') : s.state,
            currentTaskId: s.state === 'thinking' ? 'task-' + Date.now() : null,
          };
        });
        return next;
      });
      setMetricsMap((prev) => {
        const next = { ...prev };
        demoAgents.forEach((a) => {
          const m = prev[a.id];
          const load = (m?.load ?? 0.3) * 0.9 + 0.1 * Math.random();
          // Occasionally toggle subagents for demo moons
          let activeSubagents = m?.activeSubagents ?? 0;
          if (Math.random() < 0.15) activeSubagents = Math.min(4, activeSubagents + 1);
          if (Math.random() < 0.1 && activeSubagents > 0) activeSubagents -= 1;
          next[a.id] = {
            ...m!,
            load,
            toolCalls: (m?.toolCalls ?? 0) + (Math.random() < 0.3 ? 1 : 0),
            activeSubagents,
            lastUpdated: Date.now(),
          };
        });
        return next;
      });
      // Occasionally spawn a demo ship between two random agents
      if (Math.random() < 0.35) {
        const ids = demoAgents.map((a) => a.id);
        const fromIdx = Math.floor(Math.random() * ids.length);
        let toIdx = Math.floor(Math.random() * (ids.length - 1));
        if (toIdx >= fromIdx) toIdx++;
        const shipId = `demo-ship-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        setShips((prev) => [
          ...prev,
          { id: shipId, fromAgentId: ids[fromIdx], toAgentId: ids[toIdx], payloadSize: Math.floor(Math.random() * 10) + 1, fromAgentType: demoAgentTypeMap[ids[fromIdx]] },
        ]);
        const timerId = setTimeout(() => {
          setShips((prev) => prev.filter((s) => s.id !== shipId));
          shipTimerIdsRef.current.delete(timerId);
        }, 20000);
        shipTimerIdsRef.current.add(timerId);
      }
    }, 1400);
    setDemoSimRunning(true);
  }, []);

  const stopDemoSimulation = useCallback(() => {
    if (demoIntervalRef.current) {
      clearInterval(demoIntervalRef.current);
      demoIntervalRef.current = null;
    }
    setDemoSimRunning(false);
    setAgents((prev) => prev.filter((a) => !a.id.startsWith('demo-')));
    setShips((prev) => prev.filter((s) => !s.id.startsWith('demo-ship-')));
    // Clean up demo agent entries from lastSeen tracking
    for (const id of Object.keys(agentLastSeenRef.current)) {
      if (id.startsWith('demo-')) delete agentLastSeenRef.current[id];
    }
  }, []);

  // Sync demo simulation with store flag (placed after callbacks are defined)
  useEffect(() => {
    if (demoRequested && !demoSimRunning) {
      unlockAchievement('demo_activated');
      useCommandCenterStore.getState().setDemoMode(true);
      runDemoSimulation();
    } else if (!demoRequested && demoSimRunning) {
      stopDemoSimulation();
      useCommandCenterStore.getState().setDemoMode(false);
    }
  }, [demoRequested, demoSimRunning, runDemoSimulation, stopDemoSimulation, unlockAchievement]);

  useEffect(() => () => {
    if (demoIntervalRef.current) clearInterval(demoIntervalRef.current);
  }, []);

  // Clean up ship timers on unmount
  useEffect(() => () => {
    for (const id of shipTimerIdsRef.current) clearTimeout(id);
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        minHeight: 380,
        flex: 1,
        background: 'transparent',
      }}
    >
      <div
        ref={panelSize.ref}
        style={{ flex: 1, minHeight: 0, position: 'relative', background: 'transparent' }}
      >
        <RandomStarfield />
        <Universe
          width={panelSize.width}
          height={panelSize.height}
          agents={agents}
          metrics={metricsView}
          activeSubagents={activeSubagentsView}
          ships={ships}
          agentStates={agentStates}
          pausedAgentIds={pausedAgentIds}
          isolatedAgentId={isolatedAgentId}
          boostedAgentIds={boostedAgentIds}
          selectedAgentId={selectedAgentId}
          centerRequestedAt={centerRequestedAt}
          onPlanetHover={handlePlanetHover}
          onPlanetClick={handlePlanetClick}
          onAstronautConsumed={handleAstronautConsumed}
          onAstronautSpawned={handleAstronautSpawned}
          onUfoAbduction={handleUfoAbduction}
          onUfoClicked={handleUfoClicked}
          onSingularityClick={handleSingularityClick}
          onUfoConsumed={handleUfoConsumed}
          onAstronautTrapped={handleAstronautTrapped}
          onAstronautEscaped={handleAstronautEscaped}
          onAstronautGrazed={handleAstronautGrazed}
          onAstronautLanded={handleAstronautLanded}
          onAstronautBounced={handleAstronautBounced}
          onRocketMan={handleRocketMan}
          onTrickShot={handleTrickShot}
          onKamikaze={handleKamikaze}
          onCowDrop={handleCowDrop}
          onShootingStarClicked={handleShootingStarClicked}
        />
      </div>
      {!hasAgents && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '40%',
            transform: 'translate(-50%, -50%)',
            textAlign: 'center',
            color: '#3a5a4a',
            fontSize: 11,
            fontFamily: 'Consolas, monospace',
            pointerEvents: 'none',
            zIndex: 5,
          }}
        >
          <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.3 }}>🌌</div>
          <div>No agents yet — press Demo in the Command Center</div>
        </div>
      )}
      <CommandCenter />
      <AchievementToasts />
      {infoOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 300,
            background: 'rgba(0,0,0,0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={toggleInfo}
        >
          <div
            style={{
              background: 'linear-gradient(180deg, #0e1f18 0%, #091510 100%)',
              border: '1px solid #2a5a3c',
              borderRadius: 4,
              padding: '20px 24px',
              maxWidth: 380,
              color: '#b8d4a0',
              fontFamily: 'system-ui',
              fontSize: 12,
              boxShadow: '0 4px 24px rgba(0,0,0,0.7)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 14, fontWeight: 700, color: '#c8e4b0', marginBottom: 14, letterSpacing: '0.05em' }}>
              EVENT HORIZON — Universe Guide
            </div>
            {[
              ['🪐 Planets', 'Each AI coding agent appears as a planet. Its type determines the visual: Claude Code = gas giant (rings + storm), Copilot = icy world, OpenCode = rocky, others = volcanic.'],
              ['⚫ Black Hole', 'The singularity at the center. Astronauts that drift too close are captured and spiral in.'],
              ['🚀 Ships', 'Data transfers between agents are shown as ships flying curved arcs between planets.'],
              ['👨‍🚀 Astronauts', 'Background explorers drifting through the universe. Click empty space to spawn one.'],
              ['🛸 UFO', 'Appears periodically to abduct a cow from one of the planets. Fly-in → beam → fly-away.'],
              ['📡 Command Center', 'Select a planet to see its metrics. Use the command buttons to pause, isolate, or boost agents.'],
            ].map(([title, desc]) => (
              <div key={title as string} style={{ marginBottom: 10 }}>
                <span style={{ color: '#8fc08a', fontWeight: 600 }}>{title as string}</span>
                <span style={{ color: '#7a9a82', marginLeft: 6 }}>{desc as string}</span>
              </div>
            ))}
            {extensionVersion && (
              <div style={{ marginTop: 14, textAlign: 'center', color: '#3a5a48', fontSize: 9, letterSpacing: '0.05em' }}>
                v{extensionVersion}
              </div>
            )}
            <div style={{ marginTop: extensionVersion ? 6 : 14, textAlign: 'center', color: '#4a6a58', fontSize: 10 }}>
              Click anywhere to close
            </div>
          </div>
        </div>
      )}
      {connectOpen && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={toggleConnect}
        >
          <div
            style={{
              background: 'linear-gradient(180deg, #0b1a12 0%, #060e09 100%)',
              border: '1px solid #1e4030',
              padding: '20px 24px',
              width: 360,
              fontFamily: 'Consolas, monospace',
              boxShadow: '0 4px 32px rgba(0,0,0,0.85)',
              clipPath: 'polygon(16px 0, 100% 0, 100% 100%, 0 100%, 0 16px)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ flex: 1, fontSize: 11, fontWeight: 700, color: '#3a9060', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
                Connect Agent
              </div>
              <button type="button" onClick={toggleConnect}
                style={{ background: 'none', border: 'none', color: '#2a5040', cursor: 'pointer', fontSize: 14, padding: 0, lineHeight: 1 }}>✕</button>
            </div>
            {[
              { id: 'claude-code', label: 'Claude Code',    planet: '🟤', status: 'available' as const, desc: 'Installs curl hooks into ~/.claude/settings.json. One click, no token needed.' },
              { id: 'opencode',    label: 'OpenCode',       planet: '🟠', status: 'available' as const, desc: 'Installs a plugin into ~/.config/opencode/plugins/. Restart OpenCode after connecting.' },
              { id: 'copilot',     label: 'GitHub Copilot', planet: '🔵', status: 'available' as const, desc: 'Installs debug hooks into .github/hooks/. Check "Copilot Chat Hooks" output for events.' },
              { id: 'cursor',      label: 'Cursor',         planet: '🩵', status: 'soon'      as const, desc: 'Cursor connector coming soon.' },
              { id: 'ollama',      label: 'Ollama / Local', planet: '⚫', status: 'soon'      as const, desc: 'Local model support coming soon.' },
            ].map((c) => {
              const isConnected = connectedAgentTypes.includes(c.id);
              return (
                <div key={c.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 0', borderBottom: '1px solid rgba(30,70,45,0.35)' }}>
                  <div style={{ fontSize: 18, lineHeight: 1, paddingTop: 1 }}>{c.planet}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: isConnected ? '#70e898' : '#90c088', fontWeight: 700, marginBottom: 2 }}>
                      {c.label}
                      {isConnected && <span style={{ fontSize: 8, color: '#40b868', marginLeft: 6, letterSpacing: '0.06em' }}>● LIVE</span>}
                    </div>
                    <div style={{ fontSize: 9, color: '#3a5a44', lineHeight: 1.4 }}>{c.desc}</div>
                  </div>
                  {isConnected ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
                      <div style={{ fontSize: 9, color: '#40b868', letterSpacing: '0.04em' }}>Connected</div>
                      <button type="button"
                        onClick={() => { vscodeApi?.postMessage({ type: 'remove-agent', agentType: c.id }); }}
                        style={{ padding: '2px 7px', border: '1px solid #4a3030', background: 'rgba(40,15,15,0.8)', color: '#805858', fontSize: 8, cursor: 'pointer' }}>
                        Disconnect
                      </button>
                    </div>
                  ) : c.status === 'available' ? (
                    <button type="button"
                      onClick={() => { vscodeApi?.postMessage({ type: 'setup-agent', agentType: c.id }); toggleConnect(); }}
                      style={{ padding: '4px 10px', border: '1px solid #25904a', background: 'linear-gradient(180deg, #1a3828 0%, #0f2018 100%)', color: '#50c070', fontSize: 10, cursor: 'pointer', flexShrink: 0 }}>
                      Install
                    </button>
                  ) : c.status === 'auto' ? (
                    <div style={{ fontSize: 9, color: '#4a88cc', flexShrink: 0, paddingTop: 2 }}>Auto</div>
                  ) : (
                    <div style={{ fontSize: 9, color: '#2a3a2a', flexShrink: 0, paddingTop: 2 }}>Soon</div>
                  )}
                </div>
              );
            })}
            <div style={{ marginTop: 10, fontSize: 9, color: '#2a4a34', textAlign: 'center' }}>
              Event Horizon listens on port 28765 — any agent on this machine can connect
            </div>
          </div>
        </div>
      )}
      {spawnOpen && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={toggleSpawn}
        >
          <div
            style={{
              background: 'linear-gradient(180deg, #0b1a12 0%, #060e09 100%)',
              border: '1px solid #1e4030',
              padding: '20px 24px',
              width: 340,
              fontFamily: 'Consolas, monospace',
              boxShadow: '0 4px 32px rgba(0,0,0,0.85)',
              clipPath: 'polygon(16px 0, 100% 0, 100% 100%, 0 100%, 0 16px)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ flex: 1, fontSize: 11, fontWeight: 700, color: '#3a9060', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
                Spawn Agent
              </div>
              <button type="button" onClick={toggleSpawn}
                style={{ background: 'none', border: 'none', color: '#2a5040', cursor: 'pointer', fontSize: 14, padding: 0, lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ fontSize: 9, color: '#4a6a50', marginBottom: 12, lineHeight: 1.5 }}>
              Opens a new terminal in the IDE running the selected agent CLI.
            </div>
            {[
              { id: 'claude-code', label: 'Claude Code', cmd: 'claude', planet: '🟤' },
              { id: 'opencode',    label: 'OpenCode',    cmd: 'opencode', planet: '🟠' },
              { id: 'aider',       label: 'Aider',       cmd: 'aider', planet: '🟢' },
            ].map((a) => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid rgba(30,70,45,0.35)' }}>
                <div style={{ fontSize: 16, lineHeight: 1 }}>{a.planet}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: '#90c088', fontWeight: 700 }}>{a.label}</div>
                  <div style={{ fontSize: 9, color: '#3a5a44' }}>$ {a.cmd}</div>
                </div>
                <button type="button"
                  onClick={() => { vscodeApi?.postMessage({ type: 'spawn-agent', command: a.cmd, label: a.label }); toggleSpawn(); }}
                  style={{ padding: '4px 10px', border: '1px solid #25904a', background: 'linear-gradient(180deg, #1a3828 0%, #0f2018 100%)', color: '#50c070', fontSize: 10, cursor: 'pointer', flexShrink: 0 }}>
                  Launch
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      {hoveredAgentId && hoveredAgent && (
        <div
          style={{
            position: 'fixed',
            left: Math.min(mousePos.x + 14, window.innerWidth - 180),
            top: Math.max(mousePos.y - 60, 8),
            zIndex: 1000,
            pointerEvents: 'none',
          }}
        >
          <Tooltip
            agentName={hoveredAgent.name}
            loadPercent={Math.round((hoveredMetrics?.load ?? 0.5) * 100)}
            activeTask={hoveredAgent.currentTaskId}
            cwd={hoveredAgent.cwd}
          />
        </div>
      )}
    </div>
  );
}

const rootEl = document.getElementById('root');
if (rootEl) {
  try {
    const root = createRoot(rootEl);
    root.render(
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    rootEl.textContent = `Error: ${msg}`;
    if (typeof (window as unknown as { __ehScriptLoadError?: (m: string) => void }).__ehScriptLoadError === 'function') {
      (window as unknown as { __ehScriptLoadError: (m: string) => void }).__ehScriptLoadError('Error: ' + msg);
    }
  }
}
