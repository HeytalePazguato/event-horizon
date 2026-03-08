/**
 * Center panel: agent metrics + logs + medals tabs.
 * @event-horizon/ui
 */

import type { FC } from 'react';
import { useState } from 'react';
import { useCommandCenterStore } from '../store.js';
import type { LogEntry } from '../store.js';
import { ACHIEVEMENTS, Medal, TIER_LABELS, tierBorderColor } from '../Achievements.js';

const LogsView: FC<{ entries: LogEntry[] }> = ({ entries }) => (
  <div style={{ fontFamily: 'Consolas, monospace', fontSize: 9, color: '#7a9a82', overflowY: 'auto', maxHeight: 80, lineHeight: 1.5 }}>
    {entries.length === 0 ? (
      <span style={{ color: '#4a5a52' }}>No events yet.</span>
    ) : entries.map((e) => (
      <div key={e.id} style={{ borderBottom: '1px solid rgba(50,80,60,0.3)', paddingBottom: 1, marginBottom: 1 }}>
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
  const achievementTiers = useCommandCenterStore((s) => s.achievementTiers);
  const achievementCounts = useCommandCenterStore((s) => s.achievementCounts);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  if (unlockedIds.length === 0) {
    return <div style={{ color: '#3a5a4a', fontSize: 10, padding: '4px 2px' }}>No medals yet.</div>;
  }

  const hovered = hoveredId ? ACHIEVEMENTS.find((a) => a.id === hoveredId) : null;
  const hoveredTier = hoveredId ? achievementTiers[hoveredId] : undefined;
  const hoveredCount = hoveredId ? achievementCounts[hoveredId] : undefined;

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {unlockedIds.map((id) => {
          const ach = ACHIEVEMENTS.find((a) => a.id === id);
          const tier = achievementTiers[id];
          const borderColor = ach?.tiers ? tierBorderColor(tier) : undefined;
          return (
            <div
              key={id}
              onMouseEnter={() => setHoveredId(id)}
              onMouseLeave={() => setHoveredId(null)}
              style={{
                cursor: 'default',
                opacity: hoveredId && hoveredId !== id ? 0.55 : 1,
                position: 'relative',
                ...(borderColor ? { border: `2px solid ${borderColor}`, borderRadius: 4, boxShadow: `0 0 6px ${borderColor}66` } : {}),
              }}
            >
              <Medal id={id} size={28} />
              {ach?.tiers && tier != null && (
                <span style={{
                  position: 'absolute',
                  bottom: -3,
                  right: -3,
                  fontSize: 8,
                  fontWeight: 700,
                  color: '#fff',
                  background: borderColor ?? '#444',
                  borderRadius: 2,
                  padding: '0 3px',
                  lineHeight: '12px',
                  textShadow: '0 1px 2px rgba(0,0,0,0.8)',
                }}>
                  {TIER_LABELS[tier] ?? ''}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ minHeight: 14, marginTop: 4, fontSize: 9, color: '#a0d090', fontWeight: 600, letterSpacing: '0.04em' }}>
        {hovered ? (
          <>
            {hovered.name}
            {hovered.tiers && hoveredTier != null ? ` ${TIER_LABELS[hoveredTier]}` : ''}
            {hovered.tiers && hoveredCount != null ? (
              <span style={{ color: '#6a8a72', fontWeight: 400 }}>
                {' '}({hoveredCount}{hoveredTier != null && hoveredTier < hovered.tiers.length - 1 ? ` / ${hovered.tiers[hoveredTier + 1]}` : ''})
              </span>
            ) : null}
          </>
        ) : ''}
      </div>
    </div>
  );
};

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function topTool(breakdown: Record<string, number>): string {
  let best = '';
  let max = 0;
  for (const [name, count] of Object.entries(breakdown)) {
    if (count > max) { max = count; best = name; }
  }
  return best || '-';
}

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
  fontSize: 8,
  marginBottom: 1,
  letterSpacing: '0.05em',
  textTransform: 'uppercase' as const,
};
const gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '3px 4px' };
const cellStyle: React.CSSProperties = {
  minWidth: 0,
  padding: '3px 4px',
  background: 'rgba(0,0,0,0.25)',
  border: '1px solid #1e3328',
  boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.2)',
  overflow: 'hidden',
};
const valStyle: React.CSSProperties = { color: '#b0d0a8', fontSize: 10, fontWeight: 600 };
const errStyle: React.CSSProperties = { ...valStyle, color: '#c65858' };

type View = 'info' | 'logs' | 'medals';

export const MetricsPanel: FC = () => {
  const selectedMetrics = useCommandCenterStore((s) => s.selectedMetrics);
  const selectedAgentId = useCommandCenterStore((s) => s.selectedAgentId);
  const logsOpen        = useCommandCenterStore((s) => s.logsOpen);
  const closeLogs       = useCommandCenterStore((s) => s.closeLogs);
  const allLogs         = useCommandCenterStore((s) => s.logs);
  const unlockedCount   = useCommandCenterStore((s) => s.unlockedAchievements.length);
  const [view, setView] = useState<View>('info');

  const effectiveView: View = logsOpen ? 'logs' : view;
  const setEffectiveView = (v: View) => {
    setView(v);
    if (v !== 'logs') closeLogs();
  };

  const agentLogs = selectedAgentId
    ? allLogs.filter((l) => l.agentId === selectedAgentId)
    : allLogs;

  const tabs = (
    <div style={{ display: 'flex', marginBottom: 4, gap: 4 }}>
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

  const m = selectedMetrics;
  const loadPct = Math.round(m.load * 100);
  const successRate = m.toolCalls > 0
    ? Math.round(((m.toolCalls - m.toolFailures) / m.toolCalls) * 100)
    : 100;
  const uptime = formatDuration(Date.now() - m.sessionStartedAt);
  const lastActive = formatDuration(Date.now() - m.lastUpdated);
  const top = topTool(m.toolBreakdown);

  return (
    <div data-metrics-panel>
      {tabs}
      {effectiveView === 'logs' && <LogsView entries={agentLogs} />}
      {effectiveView === 'medals' && <MedalsView />}
      {effectiveView === 'info' && (
        <div style={gridStyle}>
          <div style={cellStyle}>
            <div style={labelStyle}>Load</div>
            <div style={valStyle}>{loadPct}%</div>
          </div>
          <div style={cellStyle}>
            <div style={labelStyle}>Tools</div>
            <div style={valStyle}>{m.toolCalls}</div>
          </div>
          <div style={cellStyle}>
            <div style={labelStyle}>Prompts</div>
            <div style={valStyle}>{m.promptsSubmitted}</div>
          </div>
          <div style={cellStyle}>
            <div style={labelStyle}>Errors</div>
            <div style={m.errorCount > 0 ? errStyle : valStyle}>{m.errorCount}</div>
          </div>
          <div style={cellStyle}>
            <div style={labelStyle}>Success</div>
            <div style={valStyle}>{successRate}%</div>
          </div>
          <div style={cellStyle}>
            <div style={labelStyle}>Agents</div>
            <div style={valStyle}>{m.activeSubagents}/{m.subagentSpawns}</div>
          </div>
          <div style={cellStyle}>
            <div style={labelStyle}>Tasks</div>
            <div style={valStyle}>{m.activeTasks}</div>
          </div>
          <div style={cellStyle}>
            <div style={labelStyle}>Top Tool</div>
            <div style={{ ...valStyle, fontSize: 8 }}>{top}</div>
          </div>
          <div style={cellStyle}>
            <div style={labelStyle}>Uptime</div>
            <div style={valStyle}>{uptime}</div>
          </div>
          <div style={cellStyle}>
            <div style={labelStyle}>Last Act</div>
            <div style={valStyle}>{lastActive}</div>
          </div>
        </div>
      )}
    </div>
  );
};
