/**
 * Project Graph Section — debug placeholder.
 *
 * The full implementation (Controls + Canvas + DetailDrawer) is temporarily
 * disabled while we isolate the source of the
 *   "Cannot read properties of null (reading 'remove')"
 * error in the webview. If this placeholder renders without error, the bug
 * is NOT in the section itself — it's somewhere else in the webview's graph
 * wiring (message handlers, browse-request effect, OperationsView prop pass).
 *
 * Phase 8.5 of the Project Graph plan.
 */

import React from 'react';
import type { GraphNodeData, GraphEdgeData } from './ProjectGraphCanvas.js';
import type { GraphStats, GraphFilter, GraphBuildProgress } from './ProjectGraphControls.js';
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

export const ProjectGraphSection: React.FC<ProjectGraphSectionProps> = (props) => {
  // Reference all props so TS doesn't flag unused
  void props.stats; void props.buildProgress; void props.nodes; void props.edges;
  void props.filter; void props.selectedNodeDetails; void props.onFilterChange;
  void props.onBuild; void props.onNodeSelect; void props.onRevealInEditor;
  void props.height;

  return (
    <div
      style={{
        padding: 14,
        marginBottom: 12,
        color: '#88aacc',
        fontFamily: 'monospace',
        fontSize: 11,
        background: 'rgba(20, 32, 44, 0.5)',
        border: '1px solid rgba(68, 136, 187, 0.3)',
        borderRadius: 4,
      }}
    >
      <div style={{ color: '#cce0ff', fontWeight: 'bold', marginBottom: 6 }}>
        Project Graph (placeholder)
      </div>
      <div style={{ color: '#557799' }}>
        If this message renders, the Knowledge tab itself is fine. The actual graph
        canvas / controls / drawer are temporarily disabled while a webview error
        is being diagnosed. Build the graph via Command Palette → "Event Horizon:
        Build Project Graph" or via <code style={{ color: '#88aacc' }}>/eh:optimize-context</code>.
      </div>
    </div>
  );
};
