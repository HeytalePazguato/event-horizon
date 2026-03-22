/**
 * Full-size File Activity Heatmap for Operations view.
 * Sortable columns, full paths, row expansion, heat color legend.
 * @event-horizon/ui
 */

import type { FC } from 'react';
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCommandCenterStore } from '../store.js';
import type { FileActivity, FileAgentActivity } from '../store.js';

const AGENT_COLORS: Record<string, string> = {
  'claude-code': '#88aaff',
  copilot: '#cc88ff',
  opencode: '#88ffaa',
  cursor: '#44ddcc',
  unknown: '#aaccff',
};

type SortKey = 'file' | 'ops' | 'reads' | 'writes' | 'errors' | 'agents' | 'lastActive';
type SortDir = 'asc' | 'desc';

function folderFromCwd(cwd?: string): string {
  if (!cwd) return '';
  let norm = cwd.replace(/\\/g, '/');
  while (norm.endsWith('/')) norm = norm.slice(0, -1);
  return norm.split('/').pop() || '';
}

function timeAgo(ts: number): string {
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

/** Shared tooltip container style for Operations view. */
const TOOLTIP_STYLE: React.CSSProperties = {
  position: 'fixed',
  top: 8,
  right: 12,
  width: 220,
  background: 'linear-gradient(180deg, #0d1e16 0%, #070f0a 100%)',
  border: '1px solid #2a5a3c',
  boxShadow: '0 4px 16px rgba(0,0,0,0.75)',
  padding: '8px 10px',
  fontFamily: 'Consolas, monospace',
  zIndex: 9999,
  pointerEvents: 'none',
  clipPath: 'polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%)',
};

/** Portal tooltip for agent dots — unified style with Timeline tooltips. */
const AgentTooltip: FC<{ agent: FileAgentActivity }> = ({ agent }) => {
  const folder = folderFromCwd(agent.cwd);
  return createPortal(
    <div style={TOOLTIP_STYLE}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: AGENT_COLORS[agent.agentType] ?? '#aaccff', flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: '#90d898' }}>{agent.agentName}</span>
      </div>
      {folder && <div style={{ fontSize: 10, color: '#5a8a6a', marginBottom: 3, paddingLeft: 14 }}>{folder}</div>}
      <div style={{ fontSize: 11, color: '#6a9a78' }}>
        <span style={{ color: '#7aaa88' }}>{agent.reads}</span> reads
        {' · '}<span style={{ color: '#7aaa88' }}>{agent.writes}</span> writes
        {agent.errors > 0 && <>{' · '}<span style={{ color: '#c06060' }}>{agent.errors}</span> errors</>}
      </div>
    </div>,
    document.body,
  );
};

function totalReads(f: FileActivity): number { return Object.values(f.agents).reduce((s, a) => s + a.reads, 0); }
function totalWrites(f: FileActivity): number { return Object.values(f.agents).reduce((s, a) => s + a.writes, 0); }
function totalErrors(f: FileActivity): number { return Object.values(f.agents).reduce((s, a) => s + a.errors, 0); }

export const FileHeatmapFull: FC = () => {
  const fileActivity = useCommandCenterStore((s) => s.fileActivity);
  const selectedAgentId = useCommandCenterStore((s) => s.selectedAgentId);
  const [sortKey, setSortKey] = useState<SortKey>('ops');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [showFullPaths, setShowFullPaths] = useState(false);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [hoveredAgent, setHoveredAgent] = useState<FileAgentActivity | null>(null);

  const files = useMemo(() => {
    let entries = Object.values(fileActivity);
    if (selectedAgentId) entries = entries.filter((f) => f.agents[selectedAgentId]);

    const comparator = (a: FileActivity, b: FileActivity): number => {
      let cmp = 0;
      if (sortKey === 'file') cmp = a.name.localeCompare(b.name);
      else if (sortKey === 'ops') cmp = a.totalOps - b.totalOps;
      else if (sortKey === 'reads') cmp = totalReads(a) - totalReads(b);
      else if (sortKey === 'writes') cmp = totalWrites(a) - totalWrites(b);
      else if (sortKey === 'errors') cmp = totalErrors(a) - totalErrors(b);
      else if (sortKey === 'agents') cmp = a.agentCount - b.agentCount;
      else if (sortKey === 'lastActive') cmp = a.lastTs - b.lastTs;
      return sortDir === 'desc' ? -cmp : cmp;
    };
    return [...entries].sort(comparator);
  }, [fileActivity, selectedAgentId, sortKey, sortDir]);

  const maxOps = useMemo(() => Math.max(1, ...files.map((f) => f.totalOps)), [files]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const headerStyle = (key: SortKey): React.CSSProperties => ({
    padding: '8px 10px',
    textAlign: 'left' as const,
    color: sortKey === key ? '#90d898' : '#5a8a68',
    fontWeight: 600,
    fontSize: 12,
    cursor: 'pointer',
    userSelect: 'none' as const,
    whiteSpace: 'nowrap' as const,
  });

  const arrow = (key: SortKey) => sortKey === key ? (sortDir === 'asc' ? ' ▴' : ' ▾') : '';

  /** Column tooltip descriptions. */
  const COL_TIPS: Record<SortKey, string> = {
    file: 'File name (or full path). Click to sort alphabetically.',
    ops: 'Total operations — reads + writes across all agents.',
    reads: 'Total file reads across all agents.',
    writes: 'Total file writes/edits across all agents.',
    errors: 'Total errors encountered on this file.',
    agents: 'Number of distinct agents that touched this file.',
    lastActive: 'Time since the most recent operation on this file.',
  };

  const totalFiles = Object.keys(fileActivity).length;
  const contested = files.filter((f) => f.agentCount > 1).length;
  const errorFiles = files.filter((f) => f.hasErrors).length;

  return (
    <div style={{ fontFamily: 'Consolas, monospace', display: 'flex', flexDirection: 'column', gap: 10, height: '100%' }}>
      {hoveredAgent && <AgentTooltip agent={hoveredAgent} />}

      {/* Controls bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
        <span style={{ fontSize: 13, color: '#6a9a7a' }}>{totalFiles} files</span>
        {contested > 0 && <span style={{ fontSize: 13, color: '#d4944a' }}>{contested} shared</span>}
        {errorFiles > 0 && <span style={{ fontSize: 13, color: '#c04040' }}>{errorFiles} errors</span>}

        {/* Heat legend */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginLeft: 8 }}>
          <div style={{ width: 12, height: 12, background: '#2a6a3a', borderRadius: 2 }} />
          <span style={{ fontSize: 10, color: '#5a8a68' }}>Normal</span>
          <div style={{ width: 12, height: 12, background: '#d4944a', borderRadius: 2, marginLeft: 6 }} />
          <span style={{ fontSize: 10, color: '#5a8a68' }}>Shared</span>
          <div style={{ width: 12, height: 12, background: '#c04040', borderRadius: 2, marginLeft: 6 }} />
          <span style={{ fontSize: 10, color: '#5a8a68' }}>Error</span>
        </div>

        <button
          type="button"
          onClick={() => setShowFullPaths((p) => !p)}
          style={{
            marginLeft: 'auto',
            padding: '4px 10px', border: `1px solid ${showFullPaths ? '#25904a' : '#1e4030'}`,
            borderRadius: 2, background: showFullPaths ? '#1a3828' : 'transparent',
            color: showFullPaths ? '#60d080' : '#5a8a68', fontSize: 11, fontFamily: 'Consolas, monospace', cursor: 'pointer',
          }}
        >
          Full Paths
        </button>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #1a3020', position: 'sticky', top: 0, background: '#080e0a', zIndex: 1 }}>
              <th style={{ ...headerStyle('file'), width: '40%' }} onClick={() => toggleSort('file')} title={COL_TIPS.file}>File{arrow('file')}</th>
              <th style={headerStyle('ops')} onClick={() => toggleSort('ops')} title={COL_TIPS.ops}>Total{arrow('ops')}</th>
              <th style={headerStyle('reads')} onClick={() => toggleSort('reads')} title={COL_TIPS.reads}>Reads{arrow('reads')}</th>
              <th style={headerStyle('writes')} onClick={() => toggleSort('writes')} title={COL_TIPS.writes}>Writes{arrow('writes')}</th>
              <th style={headerStyle('errors')} onClick={() => toggleSort('errors')} title={COL_TIPS.errors}>Errors{arrow('errors')}</th>
              <th style={headerStyle('agents')} onClick={() => toggleSort('agents')} title={COL_TIPS.agents}>Agents{arrow('agents')}</th>
              <th style={headerStyle('lastActive')} onClick={() => toggleSort('lastActive')} title={COL_TIPS.lastActive}>Last{arrow('lastActive')}</th>
            </tr>
          </thead>
          <tbody>
            {files.map((f) => {
              const isExpanded = expandedFile === f.path;
              let heatColor = '#2a6a3a';
              if (f.agentCount > 1) heatColor = '#d4944a';
              if (f.hasErrors) heatColor = '#c04040';
              const ratio = f.totalOps / maxOps;

              return (
                <tr key={f.path} style={{ cursor: 'pointer' }} onClick={() => setExpandedFile(isExpanded ? null : f.path)}>
                  <td style={{ padding: '6px 10px', fontSize: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {/* Heat bar */}
                      <div style={{ width: 44, height: 6, background: '#0a1a10', borderRadius: 2, flexShrink: 0 }}>
                        <div style={{ width: `${Math.max(8, ratio * 100)}%`, height: '100%', background: heatColor, borderRadius: 2 }} />
                      </div>
                      <span style={{
                        color: f.hasErrors ? '#c06060' : f.agentCount > 1 ? '#d4a44a' : '#8aaa92',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }} title={f.path}>
                        {showFullPaths ? f.path : f.name}
                      </span>
                    </div>
                    {/* Expanded: per-agent breakdown */}
                    {isExpanded && (
                      <div style={{ marginTop: 8, paddingLeft: 52 }}>
                        {Object.values(f.agents).map((a) => (
                          <div
                            key={a.agentId}
                            style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, fontSize: 11 }}
                            onMouseEnter={() => setHoveredAgent(a)}
                            onMouseLeave={() => setHoveredAgent(null)}
                          >
                            <div style={{ width: 8, height: 8, borderRadius: '50%', background: AGENT_COLORS[a.agentType] ?? '#aaccff', flexShrink: 0 }} />
                            <span style={{ color: '#7a9a82', width: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.agentName}</span>
                            <span style={{ color: '#5a8a6a' }}>{a.reads} reads  {a.writes} writes{a.errors ? `  ${a.errors} errors` : ''}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '6px 10px', fontSize: 12, color: '#7a9a82' }}>{f.totalOps}</td>
                  <td style={{ padding: '6px 10px', fontSize: 12, color: '#7a9a82' }}>{totalReads(f)}</td>
                  <td style={{ padding: '6px 10px', fontSize: 12, color: '#7a9a82' }}>{totalWrites(f)}</td>
                  <td style={{ padding: '6px 10px', fontSize: 12, color: f.hasErrors ? '#c06060' : '#7a9a82' }}>{totalErrors(f)}</td>
                  <td style={{ padding: '6px 10px', fontSize: 12 }}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {Object.values(f.agents).map((a) => (
                        <div
                          key={a.agentId}
                          onMouseEnter={() => setHoveredAgent(a)}
                          onMouseLeave={() => setHoveredAgent(null)}
                          style={{ width: 9, height: 9, borderRadius: '50%', background: AGENT_COLORS[a.agentType] ?? '#aaccff', cursor: 'default' }}
                        />
                      ))}
                    </div>
                  </td>
                  <td style={{ padding: '6px 10px', fontSize: 11, color: '#5a8a6a', whiteSpace: 'nowrap' }}>{timeAgo(f.lastTs)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {files.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', color: '#3a5a48', fontSize: 11 }}>
            No file activity yet. File reads and writes will appear here.
          </div>
        )}
      </div>
    </div>
  );
};
