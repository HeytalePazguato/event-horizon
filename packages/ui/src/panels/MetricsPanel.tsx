/**
 * Center panel: agent metrics + logs + medals tabs.
 * @event-horizon/ui
 */

import type { FC } from 'react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useCommandCenterStore } from '../store.js';
import type { LogEntry, SingularityStats } from '../store.js';
import { ACHIEVEMENTS, getMedal, TIER_LABELS, tierBorderColor } from '../achievements/index.js';
import { SkillsPanel } from './SkillsPanel.js';

/** Renders a medal by achievement ID. */
const MedalById: FC<{ id: string; size?: number }> = ({ id, size }) => {
  const Medal = getMedal(id);
  return <Medal size={size} />;
};

const LogsView: FC<{ entries: LogEntry[] }> = ({ entries }) => (
  <div style={{ fontFamily: 'Consolas, monospace', fontSize: 9, color: '#7a9a82', overflowY: 'auto', maxHeight: 85, lineHeight: 1.5 }}>
    {entries.length === 0 ? (
      <span style={{ color: '#4a5a52' }}>No events yet.</span>
    ) : entries.map((e) => (
      <div key={e.id} style={{ borderBottom: '1px solid rgba(50,80,60,0.3)', paddingBottom: 1, marginBottom: 1 }}>
        <span style={{ color: '#4a8a6a' }}>{e.ts}</span>
        {' '}
        <span style={{ color: '#8ab880' }}>[{e.agentName}]</span>
        {' '}
        <span style={{ color: e.skillName ? '#44ddff' : '#a0c090' }}>{e.type}</span>
        {e.skillName && (
          <span style={{ color: '#44ddff', marginLeft: 4, fontSize: 8 }}>/{e.skillName}</span>
        )}
      </div>
    ))}
  </div>
);

// ── Medal tooltip (portal, same pattern as CmdTooltip in AgentControls) ──────

const MedalTooltip: FC<{ ach: typeof ACHIEVEMENTS[number]; unlocked: boolean; tier?: number; count?: number }> = ({ ach, unlocked, tier, count }) =>
  createPortal(
    <div
      style={{
        position: 'fixed',
        bottom: 212,
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
      <div style={{ fontSize: 11, fontWeight: 700, color: '#90d898', letterSpacing: '0.04em', marginBottom: 4 }}>
        {ach.name}
        {unlocked && ach.tiers && tier != null ? ` ${TIER_LABELS[tier]}` : ''}
        {unlocked && ach.tiers && count != null ? (
          <span style={{ color: '#4a7a58', fontWeight: 400, fontSize: 9 }}>
            {' '}({count}{tier != null && tier < ach.tiers.length - 1 ? ` / ${ach.tiers[tier + 1]}` : ''})
          </span>
        ) : null}
      </div>
      <div style={{ fontSize: 9, color: '#4a7a58', lineHeight: 1.5 }}>
        {unlocked ? ach.desc : (ach.secret ? 'Figure this one out yourself\u2026' : ach.desc)}
      </div>
    </div>,
    document.body
  );

const MedalsView: FC = () => {
  const unlockedIds = useCommandCenterStore((s) => s.unlockedAchievements);
  const achievementTiers = useCommandCenterStore((s) => s.achievementTiers);
  const achievementCounts = useCommandCenterStore((s) => s.achievementCounts);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const unlockedSet = new Set(unlockedIds);
  const hovered = hoveredId ? ACHIEVEMENTS.find((a) => a.id === hoveredId) : null;

  return (
    <>
      {hovered && (
        <MedalTooltip
          ach={hovered}
          unlocked={unlockedSet.has(hovered.id)}
          tier={achievementTiers[hovered.id]}
          count={achievementCounts[hovered.id]}
        />
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {ACHIEVEMENTS.map((ach) => {
          const unlocked = unlockedSet.has(ach.id);
          const tier = achievementTiers[ach.id];
          const borderColor = unlocked && ach.tiers ? tierBorderColor(tier) : undefined;
          return (
            <div
              key={ach.id}
              onMouseEnter={() => setHoveredId(ach.id)}
              onMouseLeave={() => setHoveredId(null)}
              style={{
                cursor: 'default',
                opacity: hoveredId && hoveredId !== ach.id ? 0.55 : 1,
                position: 'relative',
                ...(borderColor ? { border: `2px solid ${borderColor}`, borderRadius: 4, boxShadow: `0 0 6px ${borderColor}66` } : {}),
                ...(!unlocked ? { filter: 'brightness(0) saturate(0)', opacity: hoveredId === ach.id ? 0.5 : 0.25, border: '1px solid #2a4a3a', borderRadius: 4 } : {}),
              }}
            >
              <MedalById id={ach.id} size={28} />
              {unlocked && ach.tiers && tier != null && (
                <span style={{
                  position: 'absolute',
                  bottom: 0,
                  right: 0,
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
    </>
  );
};

function formatTokens(n: number): string {
  if (n <= 0) return '-';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function formatCost(usd: number): string {
  if (usd <= 0) return '-';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 10) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(1)}`;
}

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

const SingularityView: FC<{ stats: SingularityStats }> = ({ stats }) => {
  const uptime = stats.firstEventAt ? formatDuration(Date.now() - stats.firstEventAt) : '-';
  const consumed = stats.planetsSwallowed + stats.astronautsConsumed + stats.ufosConsumed;
  return (
    <div style={gridStyle}>
      {/* Row 1 — physical objects */}
      <div style={cellStyle}>
        <div style={labelStyle}>Planets</div>
        <div style={{ ...valStyle, color: '#d4844a' }}>{stats.planetsSwallowed}</div>
      </div>
      <div style={cellStyle}>
        <div style={labelStyle}>Astros</div>
        <div style={{ ...valStyle, color: '#d4844a' }}>{stats.astronautsConsumed}</div>
      </div>
      <div style={cellStyle}>
        <div style={labelStyle}>UFOs</div>
        <div style={{ ...valStyle, color: '#d4844a' }}>{stats.ufosConsumed}</div>
      </div>
      <div style={cellStyle}>
        <div style={labelStyle}>Cows</div>
        <div style={valStyle}>{stats.cowsAbducted}</div>
      </div>
      <div style={cellStyle}>
        <div style={labelStyle}>Ships</div>
        <div style={valStyle}>{stats.shipsObserved}</div>
      </div>
      {/* Row 2 — cosmic observations */}
      <div style={cellStyle}>
        <div style={labelStyle}>Agents</div>
        <div style={valStyle}>{stats.agentsSeen}</div>
      </div>
      <div style={cellStyle}>
        <div style={labelStyle}>Events</div>
        <div style={valStyle}>{stats.eventsWitnessed}</div>
      </div>
      <div style={cellStyle}>
        <div style={labelStyle}>Errors</div>
        <div style={stats.errorsWitnessed > 0 ? errStyle : valStyle}>{stats.errorsWitnessed}</div>
      </div>
      <div style={cellStyle}>
        <div style={labelStyle}>Uptime</div>
        <div style={valStyle}>{uptime}</div>
      </div>
      <div style={cellStyle}>
        <div style={labelStyle}>Consumed</div>
        <div style={{ ...valStyle, color: '#d4844a', fontSize: 9 }}>{consumed}</div>
      </div>
      {/* Row 3 — token/cost totals */}
      <div style={cellStyle}>
        <div style={labelStyle}>Tokens</div>
        <div style={{ ...valStyle, color: '#88ccff' }}>{formatTokens(stats.totalTokens)}</div>
      </div>
      <div style={cellStyle}>
        <div style={labelStyle}>Cost</div>
        <div style={{ ...valStyle, color: '#ffcc44' }}>{formatCost(stats.totalCostUsd)}</div>
      </div>
    </div>
  );
};

type View = 'info' | 'logs' | 'medals' | 'skills';

export interface MetricsPanelProps {
  onOpenSkill?: (filePath: string) => void;
  onCreateSkill?: () => void;
  onOpenMarketplace?: () => void;
  onMoveSkill?: (filePath: string, newCategory: string) => void;
  onDuplicateSkill?: (filePath: string, newName: string) => void;
}

export const MetricsPanel: FC<MetricsPanelProps> = ({ onOpenSkill, onCreateSkill, onOpenMarketplace, onMoveSkill, onDuplicateSkill } = {}) => {
  const selectedMetrics = useCommandCenterStore((s) => s.selectedMetrics);
  const selectedAgentId = useCommandCenterStore((s) => s.selectedAgentId);
  const singularitySelected = useCommandCenterStore((s) => s.singularitySelected);
  const singularityStats    = useCommandCenterStore((s) => s.singularityStats);
  const logsOpen        = useCommandCenterStore((s) => s.logsOpen);
  const closeLogs       = useCommandCenterStore((s) => s.closeLogs);
  const allLogs         = useCommandCenterStore((s) => s.logs);
  const unlockedCount   = useCommandCenterStore((s) => s.unlockedAchievements.length);
  const skillsCount     = useCommandCenterStore((s) => s.skills.length);
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
    <div style={{ display: 'flex', marginBottom: 4, gap: 4, flexShrink: 0 }}>
      <button type="button" style={tabStyle(effectiveView === 'info')} onClick={() => setEffectiveView('info')}>Info</button>
      <button type="button" style={tabStyle(effectiveView === 'logs')} onClick={() => setEffectiveView('logs')}>
        Logs{(effectiveView === 'logs' ? agentLogs : allLogs).length > 0 ? ` (${(effectiveView === 'logs' ? agentLogs : allLogs).length})` : ''}
      </button>
      <button type="button" style={tabStyle(effectiveView === 'medals')} onClick={() => setEffectiveView('medals')}>
        Medals ({unlockedCount}/{ACHIEVEMENTS.length})
      </button>
      <button type="button" style={tabStyle(effectiveView === 'skills')} onClick={() => setEffectiveView('skills')}>
        Skills{skillsCount > 0 ? ` (${skillsCount})` : ''}
      </button>
    </div>
  );

  if (!selectedMetrics) {
    return (
      <div data-metrics-panel>
        {tabs}
        {effectiveView === 'logs' && <LogsView entries={agentLogs} />}
        {effectiveView === 'medals' && <MedalsView />}
        {effectiveView === 'skills' && <SkillsPanel onOpenSkill={onOpenSkill} onCreateSkill={onCreateSkill} onOpenMarketplace={onOpenMarketplace} onMoveSkill={onMoveSkill} onDuplicateSkill={onDuplicateSkill} />}

        {effectiveView === 'info' && singularitySelected && (
          <SingularityView stats={singularityStats} />
        )}
        {effectiveView === 'info' && !singularitySelected && (
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
      {effectiveView === 'skills' && <SkillsPanel onOpenSkill={onOpenSkill} onCreateSkill={onCreateSkill} onOpenMarketplace={onOpenMarketplace} onMoveSkill={onMoveSkill} onDuplicateSkill={onDuplicateSkill} />}
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
          {/* Row 3 — token/cost */}
          <div style={cellStyle}>
            <div style={labelStyle}>Tokens</div>
            <div style={{ ...valStyle, color: '#88ccff' }}>{formatTokens(m.inputTokens + m.outputTokens)}</div>
          </div>
          <div style={cellStyle}>
            <div style={labelStyle}>Cost</div>
            <div style={{ ...valStyle, color: '#ffcc44' }}>{formatCost(m.estimatedCostUsd)}</div>
          </div>
        </div>
      )}
    </div>
  );
};
