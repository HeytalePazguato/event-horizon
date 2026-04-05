/**
 * Timeline panel — horizontal swimlane visualization of agent activity.
 * Each agent gets a row showing colored state blocks over time.
 * @event-horizon/ui
 */

import type { FC } from 'react';
import { useMemo, useRef, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCommandCenterStore } from '../store.js';
import type { TimelineEntry } from '../store.js';
import { PlanetIcon } from './AgentIdentity.js';
import { folderName } from '../utils.js';

const STATE_COLORS: Record<string, string> = {
  state: '#3a8a5a',
  file: '#6aa0d4',
  tool: '#d4a84a',
  error: '#c65858',
  compaction: '#cc8844',
};

const STATE_LABELS: Record<string, string> = {
  state: 'State',
  file: 'File',
  tool: 'Tool',
  error: 'Error',
  compaction: 'Compaction',
};

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

const AGENT_COLORS: Record<string, string> = {
  'claude-code': '#88aaff',
  copilot: '#cc88ff',
  opencode: '#88ffaa',
  cursor: '#44ddcc',
  unknown: '#aaccff',
};

interface SwimlaneData {
  agentName: string;
  agentType: string;
  cwd?: string;
  entries: TimelineEntry[];
}

/** Group timeline entries by agent and compute time range. */
function buildSwimlanes(
  entries: TimelineEntry[],
  selectedAgentId: string | null,
  agentCwds: Record<string, string | undefined>,
): Map<string, SwimlaneData> {
  const agentMap = new Map<string, SwimlaneData>();
  for (const e of entries) {
    if (selectedAgentId && e.agentId !== selectedAgentId) continue;
    if (!agentMap.has(e.agentId)) {
      agentMap.set(e.agentId, { agentName: e.agentName, agentType: e.agentType, cwd: agentCwds[e.agentId], entries: [] });
    }
    agentMap.get(e.agentId)!.entries.push(e);
  }
  return agentMap;
}

/** Tooltip for hovering a timeline block — unified style with Files tooltips. */
const BlockTooltip: FC<{ entry: TimelineEntry; cwd?: string }> = ({ entry, cwd }) => {
  const folder = cwd ? folderName(cwd) : '';
  return createPortal(
    <div style={TOOLTIP_STYLE}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: AGENT_COLORS[entry.agentType] ?? '#aaccff', flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: '#90d898' }}>{entry.agentName}</span>
      </div>
      {folder && <div style={{ fontSize: 10, color: '#5a8a6a', marginBottom: 3, paddingLeft: 14 }}>{folder}</div>}
      <div style={{ fontSize: 11, color: STATE_COLORS[entry.kind] ?? '#7a9a82', marginBottom: 2 }}>
        {STATE_LABELS[entry.kind] ?? entry.kind}: {entry.label}
      </div>
      <div style={{ fontSize: 10, color: '#4a6a58' }}>
        {new Date(entry.ts).toLocaleTimeString()}
      </div>
    </div>,
    document.body,
  );
};

const TIME_AXIS_HEIGHT = 22;
const LANE_HEIGHT = 40;
const LABEL_WIDTH = 160;
const BLOCK_WIDTH = 6;

export interface TimelinePanelProps {
  /** Map of agentId → cwd for showing folder names. */
  agentCwds?: Record<string, string | undefined>;
}

export const TimelinePanel: FC<TimelinePanelProps> = ({ agentCwds = {} }) => {
  const timeline = useCommandCenterStore((s) => s.timeline);
  const selectedAgentId = useCommandCenterStore((s) => s.selectedAgentId);
  const [hoveredEntry, setHoveredEntry] = useState<TimelineEntry | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const swimlanes = useMemo(() => buildSwimlanes(timeline, selectedAgentId, agentCwds), [timeline, selectedAgentId, agentCwds]);

  // Time range
  const allEntries = useMemo(() => timeline.filter((e) => !selectedAgentId || e.agentId === selectedAgentId), [timeline, selectedAgentId]);
  const minTs = allEntries.length > 0 ? allEntries[0].ts : Date.now();
  const maxTs = allEntries.length > 0 ? allEntries[allEntries.length - 1].ts : Date.now();
  const timeSpan = Math.max(maxTs - minTs, 10000);
  const pixelsPerMs = 0.05;
  const totalWidth = Math.max(400, timeSpan * pixelsPerMs);

  // Auto-scroll right
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, [timeline.length]);

  const agents = [...swimlanes.entries()];

  if (timeline.length === 0) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: '#3a5a48', fontSize: 12, fontFamily: 'Consolas, monospace' }}>
        No timeline data yet. Agent events will build the timeline as they arrive.
      </div>
    );
  }

  // Time axis labels
  const labelCount = Math.max(2, Math.floor(totalWidth / 120));
  const timeLabels: Array<{ x: number; label: string }> = [];
  for (let i = 0; i <= labelCount; i++) {
    const ts = minTs + (timeSpan * i) / labelCount;
    const x = ((ts - minTs) / timeSpan) * totalWidth;
    const d = new Date(ts);
    timeLabels.push({ x, label: `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}` });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: 'Consolas, monospace' }}>
      {hoveredEntry && <BlockTooltip entry={hoveredEntry} cwd={agentCwds[hoveredEntry.agentId]} />}

      {/* Legend */}
      <div style={{ display: 'flex', gap: 14, padding: '8px 0', flexShrink: 0, alignItems: 'center' }}>
        {Object.entries(STATE_COLORS).map(([kind, color]) => (
          <div key={kind} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 12, height: 12, background: color, borderRadius: 2 }} />
            <span style={{ fontSize: 12, color: '#5a8a6a' }}>{STATE_LABELS[kind]}</span>
          </div>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#3a6a48' }}>{allEntries.length} events</span>
      </div>

      {/* Swimlane area */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        {/* Agent labels (fixed left column) */}
        <div style={{ width: LABEL_WIDTH, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
          {/* Spacer to align with time axis */}
          <div style={{ height: TIME_AXIS_HEIGHT, flexShrink: 0 }} />
          {/* Agent rows */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {agents.map(([agentId, data]) => {
              const folder = data.cwd ? folderName(data.cwd) : '';
              return (
                <div key={agentId} style={{
                  height: LANE_HEIGHT,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '0 10px',
                  borderBottom: '1px solid rgba(30,60,40,0.2)',
                  boxSizing: 'border-box',
                }}>
                  <PlanetIcon type={data.agentType} size={18} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 12,
                      color: '#8aaa92',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {data.agentName}
                    </div>
                    {folder && (
                      <div style={{
                        fontSize: 10,
                        color: '#4a7a5a',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {folder}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Scrollable timeline */}
        <div ref={scrollRef} style={{ flex: 1, overflowX: 'auto', overflowY: 'auto', minWidth: 0 }}>
          <div style={{ width: totalWidth, position: 'relative' }}>
            {/* Time axis */}
            <div style={{ height: TIME_AXIS_HEIGHT, borderBottom: '1px solid #1a3020', position: 'relative' }}>
              {timeLabels.map((tl, i) => (
                <span key={i} style={{
                  position: 'absolute',
                  left: tl.x,
                  top: 3,
                  fontSize: 10,
                  color: '#3a6a48',
                  transform: 'translateX(-50%)',
                  whiteSpace: 'nowrap',
                }}>
                  {tl.label}
                </span>
              ))}
            </div>

            {/* Swimlane rows — aligned with left label rows */}
            {agents.map(([agentId, data]) => (
              <div key={agentId} style={{
                height: LANE_HEIGHT,
                position: 'relative',
                borderBottom: '1px solid rgba(30,60,40,0.15)',
                boxSizing: 'border-box',
              }}>
                {data.entries.map((entry, i) => {
                  const x = ((entry.ts - minTs) / timeSpan) * totalWidth;
                  const isCompaction = entry.kind === 'compaction';
                  return (
                    <div
                      key={i}
                      onMouseEnter={() => setHoveredEntry(entry)}
                      onMouseLeave={() => setHoveredEntry(null)}
                      style={{
                        position: 'absolute',
                        left: x,
                        top: isCompaction ? 2 : (LANE_HEIGHT - 20) / 2,
                        width: isCompaction ? 2 : BLOCK_WIDTH,
                        height: isCompaction ? LANE_HEIGHT - 4 : 20,
                        background: STATE_COLORS[entry.kind] ?? '#4a7a58',
                        borderRadius: 1,
                        opacity: isCompaction ? 0.95 : 0.85,
                        cursor: 'default',
                      }}
                    />
                  );
                })}
              </div>
            ))}

            {/* "Now" line */}
            <div style={{
              position: 'absolute',
              left: totalWidth - 1,
              top: 0,
              bottom: 0,
              width: 1,
              background: '#40a060',
              opacity: 0.5,
            }} />
          </div>
        </div>
      </div>
    </div>
  );
};
