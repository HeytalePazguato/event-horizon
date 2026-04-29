/**
 * Project Graph Canvas — SVG visualization.
 *
 * Pure React + SVG. No useEffect, no refs, no addEventListener — every
 * interaction is via JSX event props so React lifecycle handles it.
 *
 * - Rounded-square nodes (96×64), type-colored, with soft glow halo
 * - Straight edge connections, cyan, alpha 0.4
 * - Force-directed layout (200 iterations) computed on render
 * - Pan via mouse drag on background
 * - Zoom via wheel (no preventDefault — can't with React's passive listeners,
 *   but the zoom math still works)
 * - Click selection ring (white)
 *
 * Phase 8.2 of the Project Graph plan.
 */

import React, { useMemo, useState } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────

export interface GraphNodeData {
  id: string;
  label: string;
  type: string;
  sourceFile?: string;
  sourceLocation?: string;
  tag?: string;
  confidence?: number;
}

export interface GraphEdgeData {
  id: string;
  sourceId: string;
  targetId: string;
  relationType: string;
}

export interface ProjectGraphCanvasProps {
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
  selectedNodeId?: string | null;
  onNodeSelect?: (nodeId: string | null) => void;
  width?: number;
  height?: number;
}

// ── Visual constants ───────────────────────────────────────────────────────

const NODE_W = 80;
const NODE_H = 48;
const NODE_RADIUS = 6;
const GRID_SPACING = 16;
// Per-axis minimum centre-to-centre distance so two axis-aligned
// rectangles never overlap. The radial circle check used previously
// allowed pairs to satisfy `dist >= R` while still overlapping in
// practice (e.g. dx=85, dy=80 → dist=117 > radial threshold, but
// horizontally |dx|=85 still overlapped 80×48 boxes when dy was small
// enough). Adding a margin on each axis for the halo + label.
const MIN_DX = NODE_W + 24;
const MIN_DY = NODE_H + 24;

// Green-leaning palette to match the Event Horizon Universe view. Functions
// (the most common node type) anchor the theme; other types use closely
// related hues to keep the canvas cohesive instead of a rainbow.
const NODE_COLORS: Record<string, string> = {
  function: '#44ff88',
  class: '#ffcc66',
  module: '#88ffaa',
  interface: '#aaffcc',
  concept: '#cc88ff',
  doc_section: '#ccff88',
  rationale: '#ffff88',
  agent_activity: '#ff8844',
  knowledge: '#ffffff',
};

const DEFAULT_NODE_COLOR = '#88cc99';
const EDGE_COLOR = '#44ff88';

// ── Component ──────────────────────────────────────────────────────────────

export const ProjectGraphCanvas: React.FC<ProjectGraphCanvasProps> = ({
  nodes,
  edges,
  selectedNodeId,
  onNodeSelect,
  width = 800,
  height = 600,
}) => {
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState<{ startX: number; startY: number; panX: number; panY: number } | null>(null);

  const positions = useMemo(
    () => layoutNodes(nodes, edges, width, height),
    [nodes, edges, width, height],
  );

  // BFS distance from the selected node, capped at 3 hops. Used to dim
  // unrelated nodes/edges and tier the visible neighborhood so it's
  // clear which boxes relate to the selection and how directly.
  const levelMap = useMemo(
    () => (selectedNodeId ? computeLevels(selectedNodeId, nodes, edges, 3) : null),
    [selectedNodeId, nodes, edges],
  );

  // Opacity tier for a node based on its BFS distance from selection.
  // Levels 0–3 stay near full opacity; the tier-ring COLOUR is what
  // signals depth (green → amber → orange). Unreachable boxes drop to
  // 10 % so they fade into the background grid without disappearing.
  const nodeOpacity = (id: string): number => {
    if (!levelMap) return 1;
    const lvl = levelMap.get(id);
    if (lvl === undefined) return 0.1; // unreachable
    if (lvl === 0) return 1;
    if (lvl === 1) return 1;
    if (lvl === 2) return 0.98;
    return 0.9;                         // level 3
  };

  // Per-tier edge style. Colour shifts (green → amber → orange) plus
  // stroke-width step give a much sharper visual hierarchy than opacity
  // alone. Unreachable edges get a desaturated grey at 6 %.
  const edgeStyle = (sourceId: string, targetId: string): { stroke: string; opacity: number; width: number } => {
    if (!levelMap) return { stroke: EDGE_COLOR, opacity: 0.4, width: 1.5 };
    const a = levelMap.get(sourceId);
    const b = levelMap.get(targetId);
    if (a === undefined || b === undefined) return { stroke: '#3a5544', opacity: 0.06, width: 1 };
    const rank = Math.max(a, b);
    if (rank <= 1) return { stroke: '#44ff88', opacity: 1.0, width: 2.5 };   // bright green
    if (rank === 2) return { stroke: '#ffcc66', opacity: 0.9, width: 1.8 };  // amber
    if (rank === 3) return { stroke: '#ff8844', opacity: 0.75, width: 1.4 }; // orange
    return { stroke: '#3a5544', opacity: 0.06, width: 1 };
  };

  const transform = `translate(${pan.x}, ${pan.y}) scale(${zoom})`;
  const isEmpty = nodes.length === 0;

  return (
    <svg
      width={width}
      height={height}
      style={{
        display: 'block',
        background: '#0a1810',
        cursor: drag ? 'grabbing' : 'grab',
        userSelect: 'none',
        // Without this, SVG content transformed by pan/zoom can extend
        // past the viewport and render over the controls header above.
        overflow: 'hidden',
      }}
      onMouseDown={(e) => {
        const target = e.target as Element;
        // Only start panning when grabbing the background, not a node.
        if (target.tagName === 'svg' || target.getAttribute('data-bg') === '1') {
          setDrag({ startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y });
        }
      }}
      onMouseMove={(e) => {
        if (drag) {
          setPan({ x: drag.panX + (e.clientX - drag.startX), y: drag.panY + (e.clientY - drag.startY) });
        }
      }}
      onMouseUp={() => setDrag(null)}
      onMouseLeave={() => setDrag(null)}
      onWheel={(e) => {
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        setZoom((z) => Math.max(0.25, Math.min(4, z * factor)));
      }}
    >
      <defs>
        <pattern id="graph-grid" width={GRID_SPACING} height={GRID_SPACING} patternUnits="userSpaceOnUse">
          <path
            d={`M ${GRID_SPACING} 0 L 0 0 0 ${GRID_SPACING}`}
            fill="none"
            stroke="#226644"
            strokeWidth="1"
            strokeOpacity="0.1"
          />
        </pattern>
      </defs>
      <rect data-bg="1" x={0} y={0} width={width} height={height} fill="url(#graph-grid)" />

      {isEmpty && (
        <text
          x={width / 2}
          y={height / 2}
          fontFamily="monospace"
          fontSize={12}
          fill="#557766"
          textAnchor="middle"
        >
          Run /eh:optimize-context in any AI agent to build the project graph.
        </text>
      )}

      <g transform={transform}>
        {edges.map((edge) => {
          const a = positions.get(edge.sourceId);
          const b = positions.get(edge.targetId);
          if (!a || !b) return null;
          const style = edgeStyle(edge.sourceId, edge.targetId);
          return (
            <line
              key={edge.id}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={style.stroke}
              strokeWidth={style.width}
              strokeOpacity={style.opacity}
            />
          );
        })}

        {nodes.map((node) => {
          const pos = positions.get(node.id);
          if (!pos) return null;
          const color = NODE_COLORS[node.type] ?? DEFAULT_NODE_COLOR;
          const isSelected = node.id === selectedNodeId;
          const labelText = node.label.length > 14 ? node.label.slice(0, 13) + '…' : node.label;
          const opacity = nodeOpacity(node.id);
          // Tier ring colour matches the edge palette so the depth gradient
          // reads consistently: green = direct neighbour, amber = 2 hops,
          // orange = 3 hops. Stroke width also steps down so the eye picks
          // up the tier even before the colour registers.
          const lvl = levelMap?.get(node.id);
          const tierRing = lvl === 1
            ? { color: '#44ff88', width: 2.5, opacity: 1.0 }
            : lvl === 2
            ? { color: '#ffcc66', width: 2.0, opacity: 0.95 }
            : lvl === 3
            ? { color: '#ff8844', width: 1.6, opacity: 0.85 }
            : null;
          return (
            <g
              key={node.id}
              transform={`translate(${pos.x}, ${pos.y})`}
              opacity={opacity}
              style={{ cursor: 'pointer' }}
              onClick={(e) => {
                e.stopPropagation();
                if (onNodeSelect) onNodeSelect(node.id);
              }}
            >
              <rect
                x={-NODE_W / 2 - 8}
                y={-NODE_H / 2 - 8}
                width={NODE_W + 16}
                height={NODE_H + 16}
                rx={NODE_RADIUS + 6}
                fill={color}
                opacity={0.15}
              />
              <rect
                x={-NODE_W / 2}
                y={-NODE_H / 2}
                width={NODE_W}
                height={NODE_H}
                rx={NODE_RADIUS}
                fill="#142c1f"
                fillOpacity={0.95}
                stroke={color}
                strokeWidth={2}
                strokeOpacity={0.85}
              />
              {isSelected && (
                <rect
                  x={-NODE_W / 2 - 4}
                  y={-NODE_H / 2 - 4}
                  width={NODE_W + 8}
                  height={NODE_H + 8}
                  rx={NODE_RADIUS + 4}
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth={2}
                  strokeOpacity={0.85}
                />
              )}
              {!isSelected && tierRing && (
                <rect
                  x={-NODE_W / 2 - 3}
                  y={-NODE_H / 2 - 3}
                  width={NODE_W + 6}
                  height={NODE_H + 6}
                  rx={NODE_RADIUS + 3}
                  fill="none"
                  stroke={tierRing.color}
                  strokeWidth={tierRing.width}
                  strokeOpacity={tierRing.opacity}
                />
              )}
              <text
                x={0}
                y={-6}
                fontFamily="monospace"
                fontSize={9}
                fill={color}
                textAnchor="middle"
                style={{ pointerEvents: 'none' }}
              >
                {node.type}
              </text>
              <text
                x={0}
                y={12}
                fontFamily="monospace"
                fontSize={11}
                fill="#ddeeff"
                textAnchor="middle"
                style={{ pointerEvents: 'none' }}
              >
                {labelText}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
};

// ── Force-directed layout ──────────────────────────────────────────────────

interface NodePosition {
  x: number;
  y: number;
}

function layoutNodes(
  nodes: GraphNodeData[],
  edges: GraphEdgeData[],
  w: number,
  h: number,
): Map<string, NodePosition> {
  if (nodes.length === 0) return new Map();
  if (nodes.length === 1) return new Map([[nodes[0].id, { x: w / 2, y: h / 2 }]]);

  const pos = new Map<string, { x: number; y: number; vx: number; vy: number }>();
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(w, h) * 0.3;
  for (let i = 0; i < nodes.length; i++) {
    const angle = (i / nodes.length) * Math.PI * 2;
    pos.set(nodes[i].id, {
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
    });
  }

  const REPULSION = 6000;
  const SPRING = 0.04;
  const SPRING_LENGTH = 180;
  const DAMPING = 0.82;
  const ITERATIONS = 200;
  const MAX_VELOCITY = 50;

  for (let iter = 0; iter < ITERATIONS; iter++) {
    for (const a of nodes) {
      const pa = pos.get(a.id);
      if (!pa) continue;
      for (const b of nodes) {
        if (a.id === b.id) continue;
        const pb = pos.get(b.id);
        if (!pb) continue;
        const dx = pa.x - pb.x;
        const dy = pa.y - pb.y;
        const dist = Math.sqrt(dx * dx + dy * dy) + 0.1;
        const force = REPULSION / (dist * dist);
        pa.vx += (dx / dist) * force;
        pa.vy += (dy / dist) * force;
      }
    }
    for (const edge of edges) {
      const pa = pos.get(edge.sourceId);
      const pb = pos.get(edge.targetId);
      if (!pa || !pb) continue;
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const dist = Math.sqrt(dx * dx + dy * dy) + 0.1;
      const force = SPRING * (dist - SPRING_LENGTH);
      pa.vx += (dx / dist) * force;
      pa.vy += (dy / dist) * force;
      pb.vx -= (dx / dist) * force;
      pb.vy -= (dy / dist) * force;
    }
    for (const p of pos.values()) {
      const v = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
      if (v > MAX_VELOCITY) {
        p.vx = (p.vx / v) * MAX_VELOCITY;
        p.vy = (p.vy / v) * MAX_VELOCITY;
      }
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= DAMPING;
      p.vy *= DAMPING;
    }

    // AABB collision constraint: any two boxes whose centres are
    // within MIN_DX horizontally AND MIN_DY vertically overlap. Push
    // them apart along the axis of smaller penetration so the layout
    // settles into a non-overlapping arrangement. Multiple passes per
    // iteration so cascading collisions resolve in dense hubs.
    for (let pass = 0; pass < 4; pass++) {
      resolveCollisions(nodes, pos);
    }
  }

  // Final settle pass — pure collision, no springs — so any remaining
  // overlap from the last spring tug gets pushed out before render.
  // 30 iterations is more than enough on a 200-node page.
  for (let p = 0; p < 30; p++) {
    if (!resolveCollisions(nodes, pos)) break;
  }

  const result = new Map<string, NodePosition>();
  for (const [id, p] of pos) {
    result.set(id, {
      x: Math.round(p.x / GRID_SPACING) * GRID_SPACING,
      y: Math.round(p.y / GRID_SPACING) * GRID_SPACING,
    });
  }
  return result;
}

/**
 * BFS distance from a root node, capped at maxLevel. Used to tier the
 * highlight when a node is selected: level 0 = selected, level 1 =
 * direct neighbors, level 2/3 = further hops, missing = unreachable
 * (the canvas dims those heavily). Treats edges as undirected so a
 * caller and a callee both light up.
 */
function computeLevels(
  rootId: string,
  nodes: GraphNodeData[],
  edges: GraphEdgeData[],
  maxLevel: number,
): Map<string, number> {
  const levels = new Map<string, number>();
  // If the root isn't in the visible page, return an empty map so
  // everything dims (visual signal that the selected node is off-page).
  if (!nodes.some((n) => n.id === rootId)) return levels;
  levels.set(rootId, 0);
  const adj = new Map<string, Set<string>>();
  for (const e of edges) {
    if (!adj.has(e.sourceId)) adj.set(e.sourceId, new Set());
    if (!adj.has(e.targetId)) adj.set(e.targetId, new Set());
    adj.get(e.sourceId)!.add(e.targetId);
    adj.get(e.targetId)!.add(e.sourceId);
  }
  let frontier: string[] = [rootId];
  for (let lvl = 1; lvl <= maxLevel; lvl++) {
    const next: string[] = [];
    for (const id of frontier) {
      const neighbors = adj.get(id);
      if (!neighbors) continue;
      for (const nb of neighbors) {
        if (levels.has(nb)) continue;
        levels.set(nb, lvl);
        next.push(nb);
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  return levels;
}

/**
 * One AABB collision-resolution pass. Pushes apart any pair of boxes
 * that overlap on both axes (centres within MIN_DX horizontally AND
 * MIN_DY vertically). Returns true if any pair was pushed.
 */
function resolveCollisions(
  nodes: GraphNodeData[],
  pos: Map<string, { x: number; y: number; vx: number; vy: number }>,
): boolean {
  let pushed = false;
  for (let i = 0; i < nodes.length; i++) {
    const pa = pos.get(nodes[i].id);
    if (!pa) continue;
    for (let j = i + 1; j < nodes.length; j++) {
      const pb = pos.get(nodes[j].id);
      if (!pb) continue;
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);
      if (absDx >= MIN_DX || absDy >= MIN_DY) continue; // not overlapping
      // Coincident — nudge deterministically.
      if (absDx < 0.001 && absDy < 0.001) {
        pb.x += MIN_DX / 2;
        pushed = true;
        continue;
      }
      // Penetration on each axis. Push along the axis with smaller
      // penetration — that's the cheapest way out of the collision.
      const penX = MIN_DX - absDx;
      const penY = MIN_DY - absDy;
      if (penX < penY) {
        const sign = dx >= 0 ? 1 : -1;
        const half = penX / 2;
        pa.x -= sign * half;
        pb.x += sign * half;
      } else {
        const sign = dy >= 0 ? 1 : -1;
        const half = penY / 2;
        pa.y -= sign * half;
        pb.y += sign * half;
      }
      pushed = true;
    }
  }
  return pushed;
}
