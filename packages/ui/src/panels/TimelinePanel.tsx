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

const STATE_COLORS: Record<string, string> = {
  state: '#3a8a5a',
  file: '#6aa0d4',
  tool: '#d4a84a',
  error: '#c65858',
};

const STATE_LABELS: Record<string, string> = {
  state: 'State',
  file: 'File',
  tool: 'Tool',
  error: 'Error',
};

/** Group timeline entries by agent and compute time range. */
function buildSwimlanes(entries: TimelineEntry[], selectedAgentId: string | null) {
  const agentMap = new Map<string, { agentName: string; agentType: string; entries: TimelineEntry[] }>();
  for (const e of entries) {
    if (selectedAgentId && e.agentId !== selectedAgentId) continue;
    if (!agentMap.has(e.agentId)) {
      agentMap.set(e.agentId, { agentName: e.agentName, agentType: e.agentType, entries: [] });
    }
    agentMap.get(e.agentId)!.entries.push(e);
  }
  return agentMap;
}

/** Tooltip for hovering a timeline block. */
const BlockTooltip: FC<{ entry: TimelineEntry }> = ({ entry }) =>
  createPortal(
    <div style={{
      position: 'fixed', top: 8, right: 12, width: 210,
      background: 'linear-gradient(180deg, #0d1e16 0%, #070f0a 100%)',
      border: '1px solid #2a5a3c', boxShadow: '0 4px 16px rgba(0,0,0,0.75)',
      padding: '7px 9px', fontFamily: 'Consolas, monospace', zIndex: 9999, pointerEvents: 'none',
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#90d898', marginBottom: 3 }}>{entry.agentName}</div>
      <div style={{ fontSize: 10, color: STATE_COLORS[entry.kind] ?? '#7a9a82', marginBottom: 2 }}>
        {STATE_LABELS[entry.kind] ?? entry.kind}: {entry.label}
      </div>
      <div style={{ fontSize: 11, color: '#4a6a58' }}>
        {new Date(entry.ts).toLocaleTimeString()}
      </div>
    </div>,
    document.body,
  );

const LANE_HEIGHT = 28;
const LABEL_WIDTH = 120;
const BLOCK_WIDTH = 6;

export const TimelinePanel: FC = () => {
  const timeline = useCommandCenterStore((s) => s.timeline);
  const selectedAgentId = useCommandCenterStore((s) => s.selectedAgentId);
  const [hoveredEntry, setHoveredEntry] = useState<TimelineEntry | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const swimlanes = useMemo(() => buildSwimlanes(timeline, selectedAgentId), [timeline, selectedAgentId]);

  // Time range
  const allEntries = useMemo(() => timeline.filter((e) => !selectedAgentId || e.agentId === selectedAgentId), [timeline, selectedAgentId]);
  const minTs = allEntries.length > 0 ? allEntries[0].ts : Date.now();
  const maxTs = allEntries.length > 0 ? allEntries[allEntries.length - 1].ts : Date.now();
  const timeSpan = Math.max(maxTs - minTs, 10000); // At least 10s
  const pixelsPerMs = 0.05; // 50px per second
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
      <div style={{ padding: 20, textAlign: 'center', color: '#3a5a48', fontSize: 11, fontFamily: 'Consolas, monospace' }}>
        No timeline data yet. Agent events will build the timeline as they arrive.
      </div>
    );
  }

  // Time axis labels
  const labelCount = Math.max(2, Math.floor(totalWidth / 100));
  const timeLabels: Array<{ x: number; label: string }> = [];
  for (let i = 0; i <= labelCount; i++) {
    const ts = minTs + (timeSpan * i) / labelCount;
    const x = ((ts - minTs) / timeSpan) * totalWidth;
    const d = new Date(ts);
    timeLabels.push({ x, label: `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}` });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: 'Consolas, monospace' }}>
      {hoveredEntry && <BlockTooltip entry={hoveredEntry} />}

      {/* Legend */}
      <div style={{ display: 'flex', gap: 12, padding: '6px 0', flexShrink: 0, alignItems: 'center' }}>
        {Object.entries(STATE_COLORS).map(([kind, color]) => (
          <div key={kind} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 10, height: 10, background: color, borderRadius: 2 }} />
            <span style={{ fontSize: 11, color: '#5a8a6a' }}>{STATE_LABELS[kind]}</span>
          </div>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#3a6a48' }}>{allEntries.length} events</span>
      </div>

      {/* Swimlane area */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Agent labels (fixed) */}
        <div style={{ width: LABEL_WIDTH, flexShrink: 0, overflowY: 'auto' }}>
          {agents.map(([agentId, data]) => (
            <div key={agentId} style={{
              height: LANE_HEIGHT,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '0 8px',
              borderBottom: '1px solid rgba(30,60,40,0.2)',
            }}>
              <PlanetIcon type={data.agentType} size={14} />
              <span style={{
                fontSize: 11,
                color: '#7a9a82',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {data.agentName}
              </span>
            </div>
          ))}
        </div>

        {/* Scrollable timeline */}
        <div ref={scrollRef} style={{ flex: 1, overflowX: 'auto', overflowY: 'auto', minWidth: 0 }}>
          <div style={{ width: totalWidth, position: 'relative' }}>
            {/* Time axis */}
            <div style={{ height: 18, borderBottom: '1px solid #1a3020', position: 'relative' }}>
              {timeLabels.map((tl, i) => (
                <span key={i} style={{
                  position: 'absolute',
                  left: tl.x,
                  top: 2,
                  fontSize: 10,
                  color: '#3a6a48',
                  transform: 'translateX(-50%)',
                  whiteSpace: 'nowrap',
                }}>
                  {tl.label}
                </span>
              ))}
            </div>

            {/* Swimlane rows */}
            {agents.map(([agentId, data]) => (
              <div key={agentId} style={{
                height: LANE_HEIGHT,
                position: 'relative',
                borderBottom: '1px solid rgba(30,60,40,0.15)',
              }}>
                {data.entries.map((entry, i) => {
                  const x = ((entry.ts - minTs) / timeSpan) * totalWidth;
                  return (
                    <div
                      key={i}
                      onMouseEnter={() => setHoveredEntry(entry)}
                      onMouseLeave={() => setHoveredEntry(null)}
                      style={{
                        position: 'absolute',
                        left: x,
                        top: 4,
                        width: BLOCK_WIDTH,
                        height: LANE_HEIGHT - 8,
                        background: STATE_COLORS[entry.kind] ?? '#4a7a58',
                        borderRadius: 1,
                        opacity: 0.8,
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
