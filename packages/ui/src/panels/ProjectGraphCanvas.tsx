/**
 * Project Graph Canvas — SVG visualization of the project knowledge graph.
 *
 * SVG instead of PixiJS to avoid the canvas mount/destroy lifecycle issues
 * that plagued the v8 Pixi implementation under React strict-mode double-
 * mounts. SVG elements are plain DOM and React handles them naturally.
 *
 * Renders rounded-square nodes (type-colored, soft glow), straight edge
 * connections, force-directed layout, pan via drag, zoom via wheel, and
 * click-to-select.
 *
 * Phase 8.2 of the Project Graph plan.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';

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

const NODE_W = 96;
const NODE_H = 64;
const NODE_RADIUS = 8;
const GRID_SPACING = 16;

const NODE_COLORS: Record<string, string> = {
  function: '#44ddff',
  class: '#ffaa44',
  module: '#88ffaa',
  interface: '#88aaff',
  concept: '#ff44ff',
  doc_section: '#cc88ff',
  rationale: '#ccff66',
  agent_activity: '#ff8844',
  knowledge: '#ffffff',
};

const DEFAULT_NODE_COLOR = '#aaaaaa';

// ── Component ──────────────────────────────────────────────────────────────

interface NodePosition {
  x: number;
  y: number;
}

export const ProjectGraphCanvas: React.FC<ProjectGraphCanvasProps> = ({
  nodes,
  edges,
  selectedNodeId,
  onNodeSelect,
  width = 800,
  height = 600,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);

  const positions = useMemo(
    () => layoutNodes(nodes, edges, width, height),
    [nodes, edges, width, height],
  );

  // Wheel zoom
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom((z) => Math.max(0.25, Math.min(4, z * factor)));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      svg.removeEventListener('wheel', onWheel);
    };
  }, []);

  if (nodes.length === 0) {
    return (
      <div
        style={{
          width,
          height,
          background: '#0a0f18',
          border: '1px solid rgba(68, 136, 187, 0.25)',
          color: '#557799',
          fontFamily: 'monospace',
          fontSize: 12,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          padding: 24,
        }}
      >
        Empty graph. Click <strong style={{ color: '#88aacc', margin: '0 4px' }}>Build</strong> in the controls above to scan the workspace.
      </div>
    );
  }

  const transform = `translate(${pan.x}, ${pan.y}) scale(${zoom})`;

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      style={{
        display: 'block',
        background: '#0a0f18',
        cursor: drag ? 'grabbing' : 'grab',
        userSelect: 'none',
      }}
      onMouseDown={(e) => {
        if (e.target === svgRef.current || (e.target as Element).tagName === 'rect' && (e.target as SVGRectElement).getAttribute('data-bg')) {
          setDrag({ x: e.clientX - pan.x, y: e.clientY - pan.y });
        }
      }}
      onMouseMove={(e) => {
        if (drag) setPan({ x: e.clientX - drag.x, y: e.clientY - drag.y });
      }}
      onMouseUp={() => setDrag(null)}
      onMouseLeave={() => setDrag(null)}
    >
      {/* Background pattern (grid) */}
      <defs>
        <pattern id="graph-grid" width={GRID_SPACING} height={GRID_SPACING} patternUnits="userSpaceOnUse">
          <path
            d={`M ${GRID_SPACING} 0 L 0 0 0 ${GRID_SPACING}`}
            fill="none"
            stroke="#224488"
            strokeWidth="1"
            strokeOpacity="0.08"
          />
        </pattern>
      </defs>
      <rect data-bg="1" x={0} y={0} width={width} height={height} fill="url(#graph-grid)" />

      <g transform={transform}>
        {/* Edges first */}
        {edges.map((edge) => {
          const a = positions.get(edge.sourceId);
          const b = positions.get(edge.targetId);
          if (!a || !b) return null;
          return (
            <line
              key={edge.id}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="#44ddff"
              strokeWidth="1.5"
              strokeOpacity="0.4"
            />
          );
        })}

        {/* Nodes */}
        {nodes.map((node) => {
          const pos = positions.get(node.id);
          if (!pos) return null;
          const color = NODE_COLORS[node.type] ?? DEFAULT_NODE_COLOR;
          const isSelected = node.id === selectedNodeId;
          const labelText = node.label.length > 14 ? node.label.slice(0, 13) + '…' : node.label;
          return (
            <g
              key={node.id}
              transform={`translate(${pos.x}, ${pos.y})`}
              style={{ cursor: 'pointer' }}
              onClick={(e) => {
                e.stopPropagation();
                onNodeSelect?.(node.id);
              }}
            >
              {/* Glow halo */}
              <rect
                x={-NODE_W / 2 - 8}
                y={-NODE_H / 2 - 8}
                width={NODE_W + 16}
                height={NODE_H + 16}
                rx={NODE_RADIUS + 6}
                fill={color}
                opacity={0.15}
              />
              {/* Body */}
              <rect
                x={-NODE_W / 2}
                y={-NODE_H / 2}
                width={NODE_W}
                height={NODE_H}
                rx={NODE_RADIUS}
                fill="#14202c"
                fillOpacity={0.95}
                stroke={color}
                strokeWidth={2}
                strokeOpacity={0.85}
              />
              {/* Selection ring */}
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
              {/* Type label */}
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
              {/* Main label */}
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

function layoutNodes(
  nodes: GraphNodeData[],
  edges: GraphEdgeData[],
  w: number,
  h: number,
): Map<string, NodePosition> {
  if (nodes.length === 0) return new Map();
  if (nodes.length === 1) {
    return new Map([[nodes[0].id, { x: w / 2, y: h / 2 }]]);
  }

  const pos = new Map<string, { x: number; y: number; vx: number; vy: number }>();
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(w, h) * 0.3;
  for (let i = 0; i < nodes.length; i++) {
    const angle = (i / nodes.length) * Math.PI * 2;
    pos.set(nodes[i].id, {
      x: cx + Math.cos(angle) * radius + (Math.random() - 0.5) * 20,
      y: cy + Math.sin(angle) * radius + (Math.random() - 0.5) * 20,
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
