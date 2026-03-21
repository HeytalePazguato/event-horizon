/**
 * File Activity Heatmap — shows which files each agent touches,
 * sorted by activity level. Highlights multi-agent contention and errors.
 * @event-horizon/ui
 */

import type { FC } from 'react';
import { useMemo, useState } from 'react';
import { useCommandCenterStore } from '../store.js';
import type { FileActivity } from '../store.js';

/** Color for the agent type badge dot. */
const AGENT_COLORS: Record<string, string> = {
  'claude-code': '#88aaff',
  copilot: '#cc88ff',
  opencode: '#88ffaa',
  cursor: '#44ddcc',
  unknown: '#aaccff',
};

const HeatBar: FC<{ ratio: number; hasErrors: boolean; multiAgent: boolean }> = ({ ratio, hasErrors, multiAgent }) => {
  // Gradient from dim green → bright green → amber (multi) → red (errors)
  let color = '#2a6a3a';
  if (ratio > 0.7) color = '#4a9a5a';
  else if (ratio > 0.4) color = '#3a8a4a';
  if (multiAgent) color = '#d4944a';
  if (hasErrors) color = '#c04040';
  return (
    <div style={{ width: 40, height: 4, background: '#0a1a10', borderRadius: 2, flexShrink: 0 }}>
      <div style={{ width: `${Math.max(8, ratio * 100)}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.3s' }} />
    </div>
  );
};

const AgentDots: FC<{ activity: FileActivity }> = ({ activity }) => (
  <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
    {Object.values(activity.agents).map((a) => (
      <div
        key={a.agentId}
        title={`${a.agentName}: ${a.reads}R ${a.writes}W${a.errors ? ` ${a.errors}E` : ''}`}
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: AGENT_COLORS[a.agentType ?? 'unknown'] ?? '#aaccff',
          border: a.errors > 0 ? '1px solid #ff4444' : '1px solid rgba(255,255,255,0.1)',
          flexShrink: 0,
        }}
      />
    ))}
  </div>
);

type SortMode = 'activity' | 'agents' | 'recent';

export const FileHeatmap: FC = () => {
  const fileActivity = useCommandCenterStore((s) => s.fileActivity);
  const selectedAgentId = useCommandCenterStore((s) => s.selectedAgentId);
  const [sortMode, setSortMode] = useState<SortMode>('activity');
  const [filterAgent, setFilterAgent] = useState(false);

  const files = useMemo(() => {
    let entries = Object.values(fileActivity);
    // When an agent is selected and filter is on, only show that agent's files
    if (filterAgent && selectedAgentId) {
      entries = entries.filter((f) => f.agents[selectedAgentId]);
    }
    // Sort
    if (sortMode === 'activity') entries.sort((a, b) => b.totalOps - a.totalOps);
    else if (sortMode === 'agents') entries.sort((a, b) => b.agentCount - a.agentCount || b.totalOps - a.totalOps);
    else entries.sort((a, b) => b.lastTs - a.lastTs);
    return entries.slice(0, 50); // Cap display
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
    <div style={{ fontFamily: 'Consolas, monospace', fontSize: 9, display: 'flex', flexDirection: 'column', gap: 3, minHeight: 0 }}>
      {/* Summary bar */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0, color: '#5a8a6a', fontSize: 8 }}>
        <span>{totalFiles} files</span>
        {multiAgentCount > 0 && (
          <span style={{ color: '#d4944a' }}>{multiAgentCount} contested</span>
        )}
        {errorCount > 0 && (
          <span style={{ color: '#c04040' }}>{errorCount} w/ errors</span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 3 }}>
          {selectedAgentId && (
            <button
              type="button"
              onClick={() => setFilterAgent((f) => !f)}
              style={{
                background: filterAgent ? '#1a3828' : 'transparent',
                border: `1px solid ${filterAgent ? '#25904a' : '#1e4030'}`,
                borderRadius: 2,
                color: filterAgent ? '#60d080' : '#3a6a48',
                fontSize: 7,
                fontFamily: 'Consolas, monospace',
                cursor: 'pointer',
                padding: '1px 4px',
              }}
            >
              Agent
            </button>
          )}
          {(['activity', 'agents', 'recent'] as SortMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setSortMode(m)}
              style={{
                background: sortMode === m ? '#1a3828' : 'transparent',
                border: `1px solid ${sortMode === m ? '#25904a' : '#1e4030'}`,
                borderRadius: 2,
                color: sortMode === m ? '#60d080' : '#3a6a48',
                fontSize: 7,
                fontFamily: 'Consolas, monospace',
                cursor: 'pointer',
                padding: '1px 4px',
                textTransform: 'capitalize',
              }}
            >
              {m === 'activity' ? 'Hot' : m === 'agents' ? 'Shared' : 'New'}
            </button>
          ))}
        </div>
      </div>

      {/* File list */}
      <div style={{ overflowY: 'auto', maxHeight: 72, minHeight: 0 }}>
        {files.map((f) => (
          <div
            key={f.path}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '1px 0',
              borderBottom: '1px solid rgba(40,60,50,0.25)',
            }}
          >
            <HeatBar ratio={f.totalOps / maxOps} hasErrors={f.hasErrors} multiAgent={f.agentCount > 1} />
            <span
              style={{
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: f.hasErrors ? '#c06060' : f.agentCount > 1 ? '#d4a44a' : '#7a9a82',
              }}
              title={f.path}
            >
              {f.name}
            </span>
            <span style={{ color: '#4a6a58', fontSize: 8, flexShrink: 0 }}>
              {f.totalOps}
            </span>
            <AgentDots activity={f} />
          </div>
        ))}
      </div>
    </div>
  );
};
