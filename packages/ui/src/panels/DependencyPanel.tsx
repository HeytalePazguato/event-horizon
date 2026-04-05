/**
 * Dependency Panel — DAG visualization of task dependencies.
 * Renders tasks as nodes with edges for blockedBy relationships,
 * uses topological sort (Kahn's algorithm) for left-to-right layout,
 * highlights the critical path, and shows cycle warnings.
 * @event-horizon/ui
 */

import type { FC } from 'react';
import { useMemo } from 'react';
import { colors, fonts, sizes } from '../styles/tokens.js';
import type { PlanView, PlanTaskView, PlanTaskStatus } from './PlanPanel.js';

// ── Status colors (matching spec) ─────────────────────────────────────────

const STATUS_COLORS: Record<PlanTaskStatus, string> = {
  pending: '#4a7a58',
  claimed: '#6aa0d4',
  in_progress: '#d4a84a',
  done: '#40a060',
  failed: '#c65858',
  blocked: '#8a6a2a',
};

// ── Cycle detection (DFS coloring) ────────────────────────────────────────

function detectCycles(tasks: PlanTaskView[]): string[] {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const cycles: string[] = [];
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  for (const task of tasks) color.set(task.id, WHITE);

  function dfs(taskId: string, path: string[]): void {
    color.set(taskId, GRAY);
    path.push(taskId);
    const task = taskById.get(taskId);
    if (task) {
      for (const dep of task.blockedBy) {
        if (color.get(dep) === GRAY) {
          const cycleStart = path.indexOf(dep);
          cycles.push(`Cycle: ${path.slice(cycleStart).join(' -> ')} -> ${dep}`);
        } else if (color.get(dep) === WHITE) {
          dfs(dep, path);
        }
      }
    }
    path.pop();
    color.set(taskId, BLACK);
  }

  for (const task of tasks) {
    if (color.get(task.id) === WHITE) dfs(task.id, []);
  }
  return cycles;
}

// ── Topological sort (Kahn's algorithm) ───────────────────────────────────

function topoSort(tasks: PlanTaskView[]): { layers: string[][]; hasCycles: boolean } {
  const inDegree = new Map<string, number>();
  const taskIds = new Set(tasks.map((t) => t.id));
  const adjList = new Map<string, string[]>(); // dep -> dependents

  for (const task of tasks) {
    inDegree.set(task.id, 0);
    adjList.set(task.id, []);
  }

  for (const task of tasks) {
    for (const dep of task.blockedBy) {
      if (!taskIds.has(dep)) continue;
      inDegree.set(task.id, (inDegree.get(task.id) ?? 0) + 1);
      const list = adjList.get(dep) ?? [];
      list.push(task.id);
      adjList.set(dep, list);
    }
  }

  const layers: string[][] = [];
  let queue = tasks.filter((t) => (inDegree.get(t.id) ?? 0) === 0).map((t) => t.id);
  const visited = new Set<string>();

  while (queue.length > 0) {
    layers.push([...queue]);
    const next: string[] = [];
    for (const id of queue) {
      visited.add(id);
      for (const dependent of adjList.get(id) ?? []) {
        const deg = (inDegree.get(dependent) ?? 1) - 1;
        inDegree.set(dependent, deg);
        if (deg === 0 && !visited.has(dependent)) next.push(dependent);
      }
    }
    queue = next;
  }

  // Add any remaining (cycle members) to the last layer
  const remaining = tasks.filter((t) => !visited.has(t.id)).map((t) => t.id);
  if (remaining.length > 0) layers.push(remaining);

  return { layers, hasCycles: remaining.length > 0 };
}

// ── Critical path (longest dependency chain) ──────────────────────────────

function findCriticalPath(tasks: PlanTaskView[]): Set<string> {
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const taskIds = new Set(tasks.map((t) => t.id));
  const memo = new Map<string, { length: number; path: string[] }>();

  function longestPath(id: string): { length: number; path: string[] } {
    if (memo.has(id)) return memo.get(id)!;
    const task = taskById.get(id);
    if (!task || task.blockedBy.length === 0) {
      const result = { length: 1, path: [id] };
      memo.set(id, result);
      return result;
    }
    let best = { length: 0, path: [] as string[] };
    for (const dep of task.blockedBy) {
      if (!taskIds.has(dep)) continue;
      const sub = longestPath(dep);
      if (sub.length > best.length) best = sub;
    }
    const result = { length: best.length + 1, path: [...best.path, id] };
    memo.set(id, result);
    return result;
  }

  let criticalResult = { length: 0, path: [] as string[] };
  for (const task of tasks) {
    const result = longestPath(task.id);
    if (result.length > criticalResult.length) criticalResult = result;
  }

  // Build set of edges on the critical path
  const criticalEdges = new Set<string>();
  for (let i = 0; i < criticalResult.path.length - 1; i++) {
    criticalEdges.add(`${criticalResult.path[i]}->${criticalResult.path[i + 1]}`);
  }
  return criticalEdges;
}

// ── Component ─────────────────────────────────────────────────────────────

const NODE_W = 140;
const NODE_H = 48;
const LAYER_GAP = 60;
const NODE_GAP = 16;

export interface DependencyPanelProps {
  plan: PlanView;
}

export const DependencyPanel: FC<DependencyPanelProps> = ({ plan }) => {
  if (!plan.loaded || !plan.tasks || plan.tasks.length === 0) {
    return (
      <div style={{ padding: sizes.spacing.xl, color: colors.text.dim, fontFamily: fonts.mono, fontSize: sizes.text.md, textAlign: 'center', marginTop: 40 }}>
        <div style={{ fontSize: sizes.text.xl, marginBottom: sizes.spacing.md, color: colors.text.secondary }}>No Plan Loaded</div>
        <div>Load a plan to view the dependency graph.</div>
      </div>
    );
  }

  const tasks = plan.tasks;
  const cycles = useMemo(() => detectCycles(tasks), [tasks]);
  const { layers } = useMemo(() => topoSort(tasks), [tasks]);
  const criticalEdges = useMemo(() => findCriticalPath(tasks), [tasks]);

  // Compute node positions
  const positions = useMemo(() => {
    const pos = new Map<string, { x: number; y: number }>();
    for (let col = 0; col < layers.length; col++) {
      const layer = layers[col];
      const totalHeight = layer.length * NODE_H + (layer.length - 1) * NODE_GAP;
      const startY = -totalHeight / 2;
      for (let row = 0; row < layer.length; row++) {
        pos.set(layer[row], {
          x: col * (NODE_W + LAYER_GAP),
          y: startY + row * (NODE_H + NODE_GAP),
        });
      }
    }
    return pos;
  }, [layers]);

  // Compute SVG bounds
  const { svgWidth, svgHeight, offsetX, offsetY } = useMemo(() => {
    let minX = 0, maxX = 0, minY = 0, maxY = 0;
    for (const { x, y } of positions.values()) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x + NODE_W);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y + NODE_H);
    }
    const pad = 40;
    return {
      svgWidth: maxX - minX + pad * 2,
      svgHeight: maxY - minY + pad * 2,
      offsetX: -minX + pad,
      offsetY: -minY + pad,
    };
  }, [positions]);

  // Build edges
  const edges = useMemo(() => {
    const result: Array<{ from: string; to: string; isCritical: boolean }> = [];
    for (const task of tasks) {
      for (const dep of task.blockedBy) {
        if (!positions.has(dep)) continue;
        const edgeKey = `${dep}->${task.id}`;
        result.push({ from: dep, to: task.id, isCritical: criticalEdges.has(edgeKey) });
      }
    }
    return result;
  }, [tasks, positions, criticalEdges]);

  return (
    <div style={{ padding: sizes.spacing.lg, fontFamily: fonts.mono, display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: sizes.spacing.md, marginBottom: sizes.spacing.md, flexShrink: 0 }}>
        <div style={{ fontSize: sizes.text.xl, color: colors.text.primary, fontWeight: 600 }}>
          Dependencies
        </div>
        {plan.name && (
          <span style={{ fontSize: sizes.text.sm, color: colors.text.dim }}>
            {plan.name}
          </span>
        )}
        <span style={{ fontSize: sizes.text.xs, color: colors.text.dim, marginLeft: 'auto' }}>
          {tasks.length} tasks, {edges.length} edges
        </span>
      </div>

      {/* Cycle warnings */}
      {cycles.length > 0 && (
        <div style={{
          padding: `${sizes.spacing.sm}px ${sizes.spacing.md}px`,
          background: 'rgba(198,88,88,0.12)',
          border: '1px solid #8a3030',
          borderRadius: sizes.radius.sm,
          marginBottom: sizes.spacing.md,
          flexShrink: 0,
        }}>
          <div style={{ fontSize: sizes.text.sm, color: '#c65858', fontWeight: 600, marginBottom: 4 }}>
            Dependency Cycles Detected
          </div>
          {cycles.map((c, i) => (
            <div key={i} style={{ fontSize: sizes.text.xs, color: '#a04040', lineHeight: 1.4 }}>
              {c}
            </div>
          ))}
        </div>
      )}

      {/* Legend */}
      <div style={{ display: 'flex', gap: sizes.spacing.lg, marginBottom: sizes.spacing.sm, flexShrink: 0, flexWrap: 'wrap' }}>
        {(['pending', 'blocked', 'in_progress', 'done', 'failed'] as PlanTaskStatus[]).map((s) => (
          <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: STATUS_COLORS[s] }} />
            <span style={{ fontSize: sizes.text.xs, color: colors.text.dim, textTransform: 'uppercase' }}>{s}</span>
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ width: 16, height: 3, background: '#c65858', borderRadius: 1 }} />
          <span style={{ fontSize: sizes.text.xs, color: colors.text.dim }}>Critical Path</span>
        </div>
      </div>

      {/* DAG SVG */}
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        <svg width={svgWidth} height={svgHeight} style={{ display: 'block' }}>
          <defs>
            <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill={colors.text.dim} />
            </marker>
            <marker id="arrowhead-critical" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill="#c65858" />
            </marker>
          </defs>

          {/* Edges */}
          {edges.map((edge, i) => {
            const fromPos = positions.get(edge.from);
            const toPos = positions.get(edge.to);
            if (!fromPos || !toPos) return null;
            const x1 = fromPos.x + NODE_W + offsetX;
            const y1 = fromPos.y + NODE_H / 2 + offsetY;
            const x2 = toPos.x + offsetX;
            const y2 = toPos.y + NODE_H / 2 + offsetY;
            return (
              <line
                key={i}
                x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={edge.isCritical ? '#c65858' : colors.border.primary}
                strokeWidth={edge.isCritical ? 2.5 : 1.2}
                strokeOpacity={edge.isCritical ? 0.9 : 0.5}
                markerEnd={edge.isCritical ? 'url(#arrowhead-critical)' : 'url(#arrowhead)'}
              />
            );
          })}

          {/* Nodes */}
          {tasks.map((task) => {
            const pos = positions.get(task.id);
            if (!pos) return null;
            const x = pos.x + offsetX;
            const y = pos.y + offsetY;
            const statusColor = STATUS_COLORS[task.status] ?? colors.text.dim;
            return (
              <g key={task.id}>
                <rect
                  x={x} y={y} width={NODE_W} height={NODE_H}
                  rx={3} ry={3}
                  fill={colors.bg.secondary}
                  stroke={statusColor}
                  strokeWidth={1.5}
                />
                {/* Task ID */}
                <text x={x + 6} y={y + 14} fill={colors.text.dim} fontSize={9} fontFamily={fonts.mono}>
                  {task.id}
                </text>
                {/* Title (truncated) */}
                <text x={x + 6} y={y + 28} fill={colors.text.primary} fontSize={10} fontFamily={fonts.mono}>
                  {task.title.length > 16 ? task.title.slice(0, 15) + '\u2026' : task.title}
                </text>
                {/* Status indicator */}
                <rect
                  x={x} y={y + NODE_H - 4}
                  width={NODE_W} height={4}
                  rx={0} ry={0}
                  fill={statusColor}
                  fillOpacity={0.6}
                />
                {/* Assignee */}
                {task.assignee && (
                  <text x={x + 6} y={y + 42} fill="#6aa0d4" fontSize={8} fontFamily={fonts.mono}>
                    {task.assignee.length > 18 ? task.assignee.slice(0, 17) + '\u2026' : task.assignee}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
};
