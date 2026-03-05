/**
 * Webview entry — mounts renderer + UI, handles events from extension.
 */

import { createRoot } from 'react-dom/client';
import { StrictMode, useState, useEffect, useCallback } from 'react';
import { Universe } from '@event-horizon/renderer';
import { CommandCenter, Tooltip, useCommandCenterStore } from '@event-horizon/ui';
import type { AgentState } from '@event-horizon/core';
import type { AgentMetrics } from '@event-horizon/core';

interface EventPayload {
  type: string;
  payload?: unknown;
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
      const event = msg.payload as {
        agentId: string;
        agentName: string;
        agentType?: string;
        type: string;
        timestamp: number;
        payload?: Record<string, unknown>;
      };
      setAgents((prev) => {
        const has = prev.some((a) => a.id === event.agentId);
        if (has) return prev;
        return [...prev, { id: event.agentId, name: event.agentName }];
      });
      setAgentMap((prev) => ({
        ...prev,
        [event.agentId]: {
          id: event.agentId,
          name: event.agentName,
          type: event.agentType ?? 'unknown',
          state: event.type === 'agent.error' ? 'error' : event.type === 'task.start' ? 'thinking' : 'idle',
          currentTaskId: event.payload?.taskId as string | null ?? null,
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

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: 400 }}>
      <Universe
        width={800}
        height={500}
        agents={agents}
        metrics={metrics}
        selectedAgentId={selectedAgentId}
        onPlanetHover={handlePlanetHover}
        onPlanetClick={handlePlanetClick}
      />
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
  const root = createRoot(rootEl);
  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
