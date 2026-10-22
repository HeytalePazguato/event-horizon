/**
 * Cost Insights Panel — token usage analytics and optimization recommendations.
 * Part of the Operations Dashboard (Phase 5 — Token Optimization).
 * @event-horizon/ui
 */

import type { FC } from 'react';
import { useState } from 'react';
import type { Recommendation, RecommendationAction } from '@event-horizon/core';
import { colors, fonts, sizes } from '../styles/tokens.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface CostInsightsData {
  cacheHitRatio: number;
  cacheHitByAgent: Record<string, number>;
  compactionFrequency: Record<string, { count: number; avgIntervalMs: number }>;
  highPressureAgents: string[];
  duplicateReads: Array<{ file: string; agents: string[]; estimatedWasteTokens: number }>;
  anomalies: Array<{ agentId: string; taskId: string; costUsd: number; avgCostUsd: number; ratio: number }>;
  modelEfficiency: Record<string, { successRate: number; avgCost: number; attempts: number }>;
}

export interface ContextLayerBreakdown {
  systemPrompt: number;
  conversationHistory: number;
  toolResults: number;
  cachedTokens: number;
  totalUsed: number;
  contextWindowSize: number;
  usageRatio: number;
}

/** Feedback for a clicked recommendation, keyed by recommendation id. */
export interface RecommendationActionStatus {
  state: 'pending' | 'ok' | 'error';
  message: string;
}

export interface CostInsightsPanelProps {
  insights: CostInsightsData | null;
  recommendations: Recommendation[];
  contextLayers?: Record<string, ContextLayerBreakdown> | null;
  /** Called with the clicked recommendation; the host performs the action. */
  onRecommendationAction?: (recommendation: Recommendation) => void;
  /** Keys of shared-knowledge entries, so files already added show as such. */
  knowledgeKeys?: ReadonlySet<string>;
  actionStatus?: Record<string, RecommendationActionStatus>;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const ACTION_LABEL: Record<RecommendationAction['kind'], string> = {
  'add-to-knowledge': 'Add to Shared Knowledge',
  broadcast: 'Tell all agents',
  'open-file': 'Open file',
  'focus-agent': 'Show agent',
  'open-task': 'Open task',
};

/** Compare file paths the way the host writes knowledge keys (slashes and Windows case). */
export function samePath(a: string, b: string): boolean {
  const n = (p: string) => p.split('\\').join('/').replace(/^([a-zA-Z]):/, (_, d: string) => `${d.toLowerCase()}:`);
  const na = n(a);
  const nb = n(b);
  return na === nb || (/^[a-z]:/.test(na) && na.toLowerCase() === nb.toLowerCase());
}

export function isInKnowledge(file: string, keys: ReadonlySet<string> | undefined): boolean {
  if (!keys || keys.size === 0) return false;
  if (keys.has(file)) return true;
  for (const k of keys) if (samePath(k, file)) return true;
  return false;
}

/** Recommendation shape for a duplicate-read row, matching the analyzer's id. */
export function duplicateReadRecommendation(file: string): Recommendation {
  return { id: `dup:${file}`, kind: 'duplicate-read', severity: 'info', text: '', action: { kind: 'add-to-knowledge', filePath: file } };
}

const actionButtonStyle = {
  background: 'rgba(64,160,96,0.15)',
  border: '1px solid rgba(64,160,96,0.4)',
  borderRadius: sizes.radius.sm,
  color: '#40a060',
  fontSize: sizes.text.xs,
  fontFamily: fonts.mono,
  padding: '2px 8px',
  cursor: 'pointer',
  flexShrink: 0,
} as const;

const InKnowledgeBadge: FC = () => (
  <span data-testid="in-knowledge" style={{
    color: '#40a060', fontSize: sizes.text.xs, fontFamily: fonts.mono, flexShrink: 0,
    border: '1px solid rgba(64,160,96,0.25)', borderRadius: sizes.radius.sm, padding: '1px 6px',
  }}>In knowledge {'\u2713'}</span>
);

const StatusLine: FC<{ status?: RecommendationActionStatus }> = ({ status }) => {
  if (!status) return null;
  const color = status.state === 'error' ? '#cc4444' : status.state === 'ok' ? '#40a060' : colors.text.dim;
  return (
    <div data-testid="action-status" style={{ marginTop: 2, fontSize: sizes.text.xs, color }}>
      {status.state === 'pending' ? 'Working\u2026' : status.message}
    </div>
  );
};

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function ratioColor(ratio: number): string {
  if (ratio >= 0.6) return '#40a060';  // green — good
  if (ratio >= 0.3) return '#cc8833';  // amber — ok
  return '#cc4444';                     // red — poor
}

function pressureColor(avgIntervalMs: number): string {
  if (avgIntervalMs > 600_000) return '#40a060';  // green — rare (>10min)
  if (avgIntervalMs > 300_000) return '#cc8833';  // amber — frequent (5-10min)
  return '#cc4444';                                // red — critical (<5min)
}

// ── Section wrapper ────────────────────────────────────────────────────────

const Section: FC<{ title: string; children: React.ReactNode; count?: number }> = ({ title, children, count }) => (
  <div style={{ marginBottom: sizes.spacing.lg }}>
    <div style={{
      fontSize: sizes.text.sm, fontWeight: 600, color: colors.text.secondary,
      textTransform: 'uppercase', letterSpacing: '0.06em',
      marginBottom: sizes.spacing.sm,
      display: 'flex', alignItems: 'center', gap: sizes.spacing.xs,
    }}>
      {title}
      {count !== undefined && (
        <span style={{ fontSize: sizes.text.xs, color: colors.text.dim, fontWeight: 400 }}>({count})</span>
      )}
    </div>
    {children}
  </div>
);

// ── Panel ──────────────────────────────────────────────────────────────────

export const CostInsightsPanel: FC<CostInsightsPanelProps> = ({ insights, recommendations, contextLayers, onRecommendationAction, knowledgeKeys, actionStatus }) => {
  const [expandedDup, setExpandedDup] = useState<string | null>(null);

  const agentCacheEntries = insights ? Object.entries(insights.cacheHitByAgent) : [];
  const compactionEntries = insights ? Object.entries(insights.compactionFrequency) : [];
  const modelEntries = insights ? Object.entries(insights.modelEfficiency) : [];
  const contextLayerEntries = contextLayers ? Object.entries(contextLayers) : [];

  // Show empty state when there's no meaningful data at all
  const hasData = agentCacheEntries.length > 0 || compactionEntries.length > 0
    || modelEntries.length > 0 || (insights?.duplicateReads?.length ?? 0) > 0
    || (insights?.anomalies?.length ?? 0) > 0 || recommendations.length > 0
    || contextLayerEntries.length > 0;

  if (!insights || !hasData) {
    return (
      <div style={{
        padding: sizes.spacing.xl, color: colors.text.dim, fontFamily: fonts.mono,
        fontSize: sizes.text.md, textAlign: 'center', marginTop: 40,
      }}>
        <div style={{ fontSize: sizes.text.xl, marginBottom: sizes.spacing.md, color: colors.text.secondary }}>
          No Cost Data Yet
        </div>
        <div style={{ maxWidth: 420, margin: '0 auto', lineHeight: 1.6 }}>
          Cost insights appear once agents start processing tasks and sending hook events.
          Cache efficiency, compaction pressure, and duplicate reads are tracked automatically from agent tool calls.
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: sizes.spacing.lg, fontFamily: fonts.mono, overflowY: 'auto', height: '100%', boxSizing: 'border-box' }}>

      {/* ── Context Layers (MemPalace-inspired L0-L3 breakdown) ────────── */}
      {contextLayerEntries.length > 0 && (
        <Section title="Context Layers" count={contextLayerEntries.length}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: sizes.spacing.sm }}>
            {contextLayerEntries.map(([agentId, layer]) => {
              const total = layer.totalUsed;
              const window = layer.contextWindowSize;
              const usedK = Math.round(total / 1000);
              const windowK = Math.round(window / 1000);
              const usagePct = Math.round(layer.usageRatio * 100);
              const usageColor = layer.usageRatio < 0.5 ? '#40a060' : layer.usageRatio < 0.8 ? '#cc8833' : '#cc4444';

              // Widths for stacked bar segments (proportional to total used)
              const barTotal = layer.systemPrompt + layer.conversationHistory + layer.toolResults;
              const sysPct = barTotal > 0 ? (layer.systemPrompt / barTotal) * 100 : 0;
              const convPct = barTotal > 0 ? (layer.conversationHistory / barTotal) * 100 : 0;
              const toolPct = barTotal > 0 ? (layer.toolResults / barTotal) * 100 : 0;

              return (
                <div key={agentId} style={{ marginBottom: sizes.spacing.xs }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                    <span style={{ fontSize: sizes.text.sm, color: colors.text.primary, maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {agentId.slice(0, 24)}
                    </span>
                    <span style={{ fontSize: sizes.text.sm, color: usageColor, fontWeight: 600 }}>
                      {usedK}k / {windowK}k ({usagePct}%)
                    </span>
                  </div>
                  {/* Stacked bar */}
                  <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: 'rgba(255,255,255,0.05)' }}>
                    {sysPct > 0 && <div style={{ width: `${sysPct}%`, background: '#2a4a7f' }} title={`System: ${Math.round(layer.systemPrompt / 1000)}k`} />}
                    {convPct > 0 && <div style={{ width: `${convPct}%`, background: '#2a7f6f' }} title={`Conversation: ${Math.round(layer.conversationHistory / 1000)}k`} />}
                    {toolPct > 0 && <div style={{ width: `${toolPct}%`, background: '#7f6f2a' }} title={`Tools: ${Math.round(layer.toolResults / 1000)}k`} />}
                  </div>
                  {/* Legend */}
                  <div style={{ display: 'flex', gap: sizes.spacing.md, marginTop: 3, fontSize: sizes.text.xs, color: colors.text.dim }}>
                    <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#2a4a7f', marginRight: 3, verticalAlign: 'middle' }} />System</span>
                    <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#2a7f6f', marginRight: 3, verticalAlign: 'middle' }} />Conversation</span>
                    <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#7f6f2a', marginRight: 3, verticalAlign: 'middle' }} />Tools</span>
                    {layer.cachedTokens > 0 && <span style={{ color: '#666' }}>Cached: {Math.round(layer.cachedTokens / 1000)}k</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* ── Recommendations ──────────────────────────────────────────────── */}
      {recommendations.length > 0 && (
        <Section title="Recommendations" count={recommendations.length}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: sizes.spacing.xs }}>
            {recommendations.map((rec) => {
              const added = rec.action?.kind === 'add-to-knowledge' && isInKnowledge(rec.action.filePath, knowledgeKeys);
              const status = actionStatus?.[rec.id];
              const warn = rec.severity === 'warn';
              return (
                <div key={rec.id} data-testid="recommendation" style={{
                  padding: `${sizes.spacing.xs}px ${sizes.spacing.sm}px`,
                  background: warn ? 'rgba(204,68,68,0.08)' : 'rgba(204,136,51,0.08)',
                  border: `1px solid ${warn ? 'rgba(204,68,68,0.3)' : 'rgba(204,136,51,0.25)'}`,
                  borderRadius: sizes.radius.sm,
                  fontSize: sizes.text.sm, color: warn ? '#cc6666' : '#cc8833',
                  lineHeight: 1.4,
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: sizes.spacing.sm }}>
                    <span style={{ flex: 1 }}>{rec.text}</span>
                    {added ? <InKnowledgeBadge /> : rec.action && onRecommendationAction && (
                      <button
                        type="button"
                        disabled={status?.state === 'pending'}
                        onClick={() => onRecommendationAction(rec)}
                        style={actionButtonStyle}
                      >
                        {ACTION_LABEL[rec.action.kind]}
                      </button>
                    )}
                  </div>
                  <StatusLine status={status} />
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* ── Cache Efficiency ─────────────────────────────────────────────── */}
      {agentCacheEntries.length > 0 && <Section title="Cache Efficiency">
        <div style={{
          display: 'flex', alignItems: 'center', gap: sizes.spacing.md,
          marginBottom: sizes.spacing.sm,
        }}>
          <span style={{ fontSize: sizes.text.sm, color: colors.text.dim }}>Global:</span>
          <span style={{
            fontSize: sizes.text.lg, fontWeight: 600,
            color: ratioColor(insights.cacheHitRatio),
          }}>
            {pct(insights.cacheHitRatio)}
          </span>
          {/* Mini bar */}
          <div style={{
            flex: 1, height: 6, background: colors.bg.panel, borderRadius: 3, overflow: 'hidden',
          }}>
            <div style={{
              height: '100%', width: pct(insights.cacheHitRatio),
              background: ratioColor(insights.cacheHitRatio),
              borderRadius: 3, transition: 'width 0.3s',
            }} />
          </div>
        </div>
        {agentCacheEntries.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {agentCacheEntries.map(([agentId, ratio]) => (
              <div key={agentId} style={{
                display: 'flex', alignItems: 'center', gap: sizes.spacing.sm,
                fontSize: sizes.text.xs,
              }}>
                <span style={{ color: colors.text.dim, minWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {agentId}
                </span>
                <div style={{ flex: 1, height: 4, background: colors.bg.panel, borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', width: pct(ratio),
                    background: ratioColor(ratio), borderRadius: 2,
                  }} />
                </div>
                <span style={{ color: ratioColor(ratio), minWidth: 30, textAlign: 'right' }}>{pct(ratio)}</span>
              </div>
            ))}
          </div>
        )}
      </Section>}

      {/* ── Context Pressure ─────────────────────────────────────────────── */}
      {compactionEntries.length > 0 && (
        <Section title="Context Pressure" count={compactionEntries.length}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {compactionEntries.map(([agentId, freq]) => {
              const isHigh = insights.highPressureAgents.includes(agentId);
              const intervalMin = freq.avgIntervalMs > 0 ? Math.round(freq.avgIntervalMs / 60_000) : 0;
              return (
                <div key={agentId} style={{
                  display: 'flex', alignItems: 'center', gap: sizes.spacing.sm,
                  fontSize: sizes.text.xs,
                  padding: `1px ${sizes.spacing.xs}px`,
                  background: isHigh ? 'rgba(204,68,68,0.08)' : 'transparent',
                  borderRadius: sizes.radius.sm,
                }}>
                  <span style={{
                    width: 5, height: 5, borderRadius: '50%',
                    background: freq.avgIntervalMs > 0 ? pressureColor(freq.avgIntervalMs) : colors.text.dim,
                    flexShrink: 0,
                  }} />
                  <span style={{ color: colors.text.dim, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {agentId}
                  </span>
                  <span style={{ color: colors.text.secondary }}>{freq.count}x</span>
                  {intervalMin > 0 && (
                    <span style={{ color: colors.text.dim }}>avg {intervalMin}min</span>
                  )}
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* ── Duplicate Reads ──────────────────────────────────────────────── */}
      {insights.duplicateReads.length > 0 && (
        <Section title="Duplicate Reads" count={insights.duplicateReads.length}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: sizes.spacing.xs }}>
            {insights.duplicateReads.slice(0, 20).map((dup) => (
              <div key={dup.file} style={{
                padding: `${sizes.spacing.xs}px ${sizes.spacing.sm}px`,
                background: colors.bg.secondary,
                border: `1px solid ${colors.border.primary}`,
                borderRadius: sizes.radius.sm,
                fontSize: sizes.text.xs,
              }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: sizes.spacing.xs,
                  cursor: 'pointer',
                }} onClick={() => setExpandedDup(expandedDup === dup.file ? null : dup.file)}>
                  <span style={{ fontSize: 7, transform: expandedDup === dup.file ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', display: 'inline-block' }}>{'\u25B6'}</span>
                  <span style={{ color: colors.text.primary, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {dup.file}
                  </span>
                  {isInKnowledge(dup.file, knowledgeKeys) && <span data-testid="in-knowledge-mark" style={{ color: '#40a060', flexShrink: 0 }}>{'✓'}</span>}
                  <span style={{ color: '#cc8833', flexShrink: 0 }}>{dup.agents.length} agents</span>
                  <span style={{ color: colors.text.dim, flexShrink: 0 }}>~{dup.estimatedWasteTokens} tokens</span>
                </div>
                {expandedDup === dup.file && (
                  <div style={{ marginTop: sizes.spacing.xs, paddingLeft: sizes.spacing.sm }}>
                    <div style={{ color: colors.text.dim, marginBottom: 2 }}>
                      {dup.agents.join(', ')}
                    </div>
                    {/* The row stays after adding: it measures reads, and continued reads show whether the entry helps. */}
                    {isInKnowledge(dup.file, knowledgeKeys) ? <InKnowledgeBadge /> : onRecommendationAction && (
                      <button
                        type="button"
                        disabled={actionStatus?.[`dup:${dup.file}`]?.state === 'pending'}
                        onClick={() => onRecommendationAction(duplicateReadRecommendation(dup.file))}
                        style={actionButtonStyle}
                      >
                        Add to Shared Knowledge
                      </button>
                    )}
                    <StatusLine status={actionStatus?.[`dup:${dup.file}`]} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ── Cost Anomalies ───────────────────────────────────────────────── */}
      {insights.anomalies.length > 0 && (
        <Section title="Cost Anomalies" count={insights.anomalies.length}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {insights.anomalies.map((a) => (
              <div key={`${a.agentId}-${a.taskId}`} style={{
                display: 'flex', alignItems: 'center', gap: sizes.spacing.sm,
                fontSize: sizes.text.xs,
                padding: `1px ${sizes.spacing.xs}px`,
              }}>
                <span style={{ color: '#cc4444', fontWeight: 600 }}>{a.ratio.toFixed(1)}x</span>
                <span style={{ color: colors.text.dim }}>{a.taskId}</span>
                <span style={{ color: colors.text.primary }}>${a.costUsd.toFixed(2)}</span>
                <span style={{ color: colors.text.dim }}>avg ${a.avgCostUsd.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ── Model Efficiency ─────────────────────────────────────────────── */}
      {modelEntries.length > 0 && (
        <Section title="Model Efficiency" count={modelEntries.length}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr auto auto',
            gap: `2px ${sizes.spacing.md}px`,
            fontSize: sizes.text.xs,
          }}>
            {/* Header */}
            <span style={{ color: colors.text.dim, fontWeight: 600 }}>Model</span>
            <span style={{ color: colors.text.dim, fontWeight: 600 }}>Success Rate</span>
            <span style={{ color: colors.text.dim, fontWeight: 600 }}>Avg Cost</span>
            <span style={{ color: colors.text.dim, fontWeight: 600 }}>Attempts</span>
            {/* Rows */}
            {modelEntries.map(([model, stats]) => (
              <>
                <span key={`${model}-name`} style={{ color: colors.text.primary }}>{model}</span>
                <div key={`${model}-bar`} style={{ display: 'flex', alignItems: 'center', gap: sizes.spacing.xs }}>
                  <div style={{ flex: 1, height: 4, background: colors.bg.panel, borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', width: pct(stats.successRate),
                      background: ratioColor(stats.successRate), borderRadius: 2,
                    }} />
                  </div>
                  <span style={{ color: ratioColor(stats.successRate), minWidth: 28, textAlign: 'right' }}>{pct(stats.successRate)}</span>
                </div>
                <span key={`${model}-cost`} style={{ color: colors.text.secondary, textAlign: 'right' }}>
                  ${stats.avgCost.toFixed(3)}
                </span>
                <span key={`${model}-count`} style={{ color: colors.text.dim, textAlign: 'right' }}>
                  {stats.attempts}
                </span>
              </>
            ))}
          </div>
        </Section>
      )}

      {/* This shouldn't render since we check hasData above, but just in case */}
    </div>
  );
};
