/**
 * Project Graph Section — Controls + Canvas + DetailDrawer composed together.
 * Renders inside the Knowledge tab's "Project Graph" sub-tab. Stretches to
 * fill the available width via a ResizeObserver-backed dimension hook.
 *
 * Phase 8.5 of the Project Graph plan.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ProjectGraphCanvas } from './ProjectGraphCanvas.js';
import type { GraphNodeData, GraphEdgeData } from './ProjectGraphCanvas.js';
import { ProjectGraphControls } from './ProjectGraphControls.js';
import type { GraphStats, GraphFilter, GraphBuildProgress, ClusterMode } from './ProjectGraphControls.js';
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
  onNodeSelect: (nodeId: string | null) => void;
  onRevealInEditor: (filePath: string, line?: number) => void;
  /** Total node count in the DB matching the active filter — drives the
   *  "Showing X of Y" caption when capped. Optional for back-compat. */
  totalMatching?: number;
  /** Authoritative match-id list when search is active. The server
   *  returns matches + their 1-hop neighbours so the canvas needs to
   *  know which of the rendered nodes are *actual* matches vs. context. */
  matchIds?: string[];
}

export const ProjectGraphSection: React.FC<ProjectGraphSectionProps> = ({
  stats,
  buildProgress,
  nodes,
  edges,
  filter,
  selectedNodeDetails,
  onFilterChange,
  onNodeSelect,
  onRevealInEditor,
  totalMatching,
  matchIds,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 800, height: 600 });
  // Default to folder clustering when the visible graph is large — that's
  // the same cutoff we use for label-thresholding, and it's the case where
  // an unclustered force layout becomes an unreadable hairball.
  const defaultClusterMode: ClusterMode = nodes.length > 1000 ? 'folder' : 'none';
  const [clusterMode, setClusterMode] = useState<ClusterMode>(defaultClusterMode);
  // Re-evaluate the default whenever the dataset crosses the threshold so a
  // freshly-built large graph picks folder clustering automatically.
  const lastDefault = useRef<ClusterMode>(defaultClusterMode);
  useEffect(() => {
    if (lastDefault.current !== defaultClusterMode) {
      setClusterMode(defaultClusterMode);
      lastDefault.current = defaultClusterMode;
    }
  }, [defaultClusterMode]);
  void useMemo;

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
        color: '#cceedd',
        background: 'rgba(10, 24, 16, 0.5)',
      }}
    >
      <ProjectGraphControls
        stats={stats}
        buildProgress={buildProgress}
        filter={filter}
        onFilterChange={onFilterChange}
        visibleCount={nodes.length}
        totalMatching={totalMatching}
        clusterMode={clusterMode}
        onClusterModeChange={setClusterMode}
      />
      <div ref={containerRef} style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <ProjectGraphCanvas
          nodes={nodes}
          edges={edges}
          selectedNodeId={selectedNodeDetails ? selectedNodeDetails.node.id : null}
          onNodeSelect={onNodeSelect}
          width={size.width}
          height={size.height}
          clusterMode={clusterMode}
          searchQuery={filter.search ?? ''}
          matchIds={matchIds}
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
