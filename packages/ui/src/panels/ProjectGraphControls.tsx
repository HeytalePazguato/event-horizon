/**
 * Project Graph Controls — header strip above the canvas.
 *
 * Stats line, Build/Rebuild button, debounced search input, type/tag filter
 * pills. Sends graph-build-request and graph-browse-request via the supplied
 * api callback.
 *
 * Phase 8.3 of the Project Graph plan.
 */

import React, { useCallback, useEffect, useState } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────

export interface GraphStats {
  nodeCount: number;
  edgeCount: number;
  fileCount: number;
  lastBuildAt?: number;
  /**
   * `true` when a workspace folder is open (per-project graph DB is mounted).
   * `false` when no folder is open — UI shows an instructive empty state and
   * suppresses the Build button. Optional for backward compatibility.
   */
  workspaceOpen?: boolean;
}

export interface GraphBuildProgress {
  filesProcessed: number;
  filesTotal: number;
  phase: string;
}

export interface GraphFilter {
  type?: string;
  tag?: 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS';
  search?: string;
}

export type ClusterMode = 'none' | 'folder' | 'type';

export interface ProjectGraphControlsProps {
  stats: GraphStats | null;
  /**
   * Build progress streamed from the extension while a `/eh:optimize-context`
   * scan is in flight. The component renders the progress text but never
   * triggers a build — the skill is the sole trigger.
   */
  buildProgress: GraphBuildProgress | null;
  filter: GraphFilter;
  onFilterChange: (next: GraphFilter) => void;
  /**
   * Number of nodes currently rendered in the canvas (after the page cap).
   * When this is less than `totalMatching`, the controls render a "Showing N
   * of M" caption so users understand the cap exists. Optional for backward
   * compatibility — older callers omit it and the caption is hidden.
   */
  visibleCount?: number;
  /**
   * Number of nodes that match the current filter in the DB. Note this is
   * NOT the same as `stats.nodeCount` — the latter is the unfiltered total.
   * When equal to `visibleCount` (small graphs), the caption hides.
   */
  totalMatching?: number;
  /**
   * Active clustering mode (folder = top-level directory, type = node.type,
   * none = no clusters). Optional for back-compat with older callers.
   */
  clusterMode?: ClusterMode;
  onClusterModeChange?: (mode: ClusterMode) => void;
}

// ── Filter options ─────────────────────────────────────────────────────────

const TYPE_OPTIONS: { id: string | null; label: string }[] = [
  { id: null, label: 'All' },
  { id: 'function', label: 'Functions' },
  { id: 'class', label: 'Classes' },
  { id: 'module', label: 'Modules' },
  { id: 'doc_section', label: 'Docs' },
  { id: 'rationale', label: 'Rationale' },
  { id: 'agent_activity', label: 'Activity' },
  { id: 'knowledge', label: 'Knowledge' },
];

const TAG_OPTIONS: { id: string | null; label: string }[] = [
  { id: null, label: 'All' },
  { id: 'EXTRACTED', label: 'Extracted' },
  { id: 'INFERRED', label: 'Inferred' },
  { id: 'AMBIGUOUS', label: 'Ambiguous' },
];

// ── Style tokens (inline; matches existing panel aesthetic) ────────────────

const styles = {
  root: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
    padding: '8px 10px',
    background: 'rgba(10, 24, 16, 0.7)',
    borderBottom: '1px solid rgba(68, 187, 110, 0.25)',
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#cceedd',
  },
  topRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap' as const,
  },
  stats: {
    fontSize: 11,
    color: '#88cc99',
  },
  search: {
    flex: 1,
    minWidth: 160,
    padding: '4px 8px',
    background: 'rgba(20, 44, 32, 0.85)',
    border: '1px solid rgba(68, 187, 110, 0.4)',
    color: '#cceedd',
    borderRadius: 3,
    fontFamily: 'monospace',
    fontSize: 11,
  },
  pillRow: {
    display: 'flex',
    gap: 4,
    flexWrap: 'wrap' as const,
    fontSize: 10,
  },
  pill: {
    padding: '2px 8px',
    borderRadius: 10,
    // Decomposed into longhands. Mixing `border` shorthand with the
    // `borderColor` override on `pillActive` was leaving React unable
    // to reset the colour cleanly when a pill went from active back
    // to inactive — borderColor would stick at the active green and
    // the browser's focus outline would render through, making the
    // pill look like it had a black frame after click. Longhands
    // toggle cleanly.
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'rgba(68, 187, 110, 0.35)',
    background: 'transparent',
    color: '#88cc99',
    cursor: 'pointer',
    fontFamily: 'monospace',
    outline: 'none',
    boxShadow: 'none',
  },
  pillActive: {
    background: 'rgba(68, 255, 136, 0.15)',
    color: '#44ff88',
    borderColor: '#44ff88',
  },
  progress: {
    fontSize: 10,
    color: '#ffaa44',
  },
  emptyHint: {
    fontSize: 11,
    color: '#88cc99',
    fontStyle: 'italic' as const,
  },
  visibleCaption: {
    fontSize: 10,
    color: '#ffcc66',
    fontFamily: 'monospace',
  },
  emptyMatchHint: {
    fontSize: 10,
    color: '#ff8844',
    fontFamily: 'monospace',
    fontStyle: 'italic' as const,
  },
};

const TYPE_LABEL_PLURAL: Record<string, string> = {
  function: 'functions',
  class: 'classes',
  module: 'modules',
  doc_section: 'doc sections',
  rationale: 'rationale entries',
  agent_activity: 'activity entries',
  knowledge: 'knowledge entries',
};

// ── Component ──────────────────────────────────────────────────────────────

export const ProjectGraphControls: React.FC<ProjectGraphControlsProps> = ({
  stats,
  buildProgress,
  filter,
  onFilterChange,
  visibleCount,
  totalMatching,
  clusterMode = 'none',
  onClusterModeChange,
}) => {
  const [searchInput, setSearchInput] = useState(filter.search ?? '');

  // Debounce search input 200ms
  useEffect(() => {
    const handle = setTimeout(() => {
      if (searchInput !== (filter.search ?? '')) {
        onFilterChange({ ...filter, search: searchInput || undefined });
      }
    }, 200);
    return () => clearTimeout(handle);
  }, [searchInput, filter, onFilterChange]);

  const setType = useCallback(
    (id: string | null) => {
      onFilterChange({ ...filter, type: id ?? undefined });
    },
    [filter, onFilterChange],
  );

  const setTag = useCallback(
    (id: string | null) => {
      onFilterChange({ ...filter, tag: (id ?? undefined) as GraphFilter['tag'] });
    },
    [filter, onFilterChange],
  );

  const isBuilding = buildProgress !== null;
  const hasGraph = stats !== null && stats.nodeCount > 0;
  // `workspaceOpen` is only `false` when the extension explicitly told us no
  // folder is mounted. `undefined` (older messages) means assume open.
  const workspaceOpen = stats?.workspaceOpen !== false;

  return (
    <div style={styles.root}>
      <div style={styles.topRow}>
        {!workspaceOpen ? (
          <span style={styles.emptyHint}>
            Open a folder in VS Code to enable the project graph.
          </span>
        ) : hasGraph ? (
          <span style={styles.stats}>
            {formatStats(stats)}
          </span>
        ) : (
          <span style={styles.emptyHint}>
            No project graph yet — run <code>/eh:optimize-context</code> in any AI agent to build it.
          </span>
        )}

        {isBuilding && workspaceOpen ? (
          <span style={styles.progress}>
            Building: {buildProgress.filesProcessed} / {buildProgress.filesTotal} ({buildProgress.phase})
          </span>
        ) : null}

        <input
          type="text"
          style={styles.search}
          placeholder="Search nodes (label, type, properties)..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
      </div>

      {workspaceOpen && hasGraph && typeof visibleCount === 'number' && typeof totalMatching === 'number'
        ? renderVisibilityCaption(visibleCount, totalMatching, filter.type)
        : null}

      <div style={styles.pillRow}>
        <span style={{ color: '#557766', marginRight: 6 }}>type:</span>
        {TYPE_OPTIONS.map((opt) => {
          const active = (filter.type ?? null) === opt.id;
          return (
            <button
              key={opt.label}
              type="button"
              style={{ ...styles.pill, ...(active ? styles.pillActive : {}) }}
              onClick={() => setType(opt.id)}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {onClusterModeChange ? (
        <div style={styles.pillRow}>
          <span style={{ color: '#557766', marginRight: 6 }}>cluster by:</span>
          {(['none', 'folder', 'type'] as ClusterMode[]).map((mode) => {
            const active = clusterMode === mode;
            return (
              <button
                key={mode}
                type="button"
                style={{ ...styles.pill, ...(active ? styles.pillActive : {}) }}
                onClick={() => onClusterModeChange(mode)}
              >
                {mode === 'none' ? 'None' : mode === 'folder' ? 'Folder' : 'Type'}
              </button>
            );
          })}
        </div>
      ) : null}

      <div style={styles.pillRow}>
        <span style={{ color: '#557766', marginRight: 6 }}>tag:</span>
        {TAG_OPTIONS.map((opt) => {
          const active = (filter.tag ?? null) === opt.id;
          return (
            <button
              key={opt.label}
              type="button"
              style={{ ...styles.pill, ...(active ? styles.pillActive : {}) }}
              onClick={() => setTag(opt.id)}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};

function formatStats(s: GraphStats): string {
  const ago = s.lastBuildAt ? formatRelativeTime(s.lastBuildAt) : 'unknown';
  return `${s.nodeCount.toLocaleString()} nodes · ${s.edgeCount.toLocaleString()} edges · ${s.fileCount.toLocaleString()} files · last built ${ago}`;
}

function renderVisibilityCaption(
  visibleCount: number,
  totalMatching: number,
  filterType: string | undefined,
): React.ReactNode {
  // Total === visible: small graph or uncapped browse — no caption needed.
  if (visibleCount >= totalMatching) return null;

  // Filter active but zero matches: distinct empty-state hint.
  if (totalMatching === 0) {
    return (
      <span style={styles.emptyMatchHint}>
        0 nodes match the current filter — clear filters or change the search.
      </span>
    );
  }

  const noun = filterType ? TYPE_LABEL_PLURAL[filterType] ?? `${filterType} nodes` : 'nodes';
  return (
    <span style={styles.visibleCaption}>
      Showing {visibleCount.toLocaleString()} of {totalMatching.toLocaleString()} {noun} — search or filter to narrow.
    </span>
  );
}

function formatRelativeTime(ts: number): string {
  const delta = Date.now() - ts;
  if (delta < 60_000) return 'just now';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return `${Math.floor(delta / 86_400_000)}d ago`;
}
