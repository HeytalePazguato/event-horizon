/**
 * Project Graph Section — wraps controls + canvas + detail drawer for the
 * Knowledge tab.
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
  width?: number;
  height?: number;
}

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
    <div
      style={{
        background: 'rgba(10, 15, 24, 0.5)',
        borderRadius: 4,
        overflow: 'hidden',
        fontFamily: 'monospace',
        fontSize: 11,
        color: '#cce0ff',
        border: '1px solid rgba(68, 136, 187, 0.25)',
        marginBottom: 12,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '6px 10px',
          background: 'rgba(20, 32, 44, 0.7)',
          borderBottom: '1px solid rgba(68, 136, 187, 0.2)',
          cursor: 'pointer',
          userSelect: 'none',
        }}
        onClick={() => setCollapsed((c) => !c)}
      >
        <span style={{ fontSize: 11, color: '#88aacc', textTransform: 'uppercase', letterSpacing: 1 }}>
          Project Graph
        </span>
        <span style={{ color: '#88aacc' }}>{collapsed ? '▸' : '▾'}</span>
      </div>

      {!collapsed ? (
        <div>
          <ProjectGraphControls
            stats={stats}
            buildProgress={buildProgress}
            filter={filter}
            onFilterChange={onFilterChange}
            onBuild={onBuild}
          />
          <div style={{ position: 'relative' }}>
            <ProjectGraphCanvas
              nodes={nodes}
              edges={edges}
              selectedNodeId={selectedNodeDetails ? selectedNodeDetails.node.id : null}
              onNodeSelect={onNodeSelect}
              width={width}
              height={height}
            />
            {selectedNodeDetails ? (
              <ProjectGraphDetailDrawer
                details={selectedNodeDetails}
                onClose={() => onNodeSelect(null)}
                onFocusNode={onNodeSelect}
                onRevealInEditor={onRevealInEditor}
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
};
