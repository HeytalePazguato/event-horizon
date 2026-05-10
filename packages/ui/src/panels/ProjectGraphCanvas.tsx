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

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from 'd3-force';

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

export type ClusterMode = 'none' | 'folder' | 'type';

export interface ProjectGraphCanvasProps {
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
  selectedNodeId?: string | null;
  onNodeSelect?: (nodeId: string | null) => void;
  width?: number;
  height?: number;
  /**
   * Cluster mode. When `folder` or `type`, the canvas draws a hull around
   * each cluster's members and accepts click-to-collapse / click-to-expand
   * on hulls and super-nodes. The DB is never modified.
   */
  clusterMode?: ClusterMode;
  /**
   * Active search query. Used for client-side match highlighting on top
   * of whatever filtering the server already applied — matching nodes get
   * an amber stroke; non-matching dim. When exactly one node matches, the
   * canvas auto-centers + zooms to it.
   */
  searchQuery?: string;
  /** Authoritative match list from the server. When present overrides
   *  the client-side substring match — non-match neighbours appear in
   *  the result for context but stay un-highlighted. */
  matchIds?: string[];
}

// ── Visual constants ───────────────────────────────────────────────────────

const NODE_W = 85;
const NODE_H = 48;
const NODE_RADIUS = 6;
const GRID_SPACING = 16;

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

// 12-colour palette cycled through cluster ids when clusterMode != 'none'.
// Same trick Graphify uses for community colouring — distinct hues let
// the eye see folder/community grouping without a separate hull or label
// overlay. Greens lean dominant to keep the EH aesthetic, with amber /
// purple / cyan accents to break up large clusters of green.
const CLUSTER_PALETTE = [
  '#44ff88', '#ffcc66', '#88aaff', '#cc88ff', '#ff8844', '#aaffcc',
  '#ffff88', '#ff88aa', '#88ffaa', '#88ddff', '#ddff88', '#ffaadd',
];
function clusterPalette(cid: string): string {
  // Stable hash — same cid always picks the same colour across renders.
  let h = 0;
  for (let i = 0; i < cid.length; i++) h = (h * 31 + cid.charCodeAt(i)) | 0;
  return CLUSTER_PALETTE[Math.abs(h) % CLUSTER_PALETTE.length];
}

// Helper: trace a rounded-rectangle path. Browser support for
// CanvasRenderingContext2D.roundRect varies (added late in some
// engines), so we polyfill explicitly. Both fill() and stroke() can
// follow this path.
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

// ── Component ──────────────────────────────────────────────────────────────

export const ProjectGraphCanvas: React.FC<ProjectGraphCanvasProps> = ({
  nodes,
  edges,
  selectedNodeId,
  onNodeSelect,
  width = 800,
  height = 600,
  clusterMode = 'none',
  searchQuery = '',
  matchIds,
}) => {
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  // Auto-fit-to-screen on first mount: compute the world AABB of all
  // node positions and set pan/zoom so the whole graph lands in one
  // viewport with a small margin. Without this, a 4k-node graph mounts
  // at zoom=1 with every node packed into the centre — unreadable. Runs
  // once per layout-key change (i.e. when the underlying graph changes).
  const fittedKeyRef = useRef<string | null>(null);
  // Coalesce mousemove pan updates into one paint per animation frame.
  // Without this, every mousemove (often 200+/s) triggered a React render
  // that walked 5,000 nodes for visibility culling — drag became a slideshow.
  const pendingPanRef = useRef<{ x: number; y: number } | null>(null);
  const panRafRef = useRef<number | null>(null);
  const schedulePan = (next: { x: number; y: number }) => {
    pendingPanRef.current = next;
    if (panRafRef.current !== null) return;
    panRafRef.current = requestAnimationFrame(() => {
      panRafRef.current = null;
      if (pendingPanRef.current) setPan(pendingPanRef.current);
    });
  };
  useEffect(() => () => {
    if (panRafRef.current !== null) cancelAnimationFrame(panRafRef.current);
  }, []);

  // Compute cluster id per node up-front. `folder` uses the source-file's
  // top-3-segments path; `type` uses the node type. Nodes without a
  // sourceFile (e.g. agent_activity) fall into a synthetic "_no-folder"
  // bucket so they still cluster predictably.
  const clusterByNode = useMemo<Map<string, string>>(() => {
    const map = new Map<string, string>();
    if (clusterMode === 'none') return map;
    for (const n of nodes) {
      let id: string;
      if (clusterMode === 'type') {
        id = n.type;
      } else {
        const file = n.sourceFile ?? '';
        const segs = file.split(/[\\/]/).filter(Boolean);
        // Take up to 3 leading segments — strikes a balance between
        // "too coarse" (root only) and "too fine" (every leaf folder).
        // For a path like apps/vscode/src/projectGraph/scanner.ts that's
        // apps/vscode/src; for top-level files (CHANGELOG.md) it's the
        // filename itself, so docs cluster by file.
        id = segs.slice(0, 3).join('/') || '_root';
      }
      map.set(n.id, id);
    }
    return map;
  }, [nodes, clusterMode]);

  // Memo key based on node-id set + edge-id set — not array references —
  // so unchanged data doesn't re-trigger a 300-tick simulation on every
  // browse-result post. The webview reposts a fresh array on every
  // filter change; without this guard the canvas re-runs the full
  // layout for no reason and the tab freezes for a second each time.
  const layoutKey = useMemo(() => {
    let key = `${width}x${height}|${nodes.length}n|${edges.length}e|${clusterMode}`;
    const sample = (arr: { id: string }[]) =>
      arr.slice(0, 16).map((x) => x.id).sort().join(',');
    key += '|' + sample(nodes) + '|' + sample(edges);
    return key;
  }, [nodes, edges, width, height, clusterMode]);

  const positions = useMemo(
    () => layoutNodes(nodes, edges, width, height, clusterByNode),
    [layoutKey],
  );

  // Fit-to-screen pass: runs after each layout completes (positions
  // change). Computes world AABB and sets pan/zoom so it lands in the
  // canvas with 10% margin. Skips if user has already interacted with
  // pan/zoom since this layout — heuristic: fittedKeyRef tracks the
  // last layoutKey we fit, so a fresh layout always fits, but a manual
  // pan after that doesn't get clobbered.
  useEffect(() => {
    if (positions.size === 0) return;
    if (fittedKeyRef.current === layoutKey) return;
    fittedKeyRef.current = layoutKey;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of positions.values()) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    const worldW = Math.max(maxX - minX, 1) + NODE_W * 2;
    const worldH = Math.max(maxY - minY, 1) + NODE_H * 2;
    const scaleX = (width * 0.9) / worldW;
    const scaleY = (height * 0.9) / worldH;
    const fitZoom = Math.max(0.15, Math.min(1.5, Math.min(scaleX, scaleY)));
    const cxWorld = (minX + maxX) / 2;
    const cyWorld = (minY + maxY) / 2;
    setZoom(fitZoom);
    setPan({ x: width / 2 - cxWorld * fitZoom, y: height / 2 - cyWorld * fitZoom });
  }, [layoutKey, positions, width, height]);

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
  //
  // Selection wins over filter: when a node is selected, its 3-hop
  // neighbourhood always renders at full opacity even if those nodes
  // don't match the active search/filter — clicking a box is the user's
  // signal that they want to inspect its connections, and dimming the
  // neighbours back behind the filter would defeat the click. The filter
  // still applies to nodes outside the selection's reachable set.
  const nodeOpacity = (id: string): number => {
    if (levelMap) {
      const lvl = levelMap.get(id);
      if (lvl !== undefined) {
        if (lvl === 0 || lvl === 1) return 1;
        if (lvl === 2) return 0.98;
        return 0.9; // level 3
      }
      // Unreachable from the selected node: filter still wins, otherwise
      // fade toward the background so the neighbourhood pops.
      if (matchSet && !matchSet.has(id)) return 0.15;
      return 0.1;
    }
    // No selection: filter is the only signal.
    if (matchSet && !matchSet.has(id)) return 0.15;
    return 1;
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

  const isEmpty = nodes.length === 0;

  // Minimap visibility — persisted per-workspace via a key derived from
  // the location.origin (best we can do inside a webview that doesn't
  // expose vscode workspace path). Defaults to ON for graphs > 200 nodes.
  const MINIMAP_LS_KEY = 'eh.projectGraph.minimap';
  const [minimapOn, setMinimapOn] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      const v = window.localStorage.getItem(MINIMAP_LS_KEY);
      if (v === '0') return false;
      if (v === '1') return true;
    } catch { /* localStorage may be blocked */ }
    return nodes.length > 200;
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(MINIMAP_LS_KEY, minimapOn ? '1' : '0');
    } catch { /* ignore */ }
  }, [minimapOn]);

  // Viewport culling bounds (world space). Computing these inline as
  // numbers — instead of materialising a Set<id> — keeps each pan/zoom
  // re-render at O(1) for the bounds and O(n) only when actually
  // walking nodes during JSX render. Allocates 4 numbers, not 5,000.
  const overscan = Math.max(width, height);
  const cullMinX = (-pan.x - overscan) / zoom;
  const cullMinY = (-pan.y - overscan) / zoom;
  const cullMaxX = (-pan.x + width + overscan) / zoom;
  const cullMaxY = (-pan.y + height + overscan) / zoom;
  const isVisible = (id: string): boolean => {
    const p = positions.get(id);
    if (!p) return false;
    return p.x >= cullMinX && p.x <= cullMaxX && p.y >= cullMinY && p.y <= cullMaxY;
  };
  // Cheap visible-count for the label-threshold check below — counts
  // positions inside the cull box without building a Set.
  let visibleCount = 0;
  for (const p of positions.values()) {
    if (p.x >= cullMinX && p.x <= cullMaxX && p.y >= cullMinY && p.y <= cullMaxY) visibleCount++;
  }

  // Match set: prefer the authoritative server list (matches + neighbours
  // separated; only matches highlight) when present. Fallback to local
  // substring match for back-compat or no-search cases.
  const matchSet = useMemo<Set<string> | null>(() => {
    if (matchIds && matchIds.length > 0) return new Set(matchIds);
    const q = searchQuery.trim().toLowerCase();
    if (!q) return null;
    const set = new Set<string>();
    for (const n of nodes) {
      if (
        n.label.toLowerCase().includes(q) ||
        n.type.toLowerCase().includes(q) ||
        (n.sourceFile?.toLowerCase().includes(q) ?? false)
      ) {
        set.add(n.id);
      }
    }
    return set;
  }, [nodes, searchQuery, matchIds]);

  // Auto-center on the search results. Single match → centre + zoom-in
  // on that node. Multiple matches → centre on their centroid and
  // zoom-fit so all matches + their immediate context land in view.
  // Either way the user sees the result of their query without manual
  // pan/zoom. Tracking lastFocusedKey prevents re-centering on identical
  // re-renders (filter pill clicks etc).
  const lastFocusedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!matchSet || matchSet.size === 0) return;
    const ids = Array.from(matchSet).sort();
    const key = ids.join('|');
    if (key === lastFocusedRef.current) return;
    lastFocusedRef.current = key;

    let targetPanX: number, targetPanY: number, targetZoom: number;
    if (matchSet.size === 1) {
      const pos = positions.get(ids[0]);
      if (!pos) return;
      targetZoom = 1.4;
      targetPanX = width / 2 - pos.x * targetZoom;
      targetPanY = height / 2 - pos.y * targetZoom;
    } else {
      // Centroid + zoom-fit so the match cluster fits with margin.
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      let cx = 0, cy = 0, count = 0;
      for (const id of ids) {
        const p = positions.get(id);
        if (!p) continue;
        cx += p.x; cy += p.y; count++;
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      if (count === 0) return;
      cx /= count; cy /= count;
      const spanW = Math.max(maxX - minX, 1) + NODE_W * 4;
      const spanH = Math.max(maxY - minY, 1) + NODE_H * 4;
      targetZoom = Math.max(0.4, Math.min(1.4, Math.min((width * 0.85) / spanW, (height * 0.85) / spanH)));
      targetPanX = width / 2 - cx * targetZoom;
      targetPanY = height / 2 - cy * targetZoom;
    }

    const startPan = { ...pan };
    const startZoom = zoom;
    const start = performance.now();
    const dur = 300;
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - t, 3);
      setPan({
        x: startPan.x + (targetPanX - startPan.x) * e,
        y: startPan.y + (targetPanY - startPan.y) * e,
      });
      setZoom(startZoom + (targetZoom - startZoom) * e);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // pan/zoom read for animation start only; not deps.
  }, [matchSet, positions, width, height]);
  useEffect(() => {
    if (!matchSet || matchSet.size === 0) lastFocusedRef.current = null;
  }, [matchSet]);

  // With the 200-cap restored we always render full-design boxes; the
  // adaptive-tier work was a band-aid for the SVG-at-4k era and is no
  // longer needed.
  const labelVisible = (id: string): boolean => {
    void degreeMap; void labelDegreeThreshold; void visibleCount;
    return id === selectedNodeId
      || true; // 200-node cap means every node always has room for a label
  };

  // Per-node degree for label-thresholding (Graphify shows labels only
  // on the top ~15% by degree — at scale, every-node labelling is just
  // illegible noise). Walk edges once to count.
  const degreeMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of edges) {
      m.set(e.sourceId, (m.get(e.sourceId) ?? 0) + 1);
      m.set(e.targetId, (m.get(e.targetId) ?? 0) + 1);
    }
    return m;
  }, [edges]);
  const labelDegreeThreshold = useMemo(() => {
    if (degreeMap.size === 0) return 0;
    let max = 0;
    for (const v of degreeMap.values()) if (v > max) max = v;
    // 15% of max degree, with a floor of 2 so very-low-degree graphs
    // still get most labels.
    return Math.max(2, Math.floor(max * 0.15));
  }, [degreeMap]);

  // ── Canvas paint ─────────────────────────────────────────────────────
  // Replaces the previous SVG renderer. SVG with 200+ interactive nodes
  // is slow because every shape becomes a live DOM element; Canvas paints
  // pixels in one drawcall regardless of node count. Hit-testing is
  // explicit (a `pickNode(x, y)` helper that walks the visible node
  // list — fine at 200 nodes, would need a quadtree at 5,000).
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Track potential click vs drag — a small tolerance lets jittery
  // mice still register a click instead of a 1-pixel pan.
  const mouseDownRef = useRef<{ x: number; y: number; t: number } | null>(null);

  // Hover state for the portal tooltip. Updates on mousemove via
  // hit-test; only re-renders when the hovered node id actually
  // changes (React bails on identical state writes). Cleared during
  // drag so the tooltip doesn't flicker while panning.
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Convert canvas-local coordinates to world space for hit-testing.
  const screenToWorld = (sx: number, sy: number): { x: number; y: number } => ({
    x: (sx - pan.x) / zoom,
    y: (sy - pan.y) / zoom,
  });

  const pickNode = (sx: number, sy: number): string | null => {
    const w = screenToWorld(sx, sy);
    let best: string | null = null;
    let bestDist = Infinity;
    const halfW = NODE_W / 2;
    const halfH = NODE_H / 2;
    for (const node of nodes) {
      const p = positions.get(node.id);
      if (!p) continue;
      // Quick AABB test, then prefer the closest match (ties go to the
      // node whose centre is nearest the click).
      if (
        w.x >= p.x - halfW && w.x <= p.x + halfW
        && w.y >= p.y - halfH && w.y <= p.y + halfH
      ) {
        const d = (w.x - p.x) ** 2 + (w.y - p.y) ** 2;
        if (d < bestDist) {
          bestDist = d;
          best = node.id;
        }
      }
    }
    return best;
  };

  // Single paint loop — runs on any state that affects the visible
  // pixels. requestAnimationFrame coalesces multiple state changes per
  // frame into one paint, which is critical during drag.
  const paintRafRef = useRef<number | null>(null);
  useEffect(() => {
    const cnv = canvasRef.current;
    if (!cnv) return;
    if (paintRafRef.current !== null) cancelAnimationFrame(paintRafRef.current);
    paintRafRef.current = requestAnimationFrame(() => {
      paintRafRef.current = null;
      const ctx = cnv.getContext('2d');
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      // Resize backing store for crisp rendering on Retina without
      // recreating the canvas DOM node every paint.
      const want = { w: Math.round(width * dpr), h: Math.round(height * dpr) };
      if (cnv.width !== want.w || cnv.height !== want.h) {
        cnv.width = want.w;
        cnv.height = want.h;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Background.
      ctx.fillStyle = '#0a1810';
      ctx.fillRect(0, 0, width, height);

      // Subtle blueprint grid — drawn in screen space (not transformed)
      // so the grid stays a constant size when the user zooms.
      ctx.strokeStyle = 'rgba(34, 102, 68, 0.1)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = (pan.x % GRID_SPACING); x < width; x += GRID_SPACING) {
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, height);
      }
      for (let y = (pan.y % GRID_SPACING); y < height; y += GRID_SPACING) {
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(width, y + 0.5);
      }
      ctx.stroke();

      if (isEmpty) {
        ctx.fillStyle = '#557766';
        ctx.font = '12px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(
          'Run /eh:optimize-context in any AI agent to build the project graph.',
          width / 2,
          height / 2,
        );
        return;
      }

      // Apply pan/zoom for world-space drawing.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.translate(pan.x, pan.y);
      ctx.scale(zoom, zoom);

      // Edges — hidden during drag so panning stays responsive.
      if (!drag) {
        for (const edge of edges) {
          const a = positions.get(edge.sourceId);
          const b = positions.get(edge.targetId);
          if (!a || !b) continue;
          if (!isVisible(edge.sourceId) && !isVisible(edge.targetId)) continue;
          const style = edgeStyle(edge.sourceId, edge.targetId);
          ctx.strokeStyle = style.stroke;
          ctx.globalAlpha = style.opacity;
          ctx.lineWidth = style.width;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      // Nodes.
      for (const node of nodes) {
        const p = positions.get(node.id);
        if (!p) continue;
        if (!isVisible(node.id)) continue;
        const baseColor = NODE_COLORS[node.type] ?? DEFAULT_NODE_COLOR;
        const cid = clusterByNode.get(node.id);
        const color = clusterMode !== 'none' && cid ? clusterPalette(cid) : baseColor;
        const isSelected = node.id === selectedNodeId;
        const isMatch = matchSet?.has(node.id) ?? false;
        const opacity = nodeOpacity(node.id);

        ctx.globalAlpha = opacity;

        // Halo glow.
        ctx.fillStyle = color;
        ctx.globalAlpha = opacity * 0.15;
        roundRect(ctx, p.x - NODE_W / 2 - 8, p.y - NODE_H / 2 - 8, NODE_W + 16, NODE_H + 16, NODE_RADIUS + 6);
        ctx.fill();

        // Main rounded rect.
        ctx.globalAlpha = opacity;
        ctx.fillStyle = '#142c1f';
        roundRect(ctx, p.x - NODE_W / 2, p.y - NODE_H / 2, NODE_W, NODE_H, NODE_RADIUS);
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = color;
        ctx.globalAlpha = opacity * 0.85;
        ctx.stroke();

        // Selection ring (white).
        if (isSelected) {
          ctx.lineWidth = 2;
          ctx.strokeStyle = '#ffffff';
          ctx.globalAlpha = 0.85;
          roundRect(ctx, p.x - NODE_W / 2 - 4, p.y - NODE_H / 2 - 4, NODE_W + 8, NODE_H + 8, NODE_RADIUS + 4);
          ctx.stroke();
        }

        // Tier ring (BFS-distance from selection).
        const lvl = levelMap?.get(node.id);
        if (!isSelected && lvl !== undefined && lvl >= 1 && lvl <= 3) {
          ctx.strokeStyle = lvl === 1 ? '#44ff88' : lvl === 2 ? '#ffcc66' : '#ff8844';
          ctx.lineWidth = lvl === 1 ? 2.5 : lvl === 2 ? 2 : 1.6;
          ctx.globalAlpha = lvl === 1 ? 1 : lvl === 2 ? 0.95 : 0.85;
          roundRect(ctx, p.x - NODE_W / 2 - 3, p.y - NODE_H / 2 - 3, NODE_W + 6, NODE_H + 6, NODE_RADIUS + 3);
          ctx.stroke();
        }

        // Search-match amber stroke.
        if (isMatch && !isSelected) {
          ctx.strokeStyle = '#ffaa44';
          ctx.lineWidth = 2.5;
          ctx.globalAlpha = 0.95;
          roundRect(ctx, p.x - NODE_W / 2 - 5, p.y - NODE_H / 2 - 5, NODE_W + 10, NODE_H + 10, NODE_RADIUS + 5);
          ctx.stroke();
        }

        // Labels.
        if (labelVisible(node.id)) {
          ctx.globalAlpha = opacity;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = color;
          ctx.font = '9px monospace';
          ctx.fillText(node.type, p.x, p.y - 6);
          ctx.fillStyle = '#ddeeff';
          ctx.font = '11px monospace';
          // 11px monospace ≈ 6.6 px/char. NODE_W=85 minus ~8 px internal
          // padding leaves room for ~12 chars. Anything longer collapses
          // to 11+ellipsis so labels stay inside the box border. The
          // hover tooltip below shows the full name.
          const labelText = node.label.length > 12 ? node.label.slice(0, 11) + '…' : node.label;
          ctx.fillText(labelText, p.x, p.y + 12);
        }
        ctx.globalAlpha = 1;
      }
    });
    return () => {
      if (paintRafRef.current !== null) cancelAnimationFrame(paintRafRef.current);
    };
  }, [
    nodes, edges, positions, selectedNodeId, matchSet, levelMap, clusterByNode,
    clusterMode, pan, zoom, drag, width, height, isEmpty,
  ]);

  return (
    <div style={{ position: 'relative', width, height }}>
    <canvas
      ref={canvasRef}
      style={{
        display: 'block',
        width,
        height,
        background: '#0a1810',
        cursor: drag ? 'grabbing' : 'grab',
        userSelect: 'none',
      }}
      onMouseDown={(e) => {
        const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
        mouseDownRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top, t: Date.now() };
        setDrag({ startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y });
      }}
      onMouseMove={(e) => {
        if (drag) {
          schedulePan({ x: drag.panX + (e.clientX - drag.startX), y: drag.panY + (e.clientY - drag.startY) });
          if (hoveredId !== null) setHoveredId(null);
          return;
        }
        const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const id = pickNode(sx, sy);
        if (id !== hoveredId) setHoveredId(id);
      }}
      onMouseUp={(e) => {
        const start = mouseDownRef.current;
        const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        if (start) {
          const dx = sx - start.x;
          const dy = sy - start.y;
          // Treat as click only if movement was tiny (pixel-jitter
          // tolerance) and not a long-hold.
          if (dx * dx + dy * dy < 16) {
            const id = pickNode(sx, sy);
            if (onNodeSelect) onNodeSelect(id);
          }
        }
        mouseDownRef.current = null;
        setDrag(null);
      }}
      onMouseLeave={() => {
        mouseDownRef.current = null;
        setDrag(null);
        setHoveredId(null);
      }}
      onWheel={(e) => {
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        setZoom((z) => Math.max(0.25, Math.min(4, z * factor)));
      }}
    />
    <Minimap
      width={width}
      height={height}
      positions={positions}
      nodeColors={nodes.reduce<Map<string, string>>((acc, n) => {
        acc.set(n.id, NODE_COLORS[n.type] ?? DEFAULT_NODE_COLOR);
        return acc;
      }, new Map())}
      pan={pan}
      zoom={zoom}
      onPanChange={setPan}
      visible={minimapOn}
      onToggle={() => setMinimapOn((v) => !v)}
    />
    <HoverTooltip hoveredNode={hoveredId ? nodes.find((n) => n.id === hoveredId) ?? null : null} />
    </div>
  );
};

// ── Hover tooltip ──────────────────────────────────────────────────────────
// Portal-mounted on document.body, positioned fixed at the top-right of
// the webview viewport. Per the project's tooltip rule (always portal,
// fixed corner — never inline / never following the cursor) this stays
// out of the canvas's React tree and never gets clipped or affected by
// ancestor styles.

const HoverTooltip: React.FC<{ hoveredNode: GraphNodeData | null }> = ({ hoveredNode }) => {
  if (!hoveredNode) return null;
  if (typeof document === 'undefined') return null; // SSR / test guard
  const color = NODE_COLORS[hoveredNode.type] ?? DEFAULT_NODE_COLOR;
  return createPortal(
    <div
      style={{
        position: 'fixed',
        top: 56,
        right: 12,
        zIndex: 9999,
        maxWidth: 360,
        padding: '8px 10px',
        background: 'rgba(10, 24, 16, 0.96)',
        border: '1px solid rgba(68, 187, 110, 0.6)',
        borderRadius: 4,
        fontFamily: 'monospace',
        fontSize: 11,
        color: '#cceedd',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
        pointerEvents: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{
          fontSize: 9,
          padding: '1px 5px',
          borderRadius: 2,
          background: 'rgba(68, 255, 136, 0.15)',
          color,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
        }}>
          {hoveredNode.type}
        </span>
      </div>
      <div style={{ fontSize: 12, color: '#ddeeff', wordBreak: 'break-all', marginBottom: 4 }}>
        {hoveredNode.label}
      </div>
      {hoveredNode.sourceFile && (
        <div style={{ fontSize: 10, color: '#88aa99', wordBreak: 'break-all' }}>
          {hoveredNode.sourceFile}{hoveredNode.sourceLocation ? `:${hoveredNode.sourceLocation}` : ''}
        </div>
      )}
    </div>,
    document.body,
  );
};

// ── Minimap ────────────────────────────────────────────────────────────────

interface MinimapProps {
  width: number;
  height: number;
  positions: Map<string, { x: number; y: number }>;
  nodeColors: Map<string, string>;
  pan: { x: number; y: number };
  zoom: number;
  onPanChange: (next: { x: number; y: number }) => void;
  visible: boolean;
  onToggle: () => void;
}

const MINIMAP_W = 200;
const MINIMAP_H = 120;

const Minimap: React.FC<MinimapProps> = ({
  width,
  height,
  positions,
  nodeColors,
  pan,
  zoom,
  onPanChange,
  visible,
  onToggle,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Compute the world AABB once per positions change so we can map world
  // → minimap consistently across paint and pointer events.
  const worldBounds = useMemo(() => {
    if (positions.size === 0) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of positions.values()) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    // Pad so the minimap rect doesn't clip nodes at the edge.
    const padX = (maxX - minX) * 0.1 || 100;
    const padY = (maxY - minY) * 0.1 || 100;
    return { minX: minX - padX, minY: minY - padY, maxX: maxX + padX, maxY: maxY + padY };
  }, [positions]);

  const worldW = worldBounds.maxX - worldBounds.minX;
  const worldH = worldBounds.maxY - worldBounds.minY;
  const scale = Math.min(MINIMAP_W / worldW, MINIMAP_H / worldH);
  const offX = (MINIMAP_W - worldW * scale) / 2;
  const offY = (MINIMAP_H - worldH * scale) / 2;

  // Repaint whenever positions or pan/zoom change. Coalesced through rAF
  // so a flurry of pan events from a fast drag turns into one paint per
  // frame, not one paint per mousemove. The 2-px dot renderer is cheap
  // enough that the bottleneck would otherwise be DOM overhead.
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    if (!visible) return;
    const c = canvasRef.current;
    if (!c) return;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, MINIMAP_W, MINIMAP_H);
      ctx.fillStyle = '#0a1810';
      ctx.fillRect(0, 0, MINIMAP_W, MINIMAP_H);
      for (const [id, p] of positions) {
        const mx = offX + (p.x - worldBounds.minX) * scale;
        const my = offY + (p.y - worldBounds.minY) * scale;
        ctx.fillStyle = nodeColors.get(id) ?? '#88cc99';
        ctx.fillRect(mx - 1, my - 1, 2, 2);
      }
      const vMinX = -pan.x / zoom;
      const vMinY = -pan.y / zoom;
      const vMaxX = (-pan.x + width) / zoom;
      const vMaxY = (-pan.y + height) / zoom;
      const rx = offX + (vMinX - worldBounds.minX) * scale;
      const ry = offY + (vMinY - worldBounds.minY) * scale;
      const rw = (vMaxX - vMinX) * scale;
      const rh = (vMaxY - vMinY) * scale;
      ctx.strokeStyle = '#44ff88';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(rx, ry, rw, rh);
    });
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [visible, positions, nodeColors, pan, zoom, width, height, worldBounds, offX, offY, scale]);

  const handlePointer = (clientX: number, clientY: number, rect: DOMRect) => {
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    // Convert minimap click to world coords, then to pan such that that
    // world point lands at the centre of the main canvas.
    const worldX = worldBounds.minX + (mx - offX) / scale;
    const worldY = worldBounds.minY + (my - offY) / scale;
    onPanChange({ x: width / 2 - worldX * zoom, y: height / 2 - worldY * zoom });
  };

  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        title={visible ? 'Hide minimap' : 'Show minimap'}
        style={{
          position: 'absolute',
          right: 8,
          bottom: 8,
          width: 24,
          height: 24,
          padding: 0,
          background: 'rgba(20, 44, 32, 0.85)',
          border: '1px solid rgba(68, 187, 110, 0.4)',
          color: '#88cc99',
          cursor: 'pointer',
          fontFamily: 'monospace',
          fontSize: 14,
          lineHeight: '20px',
          borderRadius: 3,
          zIndex: 2,
        }}
      >
        {visible ? '×' : '▦'}
      </button>
      {visible && (
        <canvas
          ref={canvasRef}
          width={MINIMAP_W}
          height={MINIMAP_H}
          style={{
            position: 'absolute',
            right: 38,
            bottom: 8,
            border: '1px solid rgba(68, 187, 110, 0.4)',
            cursor: 'crosshair',
            zIndex: 1,
          }}
          onMouseDown={(e) => {
            handlePointer(e.clientX, e.clientY, (e.target as HTMLCanvasElement).getBoundingClientRect());
          }}
          onMouseMove={(e) => {
            if (e.buttons === 1) {
              handlePointer(e.clientX, e.clientY, (e.target as HTMLCanvasElement).getBoundingClientRect());
            }
          }}
        />
      )}
    </>
  );
};

// ── Convex hull (Andrew's monotone chain) ──────────────────────────────────

/**
 * Returns the convex hull of `pts` as an ordered loop (counter-clockwise).
 * Used to draw a polygon around each cluster's members. Andrew's monotone
 * chain is O(n log n) — fine for a few hundred points per cluster.
 */
export function convexHull(pts: { x: number; y: number }[]): { x: number; y: number }[] {
  if (pts.length <= 1) return [...pts];
  const sorted = [...pts].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: { x: number; y: number }[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: { x: number; y: number }[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

// ── Cluster layout (cheap, deterministic, no full simulation) ──────────────

/**
 * Positions for the clustered view. Super-nodes (one per cluster id) live
 * on a deterministic ring around the canvas centre; member nodes for any
 * expanded cluster fan out around that cluster's centre on a small ring.
 *
 * Why not d3-force here: with all 4,000 members hidden by default, paying
 * the cost of a 300-tick Barnes-Hut simulation just to throw the results
 * away is wasteful — and worse, forceCollide packing tiny circles into
 * the same area produces the brick-pattern overlap users keep seeing.
 * A static ring is plenty for the super-node-only case, and a tiny
 * per-cluster simulation handles expansion in a few milliseconds.
 */
export function layoutClusters(
  nodes: GraphNodeData[],
  edges: GraphEdgeData[],
  w: number,
  h: number,
  clusterByNode: Map<string, string>,
  expanded: Set<string>,
): Map<string, NodePosition> {
  const result = new Map<string, NodePosition>();
  if (nodes.length === 0) return result;

  // Group members per cluster. Sort cluster ids alphabetically so the
  // layout is stable across re-renders.
  const members = new Map<string, GraphNodeData[]>();
  for (const n of nodes) {
    const cid = clusterByNode.get(n.id);
    if (!cid) continue;
    const arr = members.get(cid) ?? [];
    arr.push(n);
    members.set(cid, arr);
  }
  const clusterIds = Array.from(members.keys()).sort();
  const cx = w / 2;
  const cy = h / 2;

  // Outer ring radius scales with the canvas size and cluster count so
  // even 30 clusters spread without overlap.
  const ringRadius = Math.min(w, h) * 0.35;

  // Cluster centres on a deterministic ring.
  const clusterCenter = new Map<string, { x: number; y: number }>();
  clusterIds.forEach((cid, i) => {
    const angle = (i / Math.max(clusterIds.length, 1)) * Math.PI * 2;
    clusterCenter.set(cid, {
      x: cx + Math.cos(angle) * ringRadius,
      y: cy + Math.sin(angle) * ringRadius,
    });
  });

  // For collapsed clusters, every member shares the cluster centre —
  // they're hidden in render anyway, but the centroid math elsewhere
  // (hull, edge re-routing, fit-to-screen) still uses these positions.
  // For expanded clusters, fan members out on a small ring; if the
  // cluster has many members, use a spiral so they don't overlap on a
  // single circle.
  for (const cid of clusterIds) {
    const centre = clusterCenter.get(cid)!;
    const isExpanded = expanded.has(cid);
    const list = members.get(cid)!;
    if (!isExpanded) {
      for (const m of list) result.set(m.id, { x: centre.x, y: centre.y });
      continue;
    }
    // Expanded: spread members on concentric rings around the centre.
    // Stable order via id sort so re-renders don't shuffle nodes.
    list.sort((a, b) => (a.id < b.id ? -1 : 1));
    const innerR = 70;
    const ringStep = NODE_H + 16;
    const perRing = Math.max(8, Math.floor((2 * Math.PI * innerR) / (NODE_W + 16)));
    list.forEach((m, idx) => {
      const ring = Math.floor(idx / perRing);
      const ringR = innerR + ring * ringStep;
      const onRing = idx % perRing;
      const angle = (onRing / Math.max(perRing, 1)) * Math.PI * 2;
      result.set(m.id, {
        x: centre.x + Math.cos(angle) * ringR,
        y: centre.y + Math.sin(angle) * ringR,
      });
    });
  }

  // Edges aren't simulated separately here — their endpoints already
  // resolve through `positions.get(...)` in render.
  void edges;

  // Snap to grid for visual consistency with the rest of the canvas.
  for (const [id, p] of result) {
    result.set(id, {
      x: Math.round(p.x / GRID_SPACING) * GRID_SPACING,
      y: Math.round(p.y / GRID_SPACING) * GRID_SPACING,
    });
  }

  return result;
}

// ── Force-directed layout (d3-force, Barnes-Hut quadtree) ─────────────────

interface NodePosition {
  x: number;
  y: number;
}

interface SimNode extends SimulationNodeDatum {
  id: string;
}

/**
 * Run a d3-force simulation over the graph and return final positions.
 *
 * d3-force ships with a Barnes-Hut quadtree for repulsion (`forceManyBody`)
 * — that's the O(n log n) approximation that lets thousands of nodes lay
 * out without freezing the browser. We tick synchronously inside useMemo
 * so the graph appears in one paint, same UX as the previous hand-rolled
 * loop. The previous AABB resolver is gone — `forceCollide` with circular
 * bounds owns positions now, so we don't have springs and a separate
 * resolver fighting each other.
 *
 * Tick budget: 300 is a settled sweet spot — fewer leaves visible drift,
 * more is wasted compute past the point d3-force has converged.
 */
export function layoutNodes(
  nodes: GraphNodeData[],
  edges: GraphEdgeData[],
  w: number,
  h: number,
  clusterByNode?: Map<string, string>,
): Map<string, NodePosition> {
  if (nodes.length === 0) return new Map();
  if (nodes.length === 1) return new Map([[nodes[0].id, { x: w / 2, y: h / 2 }]]);

  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(w, h) * 0.3;

  // When clustering is on, seed each cluster on its own ring around the
  // centre. Within a cluster, members start near the cluster's seed point
  // so the force simulation pulls them tight quickly. Without clustering,
  // we use a single ring across all nodes (deterministic, no Math.random).
  const clusterIds = clusterByNode && clusterByNode.size > 0
    ? Array.from(new Set(clusterByNode.values()))
    : null;
  const clusterSeed = new Map<string, { x: number; y: number }>();
  if (clusterIds) {
    clusterIds.forEach((id, i) => {
      const angle = (i / clusterIds.length) * Math.PI * 2;
      const ringR = radius * 0.85;
      clusterSeed.set(id, {
        x: cx + Math.cos(angle) * ringR,
        y: cy + Math.sin(angle) * ringR,
      });
    });
  }

  const simNodes: SimNode[] = nodes.map((n, i) => {
    const cid = clusterByNode?.get(n.id);
    const seed = cid ? clusterSeed.get(cid) : null;
    if (seed) {
      // Tiny per-member offset so cluster members don't all start on the
      // same point (which would explode under repulsion).
      const memberAngle = (i / nodes.length) * Math.PI * 2;
      return {
        id: n.id,
        x: seed.x + Math.cos(memberAngle) * 16,
        y: seed.y + Math.sin(memberAngle) * 16,
        vx: 0,
        vy: 0,
      };
    }
    const angle = (i / nodes.length) * Math.PI * 2;
    return {
      id: n.id,
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
    };
  });

  const validIds = new Set(simNodes.map((n) => n.id));
  const simLinks: SimulationLinkDatum<SimNode>[] = edges
    .filter((e) => validIds.has(e.sourceId) && validIds.has(e.targetId))
    .map((e) => ({ source: e.sourceId, target: e.targetId }));

  // With the 200-cap restored, the canvas always renders full 80×48
  // boxes. Collide radius = half-diagonal of the box + a small halo
  // pad. Anything smaller and forceCollide allows visible overlap.
  const collideRadius = Math.sqrt((NODE_W / 2) ** 2 + (NODE_H / 2) ** 2) + 12;
  const N = simNodes.length;

  // Custom cluster force: each tick, nudge nodes toward their cluster's
  // running centroid. Pre-allocate the centroid map once so we don't
  // churn the GC every tick on big graphs.
  let clusterForce: ((alpha: number) => void) | null = null;
  if (clusterByNode && clusterByNode.size > 0) {
    const centroidsBuf = new Map<string, { x: number; y: number; n: number }>();
    clusterForce = (alpha: number) => {
      // Reset centroid accumulators (don't reallocate the Map).
      for (const c of centroidsBuf.values()) { c.x = 0; c.y = 0; c.n = 0; }
      for (const sn of simNodes) {
        const cid = clusterByNode.get(sn.id);
        if (!cid || typeof sn.x !== 'number' || typeof sn.y !== 'number') continue;
        let c = centroidsBuf.get(cid);
        if (!c) { c = { x: 0, y: 0, n: 0 }; centroidsBuf.set(cid, c); }
        c.x += sn.x;
        c.y += sn.y;
        c.n += 1;
      }
      for (const c of centroidsBuf.values()) {
        if (c.n > 0) { c.x /= c.n; c.y /= c.n; }
      }
      // Bumped from 0.1 to 0.18 once forceCollide moved to strength(1) +
      // iterations(3) — the stronger collide passes were overpowering
      // the cluster pull and members were drifting between clusters.
      const k = 0.18 * alpha;
      for (const sn of simNodes) {
        const cid = clusterByNode.get(sn.id);
        if (!cid) continue;
        const c = centroidsBuf.get(cid);
        if (!c || typeof sn.x !== 'number' || typeof sn.y !== 'number') continue;
        sn.vx = (sn.vx ?? 0) + (c.x - sn.x) * k;
        sn.vy = (sn.vy ?? 0) + (c.y - sn.y) * k;
      }
    };
  }

  // Physics tuned to match Graphify's vis.js forceAtlas2Based config:
  //   gravitationalConstant -60   → forceManyBody().strength(-60)
  //   centralGravity        0.005 → forceCenter().strength(0.005)
  //   springLength          120   → forceLink().distance(120)
  //   springConstant        0.08  → forceLink().strength(0.08)
  //   avoidOverlap          0.8   → forceCollide().strength(0.8)
  //   stabilization 200 iterations
  //
  // Why this works at 4k nodes when our previous -600 charge produced
  // a brick-pattern: weak repulsion (-60) lets springs (0.08) dominate
  // for connected nodes, which produces natural community grouping.
  // Connected files cluster organically; disconnected ones drift to
  // the periphery. Same formula Graphify ships under.
  // Charge scales with N — Graphify's -60 is right for ≤500 nodes, but
  // at 4k the centre-pull from forceCenter wins and you get a tight
  // ball. Bump charge linearly with N (cap at -300) so the layout
  // sprawls instead of imploding.
  const chargeStrength = -Math.min(300, 60 + N * 0.06);
  // Drop centralGravity to zero at scale — we rely on link forces +
  // forceCenter offset to keep things on screen, and the auto-fit
  // useEffect re-centers anyway. For small graphs Graphify's 0.005
  // gives a nicer cohesion.
  const centerGravity = N <= 500 ? 0.005 : 0;

  const sim = forceSimulation<SimNode>(simNodes)
    .force('charge', forceManyBody<SimNode>().strength(chargeStrength).theta(0.9).distanceMax(800))
    .force(
      'link',
      forceLink<SimNode, SimulationLinkDatum<SimNode>>(simLinks)
        .id((n) => n.id)
        .distance(120)
        .strength(0.08),
    )
    .force('center', forceCenter(cx, cy).strength(centerGravity))
    // strength(1) + iterations(3): with only 200 nodes the cost is
    // trivial, and these values guarantee non-overlapping final
    // positions even after spring forces yank nodes together.
    .force('collide', forceCollide<SimNode>(collideRadius).strength(1).iterations(3));
  if (clusterForce) sim.force('cluster', clusterForce);
  sim.stop();

  sim.tick(200);

  const result = new Map<string, NodePosition>();
  for (const n of simNodes) {
    if (typeof n.x !== 'number' || typeof n.y !== 'number') continue;
    result.set(n.id, {
      x: Math.round(n.x / GRID_SPACING) * GRID_SPACING,
      y: Math.round(n.y / GRID_SPACING) * GRID_SPACING,
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

