/**
 * Knowledge Panel — shared knowledge entries grouped by scope.
 * Part of the Operations Dashboard (Phase 1).
 * @event-horizon/ui
 */

import type { FC } from 'react';
import { useState, useCallback } from 'react';
import { colors, fonts, sizes } from '../styles/tokens.js';

// ── Types ──────────────────────────────────────────────────────────────────

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
}

export interface KnowledgePanelProps {
  workspace: KnowledgeEntry[];
  plan: KnowledgeEntry[];
  planName?: string;
  onAdd: (key: string, value: string, scope: 'workspace' | 'plan', validUntil?: number) => void;
  onEdit: (key: string, value: string, scope: 'workspace' | 'plan', validUntil?: number) => void;
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

const AddForm: FC<{ scope: 'workspace' | 'plan'; onSave: (key: string, value: string, scope: 'workspace' | 'plan', validUntil?: number) => void; onCancel: () => void }> = ({ scope, onSave, onCancel }) => {
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [expiration, setExpiration] = useState<string>('Never');

  const handleSave = useCallback(() => {
    const k = key.trim();
    const v = value.trim();
    if (!k || !v) return;
    onSave(k, v, scope, expirationFromPreset(expiration));
    setKey('');
    setValue('');
    setExpiration('Never');
    onCancel();
  }, [key, value, scope, expiration, onSave, onCancel]);

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
  onEdit: (key: string, value: string, scope: 'workspace' | 'plan', validUntil?: number) => void;
  onDelete: (key: string, scope: 'workspace' | 'plan') => void;
}> = ({ entry, onEdit, onDelete }) => {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(entry.value);
  const [editExpiration, setEditExpiration] = useState<string>(
    entry.validUntil ? 'Keep current' : 'Never'
  );

  const isTruncated = entry.value.length > TRUNCATE_LENGTH;
  const displayValue = expanded || !isTruncated ? entry.value : entry.value.slice(0, TRUNCATE_LENGTH) + '...';
  const isExpired = entry.validUntil !== undefined && entry.validUntil < Date.now();

  const handleSaveEdit = useCallback(() => {
    const v = editValue.trim();
    if (!v) return;
    // "Keep current" → preserve existing validUntil; preset → recompute; "Never" → undefined
    let validUntil: number | undefined;
    if (editExpiration === 'Keep current') validUntil = entry.validUntil;
    else validUntil = expirationFromPreset(editExpiration);
    onEdit(entry.key, v, entry.scope, validUntil);
    setEditing(false);
  }, [editValue, editExpiration, entry.key, entry.scope, entry.validUntil, onEdit]);

  // Quick-action: Extend an expired entry by 24h (resets its validUntil)
  const handleExtend = useCallback(() => {
    onEdit(entry.key, entry.value, entry.scope, Date.now() + 24 * 60 * 60 * 1000);
  }, [entry.key, entry.value, entry.scope, onEdit]);

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
  scope: 'workspace' | 'plan';
  entries: KnowledgeEntry[];
  onAdd: (key: string, value: string, scope: 'workspace' | 'plan', validUntil?: number) => void;
  onEdit: (key: string, value: string, scope: 'workspace' | 'plan', validUntil?: number) => void;
  onDelete: (key: string, scope: 'workspace' | 'plan') => void;
}> = ({ title, description, scope, entries, onAdd, onEdit, onDelete }) => {
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
        title="Workspace (always-loaded)"
        description="Persistent facts loaded into every agent session — tech stack, project conventions, key paths. Keep this small (~10-30 entries) since every spawned agent pays the token cost upfront. Use 'never expire' for stable facts; set expiration for time-bound rules."
        scope="workspace"
        entries={filteredWorkspace}
        onAdd={onAdd}
        onEdit={onEdit}
        onDelete={onDelete}
      />
      <Section
        title={`Plan: ${planName ?? 'none'} (on-demand)`}
        description="Scoped to the active plan — task findings, debugging notes, decisions discovered during execution. Loaded only when an agent reads from this plan. Set expirations for facts that won't matter once the plan completes."
        scope="plan"
        entries={filteredPlan}
        onAdd={onAdd}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    </div>
  );
};
