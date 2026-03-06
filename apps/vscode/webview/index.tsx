/**
 * Webview entry — mounts renderer + UI, handles events from extension.
 */

import { createRoot } from 'react-dom/client';
import { useState, useEffect, useCallback, useRef, Component, type ReactNode } from 'react';
import { Universe } from '@event-horizon/renderer';
import { CommandCenter, Tooltip, useCommandCenterStore } from '@event-horizon/ui';
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
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([]);
  const [metrics, setMetrics] = useState<Record<string, { load: number }>>({});
  const [agentMap, setAgentMap] = useState<Record<string, AgentState>>({});
  const [metricsMap, setMetricsMap] = useState<Record<string, AgentMetrics>>({});
  const [hoveredAgentId, setHoveredAgentId] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const setSelectedAgentData = useCommandCenterStore((s) => s.setSelectedAgentData);

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

      if (type === 'task.complete' || type === 'agent.terminate') {
        setAgents((prev) => prev.filter((a) => a.id !== agentId));
        return;
      }

      setAgents((prev) => {
        const has = prev.some((a) => a.id === agentId);
        if (has) return prev;
        return [...prev, { id: agentId, name: agentName }];
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

  const handlePlanetHover = useCallback((agentId: string | null) => {
    setHoveredAgentId(agentId);
  }, []);

  const handlePlanetClick = useCallback((agentId: string) => {
    const agent = agentMap[agentId];
    const metric = metricsMap[agentId];
    setSelectedAgentData(agent ?? null, metric ?? null);
  }, [agentMap, metricsMap, setSelectedAgentData]);

  const selectedAgentId = useCommandCenterStore((s) => s.selectedAgentId);

  const hoveredAgent = hoveredAgentId ? agentMap[hoveredAgentId] : null;
  const hoveredMetrics = hoveredAgentId ? metricsMap[hoveredAgentId] : null;
  const panelSize = usePanelSize();

  const hasAgents = agents.length > 0;
  const [demoSimRunning, setDemoSimRunning] = useState(false);
  const demoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const runDemoSimulation = useCallback(() => {
    const demoAgents = [
      { id: 'demo-opencode', name: 'OpenCode' },
      { id: 'demo-claude', name: 'Claude' },
      { id: 'demo-copilot', name: 'Copilot' },
      { id: 'demo-cursor', name: 'Cursor' },
      { id: 'demo-agent', name: 'Agent' },
    ];
    setAgents((prev) => {
      const existing = new Set(prev.map((a) => a.id));
      const toAdd = demoAgents.filter((a) => !existing.has(a.id));
      return toAdd.length ? [...prev, ...toAdd] : prev;
    });
    demoAgents.forEach((a) => {
      setAgentMap((m) => ({
        ...m,
        [a.id]: {
          id: a.id,
          name: a.name,
          type: 'demo',
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
  }, []);

  useEffect(() => () => {
    if (demoIntervalRef.current) clearInterval(demoIntervalRef.current);
  }, []);

  const psCommand = "$body = '{\"id\":\"t1\",\"agentId\":\"agent-1\",\"agentName\":\"Test Agent\",\"agentType\":\"opencode\",\"type\":\"task.start\",\"timestamp\":' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + ',\"payload\":{}}'; Invoke-RestMethod -Uri http://127.0.0.1:28765/events -Method Post -Body $body -ContentType \"application/json\"";

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
      <header
        style={{
          flexShrink: 0,
          padding: '8px 12px',
          background: 'linear-gradient(180deg, #1a2535 0%, #0f1620 100%)',
          borderBottom: '2px solid #2a4a3a',
          borderTop: '1px solid rgba(80,140,100,0.3)',
          color: '#b8d4a0',
          fontSize: 12,
          fontFamily: 'system-ui',
          boxShadow: 'inset 0 1px 0 rgba(100,180,120,0.12)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <strong style={{ color: '#c8e4b0', textShadow: '0 0 6px rgba(150,220,120,0.25)' }}>COMMAND</strong>
        <span style={{ flex: 1 }}>Agents = planets. Send a test event or run demo.</span>
        {!demoSimRunning ? (
          <button
            type="button"
            onClick={runDemoSimulation}
            style={{
              padding: '4px 10px',
              background: 'linear-gradient(180deg, #2a4a3a 0%, #1a3a2a 100%)',
              border: '1px solid #3a6a4a',
              borderRadius: 2,
              color: '#b8d4a0',
              fontSize: 11,
              cursor: 'pointer',
              boxShadow: 'inset 0 1px 0 rgba(100,180,120,0.2)',
            }}
          >
            Simulate 5 agents
          </button>
        ) : (
          <button
            type="button"
            onClick={stopDemoSimulation}
            style={{
              padding: '4px 10px',
              background: 'linear-gradient(180deg, #3a2a2a 0%, #2a1a1a 100%)',
              border: '1px solid #6a4a4a',
              borderRadius: 2,
              color: '#d4a0a0',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            Stop demo
          </button>
        )}
      </header>
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
          selectedAgentId={selectedAgentId}
          onPlanetHover={handlePlanetHover}
          onPlanetClick={handlePlanetClick}
        />
      </div>
      {!hasAgents && (
        <div
          style={{
            position: 'absolute',
            left: 12,
            right: 12,
            bottom: 148,
            padding: '12px 14px',
            background: 'linear-gradient(180deg, rgba(15,25,35,0.95) 0%, rgba(8,18,28,0.98) 100%)',
            border: '1px solid rgba(80,140,100,0.4)',
            borderRadius: 4,
            color: '#a0c0a8',
            fontSize: 11,
            fontFamily: 'Consolas, monospace',
            boxShadow: 'inset 0 0 20px rgba(0,0,0,0.4), 0 2px 8px rgba(0,0,0,0.3)',
            zIndex: 10,
          }}
        >
          <div style={{ marginBottom: 6, color: '#c8e4b0', fontWeight: 600 }}>How to see agents</div>
          <div style={{ marginBottom: 6, color: '#8899aa' }}>Run the command below in the <strong style={{ color: '#a0c0a8' }}>Extension Development Host</strong> window (the one where this panel is open). Open Terminal there (Ctrl+`), then paste and run:</div>
          <code
            style={{
              display: 'block',
              padding: '8px 10px',
              background: 'rgba(0,0,0,0.5)',
              border: '1px solid rgba(80,140,100,0.3)',
              borderRadius: 2,
              fontSize: 10,
              wordBreak: 'break-all',
              color: '#b8d4a0',
            }}
          >
            {psCommand}
          </code>
          <div style={{ marginTop: 6, color: '#6a8a7a', fontSize: 10 }}>A planet will appear in the universe. Send more events to add more agents.</div>
        </div>
      )}
      <CommandCenter />
      {hoveredAgentId && hoveredAgent && (
        <div
          style={{
            position: 'fixed',
            left: 20,
            top: 20,
            zIndex: 1000,
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
