/**
 * Traces Panel — waterfall timeline of trace spans.
 * Color-coded by span type, filterable, with aggregate breakdown.
 * @event-horizon/ui
 */

import type { FC } from 'react';
import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';

export type SpanType = 'llm_call' | 'tool_call' | 'task' | 'agent_session' | 'hook';

export interface TraceSpanView {
  id: string;
  runId: string;
  spanType: SpanType;
  name: string;
  agentId: string;
  parentSpanId?: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  metadata: Record<string, unknown>;
}

export interface TracesPanelProps {
  spans: TraceSpanView[];
  aggregate: Record<string, number>;
  agents?: Array<{ id: string; name: string }>;
}

const SPAN_COLORS: Record<string, string> = {
  tool_call: '#4488cc',
  task: '#44aa66',
  agent_session: '#cc8844',
  hook: '#8866cc',
  llm_call: '#4488cc',
};

const SPAN_LABELS: Record<string, string> = {
  tool_call: 'Tool Call',
  task: 'Task',
  agent_session: 'Session',
  hook: 'Hook',
  llm_call: 'LLM Call',
};

const TIME_RANGES: Array<{ label: string; ms: number }> = [
  { label: 'Last 5m', ms: 5 * 60 * 1000 },
  { label: 'Last 15m', ms: 15 * 60 * 1000 },
  { label: 'Last 1h', ms: 60 * 60 * 1000 },
  { label: 'All', ms: Infinity },
];

const TOOLTIP_STYLE: React.CSSProperties = {
  position: 'fixed',
  top: 8,
  right: 12,
  width: 280,
  background: 'linear-gradient(180deg, #0d1e16 0%, #070f0a 100%)',
  border: '1px solid #2a5a3c',
  boxShadow: '0 4px 16px rgba(0,0,0,0.75)',
  padding: '8px 10px',
  fontFamily: 'Consolas, monospace',
  zIndex: 9999,
  pointerEvents: 'none',
  clipPath: 'polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%)',
};

const checkboxStyle = (checked: boolean): React.CSSProperties => ({
  width: 12,
  height: 12,
  borderRadius: 2,
  border: `1px solid ${checked ? '#40a060' : '#2a5a3c'}`,
  background: checked ? '#40a060' : 'transparent',
  cursor: 'pointer',
  flexShrink: 0,
});

const filterButtonStyle = (active: boolean): React.CSSProperties => ({
  padding: '2px 8px',
  fontSize: 10,
  fontFamily: 'Consolas, monospace',
  border: `1px solid ${active ? '#40a060' : '#1a3020'}`,
  borderRadius: 2,
  background: active ? 'rgba(40,100,60,0.3)' : 'transparent',
  color: active ? '#90d898' : '#4a7a58',
  cursor: 'pointer',
});

export const TracesPanel: FC<TracesPanelProps> = ({ spans, aggregate, agents = [] }) => {
  const [agentFilter, setAgentFilter] = useState<string>('all');
  const [typeFilters, setTypeFilters] = useState<Record<string, boolean>>({
    tool_call: true,
    task: true,
    agent_session: true,
    hook: true,
    llm_call: true,
  });
  const [timeRange, setTimeRange] = useState<number>(5 * 60 * 1000);
  const [expandedSpanId, setExpandedSpanId] = useState<string | null>(null);
  const [hoveredSpan, setHoveredSpan] = useState<TraceSpanView | null>(null);

  const toggleType = (type: string) => {
    setTypeFilters((prev) => ({ ...prev, [type]: !prev[type] }));
  };

  // Filter spans
  const filteredSpans = useMemo(() => {
    const now = Date.now();
    const cutoff = timeRange === Infinity ? 0 : now - timeRange;
    return spans.filter((s) => {
      if (s.endMs < cutoff) return false;
      if (agentFilter !== 'all' && s.agentId !== agentFilter) return false;
      if (!typeFilters[s.spanType]) return false;
      return true;
    });
  }, [spans, agentFilter, typeFilters, timeRange]);

  // Time range for positioning
  const minTs = filteredSpans.length > 0 ? Math.min(...filteredSpans.map((s) => s.startMs)) : Date.now();
  const maxTs = filteredSpans.length > 0 ? Math.max(...filteredSpans.map((s) => s.endMs)) : Date.now();
  const timeSpan = Math.max(maxTs - minTs, 1000);

  // Build tree structure for nesting
  const rootSpans = useMemo(() => {
    const childMap = new Map<string, TraceSpanView[]>();
    const roots: TraceSpanView[] = [];
    for (const s of filteredSpans) {
      if (s.parentSpanId && filteredSpans.some((p) => p.id === s.parentSpanId)) {
        const children = childMap.get(s.parentSpanId) ?? [];
        children.push(s);
        childMap.set(s.parentSpanId, children);
      } else {
        roots.push(s);
      }
    }
    return { roots, childMap };
  }, [filteredSpans]);

  // Flatten tree with depth for rendering
  const flatList = useMemo(() => {
    const result: Array<{ span: TraceSpanView; depth: number }> = [];
    function walk(span: TraceSpanView, depth: number) {
      result.push({ span, depth });
      const children = rootSpans.childMap.get(span.id) ?? [];
      for (const child of children.sort((a, b) => a.startMs - b.startMs)) {
        walk(child, depth + 1);
      }
    }
    for (const root of rootSpans.roots.sort((a, b) => a.startMs - b.startMs)) {
      walk(root, 0);
    }
    return result;
  }, [rootSpans]);

  // Unique agent names for the dropdown
  const agentOptions = useMemo(() => {
    const ids = new Set(spans.map((s) => s.agentId));
    return [...ids].map((id) => {
      const agent = agents.find((a) => a.id === id);
      return { id, name: agent?.name ?? id.slice(0, 12) };
    });
  }, [spans, agents]);

  if (spans.length === 0) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: '#3a5a48', fontSize: 12, fontFamily: 'Consolas, monospace' }}>
        No trace data yet. Spans are recorded as agent events arrive.
      </div>
    );
  }

  const ROW_HEIGHT = 28;
  const BAR_HEIGHT = 16;
  const INDENT_PX = 20;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: 'Consolas, monospace', padding: 16, boxSizing: 'border-box', gap: 10 }}>
      {hoveredSpan && (
        createPortal(
          <div style={TOOLTIP_STYLE}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#90d898', marginBottom: 4 }}>{hoveredSpan.name}</div>
            <div style={{ fontSize: 11, color: SPAN_COLORS[hoveredSpan.spanType] ?? '#6a9a78', marginBottom: 2 }}>
              {SPAN_LABELS[hoveredSpan.spanType] ?? hoveredSpan.spanType}
            </div>
            <div style={{ fontSize: 11, color: '#6a9a78', marginBottom: 2 }}>Duration: {hoveredSpan.durationMs}ms</div>
            <div style={{ fontSize: 10, color: '#4a6a58' }}>
              {new Date(hoveredSpan.startMs).toLocaleTimeString()} - {new Date(hoveredSpan.endMs).toLocaleTimeString()}
            </div>
            {Object.keys(hoveredSpan.metadata).length > 0 && (
              <div style={{ marginTop: 4, fontSize: 10, color: '#4a7a58' }}>
                {Object.entries(hoveredSpan.metadata).slice(0, 5).map(([k, v]) => (
                  <div key={k}>{k}: {typeof v === 'object' ? JSON.stringify(v) : String(v)}</div>
                ))}
              </div>
            )}
          </div>,
          document.body,
        )
      )}

      {/* Filter controls */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
        {/* Agent filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: '#4a7a58' }}>Agent:</span>
          <select
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
            style={{
              background: '#0c1318',
              color: '#90d898',
              border: '1px solid #1a3020',
              borderRadius: 2,
              fontSize: 11,
              fontFamily: 'Consolas, monospace',
              padding: '2px 4px',
            }}
          >
            <option value="all">All Agents</option>
            {agentOptions.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>

        {/* Span type checkboxes */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {Object.entries(SPAN_COLORS).map(([type, color]) => (
            <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }} onClick={() => toggleType(type)}>
              <div style={{ ...checkboxStyle(typeFilters[type] ?? true), background: (typeFilters[type] ?? true) ? color : 'transparent', borderColor: color }} />
              <span style={{ fontSize: 10, color: (typeFilters[type] ?? true) ? '#6a9a78' : '#3a5a48' }}>
                {SPAN_LABELS[type]}
              </span>
            </div>
          ))}
        </div>

        {/* Time range */}
        <div style={{ display: 'flex', gap: 4 }}>
          {TIME_RANGES.map((tr) => (
            <button
              key={tr.label}
              type="button"
              style={filterButtonStyle(timeRange === tr.ms)}
              onClick={() => setTimeRange(tr.ms)}
            >
              {tr.label}
            </button>
          ))}
        </div>

        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#3a6a48' }}>{filteredSpans.length} spans</span>
      </div>

      {/* Waterfall view */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minHeight: 0 }}>
        {flatList.map(({ span, depth }) => {
          const leftPercent = ((span.startMs - minTs) / timeSpan) * 100;
          const widthPercent = Math.max(0.5, ((span.endMs - span.startMs) / timeSpan) * 100);
          const isExpanded = expandedSpanId === span.id;
          const color = SPAN_COLORS[span.spanType] ?? '#4a7a58';

          return (
            <div key={span.id}>
              <div
                style={{
                  height: ROW_HEIGHT,
                  display: 'flex',
                  alignItems: 'center',
                  borderBottom: '1px solid rgba(30,60,40,0.15)',
                  cursor: 'pointer',
                  paddingLeft: depth * INDENT_PX,
                }}
                onClick={() => setExpandedSpanId(isExpanded ? null : span.id)}
                onMouseEnter={() => setHoveredSpan(span)}
                onMouseLeave={() => setHoveredSpan(null)}
              >
                {/* Name label */}
                <div style={{
                  width: 160 - depth * INDENT_PX,
                  flexShrink: 0,
                  fontSize: 11,
                  color: '#8aaa92',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  paddingRight: 8,
                }}>
                  {span.name}
                </div>

                {/* Bar */}
                <div style={{ flex: 1, position: 'relative', height: BAR_HEIGHT }}>
                  <div style={{
                    position: 'absolute',
                    left: `${leftPercent}%`,
                    width: `${widthPercent}%`,
                    height: BAR_HEIGHT,
                    background: color,
                    borderRadius: 2,
                    opacity: 0.85,
                    minWidth: 3,
                  }} />
                </div>

                {/* Duration */}
                <div style={{
                  width: 60,
                  flexShrink: 0,
                  fontSize: 10,
                  color: '#5a8a6a',
                  textAlign: 'right',
                  paddingRight: 4,
                }}>
                  {span.durationMs}ms
                </div>
              </div>

              {/* Expanded metadata */}
              {isExpanded && (
                <div style={{
                  padding: '6px 12px 6px',
                  paddingLeft: depth * INDENT_PX + 12,
                  background: 'rgba(10,20,16,0.6)',
                  borderBottom: '1px solid rgba(30,60,40,0.25)',
                }}>
                  <div style={{ fontSize: 10, color: '#4a7a58', marginBottom: 4 }}>
                    Span: {span.id} | Run: {span.runId.slice(0, 12)} | Agent: {span.agentId.slice(0, 12)}
                  </div>
                  <div style={{ fontSize: 10, color: '#4a7a58', marginBottom: 4 }}>
                    {new Date(span.startMs).toLocaleTimeString()} - {new Date(span.endMs).toLocaleTimeString()}
                  </div>
                  {Object.keys(span.metadata).length > 0 && (
                    <div style={{ fontSize: 10, color: '#5a8a6a' }}>
                      {Object.entries(span.metadata).map(([k, v]) => (
                        <div key={k} style={{ marginBottom: 2 }}>
                          <span style={{ color: '#6a9a78' }}>{k}</span>: {typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Aggregate breakdown */}
      {Object.keys(aggregate).length > 0 && (
        <div style={{ flexShrink: 0, borderTop: '1px solid #1a3020', paddingTop: 8 }}>
          <div style={{ fontSize: 11, color: '#4a7a58', marginBottom: 6, fontWeight: 600 }}>Time Distribution</div>
          <div style={{ display: 'flex', gap: 4, height: 16, borderRadius: 2, overflow: 'hidden', marginBottom: 6 }}>
            {Object.entries(aggregate).map(([type, percent]) => (
              <div
                key={type}
                style={{
                  width: `${percent}%`,
                  background: SPAN_COLORS[type] ?? '#4a7a58',
                  minWidth: percent > 0 ? 2 : 0,
                }}
                title={`${SPAN_LABELS[type] ?? type}: ${percent}%`}
              />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {Object.entries(aggregate).map(([type, percent]) => (
              <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{ width: 8, height: 8, borderRadius: 1, background: SPAN_COLORS[type] ?? '#4a7a58' }} />
                <span style={{ fontSize: 10, color: '#5a8a6a' }}>{SPAN_LABELS[type] ?? type}: {percent}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
