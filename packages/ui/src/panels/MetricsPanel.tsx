/**
 * Center panel: tokens, tasks, memory, throughput, latency, tool calls.
 * @event-horizon/ui
 */

import type { FC } from 'react';
import { useCommandCenterStore } from '../store.js';

const labelStyle = { color: '#8899aa', fontSize: 11, marginBottom: 2 };
const gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px 16px' };
const metricStyle = { minWidth: 0 };

export const MetricsPanel: FC = () => {
  const selectedMetrics = useCommandCenterStore((s) => s.selectedMetrics);

  if (!selectedMetrics) {
    return (
      <div data-metrics-panel>
        <div style={labelStyle}>Metrics</div>
        <div style={{ color: '#667' }}>Select an agent</div>
      </div>
    );
  }

  const loadPct = Math.round(selectedMetrics.load * 100);
  const lastUpdated = new Date(selectedMetrics.lastUpdated).toLocaleTimeString();

  return (
    <div data-metrics-panel>
      <div style={{ ...labelStyle, marginBottom: 8 }}>Metrics</div>
      <div style={gridStyle}>
        <div style={metricStyle}>
          <div style={labelStyle}>Load</div>
          <div>{loadPct}%</div>
        </div>
        <div style={metricStyle}>
          <div style={labelStyle}>Tokens</div>
          <div>{selectedMetrics.tokenUsage.toLocaleString()}</div>
        </div>
        <div style={metricStyle}>
          <div style={labelStyle}>Active tasks</div>
          <div>{selectedMetrics.activeTasks}</div>
        </div>
        <div style={metricStyle}>
          <div style={labelStyle}>Errors</div>
          <div>{selectedMetrics.errorCount}</div>
        </div>
        <div style={metricStyle}>
          <div style={labelStyle}>Last updated</div>
          <div>{lastUpdated}</div>
        </div>
      </div>
    </div>
  );
};
