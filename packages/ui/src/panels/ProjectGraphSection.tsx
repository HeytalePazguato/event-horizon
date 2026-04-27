/**
 * Project Graph Section — Controls + Canvas + DetailDrawer composed together.
 * Renders inside the Knowledge tab's "Project Graph" sub-tab. Stretches to
 * fill the available width via a ResizeObserver-backed dimension hook.
 *
 * Phase 8.5 of the Project Graph plan.
 */

import React, { useEffect, useRef, useState } from 'react';
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
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 800, height: 600 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0) {
        setSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
      }
    };
    update();
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(update);
      ro.observe(el);
    }
    return () => {
      if (ro) ro.disconnect();
    };
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        fontFamily: 'monospace',
        fontSize: 11,
        color: '#cce0ff',
        background: 'rgba(10, 15, 24, 0.5)',
      }}
    >
      <ProjectGraphControls
        stats={stats}
        buildProgress={buildProgress}
        filter={filter}
        onFilterChange={onFilterChange}
        onBuild={onBuild}
      />
      <div ref={containerRef} style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <ProjectGraphCanvas
          nodes={nodes}
          edges={edges}
          selectedNodeId={selectedNodeDetails ? selectedNodeDetails.node.id : null}
          onNodeSelect={onNodeSelect}
          width={size.width}
          height={size.height}
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
  );
};
