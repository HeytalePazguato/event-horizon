/**
 * Webview entry — mounts renderer + UI, handles events from extension.
 */

import { createRoot } from 'react-dom/client';
import { useState, useEffect, useCallback, useRef, Component, type ReactNode } from 'react';
import { Universe } from '@event-horizon/renderer';
import type { ShipSpawn } from '@event-horizon/renderer';
import { CommandCenter, Tooltip, AchievementToasts, useCommandCenterStore } from '@event-horizon/ui';
import type { AgentState } from '@event-horizon/core';
import type { AgentMetrics } from '@event-horizon/core';

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
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  const [agents, setAgents] = useState<Array<{ id: string; name: string; agentType?: string }>>([]);
  const [metrics, setMetrics] = useState<Record<string, { load: number }>>({});
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
  const selectedAgentId      = useCommandCenterStore((s) => s.selectedAgentId);
  const centerRequestedAt    = useCommandCenterStore((s) => s.centerRequestedAt);
  const pendingConnectAgent  = useCommandCenterStore((s) => s.pendingConnectAgent);
  const clearConnectAgent    = useCommandCenterStore((s) => s.clearConnectAgent);

  // VS Code API (available in webview context only)
  const vscodeRef = useRef<{ postMessage: (msg: unknown) => void } | null>(null);
  if (!vscodeRef.current && typeof (window as unknown as Record<string, unknown>).acquireVsCodeApi === 'function') {
    vscodeRef.current = (window as unknown as { acquireVsCodeApi: () => { postMessage: (msg: unknown) => void } }).acquireVsCodeApi();
  }

  // Handle pending agent connection requests
  useEffect(() => {
    if (!pendingConnectAgent) return;
    if (pendingConnectAgent === 'claude-code') {
      vscodeRef.current?.postMessage({ type: 'setup-agent', agentType: 'claude-code' });
    }
    clearConnectAgent();
  }, [pendingConnectAgent, clearConnectAgent]);

  // Achievement tracking state
  const shipLaunchCountRef = useRef(0);
  const abyssTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handler = (e: MessageEvent<EventPayload>) => {
      const msg = e.data;
      if (msg?.type !== 'event' || !msg.payload) return;
      const raw = msg.payload as {
        agentId?: string;
        agentName?: string;
        agentType?: string;
        type?: string;
        timestamp?: number;
        payload?: Record<string, unknown>;
      };
      const agentId = raw.agentId ?? 'unknown';
      const agentName = raw.agentName ?? agentId;
      const agentType = raw.agentType ?? 'unknown';
      const type = raw.type ?? 'agent.spawn';

      // Log every event
      addLog({
        ts: new Date().toLocaleTimeString(),
        agentId,
        agentName,
        type,
      });

      if (type === 'agent.terminate') {
        setAgents((prev) => prev.filter((a) => a.id !== agentId));
        return;
      }

      if (type === 'data.transfer') {
        const toAgentId = raw.payload?.toAgentId as string | undefined;
        if (toAgentId) {
          const shipId = `ship-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          const payloadSize = (raw.payload?.payloadSize as number | undefined) ?? 1;
          setShips((prev) => [...prev, { id: shipId, fromAgentId: agentId, toAgentId, payloadSize, fromAgentType: agentType }]);
          // Clean up ship entry after enough time for it to complete its journey
          setTimeout(() => setShips((prev) => prev.filter((s) => s.id !== shipId)), 20000);
        }
        return;
      }

      setAgents((prev) => {
        const has = prev.some((a) => a.id === agentId);
        if (has) return prev;
        return [...prev, { id: agentId, name: agentName, agentType }];
      });
      setAgentMap((prev) => ({
        ...prev,
        [agentId]: {
          id: agentId,
          name: agentName,
          type: agentType,
          state: type === 'agent.error' ? 'error' : type === 'task.start' ? 'thinking' : 'idle',
          currentTaskId: (raw.payload?.taskId as string | null) ?? null,
        },
      }));
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  useEffect(() => {
    const handler = (e: MessageEvent<EventPayload>) => {
      const msg = e.data;
      if (msg?.type !== 'event' || !msg.payload) return;
      const event = msg.payload as {
        agentId: string;
        type: string;
        payload?: { tokens?: number; inputTokens?: number; outputTokens?: number };
      };
      const load = event.type === 'task.progress' || event.type === 'tool.call' ? 0.7 : 0.3;
      setMetrics((prev) => ({
        ...prev,
        [event.agentId]: {
          load: prev[event.agentId] ? (prev[event.agentId].load * 0.9 + load * 0.1) : load,
        },
      }));
      const tokens = (event.payload?.tokens ?? 0) as number
        + ((event.payload?.inputTokens as number) ?? 0)
        + ((event.payload?.outputTokens as number) ?? 0);
      setMetricsMap((prev) => {
        const m = prev[event.agentId];
        return {
          ...prev,
          [event.agentId]: {
            agentId: event.agentId,
            load: m ? m.load * 0.9 + (event.type === 'agent.error' ? 0.5 : 0.2) : 0.3,
            tokenUsage: (m?.tokenUsage ?? 0) + tokens,
            activeTasks: m?.activeTasks ?? 0,
            errorCount: m?.errorCount ?? 0,
            lastUpdated: Date.now(),
          },
        };
      });
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // ── Achievement detection ─────────────────────────────────────────────────

  // first_contact / ground_control / the_horde — triggered by agent count
  useEffect(() => {
    if (agents.length >= 1)  unlockAchievement('first_contact');
    if (agents.length >= 3)  unlockAchievement('ground_control');
    if (agents.length >= 10) unlockAchievement('the_horde');
  }, [agents.length, unlockAchievement]);

  // supernova — any agent enters error state
  useEffect(() => {
    const hasError = Object.values(agentMap).some((a) => a.state === 'error');
    if (hasError) unlockAchievement('supernova');
  }, [agentMap, unlockAchievement]);

  // traffic_control — count total ships launched
  useEffect(() => {
    if (ships.length === 0) return;
    // Each time a new ship appears in the list we count it
    const newTotal = shipLaunchCountRef.current + ships.length;
    shipLaunchCountRef.current = newTotal;
    if (newTotal >= 10) unlockAchievement('traffic_control');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ships.length]);

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
    unlockAchievement('gravity_well');
  }, [unlockAchievement]);

  const handleAstronautSpawned = useCallback(() => {
    unlockAchievement('lone_astronaut');
  }, [unlockAchievement]);

  const handleUfoAbduction = useCallback(() => {
    unlockAchievement('abduction');
  }, [unlockAchievement]);

  // ── Planet hover / click ──────────────────────────────────────────────────

  useEffect(() => {
    const onMove = (e: MouseEvent) => setMousePos({ x: e.clientX, y: e.clientY });
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
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
      setMetrics((m) => ({ ...m, [a.id]: { load: 0.3 + Math.random() * 0.5 } }));
      setMetricsMap((m) => ({
        ...m,
        [a.id]: {
          agentId: a.id,
          load: 0.3 + Math.random() * 0.5,
          tokenUsage: Math.floor(Math.random() * 5000),
          activeTasks: 0,
          errorCount: 0,
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
      setMetrics((prev) => {
        const next = { ...prev };
        demoAgents.forEach((a) => {
          const prevLoad = prev[a.id]?.load ?? 0.3;
          next[a.id] = { load: Math.min(0.95, prevLoad * 0.7 + 0.2 + Math.random() * 0.5) };
        });
        return next;
      });
      setMetricsMap((prev) => {
        const next = { ...prev };
        demoAgents.forEach((a) => {
          const m = prev[a.id];
          const load = (m?.load ?? 0.3) * 0.9 + 0.1 * Math.random();
          next[a.id] = {
            agentId: a.id,
            load,
            tokenUsage: (m?.tokenUsage ?? 0) + Math.floor(Math.random() * 50),
            activeTasks: m?.activeTasks ?? 0,
            errorCount: m?.errorCount ?? 0,
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
        setTimeout(() => setShips((prev) => prev.filter((s) => s.id !== shipId)), 20000);
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
  }, []);

  // Sync demo simulation with store flag (placed after callbacks are defined)
  useEffect(() => {
    if (demoRequested && !demoSimRunning) {
      runDemoSimulation();
    } else if (!demoRequested && demoSimRunning) {
      stopDemoSimulation();
    }
  }, [demoRequested, demoSimRunning, runDemoSimulation, stopDemoSimulation]);

  useEffect(() => () => {
    if (demoIntervalRef.current) clearInterval(demoIntervalRef.current);
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
          metrics={metrics}
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
            <div style={{ marginTop: 14, textAlign: 'center', color: '#4a6a58', fontSize: 10 }}>
              Click anywhere to close
            </div>
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
    rootEl.innerHTML = `<div style="color:#e88;padding:1em;font-family:system-ui">Error: ${msg}</div>`;
    if (typeof (window as unknown as { __ehScriptLoadError?: (m: string) => void }).__ehScriptLoadError === 'function') {
      (window as unknown as { __ehScriptLoadError: (m: string) => void }).__ehScriptLoadError('Error: ' + msg);
    }
  }
}
