/**
 * Project Graph Detail Drawer — slide-in panel showing the selected node.
 *
 * Header (label, type, tag, confidence), source location with reveal-in-editor
 * button, callers/callees/references sections, rationale notes, recent agent
 * activity touching the file. Sends graph-node-details-request on open.
 *
 * Phase 8.4 of the Project Graph plan.
 */

import React, { useCallback, useEffect } from 'react';
import type { GraphNodeData, GraphEdgeData } from './ProjectGraphCanvas.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface NodeNeighborEntry {
  node: GraphNodeData;
  edge: GraphEdgeData;
}

export interface NodeDetails {
  node: GraphNodeData;
  in: NodeNeighborEntry[];
  out: NodeNeighborEntry[];
  rationale: GraphNodeData[];
  recentActivity: GraphNodeData[];
}

export interface ProjectGraphDetailDrawerProps {
  details: NodeDetails | null;
  onClose: () => void;
  onFocusNode: (nodeId: string) => void;
  onRevealInEditor: (filePath: string, line?: number) => void;
}

// ── Style tokens ───────────────────────────────────────────────────────────

const styles = {
  drawer: {
    position: 'absolute' as const,
    top: 0,
    right: 0,
    height: '100%',
    width: 320,
    background: 'rgba(10, 15, 24, 0.96)',
    borderLeft: '1px solid rgba(68, 187, 110, 0.4)',
    boxShadow: '-2px 0 16px rgba(0, 0, 0, 0.45)',
    color: '#cceedd',
    fontFamily: 'monospace',
    fontSize: 11,
    overflow: 'auto' as const,
    padding: 12,
    boxSizing: 'border-box' as const,
  },
  closeRow: {
    display: 'flex',
    justifyContent: 'flex-end',
    marginBottom: 6,
  },
  closeBtn: {
    background: 'transparent',
    border: '1px solid rgba(68, 187, 110, 0.4)',
    color: '#88cc99',
    fontFamily: 'monospace',
    fontSize: 11,
    cursor: 'pointer',
    padding: '2px 8px',
    borderRadius: 3,
  },
  header: {
    paddingBottom: 8,
    borderBottom: '1px solid rgba(68, 187, 110, 0.2)',
    marginBottom: 10,
  },
  label: {
    fontSize: 14,
    fontWeight: 'bold' as const,
    color: '#ffffff',
    wordBreak: 'break-word' as const,
    marginBottom: 4,
  },
  badgeRow: {
    display: 'flex',
    gap: 6,
    fontSize: 10,
    flexWrap: 'wrap' as const,
  },
  typeBadge: {
    padding: '1px 6px',
    borderRadius: 2,
    background: 'rgba(68, 255, 136, 0.15)',
    color: '#44ff88',
  },
  tagBadge: {
    padding: '1px 6px',
    borderRadius: 2,
  },
  confidenceRow: {
    marginTop: 6,
    display: 'flex' as const,
    alignItems: 'center' as const,
    gap: 6,
  },
  confidenceLabel: {
    fontSize: 9,
    color: '#88cc99',
    width: 70,
  },
  confidenceBar: {
    flex: 1,
    height: 4,
    background: 'rgba(68, 187, 110, 0.2)',
    borderRadius: 2,
    overflow: 'hidden' as const,
  },
  confidenceFill: {
    height: '100%',
    background: 'linear-gradient(90deg, #44ff88, #ccff88)',
  },
  confidencePct: {
    fontSize: 9,
    color: '#cceedd',
    width: 30,
    textAlign: 'right' as const,
  },
  sourceLink: {
    color: '#88eeaa',
    cursor: 'pointer',
    textDecoration: 'underline' as const,
    wordBreak: 'break-all' as const,
    fontSize: 10,
  },
  section: {
    marginTop: 12,
  },
  sectionTitle: {
    fontSize: 10,
    color: '#88cc99',
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
    marginBottom: 4,
  },
  empty: {
    fontSize: 10,
    color: '#557766',
    fontStyle: 'italic' as const,
  },
  row: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 6,
    padding: '3px 0',
    fontSize: 10,
    borderBottom: '1px dotted rgba(68, 187, 110, 0.12)',
    cursor: 'pointer',
  },
  relation: {
    color: '#557766',
    minWidth: 60,
  },
  rowLabel: {
    color: '#cceedd',
    flex: 1,
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  },
  empty2: {
    fontSize: 11,
    color: '#557766',
    fontStyle: 'italic' as const,
    padding: 24,
    textAlign: 'center' as const,
  },
};

const TAG_COLORS: Record<string, { bg: string; fg: string }> = {
  EXTRACTED: { bg: 'rgba(68, 255, 136, 0.18)', fg: '#44ff88' },
  INFERRED: { bg: 'rgba(255, 170, 68, 0.18)', fg: '#ffaa44' },
  AMBIGUOUS: { bg: 'rgba(255, 102, 136, 0.2)', fg: '#ff6688' },
};

// ── Component ──────────────────────────────────────────────────────────────

export const ProjectGraphDetailDrawer: React.FC<ProjectGraphDetailDrawerProps> = ({
  details,
  onClose,
  onFocusNode,
  onRevealInEditor,
}) => {
  // Close on ESC
  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!details) return;
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [details, handleKey]);

  if (!details) return null;

  const node = details.node;
  const tagColors = TAG_COLORS[node.tag ?? 'EXTRACTED'] ?? TAG_COLORS.EXTRACTED;

  return (
    <div style={styles.drawer}>
      <div style={styles.closeRow}>
        <button type="button" style={styles.closeBtn} onClick={onClose} title="ESC">
          Close ✕
        </button>
      </div>

      <div style={styles.header}>
        <div style={styles.label}>{node.label}</div>
        <div style={styles.badgeRow}>
          <span style={styles.typeBadge}>{node.type}</span>
          <span style={{ ...styles.tagBadge, background: tagColors.bg, color: tagColors.fg }}>
            {node.tag ?? 'EXTRACTED'}
          </span>
        </div>
        {typeof node.confidence === 'number' && (
          <div
            style={styles.confidenceRow}
            title="Extractor confidence (0–100%). Tree-sitter extractions are 100% (EXTRACTED). Heuristic doc/markdown extractions are ~70% (INFERRED). Agent-supplied extractions below 50% are downgraded to AMBIGUOUS."
          >
            <span style={styles.confidenceLabel}>confidence</span>
            <div style={styles.confidenceBar}>
              <div style={{ ...styles.confidenceFill, width: `${Math.round(node.confidence * 100)}%` }} />
            </div>
            <span style={styles.confidencePct}>{Math.round(node.confidence * 100)}%</span>
          </div>
        )}
        {node.sourceFile && (
          <div style={{ marginTop: 6 }}>
            <span
              style={styles.sourceLink}
              onClick={() => onRevealInEditor(node.sourceFile!, parseLine(node.sourceLocation))}
              title="Reveal in editor"
            >
              {node.sourceFile}
              {node.sourceLocation ? `:${node.sourceLocation}` : ''}
            </span>
          </div>
        )}
      </div>

      <Section title="Callers" emptyText="No incoming calls">
        {details.in
          .filter((entry) => entry.edge.relationType === 'calls')
          .map((entry) => (
            <Row
              key={entry.edge.id}
              relation="←"
              label={entry.node.label}
              onClick={() => onFocusNode(entry.node.id)}
            />
          ))}
      </Section>

      <Section title="Callees" emptyText="No outgoing calls">
        {details.out
          .filter((entry) => entry.edge.relationType === 'calls')
          .map((entry) => (
            <Row
              key={entry.edge.id}
              relation="→"
              label={entry.node.label}
              onClick={() => onFocusNode(entry.node.id)}
            />
          ))}
      </Section>

      <Section title="Other relations" emptyText="None">
        {[...details.in, ...details.out]
          .filter((entry) => entry.edge.relationType !== 'calls')
          .map((entry) => (
            <Row
              key={entry.edge.id}
              relation={entry.edge.relationType}
              label={entry.node.label}
              onClick={() => onFocusNode(entry.node.id)}
            />
          ))}
      </Section>

      <Section title="Rationale" emptyText="No comments / WHY notes attached">
        {details.rationale.map((r) => (
          <div key={r.id} style={{ padding: '4px 0', fontSize: 10, color: '#ccff66' }}>
            {(r.label || '').slice(0, 200)}
          </div>
        ))}
      </Section>

      <Section title="Recent activity (7d)" emptyText="No agent activity on this file recently">
        {details.recentActivity.map((a) => (
          <div key={a.id} style={{ padding: '4px 0', fontSize: 10 }}>
            <div style={{ color: '#ff8844' }}>{a.label}</div>
          </div>
        ))}
      </Section>
    </div>
  );
};

// ── Subcomponents ──────────────────────────────────────────────────────────

const Section: React.FC<{ title: string; emptyText: string; children: React.ReactNode }> = ({
  title,
  emptyText,
  children,
}) => {
  const childArray = React.Children.toArray(children);
  const isEmpty = childArray.length === 0;
  return (
    <div style={styles.section}>
      <div style={styles.sectionTitle}>{title}</div>
      {isEmpty ? <div style={styles.empty}>{emptyText}</div> : children}
    </div>
  );
};

const Row: React.FC<{ relation: string; label: string; onClick: () => void }> = ({
  relation,
  label,
  onClick,
}) => (
  <div style={styles.row} onClick={onClick} title="Click to focus on canvas">
    <span style={styles.relation}>{relation}</span>
    <span style={styles.rowLabel}>{label}</span>
  </div>
);

function parseLine(loc?: string): number | undefined {
  if (!loc) return undefined;
  const m = /^(\d+)/.exec(loc);
  return m ? parseInt(m[1], 10) : undefined;
}
