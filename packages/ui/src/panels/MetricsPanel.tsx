/**
 * Center panel: tokens, tasks, metrics in a StarCraft-style status grid.
 * @event-horizon/ui
 */

import type { FC } from 'react';
import { useCommandCenterStore } from '../store.js';

const labelStyle = {
  color: '#6a8a7a',
  fontSize: 10,
  marginBottom: 2,
  letterSpacing: '0.05em',
  textTransform: 'uppercase' as const,
};
const gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px 14px' };
const cellStyle = {
  minWidth: 0,
  padding: '6px 8px',
  background: 'rgba(0,0,0,0.25)',
  border: '1px solid #1e3328',
  boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.2)',
};

export const MetricsPanel: FC = () => {
  const selectedMetrics = useCommandCenterStore((s) => s.selectedMetrics);

  if (!selectedMetrics) {
    return (
      <div data-metrics-panel>
        <div style={{ ...labelStyle, marginBottom: 8 }}>Status</div>
        <div style={{ color: '#4a5a52', fontSize: 12, padding: 8, border: '1px dashed #2a4a3a' }}>
          Select an agent
        </div>
      </div>
    );
  }

  const loadPct = Math.round(selectedMetrics.load * 100);
  const lastUpdated = new Date(selectedMetrics.lastUpdated).toLocaleTimeString();

  return (
    <div data-metrics-panel>
      <div style={{ ...labelStyle, marginBottom: 8 }}>Status</div>
      <div style={gridStyle}>
        <div style={cellStyle}>
          <div style={labelStyle}>Load</div>
          <div style={{ color: '#b0d0a8', fontWeight: 600 }}>{loadPct}%</div>
        </div>
        <div style={cellStyle}>
          <div style={labelStyle}>Tokens</div>
          <div style={{ color: '#b0d0a8' }}>{selectedMetrics.tokenUsage.toLocaleString()}</div>
        </div>
        <div style={cellStyle}>
          <div style={labelStyle}>Active tasks</div>
          <div style={{ color: '#b0d0a8' }}>{selectedMetrics.activeTasks}</div>
        </div>
        <div style={cellStyle}>
          <div style={labelStyle}>Errors</div>
          <div style={{ color: selectedMetrics.errorCount > 0 ? '#c65858' : '#b0d0a8' }}>
            {selectedMetrics.errorCount}
          </div>
        </div>
        <div style={{ ...cellStyle, gridColumn: 'span 2' }}>
          <div style={labelStyle}>Last updated</div>
          <div style={{ color: '#8a9a8a', fontSize: 12 }}>{lastUpdated}</div>
        </div>
      </div>
    </div>
  );
};
