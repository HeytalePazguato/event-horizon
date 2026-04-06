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
}

export interface KnowledgePanelProps {
  workspace: KnowledgeEntry[];
  plan: KnowledgeEntry[];
  planName?: string;
  onAdd: (key: string, value: string, scope: 'workspace' | 'plan') => void;
  onEdit: (key: string, value: string, scope: 'workspace' | 'plan') => void;
  onDelete: (key: string, scope: 'workspace' | 'plan') => void;
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

const AddForm: FC<{ scope: 'workspace' | 'plan'; onSave: (key: string, value: string, scope: 'workspace' | 'plan') => void; onCancel: () => void }> = ({ scope, onSave, onCancel }) => {
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');

  const handleSave = useCallback(() => {
    const k = key.trim();
    const v = value.trim();
    if (!k || !v) return;
    onSave(k, v, scope);
    setKey('');
    setValue('');
    onCancel();
  }, [key, value, scope, onSave, onCancel]);

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
  onEdit: (key: string, value: string, scope: 'workspace' | 'plan') => void;
  onDelete: (key: string, scope: 'workspace' | 'plan') => void;
}> = ({ entry, onEdit, onDelete }) => {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(entry.value);

  const isTruncated = entry.value.length > TRUNCATE_LENGTH;
  const displayValue = expanded || !isTruncated ? entry.value : entry.value.slice(0, TRUNCATE_LENGTH) + '...';

  const handleSaveEdit = useCallback(() => {
    const v = editValue.trim();
    if (!v) return;
    onEdit(entry.key, v, entry.scope);
    setEditing(false);
  }, [editValue, entry.key, entry.scope, onEdit]);

  return (
    <div style={{
      padding: `${sizes.spacing.xs}px ${sizes.spacing.sm}px`,
      background: colors.bg.secondary,
      border: `1px solid ${colors.border.primary}`,
      borderRadius: sizes.radius.sm,
      fontSize: sizes.text.sm,
    }}>
      {/* Header: key + actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: sizes.spacing.xs }}>
        <span style={{ color: colors.text.primary, fontWeight: 600 }}>{entry.key}</span>
        <span style={{ color: colors.text.dim, fontSize: sizes.text.xs, marginLeft: 'auto', flexShrink: 0 }}>
          {entry.author} &middot; {relativeTime(entry.updatedAt)}
        </span>
        <button
          type="button"
          onClick={() => { setEditing(!editing); setEditValue(entry.value); }}
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
  scope: 'workspace' | 'plan';
  entries: KnowledgeEntry[];
  onAdd: (key: string, value: string, scope: 'workspace' | 'plan') => void;
  onEdit: (key: string, value: string, scope: 'workspace' | 'plan') => void;
  onDelete: (key: string, scope: 'workspace' | 'plan') => void;
}> = ({ title, scope, entries, onAdd, onEdit, onDelete }) => {
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

  const filterEntries = useCallback((entries: KnowledgeEntry[]): KnowledgeEntry[] => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    // Exact scope match
    if (q === 'workspace' || q === 'plan') {
      return entries.filter((e) => e.scope === q);
    }
    return entries.filter((e) =>
      e.key.toLowerCase().includes(q) ||
      e.author.toLowerCase().includes(q) ||
      e.value.toLowerCase().includes(q)
    );
  }, [search]);

  const filteredWorkspace = filterEntries(workspace);
  const filteredPlan = filterEntries(plan);

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
        title="Workspace (persistent)"
        scope="workspace"
        entries={filteredWorkspace}
        onAdd={onAdd}
        onEdit={onEdit}
        onDelete={onDelete}
      />
      <Section
        title={`Plan: ${planName ?? 'none'} (active)`}
        scope="plan"
        entries={filteredPlan}
        onAdd={onAdd}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    </div>
  );
};
