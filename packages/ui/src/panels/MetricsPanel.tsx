/**
 * Center panel: tokens, tasks, metrics + logs + medals tabs.
 * @event-horizon/ui
 */

import type { FC } from 'react';
import { useState } from 'react';
import { useCommandCenterStore } from '../store.js';
import type { LogEntry } from '../store.js';
import { ACHIEVEMENTS, Medal } from '../Achievements.js';

const LogsView: FC<{ entries: LogEntry[] }> = ({ entries }) => (
  <div style={{ fontFamily: 'Consolas, monospace', fontSize: 9, color: '#7a9a82', overflowY: 'auto', maxHeight: 80, lineHeight: 1.5 }}>
    {entries.length === 0 ? (
      <span style={{ color: '#4a5a52' }}>No events yet.</span>
    ) : entries.map((e, i) => (
      <div key={i} style={{ borderBottom: '1px solid rgba(50,80,60,0.3)', paddingBottom: 1, marginBottom: 1 }}>
        <span style={{ color: '#4a8a6a' }}>{e.ts}</span>
        {' '}
        <span style={{ color: '#8ab880' }}>[{e.agentName}]</span>
        {' '}
        <span style={{ color: '#a0c090' }}>{e.type}</span>
      </div>
    ))}
  </div>
);

const MedalsView: FC = () => {
  const unlockedIds = useCommandCenterStore((s) => s.unlockedAchievements);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  if (unlockedIds.length === 0) {
    return <div style={{ color: '#3a5a4a', fontSize: 10, padding: '4px 2px' }}>No medals yet.</div>;
  }

  const hovered = hoveredId ? ACHIEVEMENTS.find((a) => a.id === hoveredId) : null;

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {unlockedIds.map((id) => (
          <div
            key={id}
            onMouseEnter={() => setHoveredId(id)}
            onMouseLeave={() => setHoveredId(null)}
            style={{ cursor: 'default', opacity: hoveredId && hoveredId !== id ? 0.55 : 1 }}
          >
            <Medal id={id} size={28} />
          </div>
        ))}
      </div>
      <div style={{ minHeight: 14, marginTop: 4, fontSize: 9, color: '#a0d090', fontWeight: 600, letterSpacing: '0.04em' }}>
        {hovered ? hovered.name : ''}
      </div>
    </div>
  );
};

const tabStyle = (active: boolean) => ({
  padding: '2px 8px',
  fontSize: 9,
  border: '1px solid #2a4a3a',
  background: active ? 'rgba(50,90,60,0.4)' : 'transparent',
  color: active ? '#8fc08a' : '#6a7a72',
  cursor: 'pointer' as const,
  marginRight: 4,
});

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

type View = 'info' | 'logs' | 'medals';

export const MetricsPanel: FC = () => {
  const selectedMetrics = useCommandCenterStore((s) => s.selectedMetrics);
  const selectedAgentId = useCommandCenterStore((s) => s.selectedAgentId);
  const logsOpen        = useCommandCenterStore((s) => s.logsOpen);
  const closeLogs       = useCommandCenterStore((s) => s.closeLogs);
  const allLogs         = useCommandCenterStore((s) => s.logs);
  const unlockedCount   = useCommandCenterStore((s) => s.unlockedAchievements.length);
  const [view, setView] = useState<View>('info');

  // Sync with store logsOpen flag
  const effectiveView: View = logsOpen ? 'logs' : view;
  const setEffectiveView = (v: View) => {
    setView(v);
    if (v !== 'logs') closeLogs();
  };

  const agentLogs = selectedAgentId
    ? allLogs.filter((l) => l.agentId === selectedAgentId)
    : allLogs;

  const tabs = (
    <div style={{ display: 'flex', marginBottom: 6, gap: 4 }}>
      <button type="button" style={tabStyle(effectiveView === 'info')} onClick={() => setEffectiveView('info')}>Info</button>
      <button type="button" style={tabStyle(effectiveView === 'logs')} onClick={() => setEffectiveView('logs')}>
        Logs{(effectiveView === 'logs' ? agentLogs : allLogs).length > 0 ? ` (${(effectiveView === 'logs' ? agentLogs : allLogs).length})` : ''}
      </button>
      <button type="button" style={tabStyle(effectiveView === 'medals')} onClick={() => setEffectiveView('medals')}>
        Medals{unlockedCount > 0 ? ` (${unlockedCount})` : ''}
      </button>
    </div>
  );

  if (!selectedMetrics) {
    return (
      <div data-metrics-panel>
        {tabs}
        {effectiveView === 'logs' && <LogsView entries={agentLogs} />}
        {effectiveView === 'medals' && <MedalsView />}
        {effectiveView === 'info' && (
          <div style={{ color: '#4a5a52', fontSize: 11, padding: 8, border: '1px dashed #2a4a3a' }}>
            Select an agent
          </div>
        )}
      </div>
    );
  }

  const loadPct = Math.round(selectedMetrics.load * 100);
  const lastUpdated = new Date(selectedMetrics.lastUpdated).toLocaleTimeString();

  return (
    <div data-metrics-panel>
      {tabs}
      {effectiveView === 'logs' && <LogsView entries={agentLogs} />}
      {effectiveView === 'medals' && <MedalsView />}
      {effectiveView === 'info' && (
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
      )}
    </div>
  );
};
