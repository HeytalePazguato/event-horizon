/**
 * Project Graph Section — wraps controls + canvas + detail drawer for the
 * Knowledge tab. The webview owns graph state and passes it through props.
 *
 * Phase 8.5 of the Project Graph plan.
 */

import React, { useState } from 'react';
import { ProjectGraphCanvas } from './ProjectGraphCanvas.js';
import type { GraphNodeData, GraphEdgeData } from './ProjectGraphCanvas.js';
import { ProjectGraphControls } from './ProjectGraphControls.js';
import type { GraphStats, GraphFilter, GraphBuildProgress } from './ProjectGraphControls.js';
import { ProjectGraphDetailDrawer } from './ProjectGraphDetailDrawer.js';
import type { NodeDetails } from './ProjectGraphDetailDrawer.js';

export interface ProjectGraphSectionProps {
  stats: GraphStats | null;
  buildProgress: GraphBuildProgress | null;
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
  filter: GraphFilter;
  selectedNodeDetails: NodeDetails | null;
  onFilterChange: (next: GraphFilter) => void;
  onBuild: (force: boolean) => void;
  onNodeSelect: (nodeId: string | null) => void;
  onRevealInEditor: (filePath: string, line?: number) => void;
  /** Optional explicit dimensions; defaults adapt to container width. */
  width?: number;
  height?: number;
}

const styles = {
  root: {
    display: 'flex',
    flexDirection: 'column' as const,
    background: 'rgba(10, 15, 24, 0.5)',
    borderRadius: 4,
    overflow: 'hidden' as const,
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#cce0ff',
    border: '1px solid rgba(68, 136, 187, 0.25)',
    marginBottom: 12,
  },
  toggleRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '6px 10px',
    background: 'rgba(20, 32, 44, 0.7)',
    borderBottom: '1px solid rgba(68, 136, 187, 0.2)',
    cursor: 'pointer',
    userSelect: 'none' as const,
  },
  title: {
    fontSize: 11,
    color: '#88aacc',
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
  },
  caret: {
    color: '#88aacc',
  },
  body: {
    position: 'relative' as const,
  },
};

export const ProjectGraphSection: React.FC<ProjectGraphSectionProps> = ({
  stats,
  buildProgress,
  nodes,
  edges,
  filter,
  selectedNodeDetails,
  onFilterChange,
  onBuild,
  onNodeSelect,
  onRevealInEditor,
  width = 720,
  height = 460,
}) => {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div style={styles.root}>
      <div style={styles.toggleRow} onClick={() => setCollapsed((c) => !c)}>
        <span style={styles.title}>Project Graph</span>
        <span style={styles.caret}>{collapsed ? '▸' : '▾'}</span>
      </div>

      {!collapsed && (
        <>
          <ProjectGraphControls
            stats={stats}
            buildProgress={buildProgress}
            filter={filter}
            onFilterChange={onFilterChange}
            onBuild={onBuild}
          />
          <div style={styles.body}>
            <ProjectGraphCanvas
              nodes={nodes}
              edges={edges}
              selectedNodeId={selectedNodeDetails?.node.id ?? null}
              onNodeSelect={onNodeSelect}
              width={width}
              height={height}
            />
            {selectedNodeDetails && (
              <ProjectGraphDetailDrawer
                details={selectedNodeDetails}
                onClose={() => onNodeSelect(null)}
                onFocusNode={onNodeSelect}
                onRevealInEditor={onRevealInEditor}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
};
