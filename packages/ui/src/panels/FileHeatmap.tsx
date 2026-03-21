/**
 * File Activity Heatmap — shows which files each agent touches,
 * sorted by activity level. Highlights multi-agent contention and errors.
 * @event-horizon/ui
 */

import type { FC } from 'react';
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCommandCenterStore } from '../store.js';
import type { FileAgentActivity } from '../store.js';

/** Color for the agent type badge dot. */
const AGENT_COLORS: Record<string, string> = {
  'claude-code': '#88aaff',
  copilot: '#cc88ff',
  opencode: '#88ffaa',
  cursor: '#44ddcc',
  unknown: '#aaccff',
};

/** Heat bar — proportional width showing relative activity. */
const HeatBar: FC<{ ratio: number; ops: number; hasErrors: boolean; multiAgent: boolean }> = ({ ratio, ops, hasErrors, multiAgent }) => {
  let color = '#2a6a3a';
  if (ratio > 0.7) color = '#4a9a5a';
  else if (ratio > 0.4) color = '#3a8a4a';
  if (multiAgent) color = '#d4944a';
  if (hasErrors) color = '#c04040';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, width: 52 }}>
      <div style={{ width: 34, height: 5, background: '#0a1a10', borderRadius: 2 }}>
        <div style={{ width: `${Math.max(10, ratio * 100)}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: 9, color: '#5a7a68', minWidth: 14, textAlign: 'right' }}>{ops}</span>
    </div>
  );
};

/** Portal tooltip — same style and position as CmdTooltip in AgentControls. */
const FileTooltip: FC<{ agent: FileAgentActivity }> = ({ agent }) => {
  const ccMinimized = useCommandCenterStore((s) => s.ccMinimized);
  return createPortal(
    <div
      style={{
        position: 'fixed',
        bottom: ccMinimized ? 75 : 212,
        right: 12,
        width: 190,
        background: 'linear-gradient(180deg, #0d1e16 0%, #070f0a 100%)',
        border: '1px solid #2a5a3c',
        boxShadow: '0 -4px 16px rgba(0,0,0,0.75)',
        padding: '7px 9px',
        fontFamily: 'Consolas, monospace',
        zIndex: 9999,
        pointerEvents: 'none',
        clipPath: 'polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: AGENT_COLORS[agent.agentType] ?? '#aaccff', flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: '#90d898', letterSpacing: '0.04em' }}>
          {agent.agentName}
        </span>
      </div>
      <div style={{ fontSize: 10, color: '#6a9a78', lineHeight: 1.6 }}>
        <span style={{ color: '#7aaa88' }}>{agent.reads}</span> reads
        {' · '}
        <span style={{ color: '#7aaa88' }}>{agent.writes}</span> writes
        {agent.errors > 0 && (
          <>
            {' · '}
            <span style={{ color: '#c06060' }}>{agent.errors}</span> errors
          </>
        )}
      </div>
    </div>,
    document.body,
  );
};

type SortMode = 'activity' | 'agents' | 'recent';

const sortBtnStyle = (active: boolean): React.CSSProperties => ({
  background: active ? '#1a3828' : 'transparent',
  border: `1px solid ${active ? '#25904a' : '#1e4030'}`,
  borderRadius: 2,
  color: active ? '#60d080' : '#4a7a58',
  fontSize: 9,
  fontFamily: 'Consolas, monospace',
  cursor: 'pointer',
  padding: '2px 6px',
  fontWeight: active ? 600 : 400,
});

export const FileHeatmap: FC = () => {
  const fileActivity = useCommandCenterStore((s) => s.fileActivity);
  const selectedAgentId = useCommandCenterStore((s) => s.selectedAgentId);
  const [sortMode, setSortMode] = useState<SortMode>('activity');
  const [filterAgent, setFilterAgent] = useState(false);
  const [hoveredAgent, setHoveredAgent] = useState<FileAgentActivity | null>(null);

  const files = useMemo(() => {
    let entries = Object.values(fileActivity);
    if (filterAgent && selectedAgentId) {
      entries = entries.filter((f) => f.agents[selectedAgentId]);
    }
    if (sortMode === 'activity') entries.sort((a, b) => b.totalOps - a.totalOps);
    else if (sortMode === 'agents') entries.sort((a, b) => b.agentCount - a.agentCount || b.totalOps - a.totalOps);
    else entries.sort((a, b) => b.lastTs - a.lastTs);
    return entries.slice(0, 50);
  }, [fileActivity, sortMode, filterAgent, selectedAgentId]);

  const maxOps = useMemo(() => Math.max(1, ...files.map((f) => f.totalOps)), [files]);
  const multiAgentCount = useMemo(() => files.filter((f) => f.agentCount > 1).length, [files]);
  const errorCount = useMemo(() => files.filter((f) => f.hasErrors).length, [files]);
  const totalFiles = Object.keys(fileActivity).length;

  if (totalFiles === 0) {
    return (
      <div style={{ color: '#4a5a52', fontSize: 10, padding: 4, fontFamily: 'Consolas, monospace' }}>
        No file activity yet. File reads and writes will appear here.
      </div>
    );
  }

  return (
    <div style={{ fontFamily: 'Consolas, monospace', display: 'flex', flexDirection: 'column', gap: 4, minHeight: 0 }}>
      {/* Tooltip portal */}
      {hoveredAgent && <FileTooltip agent={hoveredAgent} />}

      {/* Summary + sort controls */}
      <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0, gap: 6 }}>
        <span style={{ fontSize: 10, color: '#6a9a7a' }}>{totalFiles} files</span>
        {multiAgentCount > 0 && (
          <span style={{ fontSize: 10, color: '#d4944a' }}>{multiAgentCount} shared</span>
        )}
        {errorCount > 0 && (
          <span style={{ fontSize: 10, color: '#c04040' }}>{errorCount} errors</span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 3 }}>
          {selectedAgentId && (
            <button type="button" onClick={() => setFilterAgent((f) => !f)} style={sortBtnStyle(filterAgent)}>
              Agent
            </button>
          )}
          <button type="button" onClick={() => setSortMode('activity')} style={sortBtnStyle(sortMode === 'activity')}>Hot</button>
          <button type="button" onClick={() => setSortMode('agents')} style={sortBtnStyle(sortMode === 'agents')}>Shared</button>
          <button type="button" onClick={() => setSortMode('recent')} style={sortBtnStyle(sortMode === 'recent')}>New</button>
        </div>
      </div>

      {/* File list */}
      <div style={{ overflowY: 'auto', maxHeight: 74, minHeight: 0 }}>
        {files.map((f) => (
          <div
            key={f.path}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '2px 0',
              borderBottom: '1px solid rgba(40,60,50,0.25)',
            }}
          >
            <HeatBar ratio={f.totalOps / maxOps} ops={f.totalOps} hasErrors={f.hasErrors} multiAgent={f.agentCount > 1} />
            <span
              style={{
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: 10,
                color: f.hasErrors ? '#c06060' : f.agentCount > 1 ? '#d4a44a' : '#8aaa92',
              }}
              title={f.path}
            >
              {f.name}
            </span>
            {/* Agent dots */}
            <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
              {Object.values(f.agents).map((a) => (
                <div
                  key={a.agentId}
                  onMouseEnter={() => setHoveredAgent(a)}
                  onMouseLeave={() => setHoveredAgent(null)}
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: AGENT_COLORS[a.agentType ?? 'unknown'] ?? '#aaccff',
                    border: a.errors > 0 ? '1px solid #ff4444' : '1px solid rgba(255,255,255,0.15)',
                    flexShrink: 0,
                    cursor: 'default',
                  }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
