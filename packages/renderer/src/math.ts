/**
 * Pure math & layout helpers extracted from Universe.tsx for testability.
 * No PixiJS or DOM dependencies — all functions are pure.
 * @event-horizon/renderer
 */

// Types defined here to avoid circular dependency with Universe.tsx.
// Universe.tsx re-exports these types.

export interface AgentView {
  id: string;
  name: string;
  agentType?: string;
  cwd?: string;
}

export interface WorkspaceGroup {
  agentIds: string[];
  memberPositions: Array<{ x: number; y: number }>;
}

// --- constants ---------------------------------------------------------------

/** Minimum pixel distance between planet centers (prevents overlap). */
export const MIN_PIXEL_DIST = 150;
/** Minimum distance from origin — planets must stay outside the singularity + belt padding. */
export const PLANET_MIN_RADIUS = 180;
/** Ship arcs must clear the singularity outer glow. */
export const SHIP_AVOID_RADIUS = 95;
/** Orbital band centre radii. */
export const BAND_R = [220, 310, 400];
/** Number of angular samples for belt contour. */
export const BELT_SAMPLES = 64;
/** Padding around planets when computing belt contour. */
export const BELT_PADDING = 65;

// --- helpers ----------------------------------------------------------------

/** DJB2 hash — deterministic integer from a string. */
export function hashId(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h) ^ s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Normalize a cwd path for grouping comparison (lowercase, forward slashes, no trailing slash). */
export function normCwd(p: string): string {
  let s = p.replace(/\\/g, '/').toLowerCase();
  while (s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

/**
 * Group agents by workspace — agents whose cwd is the same, nested, or shares
 * a common parent are placed in the same group.
 * Solo agents (no cwd or no match) get their own single-element group.
 */
export function groupByWorkspace(agents: AgentView[]): AgentView[][] {
  const groups: Array<{ root: string; members: AgentView[] }> = [];
  const ungrouped: AgentView[] = [];

  for (const agent of agents) {
    if (!agent.cwd) { ungrouped.push(agent); continue; }
    const n = normCwd(agent.cwd);
    let placed = false;
    for (const g of groups) {
      if (n === g.root || n.startsWith(g.root + '/') || g.root.startsWith(n + '/')) {
        g.members.push(agent);
        if (n.length < g.root.length) g.root = n;
        placed = true;
        break;
      }
    }
    if (!placed) groups.push({ root: n, members: [agent] });
  }

  const result: AgentView[][] = groups.map((g) => g.members);
  for (const a of ungrouped) result.push([a]);
  return result;
}

/** Quadratic bezier position at progress t. */
export function bezierPoint(
  t: number,
  x0: number, y0: number,
  cx: number, cy: number,
  x1: number, y1: number,
): { x: number; y: number } {
  const mt = 1 - t;
  return {
    x: mt * mt * x0 + 2 * mt * t * cx + t * t * x1,
    y: mt * mt * y0 + 2 * mt * t * cy + t * t * y1,
  };
}

/**
 * Bezier control point that guarantees the arc avoids the black hole.
 *
 * If the straight path clears the danger zone, adds an aesthetic arc
 * scaled by distance (min 30px, max 120px).
 * If the path passes through the danger zone, pushes the control point
 * perpendicular to the from→to line, away from origin.
 */
export function computeControlPoint(
  fromX: number, fromY: number,
  toX: number,   toY: number,
): { cx: number; cy: number } {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const lenSq = dx * dx + dy * dy || 1;
  const lineLen = Math.sqrt(lenSq);

  const tNear = Math.max(0, Math.min(1, -(fromX * dx + fromY * dy) / lenSq));
  const nearX  = fromX + tNear * dx;
  const nearY  = fromY + tNear * dy;
  const nearDist = Math.sqrt(nearX * nearX + nearY * nearY);

  const mx = (fromX + toX) / 2;
  const my = (fromY + toY) / 2;

  let perpX = -dy / lineLen;
  let perpY =  dx / lineLen;
  const midDist = Math.sqrt(mx * mx + my * my);
  if (midDist > 1 && perpX * (mx / midDist) + perpY * (my / midDist) < 0) {
    perpX = -perpX;
    perpY = -perpY;
  }

  if (nearDist >= SHIP_AVOID_RADIUS) {
    const arcOffset = Math.max(30, Math.min(120, lineLen * 0.2));
    return { cx: mx + perpX * arcOffset, cy: my + perpY * arcOffset };
  }

  const push = 260 + (SHIP_AVOID_RADIUS - nearDist);
  return { cx: mx + perpX * push, cy: my + perpY * push };
}

/**
 * Place planets so they never overlap.
 *
 * Groups agents by workspace, assigns to orbital bands by hash,
 * runs repulsion passes to resolve overlaps, and clamps to minimum radius.
 */
export function computePlanetPositions(
  agents: AgentView[],
  sessionSeed: number = 0,
): { positions: Map<string, { x: number; y: number }>; workspaceGroups: WorkspaceGroup[] } {
  if (agents.length === 0) return { positions: new Map(), workspaceGroups: [] };

  const wsGroups = groupByWorkspace(agents);
  const sessionAngleOffset = sessionSeed * Math.PI * 2;
  const posArray: Array<{ id: string; x: number; y: number }> = [];

  for (const group of wsGroups) {
    const bandIdx = hashId(group[0].id) % 3;
    const R = BAND_R[bandIdx];
    const startAngle = (hashId(group[0].id + 'b' + bandIdx) % 628) / 100 + sessionAngleOffset;
    const groupAngle = startAngle + (hashId(group[0].id + 'g') % 628) / 100;

    if (group.length === 1) {
      const baseJitter = ((hashId(group[0].id + 'r') % 40) / 40 - 0.5) * 14;
      const sessionJitter = ((sessionSeed * hashId(group[0].id) % 30) - 15);
      const r = R + baseJitter + sessionJitter;
      posArray.push({ id: group[0].id, x: Math.cos(groupAngle) * r, y: Math.sin(groupAngle) * r });
    } else {
      const cx = Math.cos(groupAngle) * R;
      const cy = Math.sin(groupAngle) * R;
      const clusterR = 50 + (group.length - 2) * 20;
      const memberStartAngle = (hashId(group[0].id + 'ms') % 628) / 100;
      group.forEach((agent, idx) => {
        const memberAngle = memberStartAngle + (idx / group.length) * Math.PI * 2;
        posArray.push({
          id: agent.id,
          x: cx + Math.cos(memberAngle) * clusterR,
          y: cy + Math.sin(memberAngle) * clusterR,
        });
      });
    }
  }

  // Repulsion pass — also enforces minimum distance from origin (singularity)
  for (let iter = 0; iter < 100; iter++) {
    let anyOverlap = false;
    for (let i = 0; i < posArray.length; i++) {
      for (let j = i + 1; j < posArray.length; j++) {
        const pi = posArray[i];
        const pj = posArray[j];
        const ddx = pj.x - pi.x;
        const ddy = pj.y - pi.y;
        const dist = Math.sqrt(ddx * ddx + ddy * ddy) || 0.001;
        if (dist < MIN_PIXEL_DIST) {
          anyOverlap = true;
          const pushDist = (MIN_PIXEL_DIST - dist) * 0.55 + 1;
          const nx = (ddx / dist) * pushDist;
          const ny = (ddy / dist) * pushDist;
          pi.x -= nx;  pi.y -= ny;
          pj.x += nx;  pj.y += ny;
        }
      }
    }
    // Push any planet that drifted too close to the singularity back out
    for (const p of posArray) {
      const d = Math.sqrt(p.x * p.x + p.y * p.y) || 0.001;
      if (d < PLANET_MIN_RADIUS) {
        p.x = (p.x / d) * PLANET_MIN_RADIUS;
        p.y = (p.y / d) * PLANET_MIN_RADIUS;
        anyOverlap = true;
      }
    }
    if (!anyOverlap) break;
  }

  const positions = new Map<string, { x: number; y: number }>();
  for (const p of posArray) {
    const d = Math.sqrt(p.x * p.x + p.y * p.y) || 0.001;
    if (d < PLANET_MIN_RADIUS) {
      p.x = (p.x / d) * PLANET_MIN_RADIUS;
      p.y = (p.y / d) * PLANET_MIN_RADIUS;
    }
    positions.set(p.id, { x: p.x, y: p.y });
  }

  const workspaceGroups: WorkspaceGroup[] = [];
  for (const group of wsGroups) {
    if (group.length < 2) continue;
    const ids = group.map((a) => a.id);
    const pts = ids.map((id) => positions.get(id)).filter((p): p is { x: number; y: number } => !!p);
    if (pts.length < 2) continue;
    workspaceGroups.push({ agentIds: ids, memberPositions: pts });
  }

  return { positions, workspaceGroups };
}

/**
 * Compute an irregular belt contour around planet positions.
 * For each angular sample from the centroid, find the farthest planet
 * in that direction, add padding, then apply noise for organic feel.
 */
export function computeBeltContour(
  memberPositions: Array<{ x: number; y: number }>,
): Array<{ x: number; y: number }> {
  let cx = 0, cy = 0;
  for (const p of memberPositions) { cx += p.x; cy += p.y; }
  cx /= memberPositions.length; cy /= memberPositions.length;

  const contour: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < BELT_SAMPLES; i++) {
    const angle = (i / BELT_SAMPLES) * Math.PI * 2;
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);

    let maxProj = 30;
    for (const p of memberPositions) {
      const ddx = p.x - cx;
      const ddy = p.y - cy;
      const proj = ddx * dirX + ddy * dirY;
      const dist = Math.sqrt(ddx * ddx + ddy * ddy);
      const effective = Math.max(proj, dist * 0.6);
      if (effective > maxProj) maxProj = effective;
    }

    const noise = ((hashId(`belt${i}`) % 20) - 10);
    const r = maxProj + BELT_PADDING + noise;
    contour.push({ x: cx + dirX * r, y: cy + dirY * r });
  }

  return contour;
}
