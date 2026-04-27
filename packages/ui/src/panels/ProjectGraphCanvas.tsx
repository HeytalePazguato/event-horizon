/**
 * Project Graph Canvas — PixiJS visualization of the project knowledge graph.
 *
 * Renders rounded-square nodes with type-based colors, soft glow halos,
 * straight edge connections, force-directed layout, pan/zoom, and click
 * selection. Built on PixiJS v8 (same runtime as the Universe view).
 *
 * Phase 8.2 of the Project Graph plan.
 */

import React, { useEffect, useRef } from 'react';
import { Application, Container, Graphics, Text } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';

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
const NODE_H = 96;
const NODE_RADIUS = 8;
const HALO_PAD = 8;

const BACKGROUND_COLOR = 0x0a0f18;
const GRID_COLOR = 0x224488;
const GRID_ALPHA = 0.08;
const GRID_SPACING = 16;

const EDGE_COLOR = 0x44ddff;
const EDGE_ALPHA = 0.4;
const EDGE_WIDTH = 1.5;

const NODE_COLORS: Record<string, number> = {
  function: 0x44ddff,
  class: 0xffaa44,
  module: 0x88ffaa,
  interface: 0x88aaff,
  concept: 0xff44ff,
  doc_section: 0xcc88ff,
  rationale: 0xccff66,
  agent_activity: 0xff8844,
  knowledge: 0xffffff,
};

const SELECTED_RING_COLOR = 0xffffff;

// ── Component ──────────────────────────────────────────────────────────────

interface NodeView {
  container: Container;
  data: GraphNodeData;
}

export const ProjectGraphCanvas: React.FC<ProjectGraphCanvasProps> = ({
  nodes,
  edges,
  selectedNodeId,
  onNodeSelect,
  width = 800,
  height = 600,
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const worldRef = useRef<Container | null>(null);
  const edgesContainerRef = useRef<Container | null>(null);
  const nodesContainerRef = useRef<Container | null>(null);
  const nodeViewsRef = useRef<Map<string, NodeView>>(new Map());
  const onNodeSelectRef = useRef(onNodeSelect);
  onNodeSelectRef.current = onNodeSelect;

  // Initialize Pixi application once
  useEffect(() => {
    if (!hostRef.current) return;
    let cancelled = false;
    const app = new Application();

    void app
      .init({
        width,
        height,
        background: BACKGROUND_COLOR,
        antialias: true,
        resolution: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
        autoDensity: true,
      })
      .then(() => {
        if (cancelled) {
          safeDestroy(app);
          return;
        }
        if (!hostRef.current) return;
        hostRef.current.appendChild(app.canvas);

        // Blueprint grid background
        const grid = new Graphics();
        drawGrid(grid, width, height);
        app.stage.addChild(grid);

        // World container (pan/zoom target)
        const world = new Container();
        app.stage.addChild(world);
        worldRef.current = world;

        const edgesC = new Container();
        world.addChild(edgesC);
        edgesContainerRef.current = edgesC;

        const nodesC = new Container();
        world.addChild(nodesC);
        nodesContainerRef.current = nodesC;

        attachInteraction(app, world);
        appRef.current = app;
      });

    return () => {
      cancelled = true;
      if (appRef.current) {
        safeDestroy(appRef.current);
        appRef.current = null;
      }
      worldRef.current = null;
      edgesContainerRef.current = null;
      nodesContainerRef.current = null;
      nodeViewsRef.current.clear();
    };
  }, [width, height]);

  // Re-render when nodes / edges change
  useEffect(() => {
    const edgesC = edgesContainerRef.current;
    const nodesC = nodesContainerRef.current;
    if (!edgesC || !nodesC) return;

    try {
      edgesC.removeChildren();
    } catch { /* container already torn down */ }
    for (const [, view] of nodeViewsRef.current) {
      try {
        view.container.destroy({ children: true });
      } catch { /* already destroyed */ }
    }
    nodeViewsRef.current.clear();

    if (nodes.length === 0) return;

    const positions = layoutNodes(nodes, edges, width, height);

    // Edges first (drawn under nodes)
    for (const edge of edges) {
      const a = positions.get(edge.sourceId);
      const b = positions.get(edge.targetId);
      if (!a || !b) continue;
      const line = new Graphics();
      line.moveTo(a.x, a.y);
      line.lineTo(b.x, b.y);
      line.stroke({ color: EDGE_COLOR, width: EDGE_WIDTH, alpha: EDGE_ALPHA });
      edgesC.addChild(line);
    }

    // Nodes
    for (const node of nodes) {
      const pos = positions.get(node.id);
      if (!pos) continue;
      const container = createNodeView(node, pos.x, pos.y, (id) => {
        onNodeSelectRef.current?.(id);
      });
      nodesC.addChild(container);
      nodeViewsRef.current.set(node.id, { container, data: node });
    }
  }, [nodes, edges, width, height]);

  // Selection ring update
  useEffect(() => {
    for (const [id, view] of nodeViewsRef.current) {
      const ring = (
        view.container.getChildByLabel
          ? view.container.getChildByLabel('selection-ring')
          : view.container.getChildByName?.('selection-ring')
      ) as Graphics | null | undefined;
      if (ring) ring.visible = id === selectedNodeId;
    }
  }, [selectedNodeId]);

  return <div ref={hostRef} style={{ width, height, overflow: 'hidden', position: 'relative' }} />;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function safeDestroy(app: Application): void {
  try {
    // Manually detach the canvas if it has a parent — Pixi v8's destroy
    // can throw on already-detached canvases under React strict mode.
    const canvas = app.canvas;
    if (canvas && canvas.parentNode) {
      try {
        canvas.parentNode.removeChild(canvas);
      } catch {
        /* already detached */
      }
    }
    app.destroy({ removeView: false }, { children: true, texture: true });
  } catch {
    /* destroy failed — leak is acceptable on tear-down */
  }
}

function drawGrid(g: Graphics, w: number, h: number): void {
  for (let x = 0; x <= w; x += GRID_SPACING) {
    g.moveTo(x, 0).lineTo(x, h);
  }
  for (let y = 0; y <= h; y += GRID_SPACING) {
    g.moveTo(0, y).lineTo(w, y);
  }
  g.stroke({ color: GRID_COLOR, width: 1, alpha: GRID_ALPHA });
}

function createNodeView(
  node: GraphNodeData,
  x: number,
  y: number,
  onClick: (id: string) => void,
): Container {
  const container = new Container();
  container.x = x;
  container.y = y;

  const color = NODE_COLORS[node.type] ?? 0xaaaaaa;

  const halo = new Graphics();
  halo.roundRect(
    -NODE_W / 2 - HALO_PAD,
    -NODE_H / 2 - HALO_PAD,
    NODE_W + HALO_PAD * 2,
    NODE_H + HALO_PAD * 2,
    NODE_RADIUS + HALO_PAD,
  );
  halo.fill({ color, alpha: 0.15 });
  container.addChild(halo);

  const body = new Graphics();
  body.roundRect(-NODE_W / 2, -NODE_H / 2, NODE_W, NODE_H, NODE_RADIUS);
  body.fill({ color: 0x14202c, alpha: 0.95 });
  body.stroke({ color, width: 2, alpha: 0.85 });
  container.addChild(body);

  const ring = new Graphics();
  ring.roundRect(-NODE_W / 2 - 3, -NODE_H / 2 - 3, NODE_W + 6, NODE_H + 6, NODE_RADIUS + 3);
  ring.stroke({ color: SELECTED_RING_COLOR, width: 2, alpha: 0.9 });
  ring.label = 'selection-ring';
  ring.visible = false;
  container.addChild(ring);

  const typeLabel = new Text({
    text: node.type,
    style: { fontFamily: 'monospace', fontSize: 9, fill: color, align: 'center' },
  });
  typeLabel.anchor.set(0.5, 0.5);
  typeLabel.x = 0;
  typeLabel.y = -10;
  container.addChild(typeLabel);

  const labelText = node.label.length > 14 ? node.label.slice(0, 13) + '…' : node.label;
  const label = new Text({
    text: labelText,
    style: { fontFamily: 'monospace', fontSize: 11, fill: 0xddeeff, align: 'center' },
  });
  label.anchor.set(0.5, 0.5);
  label.x = 0;
  label.y = 8;
  container.addChild(label);

  container.eventMode = 'static';
  container.cursor = 'pointer';
  container.on('pointertap', () => onClick(node.id));

  return container;
}

function attachInteraction(app: Application, world: Container): void {
  app.stage.eventMode = 'static';
  app.stage.hitArea = app.screen;

  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  app.stage.on('pointerdown', (e: FederatedPointerEvent) => {
    if (e.target !== app.stage) return; // node clicks pass through
    dragging = true;
    lastX = e.global.x;
    lastY = e.global.y;
  });
  app.stage.on('pointerup', () => {
    dragging = false;
  });
  app.stage.on('pointerupoutside', () => {
    dragging = false;
  });
  app.stage.on('pointermove', (e: FederatedPointerEvent) => {
    if (!dragging) return;
    world.x += e.global.x - lastX;
    world.y += e.global.y - lastY;
    lastX = e.global.x;
    lastY = e.global.y;
  });

  app.canvas.addEventListener('wheel', (e: WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const next = Math.max(0.25, Math.min(4, world.scale.x * factor));
    const rect = app.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const wx = (mx - world.x) / world.scale.x;
    const wy = (my - world.y) / world.scale.y;
    world.scale.set(next);
    world.x = mx - wx * next;
    world.y = my - wy * next;
  });
}

// Force-directed layout (simple spring-mass, ~200 iterations)
function layoutNodes(
  nodes: GraphNodeData[],
  edges: GraphEdgeData[],
  w: number,
  h: number,
): Map<string, { x: number; y: number }> {
  if (nodes.length === 0) return new Map();
  if (nodes.length === 1) {
    return new Map([[nodes[0].id, { x: w / 2, y: h / 2 }]]);
  }

  const pos = new Map<string, { x: number; y: number; vx: number; vy: number }>();
  const cx = w / 2;
  const cy = h / 2;
  for (const n of nodes) {
    pos.set(n.id, {
      x: cx + (Math.random() - 0.5) * Math.min(w, h) * 0.5,
      y: cy + (Math.random() - 0.5) * Math.min(w, h) * 0.5,
      vx: 0,
      vy: 0,
    });
  }

  const REPULSION = 5000;
  const SPRING = 0.04;
  const SPRING_LENGTH = 160;
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
      const displacement = dist - SPRING_LENGTH;
      const force = SPRING * displacement;
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

  const result = new Map<string, { x: number; y: number }>();
  for (const [id, p] of pos) {
    result.set(id, {
      x: Math.round(p.x / GRID_SPACING) * GRID_SPACING,
      y: Math.round(p.y / GRID_SPACING) * GRID_SPACING,
    });
  }
  return result;
}
