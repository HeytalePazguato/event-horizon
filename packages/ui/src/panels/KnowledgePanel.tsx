/**
 * Knowledge Panel — shared knowledge entries grouped by scope.
 * Part of the Operations Dashboard (Phase 1).
 * @event-horizon/ui
 */

import type { FC } from 'react';
import React, { useState, useCallback } from 'react';
import { colors, fonts, sizes } from '../styles/tokens.js';

// ── Types ──────────────────────────────────────────────────────────────────

export type KnowledgeTier = 'L0' | 'L1' | 'L2';

export interface KnowledgeEntry {
  key: string;
  value: string;
  scope: 'workspace' | 'plan';
  author: string;
  authorId: string;
  createdAt: number;
  updatedAt: number;
  validFrom?: number;
  validUntil?: number;
  /** MemPalace-inspired loading tier. Defaults: workspace = L1, plan = L2. L0 = critical identity. */
  tier?: KnowledgeTier;
}

// ── Tier metadata (MemPalace-inspired loading tiers) ───────────────────────

interface TierInfo {
  id: KnowledgeTier | 'L3';
  label: string;
  shortName: string;
  color: string;
  description: string;
  tokenBudget: string;
}

const TIER_INFO: Record<'L0' | 'L1' | 'L2' | 'L3', TierInfo> = {
  L0: {
    id: 'L0', label: 'L0 — Identity', shortName: 'L0',
    color: '#ff6688', tokenBudget: '~50-100 tok',
    description: 'Critical project identity. Loaded into every agent session. Keep tiny — what is this project, what tech stack, hard rules.',
  },
  L1: {
    id: 'L1', label: 'L1 — Essentials', shortName: 'L1',
    color: '#88aaff', tokenBudget: '~500-800 tok',
    description: 'Always-loaded essentials: build/test/lint commands, key directories, core conventions. The bulk of workspace knowledge.',
  },
  L2: {
    id: 'L2', label: 'L2 — On-Demand', shortName: 'L2',
    color: '#88ffaa', tokenBudget: 'loaded per topic',
    description: 'Plan-scoped knowledge. Loaded only when an agent reads from this plan. Task findings, debugging notes, decisions.',
  },
  L3: {
    id: 'L3', label: 'L3 — Deep Search', shortName: 'L3',
    color: '#ffaa44', tokenBudget: 'loaded on query',
    description: 'Persisted event history. Searched on demand via eh_search_events or the Logs tab search bar. The full audit trail.',
  },
};

function getEffectiveTier(entry: KnowledgeEntry): KnowledgeTier {
  if (entry.tier) return entry.tier;
  return entry.scope === 'workspace' ? 'L1' : 'L2';
}

export interface KnowledgePanelProps {
  workspace: KnowledgeEntry[];
  plan: KnowledgeEntry[];
  planName?: string;
  onAdd: (key: string, value: string, scope: 'workspace' | 'plan', validUntil?: number, tier?: KnowledgeTier) => void;
  onEdit: (key: string, value: string, scope: 'workspace' | 'plan', validUntil?: number, tier?: KnowledgeTier) => void;
  onDelete: (key: string, scope: 'workspace' | 'plan') => void;
}

// ── Expiration presets (MemPalace-inspired temporal validity) ──────────────

const EXPIRATION_PRESETS: Array<{ label: string; ms: number | null }> = [
  { label: 'Never', ms: null },
  { label: '1 hour', ms: 60 * 60 * 1000 },
  { label: '6 hours', ms: 6 * 60 * 60 * 1000 },
  { label: '24 hours', ms: 24 * 60 * 60 * 1000 },
  { label: '7 days', ms: 7 * 24 * 60 * 60 * 1000 },
  { label: '30 days', ms: 30 * 24 * 60 * 60 * 1000 },
];

function expirationFromPreset(label: string): number | undefined {
  const preset = EXPIRATION_PRESETS.find((p) => p.label === label);
  if (!preset || preset.ms === null) return undefined;
  return Date.now() + preset.ms;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function relativeTime(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const TRUNCATE_LENGTH = 200;

// ── Inline add form ────────────────────────────────────────────────────────

const AddForm: FC<{ scope: 'workspace' | 'plan'; onSave: (key: string, value: string, scope: 'workspace' | 'plan', validUntil?: number, tier?: KnowledgeTier) => void; onCancel: () => void }> = ({ scope, onSave, onCancel }) => {
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [expiration, setExpiration] = useState<string>('Never');
  // Workspace defaults to L1 (essentials). Plan is always L2 (no choice).
  const [tier, setTier] = useState<KnowledgeTier>(scope === 'workspace' ? 'L1' : 'L2');

  const handleSave = useCallback(() => {
    const k = key.trim();
    const v = value.trim();
    if (!k || !v) return;
    onSave(k, v, scope, expirationFromPreset(expiration), tier);
    setKey('');
    setValue('');
    setExpiration('Never');
    setTier(scope === 'workspace' ? 'L1' : 'L2');
    onCancel();
  }, [key, value, scope, expiration, tier, onSave, onCancel]);

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '3px 6px',
    fontSize: sizes.text.sm,
    fontFamily: fonts.mono,
    background: colors.bg.primary,
    border: `1px solid ${colors.border.accent}`,
    borderRadius: sizes.radius.sm,
    color: colors.text.primary,
    outline: 'none',
    boxSizing: 'border-box',
  };

  return (
    <div style={{
      padding: sizes.spacing.sm,
      background: colors.bg.secondary,
      border: `1px solid ${colors.border.accent}`,
      borderRadius: sizes.radius.sm,
      marginTop: sizes.spacing.xs,
      display: 'flex',
      flexDirection: 'column',
      gap: sizes.spacing.xs,
    }}>
      <input
        type="text"
        placeholder="Key"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        style={inputStyle}
      />
      <textarea
        placeholder="Value"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={3}
        style={{ ...inputStyle, resize: 'vertical' }}
      />
      {/* Tier picker — only meaningful for workspace (plan entries are always L2) */}
      {scope === 'workspace' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: sizes.spacing.xs }}>
          <label style={{ fontSize: sizes.text.xs, color: colors.text.dim, fontFamily: fonts.mono, flexShrink: 0 }}>
            Tier:
          </label>
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value as KnowledgeTier)}
            style={{ ...inputStyle, width: 'auto', flex: 1, cursor: 'pointer' }}
            title="L0 = critical identity (keep tiny). L1 = essentials. Both load into every agent session."
          >
            <option value="L0">L0 — Identity (~50-100 tok, critical)</option>
            <option value="L1">L1 — Essentials (~500-800 tok, default)</option>
          </select>
        </div>
      )}

      {/* Expiration — MemPalace temporal validity. Default "Never" preserves prior behavior. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: sizes.spacing.xs }}>
        <label style={{ fontSize: sizes.text.xs, color: colors.text.dim, fontFamily: fonts.mono, flexShrink: 0 }}>
          Expires after:
        </label>
        <select
          value={expiration}
          onChange={(e) => setExpiration(e.target.value)}
          style={{
            ...inputStyle,
            width: 'auto',
            flex: 1,
            cursor: 'pointer',
          }}
          title="When this entry should auto-expire. Expired entries are excluded from agent reads by default but still visible in the UI."
        >
          {EXPIRATION_PRESETS.map((p) => (
            <option key={p.label} value={p.label}>{p.label}</option>
          ))}
        </select>
      </div>
      <div style={{ display: 'flex', gap: sizes.spacing.xs, justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={onCancel}
          style={{
            padding: '2px 8px',
            fontSize: sizes.text.xs,
            fontFamily: fonts.mono,
            background: 'transparent',
            border: `1px solid ${colors.border.primary}`,
            borderRadius: sizes.radius.sm,
            color: colors.text.dim,
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          style={{
            padding: '2px 8px',
            fontSize: sizes.text.xs,
            fontFamily: fonts.mono,
            background: 'rgba(30,70,45,0.3)',
            border: `1px solid ${colors.border.active}`,
            borderRadius: sizes.radius.sm,
            color: colors.text.primary,
            cursor: 'pointer',
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
};

// ── Entry row ──────────────────────────────────────────────────────────────

const EntryRow: FC<{
  entry: KnowledgeEntry;
  onEdit: (key: string, value: string, scope: 'workspace' | 'plan', validUntil?: number, tier?: KnowledgeTier) => void;
  onDelete: (key: string, scope: 'workspace' | 'plan') => void;
}> = ({ entry, onEdit, onDelete }) => {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(entry.value);
  const [editExpiration, setEditExpiration] = useState<string>(
    entry.validUntil ? 'Keep current' : 'Never'
  );
  const [editTier, setEditTier] = useState<KnowledgeTier>(getEffectiveTier(entry));

  const isTruncated = entry.value.length > TRUNCATE_LENGTH;
  const displayValue = expanded || !isTruncated ? entry.value : entry.value.slice(0, TRUNCATE_LENGTH) + '...';
  const isExpired = entry.validUntil !== undefined && entry.validUntil < Date.now();
  const effectiveTier = getEffectiveTier(entry);
  const tierMeta = TIER_INFO[effectiveTier];

  const handleSaveEdit = useCallback(() => {
    const v = editValue.trim();
    if (!v) return;
    // "Keep current" → preserve existing validUntil; preset → recompute; "Never" → undefined
    let validUntil: number | undefined;
    if (editExpiration === 'Keep current') validUntil = entry.validUntil;
    else validUntil = expirationFromPreset(editExpiration);
    onEdit(entry.key, v, entry.scope, validUntil, editTier);
    setEditing(false);
  }, [editValue, editExpiration, editTier, entry.key, entry.scope, entry.validUntil, onEdit]);

  // Quick-action: Extend an expired entry by 24h (resets its validUntil, preserves tier)
  const handleExtend = useCallback(() => {
    onEdit(entry.key, entry.value, entry.scope, Date.now() + 24 * 60 * 60 * 1000, entry.tier);
  }, [entry.key, entry.value, entry.scope, entry.tier, onEdit]);

  return (
    <div style={{
      padding: `${sizes.spacing.xs}px ${sizes.spacing.sm}px`,
      background: colors.bg.secondary,
      border: `1px solid ${colors.border.primary}`,
      borderRadius: sizes.radius.sm,
      fontSize: sizes.text.sm,
      opacity: entry.validUntil && entry.validUntil < Date.now() ? 0.4 : 1,
    }}>
      {/* Header: key + actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: sizes.spacing.xs }}>
        <span style={{
          color: entry.validUntil && entry.validUntil < Date.now() ? colors.text.dim : colors.text.primary,
          fontWeight: 600,
          textDecoration: entry.validUntil && entry.validUntil < Date.now() ? 'line-through' : 'none',
        }}>{entry.key}</span>
        {/* Tier badge — MemPalace loading tier */}
        <span
          title={`${tierMeta.label} (${tierMeta.tokenBudget}) — ${tierMeta.description}`}
          style={{
            fontSize: sizes.text.xs, fontWeight: 700,
            color: tierMeta.color,
            background: `${tierMeta.color}1f`,
            border: `1px solid ${tierMeta.color}66`,
            borderRadius: 3, padding: '0 4px',
            fontFamily: fonts.mono,
          }}
        >
          {tierMeta.shortName}
        </span>
        {entry.validUntil && entry.validUntil < Date.now() && (
          <span style={{
            fontSize: sizes.text.xs, color: '#cc4444', fontWeight: 600,
            padding: '0 4px', background: 'rgba(204,68,68,0.12)', borderRadius: 3,
          }}>EXPIRED</span>
        )}
        {entry.validUntil && entry.validUntil >= Date.now() && (
          <span style={{ fontSize: sizes.text.xs, color: '#cc8833' }}>
            expires {relativeTime(entry.validUntil).replace(' ago', '')}
          </span>
        )}
        <span style={{ color: colors.text.dim, fontSize: sizes.text.xs, marginLeft: 'auto', flexShrink: 0 }}>
          {entry.author} &middot; {relativeTime(entry.updatedAt)}
        </span>
        {isExpired && (
          <button
            type="button"
            onClick={handleExtend}
            title="Extend by 24 hours"
            style={{
              background: 'rgba(204,136,51,0.15)',
              border: '1px solid #cc8833',
              color: '#cc8833',
              cursor: 'pointer',
              padding: '0 6px',
              fontSize: sizes.text.xs,
              fontFamily: fonts.mono,
              borderRadius: 3,
            }}
          >
            +24h
          </button>
        )}
        <button
          type="button"
          onClick={() => { setEditing(!editing); setEditValue(entry.value); setEditExpiration(entry.validUntil ? 'Keep current' : 'Never'); }}
          title="Edit"
          style={{
            background: 'transparent',
            border: 'none',
            color: colors.text.dim,
            cursor: 'pointer',
            padding: '0 2px',
            fontSize: sizes.text.xs,
            fontFamily: fonts.mono,
          }}
        >
          &#9998;
        </button>
        <button
          type="button"
          onClick={() => onDelete(entry.key, entry.scope)}
          title="Delete"
          style={{
            background: 'transparent',
            border: 'none',
            color: colors.text.dim,
            cursor: 'pointer',
            padding: '0 2px',
            fontSize: sizes.text.xs,
            fontFamily: fonts.mono,
          }}
        >
          &#10005;
        </button>
      </div>

      {/* Value or edit form */}
      {editing ? (
        <div style={{ marginTop: sizes.spacing.xs, display: 'flex', flexDirection: 'column', gap: sizes.spacing.xs }}>
          <textarea
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            rows={3}
            style={{
              width: '100%',
              padding: '3px 6px',
              fontSize: sizes.text.sm,
              fontFamily: fonts.mono,
              background: colors.bg.primary,
              border: `1px solid ${colors.border.accent}`,
              borderRadius: sizes.radius.sm,
              color: colors.text.primary,
              outline: 'none',
              resize: 'vertical',
              boxSizing: 'border-box',
            }}
          />
          {/* Tier picker (workspace only — plan entries are always L2) */}
          {entry.scope === 'workspace' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: sizes.spacing.xs }}>
              <label style={{ fontSize: sizes.text.xs, color: colors.text.dim, fontFamily: fonts.mono, flexShrink: 0 }}>
                Tier:
              </label>
              <select
                value={editTier}
                onChange={(e) => setEditTier(e.target.value as KnowledgeTier)}
                style={{
                  width: 'auto', flex: 1,
                  padding: '3px 6px',
                  fontSize: sizes.text.sm, fontFamily: fonts.mono,
                  background: colors.bg.primary,
                  border: `1px solid ${colors.border.accent}`,
                  borderRadius: sizes.radius.sm,
                  color: colors.text.primary, outline: 'none', cursor: 'pointer',
                }}
              >
                <option value="L0">L0 — Identity (~50-100 tok, critical)</option>
                <option value="L1">L1 — Essentials (~500-800 tok, default)</option>
              </select>
            </div>
          )}

          {/* Expiration — preserved by default (Keep current), can be reset to never or a preset */}
          <div style={{ display: 'flex', alignItems: 'center', gap: sizes.spacing.xs }}>
            <label style={{ fontSize: sizes.text.xs, color: colors.text.dim, fontFamily: fonts.mono, flexShrink: 0 }}>
              Expires after:
            </label>
            <select
              value={editExpiration}
              onChange={(e) => setEditExpiration(e.target.value)}
              style={{
                width: 'auto', flex: 1,
                padding: '3px 6px',
                fontSize: sizes.text.sm,
                fontFamily: fonts.mono,
                background: colors.bg.primary,
                border: `1px solid ${colors.border.accent}`,
                borderRadius: sizes.radius.sm,
                color: colors.text.primary,
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              {entry.validUntil && <option value="Keep current">Keep current ({relativeTime(entry.validUntil).replace(' ago', '')} {entry.validUntil < Date.now() ? 'ago — expired' : 'left'})</option>}
              {EXPIRATION_PRESETS.map((p) => (
                <option key={p.label} value={p.label}>{p.label}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', gap: sizes.spacing.xs, justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => setEditing(false)}
              style={{
                padding: '2px 8px',
                fontSize: sizes.text.xs,
                fontFamily: fonts.mono,
                background: 'transparent',
                border: `1px solid ${colors.border.primary}`,
                borderRadius: sizes.radius.sm,
                color: colors.text.dim,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveEdit}
              style={{
                padding: '2px 8px',
                fontSize: sizes.text.xs,
                fontFamily: fonts.mono,
                background: 'rgba(30,70,45,0.3)',
                border: `1px solid ${colors.border.active}`,
                borderRadius: sizes.radius.sm,
                color: colors.text.primary,
                cursor: 'pointer',
              }}
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <div
          style={{
            marginTop: 2,
            color: colors.text.secondary,
            fontSize: sizes.text.sm,
            lineHeight: 1.4,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            cursor: isTruncated ? 'pointer' : 'default',
          }}
          onClick={isTruncated ? () => setExpanded(!expanded) : undefined}
        >
          {displayValue}
        </div>
      )}
    </div>
  );
};

// ── Section (collapsible) ──────────────────────────────────────────────────

const Section: FC<{
  title: string;
  description?: string;
  tierBadges?: KnowledgeTier[];
  scope: 'workspace' | 'plan';
  entries: KnowledgeEntry[];
  onAdd: (key: string, value: string, scope: 'workspace' | 'plan', validUntil?: number, tier?: KnowledgeTier) => void;
  onEdit: (key: string, value: string, scope: 'workspace' | 'plan', validUntil?: number, tier?: KnowledgeTier) => void;
  onDelete: (key: string, scope: 'workspace' | 'plan') => void;
}> = ({ title, description, tierBadges, scope, entries, onAdd, onEdit, onDelete }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);

  return (
    <div style={{ marginBottom: sizes.spacing.md }}>
      {/* Section header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: sizes.spacing.xs,
        marginBottom: sizes.spacing.xs,
        cursor: 'pointer',
      }}>
        <span
          onClick={() => setCollapsed(!collapsed)}
          style={{
            fontSize: sizes.text.xs,
            color: colors.text.dim,
            userSelect: 'none',
            width: 12,
            textAlign: 'center',
          }}
        >
          {collapsed ? '\u25B6' : '\u25BC'}
        </span>
        <span
          onClick={() => setCollapsed(!collapsed)}
          style={{
            fontSize: sizes.text.sm,
            color: colors.text.primary,
            fontWeight: 600,
            letterSpacing: '0.04em',
          }}
        >
          {title}
        </span>
        {tierBadges?.map((t) => {
          const tm = TIER_INFO[t];
          return (
            <span
              key={t}
              title={`${tm.label} (${tm.tokenBudget}) — ${tm.description}`}
              style={{
                fontSize: sizes.text.xs, fontWeight: 700,
                color: tm.color, background: `${tm.color}1f`,
                border: `1px solid ${tm.color}66`,
                borderRadius: 3, padding: '0 4px',
                fontFamily: fonts.mono,
              }}
            >
              {tm.shortName}
            </span>
          );
        })}
        <span style={{
          fontSize: sizes.text.xs,
          color: colors.text.dim,
          marginLeft: 4,
        }}>
          ({entries.length})
        </span>
        <button
          type="button"
          onClick={() => { setShowAddForm(!showAddForm); setCollapsed(false); }}
          style={{
            marginLeft: 'auto',
            padding: '1px 6px',
            fontSize: sizes.text.xs,
            fontFamily: fonts.mono,
            background: 'transparent',
            border: `1px solid ${colors.border.accent}`,
            borderRadius: sizes.radius.sm,
            color: colors.text.secondary,
            cursor: 'pointer',
          }}
        >
          + Add
        </button>
      </div>

      {/* Section description (visible when not collapsed) */}
      {description && !collapsed && (
        <div style={{
          fontSize: sizes.text.xs, color: colors.text.dim,
          marginBottom: sizes.spacing.xs, marginLeft: 18,
          fontStyle: 'italic', lineHeight: 1.4,
        }}>
          {description}
        </div>
      )}

      {/* Add form */}
      {showAddForm && (
        <AddForm scope={scope} onSave={onAdd} onCancel={() => setShowAddForm(false)} />
      )}

      {/* Entries */}
      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: sizes.spacing.xs }}>
          {entries.map((entry) => (
            <EntryRow key={entry.key} entry={entry} onEdit={onEdit} onDelete={onDelete} />
          ))}
          {entries.length === 0 && !showAddForm && (
            <div style={{ fontSize: sizes.text.xs, color: colors.text.dim, padding: sizes.spacing.xs }}>
              No entries yet.
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Main component ─────────────────────────────────────────────────────────

export const KnowledgePanel: FC<KnowledgePanelProps> = ({ workspace, plan, planName, onAdd, onEdit, onDelete }) => {
  const [search, setSearch] = useState('');
  const [showExpired, setShowExpired] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  const filterEntries = useCallback((entries: KnowledgeEntry[]): KnowledgeEntry[] => {
    const now = Date.now();
    let result = entries;
    // Temporal filter — by default hide expired entries (they're still in the data, just hidden)
    if (!showExpired) {
      result = result.filter((e) => !e.validUntil || e.validUntil > now);
    }
    const q = search.trim().toLowerCase();
    if (!q) return result;
    // Exact scope match
    if (q === 'workspace' || q === 'plan') {
      return result.filter((e) => e.scope === q);
    }
    return result.filter((e) =>
      e.key.toLowerCase().includes(q) ||
      e.author.toLowerCase().includes(q) ||
      e.value.toLowerCase().includes(q)
    );
  }, [search, showExpired]);

  const filteredWorkspace = filterEntries(workspace);
  const filteredPlan = filterEntries(plan);

  // Stats — total / active / expired / expiring soon (next 24h)
  const allEntries = [...workspace, ...plan];
  const now = Date.now();
  const stats = {
    total: allEntries.length,
    expired: allEntries.filter((e) => e.validUntil !== undefined && e.validUntil < now).length,
    expiringSoon: allEntries.filter((e) => e.validUntil !== undefined && e.validUntil >= now && e.validUntil < now + 24 * 60 * 60 * 1000).length,
    permanent: allEntries.filter((e) => !e.validUntil).length,
  };
  const active = stats.total - stats.expired;

  return (
    <div style={{
      padding: sizes.spacing.lg,
      fontFamily: fonts.mono,
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      boxSizing: 'border-box',
      overflowY: 'auto',
    }}>
      {/* Info banner — explains the 4-tier knowledge loading model (collapsible, default closed) */}
      <div style={{ marginBottom: sizes.spacing.sm, flexShrink: 0 }}>
        <button
          type="button"
          onClick={() => setShowInfo((v) => !v)}
          style={{
            background: 'transparent', border: 'none',
            color: colors.text.dim, cursor: 'pointer',
            padding: 0, fontFamily: fonts.mono, fontSize: sizes.text.xs,
            display: 'flex', alignItems: 'center', gap: 4,
          }}
          title="Show explanation of the knowledge loading tiers"
        >
          <span style={{ fontSize: 7, transform: showInfo ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', display: 'inline-block' }}>{'\u25B6'}</span>
          <span>ⓘ How knowledge loads into agents (L0–L3)</span>
        </button>
        {showInfo && (
          <div style={{
            marginTop: sizes.spacing.xs, padding: sizes.spacing.sm,
            background: colors.bg.secondary,
            border: `1px solid ${colors.border.primary}`,
            borderRadius: sizes.radius.sm,
            fontSize: sizes.text.xs, color: colors.text.secondary,
            lineHeight: 1.5,
          }}>
            <div style={{ marginBottom: sizes.spacing.xs }}>
              Event Horizon uses a 4-tier loading model inspired by the MemPalace memory system. Each tier costs different tokens depending on when it loads:
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto auto 1fr', gap: '4px 10px', alignItems: 'baseline' }}>
              {(['L0', 'L1', 'L2', 'L3'] as const).map((id) => {
                const t = TIER_INFO[id];
                return (
                  <React.Fragment key={id}>
                    <span style={{
                      fontSize: sizes.text.xs, fontWeight: 700,
                      color: t.color, background: `${t.color}1f`,
                      border: `1px solid ${t.color}66`,
                      borderRadius: 3, padding: '0 4px',
                      fontFamily: fonts.mono, textAlign: 'center',
                    }}>{t.shortName}</span>
                    <span style={{ color: colors.text.dim, whiteSpace: 'nowrap' }}>{t.tokenBudget}</span>
                    <span>{t.description}</span>
                  </React.Fragment>
                );
              })}
            </div>
            <div style={{ marginTop: sizes.spacing.sm, color: colors.text.dim }}>
              <strong style={{ color: colors.text.secondary }}>Mapping:</strong> Workspace entries default to L1 (mark critical ones as L0). Plan entries are L2. L3 is the persisted event history — search it via the Logs tab or <code>eh_search_events</code> MCP tool.
            </div>
            <div style={{ marginTop: sizes.spacing.xs, color: colors.text.dim }}>
              <strong style={{ color: colors.text.secondary }}>Goal:</strong> keep L0+L1 small (under ~1000 tokens combined) so agent wake-up cost is low. Use L2/L3 for everything else.
            </div>
          </div>
        )}
      </div>

      {/* Stats header — knowledge entry counts grouped by temporal validity */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: sizes.spacing.md, flexWrap: 'wrap',
        marginBottom: sizes.spacing.sm, flexShrink: 0,
        fontSize: sizes.text.xs, fontFamily: fonts.mono,
      }}>
        <span style={{ color: colors.text.dim, fontWeight: 600 }}>Entries:</span>
        <span style={{ color: colors.text.dim }} title="Entries that agents currently see (not expired)">
          <span style={{ color: colors.text.primary, fontWeight: 600 }}>{active}</span> active
        </span>
        {stats.permanent > 0 && (
          <span style={{ color: colors.text.dim }} title="Entries with no expiration set — never expire">
            <span style={{ color: colors.text.secondary }}>{stats.permanent}</span> never expire
          </span>
        )}
        {stats.expiringSoon > 0 && (
          <span style={{ color: '#cc8833' }} title="Entries that will expire within the next 24 hours">
            <span style={{ fontWeight: 600 }}>{stats.expiringSoon}</span> expiring within 24h
          </span>
        )}
        {stats.expired > 0 && (
          <span style={{ color: '#cc4444' }} title="Entries past their validUntil timestamp — excluded from agent reads by default">
            <span style={{ fontWeight: 600 }}>{stats.expired}</span> expired
          </span>
        )}
        <label
          style={{
            marginLeft: 'auto',
            display: 'flex', alignItems: 'center', gap: 4,
            cursor: 'pointer', color: colors.text.dim,
          }}
          title="When off, expired entries are hidden in this view (matches what agents see by default via eh_read_shared). Toggle on to inspect the full audit trail including stale entries."
        >
          <input
            type="checkbox"
            checked={showExpired}
            onChange={(e) => setShowExpired(e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
          Show expired entries
        </label>
      </div>

      {/* Search input */}
      <div style={{ marginBottom: sizes.spacing.md, flexShrink: 0 }}>
        <input
          type="text"
          placeholder="Search by key, author, value, or scope..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: '100%',
            padding: '5px 8px',
            fontSize: sizes.text.sm,
            fontFamily: fonts.mono,
            background: colors.bg.primary,
            border: `1px solid ${colors.border.primary}`,
            borderRadius: sizes.radius.sm,
            color: colors.text.primary,
            outline: 'none',
            boxSizing: 'border-box',
          }}
          onFocus={(e) => { (e.target as HTMLInputElement).style.borderColor = colors.border.accent; }}
          onBlur={(e) => { (e.target as HTMLInputElement).style.borderColor = colors.border.primary; }}
        />
      </div>
      <Section
        title="Workspace — always loaded"
        tierBadges={['L0', 'L1']}
        description="Persistent facts loaded into every agent session — tech stack, project conventions, key paths. Keep this small (~10-30 entries) since every spawned agent pays the token cost upfront. Mark critical entries as L0; default L1 for essentials."
        scope="workspace"
        entries={filteredWorkspace}
        onAdd={onAdd}
        onEdit={onEdit}
        onDelete={onDelete}
      />
      <Section
        title={`Plan: ${planName ?? 'none'} — on demand`}
        tierBadges={['L2']}
        description="Scoped to the active plan — task findings, debugging notes, decisions discovered during execution. Loaded only when an agent reads from this plan. Set expirations for facts that won't matter once the plan completes."
        scope="plan"
        entries={filteredPlan}
        onAdd={onAdd}
        onEdit={onEdit}
        onDelete={onDelete}
      />
      {/* L3 explainer card — directs users to event search instead of duplicating it here */}
      <div style={{
        marginTop: sizes.spacing.md,
        padding: sizes.spacing.sm,
        background: colors.bg.secondary,
        border: `1px dashed ${TIER_INFO.L3.color}66`,
        borderRadius: sizes.radius.sm,
        fontSize: sizes.text.xs, color: colors.text.dim,
        display: 'flex', alignItems: 'center', gap: sizes.spacing.sm,
      }}>
        <span style={{
          fontSize: sizes.text.xs, fontWeight: 700,
          color: TIER_INFO.L3.color, background: `${TIER_INFO.L3.color}1f`,
          border: `1px solid ${TIER_INFO.L3.color}66`,
          borderRadius: 3, padding: '0 4px',
          fontFamily: fonts.mono, flexShrink: 0,
        }}>L3</span>
        <span>
          <strong style={{ color: colors.text.secondary }}>Deep Search</strong> — full persisted event history is not stored in the Knowledge tab. Use the <strong style={{ color: colors.text.secondary }}>Logs tab search bar</strong> (Enter to search the DB) or the <code>eh_search_events</code> MCP tool to query historical agent activity.
        </span>
      </div>
    </div>
  );
};
