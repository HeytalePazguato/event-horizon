/**
 * Main PixiJS canvas + React wrapper for the cosmic universe.
 * @event-horizon/renderer
 */

import 'pixi.js/unsafe-eval';
import type { FC } from 'react';
import { useEffect, useRef, useState, useCallback } from 'react';
import { Application, Container, Graphics, Text } from 'pixi.js';
import { createStars } from './entities/Stars.js';
import { createSingularity } from './entities/Singularity.js';
import { createPlanet } from './entities/Planet.js';
import type { ExtendedPlanet, PlanetVariant } from './entities/Planet.js';
import { createAstronaut } from './entities/Astronaut.js';
import { createUfo, setUfoBeam } from './entities/Ufo.js';
import type { ExtendedUfo } from './entities/Ufo.js';
import { createShip } from './entities/Ship.js';
import { createMoon } from './entities/Moon.js';

export interface AgentView {
  id: string;
  name: string;
  agentType?: string;
}

export interface MetricsView {
  load: number;
}

export interface ShipSpawn {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  payloadSize?: number;
  fromAgentType?: string;
}

export interface UniverseProps {
  width?: number;
  height?: number;
  agents?: AgentView[];
  metrics?: Record<string, MetricsView>;
  ships?: ShipSpawn[];
  agentStates?: Record<string, string>;
  pausedAgentIds?: Record<string, boolean>;
  isolatedAgentId?: string | null;
  boostedAgentIds?: Record<string, boolean>;
  selectedAgentId?: string | null;
  centerRequestedAt?: number;
  /** Number of active subagents per agent — rendered as orbiting moons. */
  activeSubagents?: Record<string, number>;
  onPlanetHover?: (agentId: string | null) => void;
  onPlanetClick?: (agentId: string) => void;
  onReady?: (app: Application) => void;
  /** Called when an astronaut is destroyed by the black hole. */
  onAstronautConsumed?: () => void;
  /** Called when the user clicks to spawn an astronaut. */
  onAstronautSpawned?: () => void;
  /** Called when the UFO completes a successful abduction. */
  onUfoAbduction?: () => void;
  /** Called when the user clicks on the UFO. */
  onUfoClicked?: () => void;
}

// --- constants -----------------------------------------------------------

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2;
const INITIAL_W = 640;
const INITIAL_H = 400;
const GRAVITY_STRENGTH = 0.15;
const SINGULARITY_PULL = 1.2;
const ASTRONAUT_MAX_SPEED = 3;
const ASTRONAUT_SUCK_RADIUS = 92;   // outer glow of singularity — suck-in starts here
const ASTRONAUT_DESTROY_RADIUS = 30;
const SHIP_PROGRESS_SPEED = 0.006;
const SHIP_AVOID_RADIUS = 95; // must clear singularity outer glow (DISK_OUTER 70 + glow 20 + margin)
const MAX_TRAIL_POINTS = 32;
const UFO_INTERVAL_MIN_MS = 25000;
const UFO_INTERVAL_MAX_MS = 55000;
const UFO_FLYBY_CHANCE = 0.4; // 40% of UFOs just fly by without abducting
const SHOOTING_STAR_INTERVAL_MIN = 30000;  // ms between shooting stars
const SHOOTING_STAR_INTERVAL_MAX = 90000;
const SHOOTING_STAR_MAX_BURST = 3; // up to 3 shooting stars per event
const ASTRONAUT_JET_MIN_MS = 180_000;     // 3 minutes minimum before jet fires
const ASTRONAUT_JET_MAX_MS = 420_000;     // 7 minutes max

/** Minimum distance from singularity centre for a planet to be placed.
 *  Must clear DISK_OUTER(70) + outer-glow(20) + max-planet-size(20) + margin = ~130. */
const PLANET_MIN_RADIUS = 130;

/** Trail color keyed by agentType. */
const TRAIL_COLORS: Record<string, number> = {
  'claude-code': 0x88aaff,
  'copilot':     0xcc88ff,
  'opencode':    0x88ffaa,
};
const TRAIL_COLOR_DEFAULT = 0xffcc44;

// --- helpers -------------------------------------------------------------

/**
 * Place planets so they never overlap.
 *
 * Strategy:
 *  1. Assign each agent to one of 3 orbit bands (by ID hash).
 *  2. Space agents evenly around their band orbit.
 *  3. Run a pixel-space repulsion pass to resolve any remaining overlaps
 *     (including cross-band ones), then re-clamp to PLANET_MIN_RADIUS.
 *
 * MIN_PIXEL_DIST = 120px accounts for the largest visual extent:
 * gas-giant ring arc ≈ size * 1.35 * 1.75 ≈ 38px at avg size 16,
 * so two gas giants need ≥ 76px center-to-center + margin = 120px.
 */
function computePlanetPositions(
  agents: AgentView[],
): Map<string, { x: number; y: number }> {
  if (agents.length === 0) return new Map();

  function hashId(s: string): number {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = (((h << 5) + h) ^ s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  // Band centre radii — gaps between bands are 100px+, well above the ~38px
  // gas-giant ring extent, so cross-band overlap at the same angle is impossible.
  const BAND_R = [155, 265, 375];

  const bands: AgentView[][] = [[], [], []];
  for (const agent of agents) bands[hashId(agent.id) % 3].push(agent);

  const posArray: Array<{ id: string; x: number; y: number; origR: number }> = [];

  for (let b = 0; b < 3; b++) {
    const group = bands[b];
    if (group.length === 0) continue;
    const R = BAND_R[b];

    // Deterministic but varied start angle per band
    const startAngle = (hashId((group[0].id) + 'b' + b) % 628) / 100;

    group.forEach((agent, idx) => {
      const angle = startAngle + (idx / group.length) * Math.PI * 2;
      const radialJitter = ((hashId(agent.id + 'r') % 40) / 40 - 0.5) * 14;
      const r = R + radialJitter;
      posArray.push({ id: agent.id, x: Math.cos(angle) * r, y: Math.sin(angle) * r, origR: r });
    });
  }

  // ── Pixel-space repulsion — guarantees no overlap regardless of band layout ──
  const MIN_PIXEL_DIST = 120;
  for (let iter = 0; iter < 80; iter++) {
    let anyOverlap = false;
    for (let i = 0; i < posArray.length; i++) {
      for (let j = i + 1; j < posArray.length; j++) {
        const pi = posArray[i];
        const pj = posArray[j];
        const dx = pj.x - pi.x;
        const dy = pj.y - pi.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
        if (dist < MIN_PIXEL_DIST) {
          anyOverlap = true;
          const push = (MIN_PIXEL_DIST - dist) * 0.55 + 1;
          const nx = (dx / dist) * push;
          const ny = (dy / dist) * push;
          pi.x -= nx;  pi.y -= ny;
          pj.x += nx;  pj.y += ny;
        }
      }
    }
    if (!anyOverlap) break;
  }

  // Re-clamp to minimum safe radius so nothing ends up inside the singularity
  const result = new Map<string, { x: number; y: number }>();
  for (const p of posArray) {
    const d = Math.sqrt(p.x * p.x + p.y * p.y) || 0.001;
    if (d < PLANET_MIN_RADIUS) {
      p.x = (p.x / d) * PLANET_MIN_RADIUS;
      p.y = (p.y / d) * PLANET_MIN_RADIUS;
    }
    result.set(p.id, { x: p.x, y: p.y });
  }
  return result;
}

/** Quadratic bezier position at progress t. */
function bezierPoint(
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
 * Bezier control point that guarantees the arc avoids the black hole and its halo.
 *
 * The old "push midpoint outward" approach fails for anti-podal planets: the midpoint
 * lands near the origin, so "outward" is ambiguous and the arc still slices through.
 *
 * Correct approach:
 *  1. Find the closest point on the straight-line path to origin.
 *  2. If it's already clear, add only a small aesthetic arc.
 *  3. If it passes within the danger zone, push the control point PERPENDICULAR
 *     to the from→to line (away from origin). The magnitude is chosen so the
 *     bezier apex is verified to stay > SHIP_AVOID_RADIUS at all t.
 */
function computeControlPoint(
  fromX: number, fromY: number,
  toX: number,   toY: number,
): { cx: number; cy: number } {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const lenSq = dx * dx + dy * dy || 1;
  const lineLen = Math.sqrt(lenSq);

  // Closest point on segment from→to to the origin
  const tNear = Math.max(0, Math.min(1, -(fromX * dx + fromY * dy) / lenSq));
  const nearX  = fromX + tNear * dx;
  const nearY  = fromY + tNear * dy;
  const nearDist = Math.sqrt(nearX * nearX + nearY * nearY);

  const mx = (fromX + toX) / 2;
  const my = (fromY + toY) / 2;

  // Perpendicular to from→to (unit vector), oriented away from origin
  let perpX = -dy / lineLen;
  let perpY =  dx / lineLen;
  const midDist = Math.sqrt(mx * mx + my * my);
  if (midDist > 1 && perpX * (mx / midDist) + perpY * (my / midDist) < 0) {
    perpX = -perpX;
    perpY = -perpY;
  }

  if (nearDist >= SHIP_AVOID_RADIUS) {
    // Straight path already clears the danger zone — subtle arc for visual interest
    return { cx: mx + perpX * 30, cy: my + perpY * 30 };
  }

  // Path passes through the danger zone — push perpendicular.
  // push=260 verified (analytically) to keep arc ≥ SHIP_AVOID_RADIUS at all t,
  // even when planets are exactly anti-podal.  Add extra for deeper penetrations.
  const push = 260 + (SHIP_AVOID_RADIUS - nearDist);
  return { cx: mx + perpX * push, cy: my + perpY * push };
}

// --- active ship type ----------------------------------------------------

interface ActiveShip {
  id: string;
  c: Container;
  trailG: Graphics;
  routeG: Graphics;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  cx: number;
  cy: number;
  progress: number;
  trailPoints: Array<{ x: number; y: number }>;
  trailColor: number;
}

// -------------------------------------------------------------------------

export const Universe: FC<UniverseProps> = ({
  width = INITIAL_W,
  height = INITIAL_H,
  agents = [],
  metrics = {},
  ships = [],
  agentStates = {},
  pausedAgentIds = {},
  isolatedAgentId = null,
  boostedAgentIds = {},
  selectedAgentId = null,
  centerRequestedAt = 0,
  activeSubagents = {},
  onPlanetHover,
  onPlanetClick,
  onReady,
  onAstronautConsumed,
  onAstronautSpawned,
  onUfoAbduction,
  onUfoClicked,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const panContainerRef = useRef<Container | null>(null);
  const worldRef = useRef<Container | null>(null);
  const planetsContainerRef = useRef<Container | null>(null);
  const shipsContainerRef = useRef<Container | null>(null);
  const astronautsContainerRef = useRef<Container | null>(null);
  const singularityRef = useRef<Container | null>(null);
  const starsRef = useRef<Container | null>(null);
  const astronautsRef = useRef<Array<{ id: number; c: Container; vx: number; vy: number; doomed?: boolean; nextJetTime?: number }>>([]);
  const activeShipsRef = useRef<ActiveShip[]>([]);
  const spawnedShipIdsRef = useRef<Set<string>>(new Set());
  const planetPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const agentStatesRef    = useRef<Record<string, string>>(agentStates);
  const metricsRef        = useRef<Record<string, MetricsView>>(metrics);
  const pausedRef         = useRef<Record<string, boolean>>(pausedAgentIds);
  const isolatedRef       = useRef<string | null>(isolatedAgentId);
  const boostedRef        = useRef<Record<string, boolean>>(boostedAgentIds);
  const activeSubagentsRef = useRef<Record<string, number>>(activeSubagents);
  const moonsContainerRef = useRef<Container | null>(null);
  /** Tracks current moon count per agent to avoid unnecessary rebuilds. */
  const moonCountsRef = useRef<Map<string, number>>(new Map());
  const ufoRef = useRef<Container | null>(null);
  const ufoStateRef = useRef<{
    phase: 'idle' | 'fly' | 'beam' | 'flyaway' | 'flyby';
    t: number;
    targetX: number;
    targetY: number;
    startX?: number;
    startY?: number;
    cow?: Container;
    beam?: Container;
    beamLen?: number;
    /** Fly-by waypoints for curved path */
    waypoints?: Array<{ x: number; y: number }>;
    waypointIndex?: number;
    segT?: number;
  }>({ phase: 'idle', t: 0, targetX: 0, targetY: 0 });
  const ufoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shootingStarsRef = useRef<Array<{
    g: Graphics; x: number; y: number; vx: number; vy: number;
    life: number; maxLife: number;
  }>>([]);
  const shootingStarTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const jetSprayRef = useRef<Array<{
    g: Graphics; x: number; y: number; vx: number; vy: number;
    life: number; maxLife: number;
  }>>([]);
  const scaleRef = useRef(1);
  const posRef = useRef({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const initedRef = useRef(false);
  const astronautIdRef = useRef(0);
  const spiralRef = useRef<Array<{ c: Container; vx: number; vy: number }>>([]);
  const spiralContainerRef = useRef<Container | null>(null);
  const prevAgentsRef = useRef<AgentView[]>([]);
  const tickTimeRef = useRef(0);
  const [initError, setInitError] = useState<string | null>(null);
  const [canvasReady, setCanvasReady] = useState(false);

  const sizeRef = useRef({ width, height });
  sizeRef.current = { width, height };

  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  const onAstronautConsumedRef = useRef(onAstronautConsumed);
  onAstronautConsumedRef.current = onAstronautConsumed;
  const onAstronautSpawnedRef = useRef(onAstronautSpawned);
  onAstronautSpawnedRef.current = onAstronautSpawned;
  const onUfoAbductionRef = useRef(onUfoAbduction);
  onUfoAbductionRef.current = onUfoAbduction;
  const onUfoClickedRef = useRef(onUfoClicked);
  onUfoClickedRef.current = onUfoClicked;

  const mountedRef = useRef(true);

  // Keep control refs in sync without triggering rerenders
  useEffect(() => { agentStatesRef.current = agentStates; }, [agentStates]);
  useEffect(() => { metricsRef.current = metrics; }, [metrics]);
  useEffect(() => { pausedRef.current = pausedAgentIds; }, [pausedAgentIds]);
  useEffect(() => { isolatedRef.current = isolatedAgentId; }, [isolatedAgentId]);
  useEffect(() => { boostedRef.current = boostedAgentIds; }, [boostedAgentIds]);
  useEffect(() => { activeSubagentsRef.current = activeSubagents; }, [activeSubagents]);

  // --- init timeout (fallback if PixiJS silently fails) --------------------
  useEffect(() => {
    if (canvasReady || initError) return;
    const t = setTimeout(() => {
      if (!canvasReady && !initError) setInitError('PixiJS initialization timed out');
    }, 15000);
    return () => clearTimeout(t);
  }, [canvasReady, initError]);

  // --- init PixiJS ----------------------------------------------------------
  useEffect(() => {
    mountedRef.current = true;
    const el = containerRef.current;
    if (!el || initedRef.current) return;
    initedRef.current = true;

    const app = new Application();
    appRef.current = app;

    void (async () => {
      try {
        await app.init({
          width: INITIAL_W,
          height: INITIAL_H,
          backgroundColor: 0x0a0a12,
          antialias: true,
          autoDensity: true,
        });

        if (!mountedRef.current || !appRef.current) {
          try { app.destroy(true, { children: true }); } catch { /* ignore */ }
          return;
        }

        const canvas = app.canvas as HTMLCanvasElement;
        canvas.style.display = 'block';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        if (!el.isConnected) return;
        el.appendChild(canvas);

        const w = Math.max(320, sizeRef.current.width || INITIAL_W);
        const h = Math.max(200, sizeRef.current.height || INITIAL_H);
        app.renderer.resize(w, h);

        const panContainer = new Container();
        panContainer.x = w / 2;
        panContainer.y = h / 2;
        app.stage.addChild(panContainer);
        panContainerRef.current = panContainer;

        const stars = createStars(w * 2, h * 2);
        stars.x = -w / 2;
        stars.y = -h / 2;
        app.stage.addChildAt(stars, 0);  // behind panContainer — fixed background
        starsRef.current = stars;

        const world = new Container();
        world.x = 0;
        world.y = 0;
        world.eventMode = 'static';
        const hitArea = new Graphics();
        hitArea.rect(-2000, -2000, 4000, 4000);
        hitArea.fill({ color: 0, alpha: 0 });
        hitArea.eventMode = 'static';
        world.addChild(hitArea);

        // Z-order (back→front): singularity → astronauts → planets → ships
        const singularity = createSingularity({ x: 0, y: 0 });
        world.addChild(singularity);
        singularityRef.current = singularity;

        const astronautsContainer = new Container();
        world.addChild(astronautsContainer);
        astronautsContainerRef.current = astronautsContainer;

        const planetsContainer = new Container();
        world.addChild(planetsContainer);
        planetsContainerRef.current = planetsContainer;

        const moonsContainer = new Container();
        world.addChild(moonsContainer);
        moonsContainerRef.current = moonsContainer;

        const shipsContainer = new Container();
        world.addChild(shipsContainer);
        shipsContainerRef.current = shipsContainer;

        const spiralContainer = new Container();
        world.addChild(spiralContainer);
        spiralContainerRef.current = spiralContainer;

        const ufo = createUfo();
        ufo.eventMode = 'static';
        ufo.cursor = 'pointer';
        ufo.on('pointertap', () => { onUfoClickedRef.current?.(); });
        world.addChild(ufo);
        ufoRef.current = ufo;

        panContainer.addChild(world);
        worldRef.current = world;

        // Astronauts spawn only on click — no auto-spawn
        hitArea.on('pointertap', (e: { global: { x: number; y: number } }) => {
          // Use world.toLocal so zoom scale is correctly accounted for.
          const pos = world.toLocal(e.global);
          const astro = createAstronaut();
          astro.x = pos.x;
          astro.y = pos.y;
          astronautsContainer.addChildAt(astro, 0);
          const id = ++astronautIdRef.current;
          astronautsRef.current.push({
            id,
            c: astro,
            vx: (Math.random() - 0.5) * 1.2,
            vy: (Math.random() - 0.5) * 1.2,
          });
          onAstronautSpawnedRef.current?.();
        });

        if (mountedRef.current) {
          setCanvasReady(true);
          onReadyRef.current?.(app);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (mountedRef.current) setInitError(msg);
      }
    })();

    return () => {
      mountedRef.current = false;
      panContainerRef.current = null;
      worldRef.current = null;
      planetsContainerRef.current = null;
      moonsContainerRef.current = null;
      moonCountsRef.current = new Map();
      shipsContainerRef.current = null;
      spiralContainerRef.current = null;
      astronautsContainerRef.current = null;
      astronautsRef.current = [];
      spiralRef.current = [];
      activeShipsRef.current = [];
      spawnedShipIdsRef.current = new Set();
      planetPositionsRef.current = new Map();
      ufoRef.current = null;
      singularityRef.current = null;
      starsRef.current = null;
      initedRef.current = false;
      appRef.current = null;
      try {
        const c = app.canvas;
        if (c && c.parentNode) c.remove();
      } catch { /* ignore */ }
      try {
        app.destroy(true, { children: true });
      } catch { /* already destroyed */ }
    };
  }, []); // init-only effect

  // --- resize --------------------------------------------------------------
  useEffect(() => {
    if (!canvasReady) return;
    const app = appRef.current;
    const panContainer = panContainerRef.current;
    const stars = starsRef.current;
    if (!app || !panContainer) return;

    try {
      if (app.renderer) app.renderer.resize(width, height);
    } catch { /* ignore */ }

    const cx = width / 2;
    const cy = height / 2;
    panContainer.x = cx + posRef.current.x;
    panContainer.y = cy + posRef.current.y;

    if (stars) {
      try { stars.destroy({ children: true }); } catch { /* ignore */ }
    }
    const newStars = createStars(width * 2, height * 2);
    newStars.x = -width / 2;
    newStars.y = -height / 2;
    app.stage.addChildAt(newStars, 0);
    starsRef.current = newStars;
  }, [width, height, canvasReady]);

  // --- re-center -----------------------------------------------------------
  useEffect(() => {
    if (centerRequestedAt <= 0) return;
    posRef.current = { x: 0, y: 0 };
    const panContainer = panContainerRef.current;
    const sz = sizeRef.current;
    if (panContainer && sz.width && sz.height) {
      panContainer.x = sz.width / 2;
      panContainer.y = sz.height / 2;
    }
  }, [centerRequestedAt]);

  // --- planets -------------------------------------------------------------
  useEffect(() => {
    const planetsContainer = planetsContainerRef.current;
    const spiralContainer = spiralContainerRef.current;
    if (!planetsContainer) return;

    const currentIds = new Set(agents.map((a) => a.id));
    const removedIds = new Set(
      prevAgentsRef.current.filter((a) => !currentIds.has(a.id)).map((a) => a.id),
    );

    if (spiralContainer && removedIds.size > 0) {
      for (const child of planetsContainer.children.slice()) {
        const id = (child as ExtendedPlanet).__agentId;
        if (id && removedIds.has(id)) {
          planetsContainer.removeChild(child);
          const dx = 0 - child.x;
          const dy = 0 - child.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          spiralRef.current.push({
            c: child as Container,
            vx: (dx / dist) * 0.8,
            vy: (dy / dist) * 0.8,
          });
          spiralContainer.addChild(child as Container);
        }
      }
    }

    planetsContainer.removeChildren();

    // Compute non-overlapping positions for this exact agent set
    const posMap = computePlanetPositions(agents);

    agents.forEach((agent) => {
      const pos = posMap.get(agent.id) ?? { x: 0, y: PLANET_MIN_RADIUS };
      const m = metricsRef.current[agent.id];
      const load = m?.load ?? 0.5;
      const size = 12 + load * 8;
      const planet = createPlanet({
        agentId: agent.id,
        x: pos.x,
        y: pos.y,
        size,
        brightness: 0.3 + load * 0.7,
        agentType: agent.agentType,
      });

      // Name label beneath planet
      const label = new Text({
        text: agent.name,
        style: { fontSize: 8, fill: '#6688aa', fontFamily: 'system-ui', align: 'center' },
      });
      label.anchor.set(0.5, 0);
      label.x = 0;
      label.y = (planet.__radius ?? 16) + 5;
      planet.addChild(label);

      planet.on('pointerover', () => onPlanetHover?.(agent.id));
      planet.on('pointerout', () => onPlanetHover?.(null));
      planet.on('pointertap', () => onPlanetClick?.(agent.id));

      if (selectedAgentId && selectedAgentId !== agent.id) {
        planet.alpha = 0.4;
      }

      // __radius is set inside createPlanet (accounts for per-variant size multiplier)
      planetsContainer.addChild(planet);
    });

    planetPositionsRef.current = posMap;
    prevAgentsRef.current = agents;
  // metrics intentionally excluded — read via metricsRef to avoid recreating planets on every update
  }, [agents, selectedAgentId, onPlanetHover, onPlanetClick]);

  // --- ships ---------------------------------------------------------------
  useEffect(() => {
    if (!canvasReady || ships.length === 0) return;
    const shipsContainer = shipsContainerRef.current;
    if (!shipsContainer) return;
    const posMap = planetPositionsRef.current;

    for (const ship of ships) {
      if (spawnedShipIdsRef.current.has(ship.id)) continue;
      const from = posMap.get(ship.fromAgentId);
      const to = posMap.get(ship.toAgentId);
      if (!from || !to) continue;

      const { cx, cy } = computeControlPoint(from.x, from.y, to.x, to.y);
      const trailColor = (ship.fromAgentType ? TRAIL_COLORS[ship.fromAgentType] : undefined) ?? TRAIL_COLOR_DEFAULT;

      // Static ghost route arc (drawn once)
      const routeG = new Graphics();
      for (let s = 0; s <= 48; s++) {
        const p = bezierPoint(s / 48, from.x, from.y, cx, cy, to.x, to.y);
        routeG.circle(p.x, p.y, 0.7).fill({ color: trailColor, alpha: 0.07 });
      }
      shipsContainer.addChild(routeG);

      const trailG = new Graphics();
      shipsContainer.addChild(trailG);

      const shipContainer = createShip({
        fromAgentId: ship.fromAgentId,
        toAgentId: ship.toAgentId,
        payloadSize: ship.payloadSize ?? 1,
        fromX: from.x,
        fromY: from.y,
        toX: to.x,
        toY: to.y,
      });
      shipsContainer.addChild(shipContainer);

      activeShipsRef.current.push({
        id: ship.id,
        c: shipContainer,
        trailG,
        routeG,
        fromX: from.x,
        fromY: from.y,
        toX: to.x,
        toY: to.y,
        cx,
        cy,
        progress: 0,
        trailPoints: [],
        trailColor,
      });
      spawnedShipIdsRef.current.add(ship.id);
    }
  }, [ships, canvasReady]);

  // --- pointer controls ----------------------------------------------------
  const onWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const world = worldRef.current;
    if (!world) return;
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    scaleRef.current = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scaleRef.current + delta));
    world.scale.set(scaleRef.current);
  }, []);

  const onPointerDown = useCallback((e: PointerEvent) => {
    if (e.button === 0) {
      dragRef.current = { x: e.clientX - posRef.current.x, y: e.clientY - posRef.current.y };
    }
  }, []);

  const onPointerMove = useCallback((e: PointerEvent) => {
    if (!dragRef.current) return;
    posRef.current = { x: e.clientX - dragRef.current.x, y: e.clientY - dragRef.current.y };
    const panContainer = panContainerRef.current;
    if (panContainer) {
      const s = sizeRef.current;
      panContainer.x = s.width / 2 + posRef.current.x;
      panContainer.y = s.height / 2 + posRef.current.y;
    }
    // Parallax: stars drift at 10% of pan speed for depth illusion
    const stars = starsRef.current;
    if (stars) {
      const s = sizeRef.current;
      stars.x = -s.width / 2 + posRef.current.x * 0.1;
      stars.y = -s.height / 2 + posRef.current.y * 0.1;
    }
  }, []);

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  useEffect(() => {
    if (!canvasReady) return;
    const app = appRef.current;
    if (!app) return;
    let canvas: HTMLCanvasElement | undefined;
    try {
      canvas = app.canvas as HTMLCanvasElement | undefined;
    } catch {
      return;
    }
    if (!canvas) return;

    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    return () => {
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [canvasReady, onWheel, onPointerDown, onPointerMove, onPointerUp]);

  // --- game loop -----------------------------------------------------------
  useEffect(() => {
    if (!canvasReady) return;
    const app = appRef.current;
    const world = worldRef.current;
    const planetsContainer = planetsContainerRef.current;
    const singularity = singularityRef.current;
    const ufo = ufoRef.current;
    if (!app || !world || !planetsContainer || !singularity || !ufo) return;

    const scheduleUfo = () => {
      const delay = UFO_INTERVAL_MIN_MS + Math.random() * (UFO_INTERVAL_MAX_MS - UFO_INTERVAL_MIN_MS);
      ufoTimerRef.current = setTimeout(() => {
        const kids = planetsContainer.children;
        const eufo = ufo as ExtendedUfo;
        const isFlyby = Math.random() < UFO_FLYBY_CHANCE || kids.length === 0;

        // Random entry point along the viewport edge
        const entryAngle = Math.random() * Math.PI * 2;
        const entryDist = 280 + Math.random() * 60;
        const startX = Math.cos(entryAngle) * entryDist;
        const startY = Math.sin(entryAngle) * entryDist;

        ufo.visible = true;
        ufo.x = startX;
        ufo.y = startY;
        ufo.rotation = 0; // reset any tilt from previous fly-by
        if (eufo.__beam) eufo.__beam.visible = false;
        if (eufo.__cow) eufo.__cow.visible = false;

        if (isFlyby) {
          // Fly-by: curved path through the visible area using 3-5 waypoints
          const wpCount = 3 + Math.floor(Math.random() * 3); // 3–5 waypoints
          const waypoints: Array<{ x: number; y: number }> = [{ x: startX, y: startY }];
          // Generate waypoints within the visible area for an interesting curve
          for (let wi = 0; wi < wpCount; wi++) {
            const frac = (wi + 1) / (wpCount + 1);
            // Oscillate around a rough path across the viewport
            const baseAngle = entryAngle + Math.PI; // general direction: toward opposite side
            const perpAngle = baseAngle + Math.PI / 2;
            const along = 60 + frac * 180;
            const wave = Math.sin(frac * Math.PI * (1.5 + Math.random())) * (80 + Math.random() * 60);
            waypoints.push({
              x: startX + Math.cos(baseAngle) * along + Math.cos(perpAngle) * wave,
              y: startY + Math.sin(baseAngle) * along + Math.sin(perpAngle) * wave,
            });
          }
          // Exit point — far off the opposite edge
          const exitAngle = entryAngle + Math.PI + (Math.random() - 0.5) * 0.6;
          const exitDist = 300 + Math.random() * 100;
          waypoints.push({
            x: startX + Math.cos(exitAngle) * exitDist,
            y: startY + Math.sin(exitAngle) * exitDist,
          });
          ufoStateRef.current = {
            phase: 'flyby',
            t: 0,
            targetX: 0,
            targetY: 0,
            waypoints,
            waypointIndex: 0,
            segT: 0,
          };
        } else {
          // Abduction: fly to a random planet
          const planet = kids[Math.floor(Math.random() * kids.length)] as Container & { __radius?: number };
          const radius = planet.__radius ?? 18;
          const beamLen = radius + 52;
          if (eufo.__cow) eufo.__cow.y = beamLen;
          setUfoBeam(eufo, beamLen);
          ufoStateRef.current = {
            phase: 'fly',
            t: 0,
            startX,
            startY,
            targetX: planet.x,
            targetY: planet.y - (radius + 52),
            cow: eufo.__cow as Container,
            beam: eufo.__beam as Container,
            beamLen,
          };
        }
        scheduleUfo();
      }, delay);
    };
    scheduleUfo();

    // Shooting star spawner — 1 to 3 at once, random direction, every 30-90s
    // Stars container is behind panContainer in stage coords. We add shooting stars
    // to the world container instead so they render in world-space (visible & pan-aware).
    const spawnShootingStars = () => {
      const delay = SHOOTING_STAR_INTERVAL_MIN + Math.random() * (SHOOTING_STAR_INTERVAL_MAX - SHOOTING_STAR_INTERVAL_MIN);
      shootingStarTimerRef.current = setTimeout(() => {
        const sz = sizeRef.current;
        const scale = scaleRef.current;
        const pan = posRef.current;
        // Compute world-space visible bounds
        const left   = -(sz.width  / 2 + pan.x) / scale;
        const right  =  (sz.width  / 2 - pan.x) / scale;
        const top    = -(sz.height / 2 + pan.y) / scale;
        const bottom =  (sz.height / 2 - pan.y) / scale;
        const vw = right - left;
        const vh = bottom - top;

        const count = 1 + Math.floor(Math.random() * SHOOTING_STAR_MAX_BURST);

        for (let si = 0; si < count; si++) {
          // Start within the visible viewport (with some margin)
          const x = left + Math.random() * vw;
          const y = top + Math.random() * vh;
          // Fully random direction (0-360°)
          const angle = Math.random() * Math.PI * 2;
          const speed = 2 + Math.random() * 3;
          const length = 20 + Math.random() * 30;
          const vx = Math.cos(angle) * speed;
          const vy = Math.sin(angle) * speed;

          const g = new Graphics();
          const colors = [0xffffff, 0xddeeff, 0xffeedd];
          const color = colors[Math.floor(Math.random() * colors.length)];
          // Tail trails behind the head
          g.moveTo(0, 0)
           .lineTo(-Math.cos(angle) * length, -Math.sin(angle) * length)
           .stroke({ width: 1.2, color, alpha: 0.7 });
          // Bright head dot
          g.circle(0, 0, 1.5).fill({ color, alpha: 0.9 });
          g.x = x;
          g.y = y;
          g.alpha = 0;
          // Add behind planets (index 1 = right after singularity)
          if (world.children.length > 1) {
            world.addChildAt(g, 1);
          } else {
            world.addChild(g);
          }

          const maxLife = 0.6 + Math.random() * 0.8;
          const startDelay = si * (0.1 + Math.random() * 0.3);
          shootingStarsRef.current.push({ g, x, y, vx, vy, life: -startDelay, maxLife });
        }

        spawnShootingStars();
      }, delay);
    };
    spawnShootingStars();

    const tick = () => {
      if (!world || !planetsContainer) return;
      tickTimeRef.current += 0.016;
      const singPos = { x: 0, y: 0 };

      // Spiral-in removed agents
      const spiral = spiralRef.current;
      for (let i = spiral.length - 1; i >= 0; i--) {
        const s = spiral[i];
        s.c.x += s.vx;
        s.c.y += s.vy;
        s.vx *= 1.02;
        s.vy *= 1.02;
        s.c.alpha *= 0.98;
        s.c.scale.set((s.c.scale.x ?? 1) * 0.99);
        const d = Math.sqrt(s.c.x * s.c.x + s.c.y * s.c.y);
        if (d < 25) {
          s.c.destroy({ children: true });
          spiral.splice(i, 1);
        }
      }

      // Per-planet state-driven animation
      const t = tickTimeRef.current;
      const isolated = isolatedRef.current;
      for (const p of planetsContainer.children as ExtendedPlanet[]) {
        const agentId = p.__agentId ?? '';
        const state   = agentStatesRef.current[agentId] ?? 'idle';
        const variant = (p.__variant ?? 'rocky') as PlanetVariant;
        const isPaused  = Boolean(pausedRef.current[agentId]);
        const isBoosted = Boolean(boostedRef.current[agentId]);

        // Isolation: dim everything except the isolated planet
        if (isolated) {
          p.alpha = isolated === agentId ? 1 : 0.18;
        } else {
          p.alpha = 1;
        }

        // Pulse rhythm encodes agent type:
        //   gas      → very slow, barely perceptible (massive, deliberate)
        //   icy      → fast, bright (reactive autocomplete)
        //   rocky    → steady medium (deterministic tools)
        //   volcanic → irregular floor (always "hot", unpredictable)
        let pulse: number;
        if (state === 'thinking') {
          if (variant === 'icy')      pulse = 1 + 0.07 * Math.sin(t * 11);
          else if (variant === 'gas') pulse = 1 + 0.04 * Math.sin(t * 4);
          else if (variant === 'volcanic') pulse = 1 + 0.05 * Math.sin(t * 6) * Math.sin(t * 2.3);
          else                        pulse = 1 + 0.05 * Math.sin(t * 7);
        } else if (state === 'error') {
          pulse = 1 + 0.04 * Math.sin(t * 15);
        } else {
          // idle — each type breathes at its own pace
          if (variant === 'gas')      pulse = 1 + 0.008 * Math.sin(t * 1.2);  // barely moves
          else if (variant === 'icy') pulse = 1 + 0.030 * Math.sin(t * 5.5);  // quick flicker
          else if (variant === 'volcanic') pulse = 1 + 0.022 * Math.abs(Math.sin(t * 2.8)); // never fully still
          else                        pulse = 1 + 0.015 * Math.sin(t * 2.2);  // steady rocky
        }
        if (!isPaused) p.scale.set(pulse * (isBoosted ? 1.22 : 1));
        if (isPaused)  p.scale.set(1);  // frozen

        // Thinking ring — rotation speed encodes load (throughput proxy)
        const ring = p.__thinkingRing;
        if (ring) {
          ring.visible = state === 'thinking';
          if (state === 'thinking') {
            const load = metricsRef.current[agentId]?.load ?? 0.3;
            ring.rotation += 0.015 + load * 0.06;
            ring.alpha = 0.55 + 0.35 * Math.sin(t * 5);
          }
        }

        // Error glow
        const eg = p.__errorGlow;
        if (eg) {
          eg.visible = state === 'error';
          if (state === 'error') {
            eg.alpha = 0.25 + 0.2 * Math.sin(t * 12);
          }
        }
      }

      // Manage + animate moons (subagents) — add/remove only when counts change
      const moonsContainer = moonsContainerRef.current;
      if (moonsContainer) {
        type MoonExt = Container & { __planetId?: string; __orbitSpeed?: number; __orbitDistance?: number; __orbitAngle?: number; __taskId?: string; __moonIndex?: number };
        const posMap = planetPositionsRef.current;
        const subCounts = activeSubagentsRef.current;
        const prevCounts = moonCountsRef.current;

        // Incrementally add/remove moons — never destroy existing ones
        for (const [agentId] of posMap) {
          const want = Math.min(subCounts[agentId] ?? 0, 6);
          const have = prevCounts.get(agentId) ?? 0;
          if (want === have) continue;

          if (want > have) {
            // Add only the new moons
            const parentPos = posMap.get(agentId);
            if (parentPos) {
              for (let mi = have; mi < want; mi++) {
                const orbitDistance = 28 + mi * 12;
                const orbitSpeed = 0.012 + mi * 0.004;
                const moon = createMoon({
                  taskId: `${agentId}-sub-${mi}`,
                  planetId: agentId,
                  orbitSpeed,
                  orbitDistance,
                });
                // Start at a random angle so new moons don't cluster
                const initAngle = Math.random() * Math.PI * 2;
                (moon as MoonExt).__orbitAngle = initAngle;
                moon.x = parentPos.x + Math.cos(initAngle) * orbitDistance;
                moon.y = parentPos.y + Math.sin(initAngle) * orbitDistance;
                (moon as MoonExt).__moonIndex = mi;
                moonsContainer.addChild(moon);
              }
            }
          } else {
            // Remove excess moons (highest index first)
            const agentMoons = moonsContainer.children
              .filter((c) => (c as MoonExt).__planetId === agentId) as MoonExt[];
            // Sort by moon index descending so we remove the newest first
            agentMoons.sort((a, b) => (b.__moonIndex ?? 0) - (a.__moonIndex ?? 0));
            const toRemove = have - want;
            for (let ri = 0; ri < toRemove && ri < agentMoons.length; ri++) {
              moonsContainer.removeChild(agentMoons[ri]);
              agentMoons[ri].destroy({ children: true });
            }
          }
          prevCounts.set(agentId, want);
        }
        // Remove moons for agents that no longer exist
        for (const [agentId] of prevCounts) {
          if (!posMap.has(agentId)) {
            for (let ci = moonsContainer.children.length - 1; ci >= 0; ci--) {
              const child = moonsContainer.children[ci] as MoonExt;
              if (child.__planetId === agentId) {
                moonsContainer.removeChild(child);
                child.destroy({ children: true });
              }
            }
            prevCounts.delete(agentId);
          }
        }

        // Animate orbits
        for (const moon of moonsContainer.children) {
          const em = moon as MoonExt;
          const parentPos = em.__planetId ? posMap.get(em.__planetId) : null;
          if (!parentPos) continue;
          const angle = (em.__orbitAngle ?? 0) + (em.__orbitSpeed ?? 0.01);
          em.__orbitAngle = angle;
          const dist = em.__orbitDistance ?? 28;
          moon.x = parentPos.x + Math.cos(angle) * dist;
          moon.y = parentPos.y + Math.sin(angle) * dist;
        }
      }

      // Animate ships along bezier arcs
      const activeShips = activeShipsRef.current;
      for (let i = activeShips.length - 1; i >= 0; i--) {
        const s = activeShips[i];
        s.progress += SHIP_PROGRESS_SPEED;

        if (s.progress >= 1) {
          s.c.destroy({ children: true });
          try { s.trailG.destroy(); } catch { /* ignore */ }
          try { s.routeG.destroy(); } catch { /* ignore */ }
          activeShips.splice(i, 1);
          spawnedShipIdsRef.current.delete(s.id);
          continue;
        }

        const pos = bezierPoint(s.progress, s.fromX, s.fromY, s.cx, s.cy, s.toX, s.toY);
        s.c.x = pos.x;
        s.c.y = pos.y;

        const ahead = bezierPoint(
          Math.min(1, s.progress + 0.02),
          s.fromX, s.fromY, s.cx, s.cy, s.toX, s.toY,
        );
        s.c.rotation = Math.atan2(ahead.y - pos.y, ahead.x - pos.x);

        s.trailPoints.push({ x: pos.x, y: pos.y });
        if (s.trailPoints.length > MAX_TRAIL_POINTS) s.trailPoints.shift();

        s.trailG.clear();
        const pts = s.trailPoints;
        if (pts.length >= 2) {
          for (let j = 1; j < pts.length; j++) {
            const alpha = (j / pts.length) * 0.5;
            const strokeWidth = 0.8 + (j / pts.length) * 0.6;
            s.trailG
              .moveTo(pts[j - 1].x, pts[j - 1].y)
              .lineTo(pts[j].x, pts[j].y)
              .stroke({ width: strokeWidth, color: s.trailColor, alpha });
          }
        }
      }

      // Astronaut physics
      const astros = astronautsRef.current;
      const planets = planetsContainer.children as ExtendedPlanet[];
      for (let i = astros.length - 1; i >= 0; i--) {
        const a = astros[i];

        const dx = singPos.x - a.c.x;
        const dy = singPos.y - a.c.y;
        const r2 = dx * dx + dy * dy + 1;
        const r = Math.sqrt(r2);

        // Once inside the suck radius, the astronaut is DOOMED — no escape
        if (!a.doomed && r < ASTRONAUT_SUCK_RADIUS) a.doomed = true;

        if (r < ASTRONAUT_DESTROY_RADIUS) {
          a.c.destroy({ children: true });
          astros.splice(i, 1);
          if (a.doomed) onAstronautConsumedRef.current?.();
          continue;
        }

        if (a.doomed) {
          // Strong inward acceleration — no speed cap, no wall bounce
          const inward = 0.10 + (ASTRONAUT_SUCK_RADIUS - r) * 0.004;
          a.vx += (dx / r) * inward;
          a.vy += (dy / r) * inward;
          const shrink = Math.max(0.05, (r - ASTRONAUT_DESTROY_RADIUS) / (ASTRONAUT_SUCK_RADIUS - ASTRONAUT_DESTROY_RADIUS));
          a.c.scale.set(shrink);
          a.c.alpha = shrink;
          a.c.x += a.vx;
          a.c.y += a.vy;
          continue;
        }

        // Normal physics
        let ax = (dx / r) * (SINGULARITY_PULL / r2) * 60 * 0.016;
        let ay = (dy / r) * (SINGULARITY_PULL / r2) * 60 * 0.016;

        let removed = false;
        for (const p of planets) {
          const px = p.x - a.c.x;
          const py = p.y - a.c.y;
          const pr2 = px * px + py * py + 1;
          const pr = Math.sqrt(pr2);
          ax += (px / pr) * (GRAVITY_STRENGTH / pr2) * 60 * 0.016;
          ay += (py / pr) * (GRAVITY_STRENGTH / pr2) * 60 * 0.016;
          if (pr < (p.__radius ?? 15) + 8) {
            a.c.destroy({ children: true });
            astros.splice(i, 1);
            removed = true;
            break;
          }
        }
        if (removed) continue;

        a.c.scale.set(1);
        a.c.alpha = 1;
        a.vx += ax;
        a.vy += ay;
        const speed = Math.sqrt(a.vx * a.vx + a.vy * a.vy);
        if (speed > ASTRONAUT_MAX_SPEED) {
          a.vx = (a.vx / speed) * ASTRONAUT_MAX_SPEED;
          a.vy = (a.vy / speed) * ASTRONAUT_MAX_SPEED;
        }
        a.c.x += a.vx;
        a.c.y += a.vy;

        // Jet spray: fire on a pure timer (5-10 min after spawn or last jet)
        const now = Date.now();
        if (!a.nextJetTime) {
          a.nextJetTime = now + ASTRONAUT_JET_MIN_MS + Math.random() * (ASTRONAUT_JET_MAX_MS - ASTRONAUT_JET_MIN_MS);
        }
        if (now >= a.nextJetTime) {
          // Random thrust direction — strong enough to be clearly visible
          const jetAngle = Math.random() * Math.PI * 2;
          const jetPower = 2.5 + Math.random() * 1.5;
          a.vx += Math.cos(jetAngle) * jetPower;
          a.vy += Math.sin(jetAngle) * jetPower;
          a.nextJetTime = now + ASTRONAUT_JET_MIN_MS + Math.random() * (ASTRONAUT_JET_MAX_MS - ASTRONAUT_JET_MIN_MS);

          // Spawn visible spray/exhaust in the OPPOSITE direction of thrust
          const sprayAngle = jetAngle + Math.PI;
          const astroContainer = astronautsContainerRef.current;
          if (astroContainer) {
            const particleCount = 10 + Math.floor(Math.random() * 6);
            for (let pi = 0; pi < particleCount; pi++) {
              const pAngle = sprayAngle + (Math.random() - 0.5) * 1.0; // ±~29° cone
              const pSpeed = 2 + Math.random() * 3;
              const pg = new Graphics();
              const pSize = 1.5 + Math.random() * 2.5;
              // Mix of orange, yellow, and white-hot particles
              const pColors = [0xff6622, 0xff8822, 0xffaa33, 0xffcc44, 0xffeeaa];
              const pColor = pColors[Math.floor(Math.random() * pColors.length)];
              pg.circle(0, 0, pSize).fill({ color: pColor, alpha: 0.8 + Math.random() * 0.2 });
              pg.x = a.c.x;
              pg.y = a.c.y;
              astroContainer.addChild(pg);
              jetSprayRef.current.push({
                g: pg,
                x: a.c.x,
                y: a.c.y,
                vx: Math.cos(pAngle) * pSpeed,
                vy: Math.sin(pAngle) * pSpeed,
                life: 0,
                maxLife: 0.6 + Math.random() * 0.8,
              });
            }
          }
        }

        const sz = sizeRef.current;
        const scale = scaleRef.current;
        const pan = posRef.current;
        const left   = -(sz.width  / 2 + pan.x) / scale;
        const right  =  (sz.width  / 2 - pan.x) / scale;
        const top    = -(sz.height / 2 + pan.y) / scale;
        const bottom =  (sz.height / 2 - pan.y) / scale;
        const margin = 8;
        if (a.c.x < left   + margin) { a.c.x = left   + margin; a.vx =  Math.abs(a.vx) * 0.6; }
        else if (a.c.x > right  - margin) { a.c.x = right  - margin; a.vx = -Math.abs(a.vx) * 0.6; }
        if (a.c.y < top    + margin) { a.c.y = top    + margin; a.vy =  Math.abs(a.vy) * 0.6; }
        else if (a.c.y > bottom - margin) { a.c.y = bottom - margin; a.vy = -Math.abs(a.vy) * 0.6; }
      }

      // Jet spray particles
      const jets = jetSprayRef.current;
      for (let ji = jets.length - 1; ji >= 0; ji--) {
        const jp = jets[ji];
        jp.life += 0.016;
        jp.x += jp.vx;
        jp.y += jp.vy;
        jp.vx *= 0.96; // decelerate
        jp.vy *= 0.96;
        jp.g.x = jp.x;
        jp.g.y = jp.y;
        const frac = jp.life / jp.maxLife;
        jp.g.alpha = (1 - frac) * 0.8;
        jp.g.scale.set(1 - frac * 0.5);
        if (jp.life >= jp.maxLife) {
          jp.g.destroy();
          jets.splice(ji, 1);
        }
      }

      // Shooting stars
      const sstars = shootingStarsRef.current;
      for (let si = sstars.length - 1; si >= 0; si--) {
        const ss = sstars[si];
        ss.life += 0.016;
        if (ss.life < 0) { ss.g.alpha = 0; continue; } // staggered start
        ss.x += ss.vx;
        ss.y += ss.vy;
        ss.g.x = ss.x;
        ss.g.y = ss.y;
        const frac = ss.life / ss.maxLife;
        const alpha = frac < 0.15 ? frac / 0.15 : 1 - (frac - 0.15) / 0.85;
        ss.g.alpha = alpha * 0.7;
        if (ss.life >= ss.maxLife) {
          ss.g.destroy();
          sstars.splice(si, 1);
        }
      }

      // UFO behaviour
      const ufoState = ufoStateRef.current;
      if (ufoState.phase === 'fly') {
        ufoState.t += 0.016;
        ufo.rotation = 0; // always upright during abduction
        const tv = Math.min(1, ufoState.t * 0.5);
        const ease = tv * tv * (3 - 2 * tv);
        const sx = ufoState.startX ?? -250;
        const sy = ufoState.startY ?? -200;
        ufo.x = sx + (ufoState.targetX - sx) * ease;
        ufo.y = sy + (ufoState.targetY - sy) * ease;
        if (tv >= 1) {
          ufoState.phase = 'beam';
          ufoState.t = 0;
          if (ufoState.beam) ufoState.beam.visible = true;
          if (ufoState.cow) {
            ufoState.cow.visible = true;
            ufoState.cow.y = ufoState.beamLen ?? 70; // start at planet surface
          }
        }
      } else if (ufoState.phase === 'beam') {
        ufoState.t += 0.016;
        ufo.rotation = 0; // always upright during beam
        const beamLen = ufoState.beamLen ?? 70;
        // Cow travels from planet surface (beamLen) up into the saucer body (y=-2)
        const beamT = Math.min(1, ufoState.t / 2.0);
        const cow = ufoState.cow;
        if (cow) cow.y = beamLen - beamT * (beamLen + 2);
        if (ufoState.t > 2.4) {
          if (ufoState.beam) ufoState.beam.visible = false;
          if (cow) { cow.visible = false; cow.y = beamLen; }
          onUfoAbductionRef.current?.();
          const angle = Math.random() * Math.PI * 2;
          const dist = 280 + Math.random() * 120;
          ufoState.phase = 'flyaway';
          ufoState.t = 0;
          ufoState.startX = ufo.x;
          ufoState.startY = ufo.y;
          ufoState.targetX = ufo.x + Math.cos(angle) * dist;
          ufoState.targetY = ufo.y + Math.sin(angle) * dist;
        }
      } else if (ufoState.phase === 'flyaway') {
        ufoState.t += 0.016;
        const tv = Math.min(1, ufoState.t * 0.6);
        const ease = tv * tv * (3 - 2 * tv);
        const sx = ufoState.startX ?? ufo.x;
        const sy = ufoState.startY ?? ufo.y;
        ufo.x = sx + (ufoState.targetX - sx) * ease;
        ufo.y = sy + (ufoState.targetY - sy) * ease;
        if (tv >= 1) {
          ufo.visible = false;
          ufoState.phase = 'idle';
        }
      } else if (ufoState.phase === 'flyby') {
        // Curved path through waypoints — smooth interpolation between each segment
        const wps = ufoState.waypoints;
        let idx = ufoState.waypointIndex ?? 0;
        let segT = (ufoState.segT ?? 0) + 0.012; // speed per segment
        if (!wps || wps.length < 2) { ufo.visible = false; ufoState.phase = 'idle'; }
        else {
          if (segT >= 1) {
            segT = 0;
            idx++;
            ufoState.waypointIndex = idx;
          }
          if (idx >= wps.length - 1) {
            ufo.visible = false;
            ufoState.phase = 'idle';
          } else {
            ufoState.segT = segT;
            const from = wps[idx];
            const to = wps[idx + 1];
            // Smooth ease per segment
            const ease = segT * segT * (3 - 2 * segT);
            ufo.x = from.x + (to.x - from.x) * ease;
            ufo.y = from.y + (to.y - from.y) * ease;
            // Tilt UFO slightly in movement direction
            ufo.rotation = Math.atan2(to.y - from.y, to.x - from.x) * 0.15;
          }
        }
      }
    };

    app.ticker.add(tick);
    return () => {
      app.ticker.remove(tick);
      if (ufoTimerRef.current) {
        clearTimeout(ufoTimerRef.current);
        ufoTimerRef.current = null;
      }
      if (shootingStarTimerRef.current) {
        clearTimeout(shootingStarTimerRef.current);
        shootingStarTimerRef.current = null;
      }
      for (const ss of shootingStarsRef.current) {
        try { ss.g.destroy(); } catch { /* ignore */ }
      }
      shootingStarsRef.current = [];
      for (const jp of jetSprayRef.current) {
        try { jp.g.destroy(); } catch { /* ignore */ }
      }
      jetSprayRef.current = [];
    };
  }, [canvasReady]);

  // --- render --------------------------------------------------------------
  if (initError) {
    return (
      <div style={{ padding: 12, color: '#e88', fontFamily: 'system-ui', fontSize: 14 }}>
        Universe failed to start: {initError}
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minWidth: 320,
        minHeight: 200,
        background: 'transparent',
        zIndex: 1,
      }}
    >
      {!canvasReady && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#7a8a9a',
            fontSize: 14,
            fontFamily: 'system-ui',
          }}
        >
          Initializing universe…
        </div>
      )}
      <div
        ref={containerRef}
        data-universe
        aria-label="Event Horizon universe"
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
};
