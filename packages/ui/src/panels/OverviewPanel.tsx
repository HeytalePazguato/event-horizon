/**
 * Full-width Overview panel for Operations view.
 * Shows agent metrics at comfortable size, or singularity stats for "All Agents".
 * @event-horizon/ui
 */

import type { FC } from 'react';
import { useCommandCenterStore } from '../store.js';
import type { SingularityStats } from '../store.js';
import type { AgentMetrics, AgentState } from '@event-horizon/core';
import { PlanetIcon, SingularityIcon } from './AgentIdentity.js';
import { folderName } from '../utils.js';

import { formatTokens, formatCost, formatDuration } from '../utils/formatters.js';

// ── Styles ───────────────────────────────────────────────────────────────────

const cellStyle: React.CSSProperties = {
  background: 'rgba(10,20,15,0.5)',
  border: '1px solid #1a3020',
  borderRadius: 3,
  padding: '8px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#4a7a58',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};

const valStyle: React.CSSProperties = {
  fontSize: 16,
  color: '#90d898',
  fontWeight: 600,
};

const stateColors: Record<string, string> = {
  idle: '#4a8a5a',
  thinking: '#d4a84a',
  working: '#b8a040',
  tool_use: '#6aa0d4',
  waiting: '#d4944a',
  error: '#c65858',
};

// ── Tool breakdown bar chart ─────────────────────────────────────────────────

const ToolBreakdown: FC<{ breakdown: Record<string, number> }> = ({ breakdown }) => {
  const entries = Object.entries(breakdown).sort(([, a], [, b]) => b - a).slice(0, 8);
  const max = entries.length > 0 ? entries[0][1] : 1;
  if (entries.length === 0) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ ...labelStyle, marginBottom: 4 }}>Tool Breakdown</div>
      {entries.map(([name, count]) => (
        <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
          <span style={{ width: 50, fontSize: 11, color: '#6a9a78', textAlign: 'right', flexShrink: 0 }}>{name}</span>
          <div style={{ flex: 1, height: 6, background: '#0a1a10', borderRadius: 2 }}>
            <div style={{ width: `${(count / max) * 100}%`, height: '100%', background: '#2a7a4a', borderRadius: 2 }} />
          </div>
          <span style={{ fontSize: 11, color: '#5a8a6a', width: 30, flexShrink: 0 }}>{count}</span>
        </div>
      ))}
    </div>
  );
};

// ── Agent Overview ───────────────────────────────────────────────────────────

const AgentOverview: FC<{ agent: AgentState; metrics: AgentMetrics }> = ({ agent, metrics }) => {
  const m = metrics;
  const loadPct = Math.round(m.load * 100);
  const successRate = m.toolCalls > 0
    ? Math.round(((m.toolCalls - m.toolFailures) / m.toolCalls) * 100)
    : 100;
  const uptime = formatDuration(Date.now() - m.sessionStartedAt);
  const lastActive = formatDuration(Date.now() - m.lastUpdated);

  return (
    <div style={{ padding: 16, overflowY: 'auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <PlanetIcon type={agent.type} size={44} />
        <div>
          <div style={{ fontSize: 14, color: '#c8e4b0', fontWeight: 600 }}>{agent.name}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
            <span style={{ fontSize: 12, color: '#5a8a6a', textTransform: 'uppercase' }}>{agent.type}</span>
            <span style={{ fontSize: 12, color: stateColors[agent.state] ?? '#7a8a82' }}>{agent.state}</span>
            {agent.cwd && (
              <span style={{ fontSize: 12, color: '#4a7a5a' }}>{folderName(agent.cwd)}</span>
            )}
          </div>
        </div>
      </div>

      {/* Metrics grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 8 }}>
        <div style={cellStyle}><div style={labelStyle}>Load</div><div style={valStyle}>{loadPct}%</div></div>
        <div style={cellStyle}><div style={labelStyle}>Tools</div><div style={valStyle}>{m.toolCalls}</div></div>
        <div style={cellStyle}><div style={labelStyle}>Prompts</div><div style={valStyle}>{m.promptsSubmitted}</div></div>
        <div style={cellStyle}><div style={labelStyle}>Errors</div><div style={{ ...valStyle, color: m.errorCount > 0 ? '#c65858' : '#90d898' }}>{m.errorCount}</div></div>
        <div style={cellStyle}><div style={labelStyle}>Success</div><div style={valStyle}>{successRate}%</div></div>
        <div style={cellStyle}><div style={labelStyle}>Sub-agents</div><div style={valStyle}>{m.activeSubagents}/{m.subagentSpawns}</div></div>
        <div style={cellStyle}><div style={labelStyle}>Uptime</div><div style={valStyle}>{uptime}</div></div>
        <div style={cellStyle}><div style={labelStyle}>Last Active</div><div style={valStyle}>{lastActive}</div></div>
        <div style={cellStyle}><div style={labelStyle}>Tokens</div><div style={valStyle}>{formatTokens(m.inputTokens + m.outputTokens)}</div></div>
        <div style={cellStyle}><div style={labelStyle}>Cost</div><div style={valStyle}>{formatCost(m.estimatedCostUsd)}</div></div>
        <div style={cellStyle}><div style={labelStyle}>Tasks</div><div style={valStyle}>{m.activeTasks}</div></div>
        <div style={cellStyle}><div style={labelStyle}>Prompts/min</div><div style={valStyle}>{m.sessionStartedAt > 0 ? ((m.promptsSubmitted / Math.max(1, (Date.now() - m.sessionStartedAt) / 60000))).toFixed(1) : '-'}</div></div>
      </div>

      <ToolBreakdown breakdown={m.toolBreakdown} />
    </div>
  );
};

// ── Singularity / All Agents Overview ────────────────────────────────────────

const AllAgentsOverview: FC<{
  stats: SingularityStats;
  agentMap: Record<string, AgentState>;
  metricsMap: Record<string, AgentMetrics>;
}> = ({ stats, agentMap, metricsMap }) => {
  const agents = Object.values(agentMap);
  const uptime = stats.firstEventAt ? formatDuration(Date.now() - stats.firstEventAt) : '-';

  return (
    <div style={{ padding: 16, overflowY: 'auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <SingularityIcon size={44} />
        <div>
          <div style={{ fontSize: 14, color: '#c8e4b0', fontWeight: 600 }}>All Agents</div>
          <div style={{ fontSize: 12, color: '#5a8a6a', marginTop: 2 }}>
            {agents.length} connected · {stats.eventsWitnessed} events · {uptime} uptime
          </div>
        </div>
      </div>

      {/* Global stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 16 }}>
        <div style={cellStyle}><div style={labelStyle}>Agents</div><div style={valStyle}>{stats.agentsSeen}</div></div>
        <div style={cellStyle}><div style={labelStyle}>Events</div><div style={valStyle}>{stats.eventsWitnessed}</div></div>
        <div style={cellStyle}><div style={labelStyle}>Errors</div><div style={{ ...valStyle, color: stats.errorsWitnessed > 0 ? '#c65858' : '#90d898' }}>{stats.errorsWitnessed}</div></div>
        <div style={cellStyle}><div style={labelStyle}>Uptime</div><div style={valStyle}>{uptime}</div></div>
        <div style={cellStyle}><div style={labelStyle}>Tokens</div><div style={valStyle}>{formatTokens(stats.totalTokens)}</div></div>
        <div style={cellStyle}><div style={labelStyle}>Cost</div><div style={valStyle}>{formatCost(stats.totalCostUsd)}</div></div>
        <div style={cellStyle}><div style={labelStyle}>Ships</div><div style={valStyle}>{stats.shipsObserved}</div></div>
        <div style={cellStyle}><div style={labelStyle}>Consumed</div><div style={valStyle}>{stats.planetsSwallowed + stats.astronautsConsumed + stats.ufosConsumed}</div></div>
      </div>

      {/* Agent summary table */}
      {agents.length > 0 && (
        <>
          <div style={{ ...labelStyle, marginBottom: 6 }}>Agent Summary</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #1a3020' }}>
                  {['Agent', 'State', 'Load', 'Tools', 'Errors', 'Tokens', 'Cost'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '4px 8px', color: '#4a7a58', fontWeight: 600, fontSize: 9 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => {
                  const m = metricsMap[a.id];
                  return (
                    <tr key={a.id} style={{ borderBottom: '1px solid rgba(30,60,40,0.2)' }}>
                      <td style={{ padding: '4px 8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <PlanetIcon type={a.type} size={14} />
                          <div>
                            <span style={{ color: '#8aaa92' }}>{a.name}</span>
                            {a.cwd && <span style={{ color: '#4a7a5a', fontSize: 10, marginLeft: 6 }}>{folderName(a.cwd)}</span>}
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '4px 8px', color: stateColors[a.state] ?? '#7a8a82' }}>{a.state}</td>
                      <td style={{ padding: '4px 8px', color: '#7a9a82' }}>{m ? `${Math.round(m.load * 100)}%` : '-'}</td>
                      <td style={{ padding: '4px 8px', color: '#7a9a82' }}>{m?.toolCalls ?? '-'}</td>
                      <td style={{ padding: '4px 8px', color: m?.errorCount ? '#c65858' : '#7a9a82' }}>{m?.errorCount ?? 0}</td>
                      <td style={{ padding: '4px 8px', color: '#7a9a82' }}>{m ? formatTokens(m.inputTokens + m.outputTokens) : '-'}</td>
                      <td style={{ padding: '4px 8px', color: '#7a9a82' }}>{m ? formatCost(m.estimatedCostUsd) : '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};

// ── Main Export ───────────────────────────────────────────────────────────────

export interface OverviewPanelProps {
  agentMap: Record<string, AgentState>;
  metricsMap: Record<string, AgentMetrics>;
}

export const OverviewPanel: FC<OverviewPanelProps> = ({ agentMap, metricsMap }) => {
  const selectedAgentId = useCommandCenterStore((s) => s.selectedAgentId);
  const selectedAgent = selectedAgentId ? agentMap[selectedAgentId] : null;
  const selectedMetrics = selectedAgentId ? metricsMap[selectedAgentId] : null;
  const singularityStats = useCommandCenterStore((s) => s.singularityStats);

  if (selectedAgent && selectedMetrics) {
    return <AgentOverview agent={selectedAgent} metrics={selectedMetrics} />;
  }

  return <AllAgentsOverview stats={singularityStats} agentMap={agentMap} metricsMap={metricsMap} />;
};
