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
import { createShip, createSkillProbe } from './entities/Ship.js';
import { createMoon } from './entities/Moon.js';
import { createSkillOrbit, updateSkillOrbit } from './entities/SkillOrbit.js';
import type { ExtendedSkillOrbit } from './entities/SkillOrbit.js';
import {
  bezierPoint,
  computeControlPoint,
  computePlanetPositions,
  computeBeltContour,
  PLANET_MIN_RADIUS,
  MIN_PIXEL_DIST,
} from './math.js';
import type { AgentView, WorkspaceGroup } from './math.js';
export type { AgentView, WorkspaceGroup } from './math.js';

export interface MetricsView {
  load: number;
}

export interface ShipSpawn {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  payloadSize?: number;
  fromAgentType?: string;
  /** When true, renders as a skill fork probe (cyan diamond) instead of a data ship. */
  isSkillProbe?: boolean;
}

export interface SparkSpawn {
  id: string;
  agentIds: [string, string];
  filePath: string;
}

export interface UniverseProps {
  width?: number;
  height?: number;
  agents?: AgentView[];
  metrics?: Record<string, MetricsView>;
  /** Per-agent-type visual overrides (colors, sizes) from settings. */
  visualSettings?: Record<string, { color: string; sizeMult: number }>;
  /** Animation speed multiplier (0.25 – 3.0). 1.0 = normal. */
  animationSpeed?: number;
  ships?: ShipSpawn[];
  sparks?: SparkSpawn[];
  agentStates?: Record<string, string>;
  pausedAgentIds?: Record<string, boolean>;
  isolatedAgentId?: string | null;
  boostedAgentIds?: Record<string, boolean>;
  selectedAgentId?: string | null;
  centerRequestedAt?: number;
  /** Timestamp trigger — clears custom planet positions and reverts to auto-layout. */
  resetLayoutRequestedAt?: number;
  /** Number of active subagents per agent — rendered as orbiting moons. */
  activeSubagents?: Record<string, number>;
  /** Number of installed skills per agent. */
  agentSkillCounts?: Record<string, number>;
  /** Currently active skill per agent: { agentId: { name, index } }. */
  activeSkills?: Record<string, { name: string; index: number }>;
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
  /** Called when the user clicks on the black hole. */
  onSingularityClick?: () => void;
  /** Called when a UFO gets consumed by the singularity. */
  onUfoConsumed?: () => void;
  /** Called when an astronaut enters the gravity well (suck radius). */
  onAstronautTrapped?: () => void;
  /** Called when an astronaut escapes the gravity well via jet propulsion. */
  onAstronautEscaped?: () => void;
  /** Called when an astronaut grazes the black hole (near-miss without entering gravity well). */
  onAstronautGrazed?: () => void;
  /** Called when an astronaut lands on a planet. */
  onAstronautLanded?: (agentId: string) => void;
  /** Called when an astronaut bounces off an edge. */
  onAstronautBounced?: (astronautId: number, bounceCount: number, edgesHit: Set<string>) => void;
  /** Called when an astronaut fires its jetpack. */
  onRocketMan?: () => void;
  /** Called when an astronaut bounces off an edge then falls into the black hole. */
  onTrickShot?: () => void;
  /** Called when an astronaut jets straight into the black hole without bouncing. */
  onKamikaze?: () => void;
  /** Called when the UFO beam is interrupted and the cow falls back. */
  onCowDrop?: () => void;
  /** Called when the user clicks on a shooting star. */
  onShootingStarClicked?: () => void;
}

// --- constants -----------------------------------------------------------

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2;
const INITIAL_W = 640;
const INITIAL_H = 400;
const GRAVITY_STRENGTH = 0.8;
const SINGULARITY_PULL = 1.2;
const ASTRONAUT_MAX_SPEED = 3;
const ASTRONAUT_SUCK_RADIUS = 92;   // outer glow of singularity — suck-in starts here
const ASTRONAUT_GRAZE_RADIUS = 120; // near-miss zone just outside the gravity well
const ASTRONAUT_DESTROY_RADIUS = 30;
const SHIP_PROGRESS_SPEED = 0.008;
// SHIP_AVOID_RADIUS imported from math.ts
const MAX_TRAIL_POINTS = 32;
const UFO_INTERVAL_MIN_MS = 25000;
const UFO_INTERVAL_MAX_MS = 55000;
const UFO_FLYBY_CHANCE = 0.4; // 40% of UFOs just fly by without abducting
const SHOOTING_STAR_INTERVAL_MIN = 30000;  // ms between shooting stars
const SHOOTING_STAR_INTERVAL_MAX = 90000;
const SHOOTING_STAR_MAX_BURST = 3; // up to 3 shooting stars per event
const ASTRONAUT_JET_MIN_MS = 45_000;      // 45 seconds minimum before jet fires
const ASTRONAUT_JET_MAX_MS = 120_000;     // 2 minutes max

// PLANET_MIN_RADIUS imported from math.ts

/** Trail color keyed by agentType. */
const TRAIL_COLORS: Record<string, number> = {
  'claude-code': 0x88aaff,
  'copilot':     0xcc88ff,
  'opencode':    0x88ffaa,
};
const TRAIL_COLOR_DEFAULT = 0xffcc44;

// --- helpers -------------------------------------------------------------
// hashId, normCwd, groupByWorkspace imported from math.ts

// Session-random seed — varies each time the renderer mounts but stays stable within a session.
const SESSION_SEED = Math.random();

// WorkspaceGroup re-exported from math.ts via Universe exports

// computePlanetPositions, computeBeltContour imported from math.ts

// ── Workspace asteroid belt ─────────────────────────────────────────────────

/** Number of small rocks to scatter along the belt. */
const BELT_ROCK_COUNT = 100;

/** Bright rock/dust palette — visible against the dark background. */
const ROCK_COLORS = [0x99887a, 0xb8a888, 0x8899aa, 0xc0b090, 0xa8a8b8];
/** Highlight colors for rare bright/glowing rocks. */
const ROCK_GLOW_COLORS = [0xddccaa, 0xccddee, 0xeeddbb];

/**
 * Draw an asteroid belt around a workspace group using the member positions.
 * Creates an irregular contour and scatters bright rocks along it.
 */
type BeltContainer = Container & { __groupAgentIds?: string[] };

function drawAsteroidBelt(memberPositions: Array<{ x: number; y: number }>, groupAgentIds?: string[]): BeltContainer {
  const container = new Container() as BeltContainer;
  if (groupAgentIds) {
    container.__groupAgentIds = groupAgentIds;
    container.eventMode = 'static';
    container.cursor = 'grab';
  }
  const g = new Graphics();
  const contour = computeBeltContour(memberPositions);
  const n = contour.length;

  // Draw a dashed contour outline
  for (let i = 0; i < n; i++) {
    if (i % 2 === 1) continue; // skip every other segment for dashes
    const p0 = contour[i];
    const p1 = contour[(i + 1) % n];
    g.moveTo(p0.x, p0.y);
    g.lineTo(p1.x, p1.y);
  }
  g.stroke({ width: 0.8, color: 0x6a7a8a, alpha: 0.3 });

  // Scatter rocks along the contour
  for (let i = 0; i < BELT_ROCK_COUNT; i++) {
    // Interpolate position along the contour
    const t = i / BELT_ROCK_COUNT;
    const idx = t * n;
    const i0 = Math.floor(idx) % n;
    const i1 = (i0 + 1) % n;
    const frac = idx - Math.floor(idx);
    const baseX = contour[i0].x + (contour[i1].x - contour[i0].x) * frac;
    const baseY = contour[i0].y + (contour[i1].y - contour[i0].y) * frac;

    // Radial jitter (perpendicular to contour)
    const jitter = (Math.random() - 0.5) * 22;
    // Tangent direction for perpendicular offset
    const tx = contour[i1].x - contour[i0].x;
    const ty = contour[i1].y - contour[i0].y;
    const tLen = Math.sqrt(tx * tx + ty * ty) || 1;
    // Perpendicular
    const px = -ty / tLen;
    const py = tx / tLen;

    const rx = baseX + px * jitter;
    const ry = baseY + py * jitter;

    // Most rocks are medium brightness; ~15% are bright glowing highlights
    const isGlow = Math.random() < 0.15;
    const rockSize = isGlow ? (1.2 + Math.random() * 2) : (0.8 + Math.random() * 1.6);
    const color = isGlow
      ? ROCK_GLOW_COLORS[Math.floor(Math.random() * ROCK_GLOW_COLORS.length)]
      : ROCK_COLORS[i % ROCK_COLORS.length];
    const alpha = isGlow ? (0.7 + Math.random() * 0.3) : (0.45 + Math.random() * 0.35);

    g.circle(rx, ry, rockSize);
    g.fill({ color, alpha });

    // Glow rocks get a soft halo
    if (isGlow) {
      g.circle(rx, ry, rockSize * 2.5);
      g.fill({ color, alpha: 0.08 });
    }
  }

  container.addChild(g);

  // Invisible wide hit area along the contour for drag interaction
  if (groupAgentIds) {
    const hitG = new Graphics();
    for (let i = 0; i < n; i++) {
      const p0 = contour[i];
      const p1 = contour[(i + 1) % n];
      hitG.moveTo(p0.x, p0.y);
      hitG.lineTo(p1.x, p1.y);
    }
    hitG.stroke({ width: 30, color: 0x000000, alpha: 0.001 });
    container.addChild(hitG);
  }

  return container;
}

// bezierPoint, computeControlPoint imported from math.ts

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
  visualSettings,
  animationSpeed = 1.0,
  ships = [],
  sparks = [],
  agentStates = {},
  pausedAgentIds = {},
  isolatedAgentId = null,
  boostedAgentIds = {},
  selectedAgentId = null,
  centerRequestedAt = 0,
  resetLayoutRequestedAt = 0,
  activeSubagents = {},
  agentSkillCounts = {},
  activeSkills = {},
  onPlanetHover,
  onPlanetClick,
  onReady,
  onAstronautConsumed,
  onAstronautSpawned,
  onUfoAbduction,
  onUfoClicked,
  onSingularityClick,
  onUfoConsumed,
  onAstronautTrapped,
  onAstronautEscaped,
  onAstronautGrazed,
  onAstronautLanded,
  onAstronautBounced,
  onRocketMan,
  onTrickShot,
  onKamikaze,
  onCowDrop,
  onShootingStarClicked,
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
  const astronautsRef = useRef<Array<{
    id: number; c: Container; vx: number; vy: number;
    /** Mass: 0.5 (light/fast) to 2.0 (heavy/slow). Affects drift and gravity response. */
    mass: number;
    inGravityWell?: boolean; inGrazeZone?: boolean; escapeCount?: number; nextJetTime?: number;
    bounceCount: number; edgesHit: Set<string>;
    jetFiredAt: number; hasBouncedSinceJet: boolean;
  }>>([]);
  const activeShipsRef = useRef<ActiveShip[]>([]);
  const spawnedShipIdsRef = useRef<Set<string>>(new Set());
  /** Active lightning arcs — one Graphics per collision, redrawn each frame. */
  const lightningArcsRef = useRef<Map<string, Graphics>>(new Map());
  const planetPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  /** User-dragged positions override auto-layout. Cleared on reset. */
  const customPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  /** Active while a planet is being dragged — suppresses canvas pan. */
  const planetDragRef = useRef<{ agentId: string; startX: number; startY: number; moved: boolean } | null>(null);
  /** Active while an asteroid belt (group) is being dragged. */
  const beltDragRef = useRef<{ agentIds: string[]; startX: number; startY: number } | null>(null);
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
    phase: 'idle' | 'fly' | 'beam' | 'flyaway' | 'flyby' | 'sucked' | 'cow_falling';
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
    /** Cow-drop animation fields */
    cowFallFromY?: number;
    cowFallToY?: number;
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
  const planetMapRef = useRef<Map<string, ExtendedPlanet>>(new Map());
  const visualSettingsRef = useRef(visualSettings);
  const settingsRevRef = useRef(0);
  const animationSpeedRef = useRef(animationSpeed);
  const beltsContainerRef = useRef<Container | null>(null);
  const workspaceGroupsRef = useRef<WorkspaceGroup[]>([]);
  const skillOrbitsRef = useRef<Map<string, ExtendedSkillOrbit>>(new Map());
  const agentSkillCountsRef = useRef<Record<string, number>>(agentSkillCounts);
  const activeSkillsRef = useRef<Record<string, { name: string; index: number }>>(activeSkills);
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
  const onSingularityClickRef = useRef(onSingularityClick);
  onSingularityClickRef.current = onSingularityClick;
  const onUfoConsumedRef = useRef(onUfoConsumed);
  onUfoConsumedRef.current = onUfoConsumed;
  const onAstronautTrappedRef = useRef(onAstronautTrapped);
  onAstronautTrappedRef.current = onAstronautTrapped;
  const onAstronautEscapedRef = useRef(onAstronautEscaped);
  onAstronautEscapedRef.current = onAstronautEscaped;
  const onAstronautGrazedRef = useRef(onAstronautGrazed);
  onAstronautGrazedRef.current = onAstronautGrazed;
  const onAstronautLandedRef = useRef(onAstronautLanded);
  onAstronautLandedRef.current = onAstronautLanded;
  const onAstronautBouncedRef = useRef(onAstronautBounced);
  onAstronautBouncedRef.current = onAstronautBounced;
  const onRocketManRef = useRef(onRocketMan);
  onRocketManRef.current = onRocketMan;
  const onTrickShotRef = useRef(onTrickShot);
  onTrickShotRef.current = onTrickShot;
  const onKamikazeRef = useRef(onKamikaze);
  onKamikazeRef.current = onKamikaze;
  const onCowDropRef = useRef(onCowDrop);
  onCowDropRef.current = onCowDrop;
  const onShootingStarClickedRef = useRef(onShootingStarClicked);
  onShootingStarClickedRef.current = onShootingStarClicked;
  const onPlanetHoverRef = useRef(onPlanetHover);
  onPlanetHoverRef.current = onPlanetHover;
  const onPlanetClickRef = useRef(onPlanetClick);
  onPlanetClickRef.current = onPlanetClick;

  const mountedRef = useRef(true);

  const selectedAgentIdRef = useRef<string | null>(selectedAgentId);

  // Keep control refs in sync without triggering rerenders
  useEffect(() => { agentStatesRef.current = agentStates; }, [agentStates]);
  useEffect(() => { metricsRef.current = metrics; }, [metrics]);
  useEffect(() => { pausedRef.current = pausedAgentIds; }, [pausedAgentIds]);
  useEffect(() => { isolatedRef.current = isolatedAgentId; }, [isolatedAgentId]);
  useEffect(() => { boostedRef.current = boostedAgentIds; }, [boostedAgentIds]);
  useEffect(() => { activeSubagentsRef.current = activeSubagents; }, [activeSubagents]);
  useEffect(() => { agentSkillCountsRef.current = agentSkillCounts; }, [agentSkillCounts]);
  useEffect(() => { activeSkillsRef.current = activeSkills; }, [activeSkills]);
  useEffect(() => {
    if (visualSettingsRef.current !== visualSettings) {
      visualSettingsRef.current = visualSettings;
      // Bump revision so the ticker recreates planets with new overrides
      settingsRevRef.current++;
    }
  }, [visualSettings]);
  useEffect(() => { animationSpeedRef.current = animationSpeed; }, [animationSpeed]);

  const sparksRef = useRef<SparkSpawn[]>(sparks);
  useEffect(() => { sparksRef.current = sparks; }, [sparks]);
  useEffect(() => { selectedAgentIdRef.current = selectedAgentId; }, [selectedAgentId]);

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
          preserveDrawingBuffer: true,
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
        singularity.eventMode = 'static';
        singularity.cursor = 'pointer';
        singularity.hitArea = { contains: (x: number, y: number) => Math.sqrt(x * x + y * y) <= 90 };
        singularity.on('pointertap', () => onSingularityClickRef.current?.());
        world.addChild(singularity);
        singularityRef.current = singularity;

        const astronautsContainer = new Container();
        world.addChild(astronautsContainer);
        astronautsContainerRef.current = astronautsContainer;

        const beltsContainer = new Container();
        world.addChild(beltsContainer);
        beltsContainerRef.current = beltsContainer;

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
        ufo.on('pointertap', () => {
          const state = ufoStateRef.current;
          if (state.phase === 'beam') {
            // Interrupt beam — cow falls back to planet
            if (state.beam) state.beam.visible = false;
            if (state.cow) {
              state.cowFallFromY = state.cow.y;
              state.cowFallToY = state.beamLen ?? 70;
            }
            state.phase = 'cow_falling';
            state.t = 0;
            onCowDropRef.current?.();
          }
          onUfoClickedRef.current?.();
        });
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
          // Mass varies 0.5–2.0: lighter astronauts drift faster, heavier drift slower
          const mass = 0.5 + Math.random() * 1.5;
          const driftSpeed = 1.2 / Math.sqrt(mass); // lighter = faster
          astronautsRef.current.push({
            id,
            c: astro,
            vx: (Math.random() - 0.5) * driftSpeed,
            vy: (Math.random() - 0.5) * driftSpeed,
            mass,
            bounceCount: 0,
            edgesHit: new Set(),
            jetFiredAt: 0,
            hasBouncedSinceJet: false,
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
      beltsContainerRef.current = null;
      workspaceGroupsRef.current = [];
      if (moonsContainerRef.current) {
        for (let i = moonsContainerRef.current.children.length - 1; i >= 0; i--) {
          try { moonsContainerRef.current.children[i].destroy({ children: true }); } catch { /* ignore */ }
        }
      }
      moonsContainerRef.current = null;
      moonCountsRef.current = new Map();
      shipsContainerRef.current = null;
      spiralContainerRef.current = null;
      astronautsContainerRef.current = null;
      for (const a of astronautsRef.current) {
        try { a.c.destroy({ children: true }); } catch { /* ignore */ }
      }
      astronautsRef.current = [];
      for (const s of spiralRef.current) { try { s.c.destroy({ children: true }); } catch { /* already destroyed */ } }
      spiralRef.current = [];
      for (const s of activeShipsRef.current) {
        try { s.c.destroy({ children: true }); } catch { /* ignore */ }
        try { s.trailG.destroy(); } catch { /* ignore */ }
        try { s.routeG.destroy(); } catch { /* ignore */ }
      }
      activeShipsRef.current = [];
      spawnedShipIdsRef.current = new Set();
      for (const g of lightningArcsRef.current.values()) { try { g.destroy(); } catch { /* ignore */ } }
      lightningArcsRef.current = new Map();
      for (const o of skillOrbitsRef.current.values()) { try { o.destroy({ children: true }); } catch { /* ignore */ } }
      skillOrbitsRef.current = new Map();
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
    const panContainer = panContainerRef.current;
    const sz = sizeRef.current;
    if (!panContainer || !sz.width || !sz.height) return;

    // Center on the selected planet's position, or singularity (0,0) if none selected
    const selectedId = selectedAgentIdRef.current;
    const targetPos = selectedId ? planetPositionsRef.current.get(selectedId) : null;
    const tx = targetPos?.x ?? 0;
    const ty = targetPos?.y ?? 0;

    posRef.current = { x: -tx * scaleRef.current, y: -ty * scaleRef.current };
    panContainer.x = sz.width / 2 + posRef.current.x;
    panContainer.y = sz.height / 2 + posRef.current.y;
  }, [centerRequestedAt]);

  // --- reset layout (clear custom positions) ---------------------------------
  useEffect(() => {
    if (resetLayoutRequestedAt <= 0) return;
    customPositionsRef.current.clear();
    const planetsContainer = planetsContainerRef.current;
    if (!planetsContainer) return;
    const { positions: posMap, workspaceGroups } = computePlanetPositions(agents, SESSION_SEED);
    workspaceGroupsRef.current = workspaceGroups;
    for (const child of planetsContainer.children) {
      const p = child as ExtendedPlanet;
      if (p.__agentId) {
        const pos = posMap.get(p.__agentId);
        if (pos) { p.x = pos.x; p.y = pos.y; }
      }
    }
    planetPositionsRef.current = posMap;
    // Redraw asteroid belts at auto-layout positions
    const beltsContainer = beltsContainerRef.current;
    if (beltsContainer) {
      while (beltsContainer.children.length > 0) {
        beltsContainer.children[0].destroy({ children: true });
      }
      for (const group of workspaceGroups) {
        if (group.agentIds.length > 1) {
          const belt = drawAsteroidBelt(group.memberPositions, group.agentIds);
          belt.on('pointerdown', (e: { stopPropagation: () => void; global: { x: number; y: number } }) => {
            e.stopPropagation();
            const scale = scaleRef.current;
            const panPos = posRef.current;
            const sz = sizeRef.current;
            const wx = (e.global.x - sz.width / 2 - panPos.x) / scale;
            const wy = (e.global.y - sz.height / 2 - panPos.y) / scale;
            beltDragRef.current = { agentIds: [...group.agentIds], startX: wx, startY: wy };
          });
          beltsContainer.addChild(belt);
        }
      }
    }
  }, [resetLayoutRequestedAt, agents]);

  // --- planets (diff-based: reuse existing, add new, spiral removed) -------
  useEffect(() => {
    const planetsContainer = planetsContainerRef.current;
    const spiralContainer = spiralContainerRef.current;
    if (!planetsContainer) return;

    const currentIds = new Set(agents.map((a) => a.id));
    const planetMap = planetMapRef.current;

    // 0. If visual settings changed, destroy all planets to recreate with new overrides
    if ((planetsContainer as unknown as { __settingsRev?: number }).__settingsRev !== settingsRevRef.current) {
      (planetsContainer as unknown as { __settingsRev?: number }).__settingsRev = settingsRevRef.current;
      for (const [id, planet] of planetMap) {
        planetsContainer.removeChild(planet);
        planet.destroy({ children: true });
        planetMap.delete(id);
      }
    }

    // 1. Spiral-out removed agents
    for (const [id, planet] of planetMap) {
      if (!currentIds.has(id)) {
        planetsContainer.removeChild(planet);
        planetMap.delete(id);
        if (spiralContainer) {
          const dx = 0 - planet.x;
          const dy = 0 - planet.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          spiralRef.current.push({
            c: planet as Container,
            vx: (dx / dist) * 0.8,
            vy: (dy / dist) * 0.8,
          });
          spiralContainer.addChild(planet as Container);
        } else {
          planet.destroy({ children: true });
        }
      }
    }

    // 2. Compute positions + workspace groups
    const { positions: posMap, workspaceGroups } = computePlanetPositions(agents, SESSION_SEED);
    // Apply user-dragged custom positions (overrides auto-layout).
    // For workspace groups: if some members were dragged, shift new (non-dragged)
    // members by the same delta so they appear near the dragged ones.
    for (const group of workspaceGroups) {
      const customMembers: Array<{ id: string; autoPos: { x: number; y: number }; customPos: { x: number; y: number } }> = [];
      for (const id of group.agentIds) {
        const cp = customPositionsRef.current.get(id);
        const ap = posMap.get(id);
        if (cp && ap) customMembers.push({ id, autoPos: ap, customPos: cp });
      }
      if (customMembers.length > 0) {
        // Compute average delta from auto to custom positions
        let dx = 0, dy = 0;
        for (const m of customMembers) {
          dx += m.customPos.x - m.autoPos.x;
          dy += m.customPos.y - m.autoPos.y;
        }
        dx /= customMembers.length;
        dy /= customMembers.length;
        // Apply custom positions to dragged members, shift non-dragged by group delta
        for (const id of group.agentIds) {
          const cp = customPositionsRef.current.get(id);
          if (cp) {
            posMap.set(id, cp);
          } else {
            const ap = posMap.get(id);
            if (ap) posMap.set(id, { x: ap.x + dx, y: ap.y + dy });
          }
        }
      }
    }
    // Also apply custom positions for solo (non-grouped) agents
    for (const [agentId, customPos] of customPositionsRef.current) {
      if (posMap.has(agentId)) {
        posMap.set(agentId, customPos);
      }
    }
    // Update workspace group memberPositions to reflect final positions
    for (const group of workspaceGroups) {
      group.memberPositions = group.agentIds.map((id) => posMap.get(id) ?? { x: 0, y: 0 });
    }
    workspaceGroupsRef.current = workspaceGroups;

    // 2b. Draw workspace asteroid belts
    const beltsContainer = beltsContainerRef.current;
    if (beltsContainer) {
      while (beltsContainer.children.length > 0) {
        beltsContainer.children[0].destroy({ children: true });
      }
      for (const group of workspaceGroups) {
        if (group.agentIds.length > 1) {
          const belt = drawAsteroidBelt(group.memberPositions, group.agentIds);
          belt.on('pointerdown', (e: { stopPropagation: () => void; global: { x: number; y: number } }) => {
            e.stopPropagation();
            const scale = scaleRef.current;
            const panPos = posRef.current;
            const sz = sizeRef.current;
            const worldX = (e.global.x - sz.width / 2 - panPos.x) / scale;
            const worldY = (e.global.y - sz.height / 2 - panPos.y) / scale;
            beltDragRef.current = { agentIds: [...group.agentIds], startX: worldX, startY: worldY };
          });
          beltsContainer.addChild(belt);
        }
      }
    }

    // 3. Add new planets, update existing
    agents.forEach((agent) => {
      const pos = posMap.get(agent.id) ?? { x: 0, y: PLANET_MIN_RADIUS };
      const m = metricsRef.current[agent.id];
      const load = m?.load ?? 0.5;
      const size = 12 + load * 8;

      let planet = planetMap.get(agent.id);
      if (!planet) {
        // New planet — apply visual settings overrides if available
        const vs = visualSettingsRef.current?.[agent.agentType ?? 'unknown'];
        planet = createPlanet({
          agentId: agent.id,
          x: pos.x,
          y: pos.y,
          size,
          brightness: 0.3 + load * 0.7,
          agentType: agent.agentType,
          ringColorOverride: vs ? parseInt(vs.color.slice(1), 16) : undefined,
          sizeMultOverride: vs?.sizeMult,
        });

        // Name label beneath planet (+ folder name on second line)
        let cwdNorm = agent.cwd ? agent.cwd.replace(/\\/g, '/') : '';
        while (cwdNorm.endsWith('/')) cwdNorm = cwdNorm.slice(0, -1);
        const cwdFolder = cwdNorm ? cwdNorm.split('/').pop() || '' : '';
        const labelText = cwdFolder ? `${agent.name}\n${cwdFolder}` : agent.name;
        const label = new Text({
          text: labelText,
          style: { fontSize: 11, fill: '#6688aa', fontFamily: 'system-ui', align: 'center', lineHeight: 14 },
        });
        label.anchor.set(0.5, 0);
        label.x = 0;
        label.y = (planet.__radius ?? 16) + 5;
        planet.addChild(label);

        planet.on('pointerover', () => onPlanetHoverRef.current?.(agent.id));
        planet.on('pointerout', () => onPlanetHoverRef.current?.(null));
        planet.on('pointertap', () => {
          // Only fire click if we didn't just finish dragging
          if (!planetDragRef.current?.moved) onPlanetClickRef.current?.(agent.id);
        });

        // Drag-to-rearrange handlers
        const thisPlanet = planet;
        thisPlanet.on('pointerdown', (e: { stopPropagation: () => void; global: { x: number; y: number } }) => {
          e.stopPropagation();
          const scale = scaleRef.current;
          const panPos = posRef.current;
          const sz = sizeRef.current;
          const worldX = (e.global.x - sz.width / 2 - panPos.x) / scale;
          const worldY = (e.global.y - sz.height / 2 - panPos.y) / scale;
          planetDragRef.current = { agentId: agent.id, startX: worldX - thisPlanet.x, startY: worldY - thisPlanet.y, moved: false };
        });

        planetsContainer.addChild(planet);
        planetMap.set(agent.id, planet);
      } else {
        // Update existing planet position — respect custom drag positions
        const customPos = customPositionsRef.current.get(agent.id);
        if (customPos) {
          planet.x = customPos.x;
          planet.y = customPos.y;
        } else {
          planet.x = pos.x;
          planet.y = pos.y;
        }
      }

      // Update alpha for selection
      if (selectedAgentId && selectedAgentId !== agent.id) {
        planet.alpha = 0.4;
      } else {
        planet.alpha = 1;
      }
    });

    // Manage skill orbit rings — add/remove/update based on skill counts
    const skillCounts = agentSkillCountsRef.current;
    const orbitsMap = skillOrbitsRef.current;
    const currentAgentIds = new Set(agents.map((a) => a.id));

    // Remove orbits for agents that no longer exist
    for (const [agentId, orbit] of orbitsMap) {
      if (!currentAgentIds.has(agentId)) {
        orbit.destroy({ children: true });
        orbitsMap.delete(agentId);
      }
    }

    // Add or update orbits
    for (const agent of agents) {
      const count = skillCounts[agent.id] ?? 0;
      const planet = planetMap.get(agent.id);
      if (!planet || count === 0) {
        // Remove orbit if no skills
        const existing = orbitsMap.get(agent.id);
        if (existing) {
          existing.destroy({ children: true });
          orbitsMap.delete(agent.id);
        }
        continue;
      }

      const existing = orbitsMap.get(agent.id);
      if (existing && existing.__skillCount === count) continue; // no change

      // Recreate orbit if count changed
      if (existing) {
        existing.destroy({ children: true });
      }
      const orbit = createSkillOrbit({
        agentId: agent.id,
        planetRadius: planet.__radius ?? 16,
        skillCount: count,
      });
      planet.addChild(orbit);
      orbitsMap.set(agent.id, orbit);
    }

    planetPositionsRef.current = posMap;
    prevAgentsRef.current = agents;
  // metrics intentionally excluded — read via metricsRef to avoid recreating planets on every update
  }, [agents, selectedAgentId, visualSettings]);

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
      const trailColor = ship.isSkillProbe ? 0x44ddff : ((ship.fromAgentType ? TRAIL_COLORS[ship.fromAgentType] : undefined) ?? TRAIL_COLOR_DEFAULT);

      // Static ghost route arc (drawn once)
      const routeG = new Graphics();
      for (let s = 0; s <= 48; s++) {
        const p = bezierPoint(s / 48, from.x, from.y, cx, cy, to.x, to.y);
        routeG.circle(p.x, p.y, 0.7).fill({ color: trailColor, alpha: 0.07 });
      }
      shipsContainer.addChild(routeG);

      const trailG = new Graphics();
      shipsContainer.addChild(trailG);

      const shipFactory = ship.isSkillProbe ? createSkillProbe : createShip;
      const shipContainer = shipFactory({
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

  // --- file collision lightning arcs ----------------------------------------
  // Sync Graphics objects with active sparks — add new, remove stale.
  useEffect(() => {
    if (!canvasReady) return;
    const container = shipsContainerRef.current;
    if (!container) return;
    const arcs = lightningArcsRef.current;
    const activeIds = new Set(sparks.map((s) => s.id));

    // Remove arcs that are no longer active
    for (const [id, g] of arcs) {
      if (!activeIds.has(id)) {
        g.destroy();
        arcs.delete(id);
      }
    }
    // Create Graphics for new sparks
    for (const spark of sparks) {
      if (!arcs.has(spark.id)) {
        const g = new Graphics();
        container.addChild(g);
        arcs.set(spark.id, g);
      }
    }
  }, [sparks, canvasReady]);

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
    // Don't start canvas pan if a planet or belt drag is active
    if (planetDragRef.current || beltDragRef.current) return;
    if (e.button === 0) {
      dragRef.current = { x: e.clientX - posRef.current.x, y: e.clientY - posRef.current.y };
    }
  }, []);

  const onPointerMove = useCallback((e: PointerEvent) => {
    // Planet drag — move individual planet in world coordinates
    if (planetDragRef.current) {
      const scale = scaleRef.current;
      const panPos = posRef.current;
      const sz = sizeRef.current;
      const worldX = (e.clientX - sz.width / 2 - panPos.x) / scale;
      const worldY = (e.clientY - sz.height / 2 - panPos.y) / scale;
      const drag = planetDragRef.current;
      let newX = worldX - drag.startX;
      let newY = worldY - drag.startY;

      // Mark as moved and change cursor on first actual movement
      if (!drag.moved) {
        drag.moved = true;
        const planetsContainer = planetsContainerRef.current;
        if (planetsContainer) {
          for (const child of planetsContainer.children) {
            const p = child as ExtendedPlanet;
            if (p.__agentId === drag.agentId) { p.cursor = 'grabbing'; break; }
          }
        }
      }

      // Enforce minimum distance from singularity (center)
      const dist = Math.sqrt(newX * newX + newY * newY);
      if (dist < PLANET_MIN_RADIUS) {
        const angle = Math.atan2(newY, newX);
        newX = Math.cos(angle) * PLANET_MIN_RADIUS;
        newY = Math.sin(angle) * PLANET_MIN_RADIUS;
      }

      // Enforce minimum distance from all other planets
      const planetsContainer = planetsContainerRef.current;
      if (planetsContainer) {
        for (const child of planetsContainer.children) {
          const other = child as ExtendedPlanet;
          if (!other.__agentId || other.__agentId === drag.agentId) continue;
          const dx = newX - other.x;
          const dy = newY - other.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < MIN_PIXEL_DIST && d > 0) {
            const pushAngle = Math.atan2(dy, dx);
            newX = other.x + Math.cos(pushAngle) * MIN_PIXEL_DIST;
            newY = other.y + Math.sin(pushAngle) * MIN_PIXEL_DIST;
          }
        }

        for (const child of planetsContainer.children) {
          const p = child as ExtendedPlanet;
          if (p.__agentId === drag.agentId) {
            p.x = newX;
            p.y = newY;
            customPositionsRef.current.set(drag.agentId, { x: newX, y: newY });
            planetPositionsRef.current.set(drag.agentId, { x: newX, y: newY });

            // Redraw asteroid belts to match new planet positions
            const beltsContainer = beltsContainerRef.current;
            if (beltsContainer) {
              // Update workspace group member positions from current planet positions
              for (const group of workspaceGroupsRef.current) {
                group.memberPositions = group.agentIds.map((id) => {
                  const pos = planetPositionsRef.current.get(id);
                  return pos ?? { x: 0, y: 0 };
                });
              }
              while (beltsContainer.children.length > 0) {
                beltsContainer.children[0].destroy({ children: true });
              }
              for (const group of workspaceGroupsRef.current) {
                if (group.agentIds.length > 1) {
                  const newBelt = drawAsteroidBelt(group.memberPositions, group.agentIds);
                  newBelt.on('pointerdown', (ev: { stopPropagation: () => void; global: { x: number; y: number } }) => {
                    ev.stopPropagation();
                    const s = scaleRef.current;
                    const pp = posRef.current;
                    const ssz = sizeRef.current;
                    const wx = (ev.global.x - ssz.width / 2 - pp.x) / s;
                    const wy = (ev.global.y - ssz.height / 2 - pp.y) / s;
                    beltDragRef.current = { agentIds: [...group.agentIds], startX: wx, startY: wy };
                  });
                  beltsContainer.addChild(newBelt);
                }
              }
            }
            break;
          }
        }
      }
      return; // Don't pan while dragging a planet
    }

    // Belt (group) drag — move all planets in the group together
    if (beltDragRef.current) {
      const scale = scaleRef.current;
      const panPos = posRef.current;
      const sz = sizeRef.current;
      const worldX = (e.clientX - sz.width / 2 - panPos.x) / scale;
      const worldY = (e.clientY - sz.height / 2 - panPos.y) / scale;
      const belt = beltDragRef.current;
      const dx = worldX - belt.startX;
      const dy = worldY - belt.startY;
      belt.startX = worldX;
      belt.startY = worldY;

      const planetsContainer = planetsContainerRef.current;
      if (planetsContainer) {
        for (const memberId of belt.agentIds) {
          for (const child of planetsContainer.children) {
            const p = child as ExtendedPlanet;
            if (p.__agentId === memberId) {
              p.x += dx;
              p.y += dy;
              customPositionsRef.current.set(memberId, { x: p.x, y: p.y });
              planetPositionsRef.current.set(memberId, { x: p.x, y: p.y });
              break;
            }
          }
        }
        // Redraw belts
        const beltsContainer = beltsContainerRef.current;
        if (beltsContainer) {
          for (const group of workspaceGroupsRef.current) {
            group.memberPositions = group.agentIds.map((id) => planetPositionsRef.current.get(id) ?? { x: 0, y: 0 });
          }
          while (beltsContainer.children.length > 0) {
            beltsContainer.children[0].destroy({ children: true });
          }
          for (const group of workspaceGroupsRef.current) {
            if (group.agentIds.length > 1) {
              const newBelt = drawAsteroidBelt(group.memberPositions, group.agentIds);
              newBelt.on('pointerdown', (ev: { stopPropagation: () => void; global: { x: number; y: number } }) => {
                ev.stopPropagation();
                const s = scaleRef.current;
                const pp = posRef.current;
                const ssz = sizeRef.current;
                const wx = (ev.global.x - ssz.width / 2 - pp.x) / s;
                const wy = (ev.global.y - ssz.height / 2 - pp.y) / s;
                beltDragRef.current = { agentIds: [...group.agentIds], startX: wx, startY: wy };
              });
              beltsContainer.addChild(newBelt);
            }
          }
        }
      }
      return;
    }

    // Canvas pan
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
    if (beltDragRef.current) {
      beltDragRef.current = null;
      return;
    }
    if (planetDragRef.current) {
      // Reset cursor on the dragged planet
      const planetsContainer = planetsContainerRef.current;
      if (planetsContainer) {
        for (const child of planetsContainer.children) {
          const p = child as ExtendedPlanet;
          if (p.__agentId === planetDragRef.current.agentId) {
            p.cursor = 'pointer';
            break;
          }
        }
      }
      // Small delay before clearing so pointertap doesn't fire
      setTimeout(() => { planetDragRef.current = null; }, 50);
      return;
    }
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
          // ~20% of fly-bys route dangerously close to the singularity
          const dangerousPath = Math.random() < 0.20;

          // Fly-by: curved path through the visible area using 3-5 waypoints
          const wpCount = 3 + Math.floor(Math.random() * 3); // 3–5 waypoints
          const waypoints: Array<{ x: number; y: number }> = [{ x: startX, y: startY }];

          if (dangerousPath) {
            // Route through singularity center — one waypoint near (0,0) with slight offset
            const midIdx = Math.floor(wpCount / 2);
            for (let wi = 0; wi < wpCount; wi++) {
              if (wi === midIdx) {
                // Pass through singularity danger zone (within ~25px of center)
                waypoints.push({
                  x: (Math.random() - 0.5) * 50,
                  y: (Math.random() - 0.5) * 50,
                });
              } else {
                const frac = (wi + 1) / (wpCount + 1);
                const baseAngle = entryAngle + Math.PI;
                const perpAngle = baseAngle + Math.PI / 2;
                const along = 60 + frac * 180;
                const wave = Math.sin(frac * Math.PI * (1.5 + Math.random())) * (80 + Math.random() * 60);
                waypoints.push({
                  x: startX + Math.cos(baseAngle) * along + Math.cos(perpAngle) * wave,
                  y: startY + Math.sin(baseAngle) * along + Math.sin(perpAngle) * wave,
                });
              }
            }
          } else {
            // Safe path — generate waypoints avoiding the singularity
            for (let wi = 0; wi < wpCount; wi++) {
              const frac = (wi + 1) / (wpCount + 1);
              const baseAngle = entryAngle + Math.PI;
              const perpAngle = baseAngle + Math.PI / 2;
              const along = 60 + frac * 180;
              const wave = Math.sin(frac * Math.PI * (1.5 + Math.random())) * (80 + Math.random() * 60);
              waypoints.push({
                x: startX + Math.cos(baseAngle) * along + Math.cos(perpAngle) * wave,
                y: startY + Math.sin(baseAngle) * along + Math.sin(perpAngle) * wave,
              });
            }
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
      }, delay);
    };
    scheduleUfo();

    // Shooting star spawner — 1 to 3 at once, random direction, every 30-90s
    // Stars container is behind panContainer in stage coords. We add shooting stars
    // to the world container instead so they render in world-space (visible & pan-aware).
    const spawnShootingStars = () => {
      const delay = SHOOTING_STAR_INTERVAL_MIN + Math.random() * (SHOOTING_STAR_INTERVAL_MAX - SHOOTING_STAR_INTERVAL_MIN);
      shootingStarTimerRef.current = setTimeout(() => {
        // Don't spawn shooting stars while the panel is hidden — they accumulate
        // and all appear at once when the panel becomes visible again.
        if (document.hidden) { spawnShootingStars(); return; }
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
          g.eventMode = 'static';
          g.cursor = 'pointer';
          g.hitArea = { contains: (hx: number, hy: number) => hx * hx + hy * hy < 400 };
          g.on('pointertap', () => {
            onShootingStarClickedRef.current?.();
            // Destroy this star immediately on click
            g.destroy();
            const idx = shootingStarsRef.current.findIndex((s) => s.g === g);
            if (idx !== -1) shootingStarsRef.current.splice(idx, 1);
          });
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
      const rawDt = app.ticker.deltaMS / 1000;
      // Cap delta to prevent animation bursts after the panel was hidden
      const dt = Math.min(rawDt, 0.1) * animationSpeedRef.current;

      // If we were hidden for a long time, flush accumulated shooting stars
      if (rawDt > 1) {
        const sstars = shootingStarsRef.current;
        for (const ss of sstars) ss.g.destroy();
        sstars.length = 0;
      }

      tickTimeRef.current += dt;
      const singPos = { x: 0, y: 0 };

      // Spiral-in removed agents
      const spiral = spiralRef.current;
      for (let i = spiral.length - 1; i >= 0; i--) {
        const s = spiral[i];
        // Directional acceleration toward center instead of exponential
        const dx0 = -s.c.x;
        const dy0 = -s.c.y;
        const dist0 = Math.sqrt(dx0 * dx0 + dy0 * dy0) || 1;
        s.vx += (dx0 / dist0) * 0.15;
        s.vy += (dy0 / dist0) * 0.15;
        s.c.x += s.vx;
        s.c.y += s.vy;
        s.c.alpha *= 0.98;
        s.c.scale.set((s.c.scale.x ?? 1) * 0.99);
        const d = Math.sqrt(s.c.x * s.c.x + s.c.y * s.c.y);
        if (d < 25 || s.c.alpha < 0.01) {
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
        } else if (state === 'waiting') {
          // Slow, calm breathing — planet is alive but paused, waiting for user
          pulse = 1 + 0.025 * Math.sin(t * 2.0);
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
          if (state === 'thinking' && !isPaused) {
            const load = metricsRef.current[agentId]?.load ?? 0.3;
            ring.rotation = (ring.rotation + 0.015 + load * 0.06) % (Math.PI * 2);
            ring.alpha = 0.55 + 0.35 * Math.sin(t * 5);
          }
        }

        // Error glow
        const eg = p.__errorGlow;
        if (eg) {
          eg.visible = state === 'error';
          if (state === 'error' && !isPaused) {
            eg.alpha = 0.25 + 0.2 * Math.sin(t * 12);
          }
        }

        // Waiting ring — slow pulsing amber ring (expand/contract + alpha breathe)
        const wr = p.__waitingRing;
        if (wr) {
          wr.visible = state === 'waiting';
          if (state === 'waiting' && !isPaused) {
            const breathe = Math.sin(t * 1.8);
            wr.scale.set(0.95 + 0.1 * breathe);
            wr.alpha = 0.45 + 0.35 * breathe;
          }
        }
      }

      // Animate skill orbit rings
      const skillOrbits = skillOrbitsRef.current;
      const activeSkillsMap = activeSkillsRef.current;
      for (const [agentId, orbit] of skillOrbits) {
        const skill = activeSkillsMap[agentId];
        updateSkillOrbit(orbit, t, skill?.name ?? null, skill?.index ?? -1);
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

        // Track gravity well entry/exit
        if (!a.inGravityWell && r < ASTRONAUT_SUCK_RADIUS) {
          a.inGravityWell = true;
          onAstronautTrappedRef.current?.();
        }
        // Escaped the gravity well! (was inside, now outside)
        if (a.inGravityWell && r >= ASTRONAUT_SUCK_RADIUS) {
          a.inGravityWell = false;
          a.escapeCount = (a.escapeCount ?? 0) + 1;
          onAstronautEscapedRef.current?.();
        }

        // Graze zone — near-miss detection (close but didn't enter gravity well)
        if (!a.inGravityWell && !a.inGrazeZone && r < ASTRONAUT_GRAZE_RADIUS) {
          a.inGrazeZone = true;
        }
        if (a.inGrazeZone && r >= ASTRONAUT_GRAZE_RADIUS) {
          a.inGrazeZone = false;
          // Only count as a graze if they never entered the gravity well
          if (!a.inGravityWell) {
            onAstronautGrazedRef.current?.();
          }
        }

        if (r < ASTRONAUT_DESTROY_RADIUS) {
          // Check for trick_shot (bounced then fell in) or kamikaze (jetted straight in)
          if (a.jetFiredAt > 0) {
            if (a.hasBouncedSinceJet) {
              onTrickShotRef.current?.();
            } else {
              onKamikazeRef.current?.();
            }
          }
          a.c.destroy({ children: true });
          astros.splice(i, 1);
          onAstronautConsumedRef.current?.();
          continue;
        }

        // Physics — acceleration = force / mass.
        // Lighter astronauts are more responsive to gravity; heavier ones resist more.
        const invMass = 1 / a.mass;
        let ax: number;
        let ay: number;
        if (a.inGravityWell) {
          const inward = (0.10 + (ASTRONAUT_SUCK_RADIUS - r) * 0.003) * invMass;
          ax = (dx / r) * inward;
          ay = (dy / r) * inward;
          // Visual: shrink and fade as astronaut approaches core
          const shrink = Math.max(0.15, (r - ASTRONAUT_DESTROY_RADIUS) / (ASTRONAUT_SUCK_RADIUS - ASTRONAUT_DESTROY_RADIUS));
          a.c.scale.set(shrink);
          a.c.alpha = shrink;
        } else {
          ax = (dx / r) * (SINGULARITY_PULL * invMass / r2) * dt * 60;
          ay = (dy / r) * (SINGULARITY_PULL * invMass / r2) * dt * 60;
          // Visual: scale by mass (heavy = noticeably larger sprite)
          const massScale = 0.6 + a.mass * 0.4;
          a.c.scale.set(massScale);
          a.c.alpha = 1;
        }

        // Planet gravity — only within 2× planet radius (min 80px).
        // Gentle enough that astronauts curve and can orbit, not get vacuumed in.
        // Jetpack can escape the pull.
        let removed = false;
        for (const p of planets) {
          const px = p.x - a.c.x;
          const py = p.y - a.c.y;
          const pr2 = px * px + py * py + 1;
          const pr = Math.sqrt(pr2);
          const pRadius = p.__radius ?? 15;
          const influenceRadius = Math.max(80, pRadius * 3);
          if (pr < influenceRadius) {
            const planetMass = pRadius / 15;
            // Exponential falloff: nearly zero at edge, ramps sharply near surface
            // t=0 at edge, t=1 at surface. t^6 means at halfway (t=0.5) force is ~1.5%
            const t = 1 - pr / influenceRadius;
            const falloff = t * t * t * t * t * t; // t^6
            ax += (px / pr) * (GRAVITY_STRENGTH * planetMass * invMass * falloff) * dt * 60;
            ay += (py / pr) * (GRAVITY_STRENGTH * planetMass * invMass * falloff) * dt * 60;
          }
          if (pr < (p.__radius ?? 15) + 8) {
            if (p.__agentId) onAstronautLandedRef.current?.(p.__agentId);
            a.c.destroy({ children: true });
            astros.splice(i, 1);
            removed = true;
            break;
          }
        }
        if (removed) continue;

        a.vx += ax;
        a.vy += ay;
        // Speed cap scales with mass — heavier astronauts have a lower max speed
        const maxSpeed = ASTRONAUT_MAX_SPEED / Math.sqrt(a.mass);
        if (!a.inGravityWell) {
          const speed = Math.sqrt(a.vx * a.vx + a.vy * a.vy);
          if (speed > maxSpeed) {
            a.vx = (a.vx / speed) * maxSpeed;
            a.vy = (a.vy / speed) * maxSpeed;
          }
        }
        a.c.x += a.vx;
        a.c.y += a.vy;

        // Jet spray: fire on a timer. When trapped in gravity well, jets fire more often
        // and with more power (desperate escape attempts).
        const now = Date.now();
        if (!a.nextJetTime) {
          a.nextJetTime = now + ASTRONAUT_JET_MIN_MS + Math.random() * (ASTRONAUT_JET_MAX_MS - ASTRONAUT_JET_MIN_MS);
        }
        if (now >= a.nextJetTime) {
          // In gravity well: stronger jets, biased AWAY from singularity, shorter cooldown
          const inWell = !!a.inGravityWell;
          const escapeAngle = Math.atan2(a.c.y, a.c.x); // angle away from singularity
          const jetAngle = inWell
            ? escapeAngle + (Math.random() - 0.5) * 1.2 // mostly outward ±~34°
            : Math.random() * Math.PI * 2;               // random direction
          const jetPower = inWell
            ? 4.0 + Math.random() * 2.5   // stronger desperate burst
            : 2.5 + Math.random() * 1.5;
          a.vx += Math.cos(jetAngle) * jetPower;
          a.vy += Math.sin(jetAngle) * jetPower;
          a.jetFiredAt = now;
          a.hasBouncedSinceJet = false;
          onRocketManRef.current?.();
          // Next jet sooner when trapped (15-30s) vs normal (45-120s)
          a.nextJetTime = inWell
            ? now + 15_000 + Math.random() * 15_000
            : now + ASTRONAUT_JET_MIN_MS + Math.random() * (ASTRONAUT_JET_MAX_MS - ASTRONAUT_JET_MIN_MS);

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
        let bounced = false;
        if (a.c.x < left + margin) { a.c.x = left + margin; a.vx = Math.abs(a.vx) * 0.6; bounced = true; a.edgesHit.add('left'); }
        else if (a.c.x > right - margin) { a.c.x = right - margin; a.vx = -Math.abs(a.vx) * 0.6; bounced = true; a.edgesHit.add('right'); }
        if (a.c.y < top + margin) { a.c.y = top + margin; a.vy = Math.abs(a.vy) * 0.6; bounced = true; a.edgesHit.add('top'); }
        else if (a.c.y > bottom - margin) { a.c.y = bottom - margin; a.vy = -Math.abs(a.vy) * 0.6; bounced = true; a.edgesHit.add('bottom'); }
        if (bounced) {
          a.bounceCount++;
          a.hasBouncedSinceJet = true;
          onAstronautBouncedRef.current?.(a.id, a.bounceCount, a.edgesHit);
        }
      }

      // Jet spray particles
      const jets = jetSprayRef.current;
      for (let ji = jets.length - 1; ji >= 0; ji--) {
        const jp = jets[ji];
        jp.life += dt;
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

      // File collision — lightning arcs between colliding planets
      const arcs = lightningArcsRef.current;
      const currentSparks = sparksRef.current;
      const posMapLightning = planetPositionsRef.current;
      for (const spark of currentSparks) {
        const g = arcs.get(spark.id);
        if (!g) continue;
        const posA = posMapLightning.get(spark.agentIds[0]);
        const posB = posMapLightning.get(spark.agentIds[1]);
        if (!posA || !posB) { g.clear(); continue; }

        g.clear();

        // Draw 2–3 jagged lightning bolts between the two planets
        const boltCount = 2 + Math.floor(Math.random() * 2);
        const BOLT_COLORS = [0x44ddff, 0xaaeeff, 0xffffff];
        for (let b = 0; b < boltCount; b++) {
          const segments = 8 + Math.floor(Math.random() * 6);
          const color = BOLT_COLORS[b % BOLT_COLORS.length];
          const alpha = b === 0 ? 0.9 : 0.4 + Math.random() * 0.3;
          const width = b === 0 ? 1.8 : 0.8 + Math.random() * 0.6;

          // Direction vector
          const dx = posB.x - posA.x;
          const dy = posB.y - posA.y;
          // Perpendicular for jitter
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          const perpX = -dy / len;
          const perpY = dx / len;

          g.moveTo(posA.x, posA.y);
          for (let s = 1; s < segments; s++) {
            const frac = s / segments;
            const baseX = posA.x + dx * frac;
            const baseY = posA.y + dy * frac;
            // Jitter perpendicular to the line — larger in the middle, zero at endpoints
            const jitterScale = Math.sin(frac * Math.PI) * len * 0.15;
            const jitter = (Math.random() - 0.5) * 2 * jitterScale;
            g.lineTo(baseX + perpX * jitter, baseY + perpY * jitter);
          }
          g.lineTo(posB.x, posB.y);
          g.stroke({ width, color, alpha });

          // Glow pass — same path, wider, lower alpha
          if (b === 0) {
            g.moveTo(posA.x, posA.y);
            for (let s = 1; s < segments; s++) {
              const frac = s / segments;
              const baseX = posA.x + dx * frac;
              const baseY = posA.y + dy * frac;
              const jitterScale = Math.sin(frac * Math.PI) * len * 0.15;
              const jitter = (Math.random() - 0.5) * 2 * jitterScale;
              g.lineTo(baseX + perpX * jitter, baseY + perpY * jitter);
            }
            g.lineTo(posB.x, posB.y);
            g.stroke({ width: 5, color: 0x44ddff, alpha: 0.12 });
          }
        }

        // Small sparks at both endpoints
        for (const pos of [posA, posB]) {
          for (let i = 0; i < 3; i++) {
            const sparkSize = 1 + Math.random() * 1.5;
            const offsetX = (Math.random() - 0.5) * 12;
            const offsetY = (Math.random() - 0.5) * 12;
            g.circle(pos.x + offsetX, pos.y + offsetY, sparkSize);
            g.fill({ color: 0xaaeeff, alpha: 0.5 + Math.random() * 0.4 });
          }
        }
      }

      // Shooting stars
      const sstars = shootingStarsRef.current;
      for (let si = sstars.length - 1; si >= 0; si--) {
        const ss = sstars[si];
        ss.life += dt;
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
        ufoState.t += dt;
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
        ufoState.t += dt;
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
        ufoState.t += dt;
        const tv = Math.min(1, ufoState.t * 0.6);
        const ease = tv * tv * (3 - 2 * tv);
        const sx = ufoState.startX ?? ufo.x;
        const sy = ufoState.startY ?? ufo.y;
        ufo.x = sx + (ufoState.targetX - sx) * ease;
        ufo.y = sy + (ufoState.targetY - sy) * ease;
        // Check if flyaway path crosses singularity
        const flyDist = Math.sqrt(ufo.x * ufo.x + ufo.y * ufo.y);
        if (flyDist < 55) {
          ufoState.phase = 'sucked';
          ufoState.t = 0;
          ufoState.startX = ufo.x;
          ufoState.startY = ufo.y;
        } else if (tv >= 1) {
          ufo.visible = false;
          ufoState.phase = 'idle';
          scheduleUfo();
        }
      } else if (ufoState.phase === 'flyby') {
        // Curved path through waypoints — smooth interpolation between each segment
        const wps = ufoState.waypoints;
        let idx = ufoState.waypointIndex ?? 0;
        let segT = (ufoState.segT ?? 0) + 0.012; // speed per segment
        if (!wps || wps.length < 2) { ufo.visible = false; ufoState.phase = 'idle'; scheduleUfo(); }
        else {
          if (segT >= 1) {
            segT = 0;
            idx++;
            ufoState.waypointIndex = idx;
          }
          if (idx >= wps.length - 1) {
            ufo.visible = false;
            ufoState.phase = 'idle';
            scheduleUfo();
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

            // Check if UFO entered the singularity danger zone
            const ufoDist = Math.sqrt(ufo.x * ufo.x + ufo.y * ufo.y);
            if (ufoDist < 55) {
              // Captured! Start spiral-in animation
              ufoState.phase = 'sucked';
              ufoState.t = 0;
              ufoState.startX = ufo.x;
              ufoState.startY = ufo.y;
            }
          }
        }
      } else if (ufoState.phase === 'sucked') {
        // Spiral into singularity — shrink, spin, pull toward center
        ufoState.t += dt;
        const suckT = Math.min(1, ufoState.t * 0.6); // ~1.7s to consume
        const startDist = Math.sqrt((ufoState.startX ?? 50) ** 2 + (ufoState.startY ?? 50) ** 2);
        const currentDist = startDist * (1 - suckT);
        const baseAngle = Math.atan2(ufoState.startY ?? 0, ufoState.startX ?? 0);
        const spiralAngle = baseAngle + suckT * Math.PI * 4; // 2 full rotations
        ufo.x = Math.cos(spiralAngle) * currentDist;
        ufo.y = Math.sin(spiralAngle) * currentDist;
        ufo.scale.set(1 - suckT * 0.9); // shrink to 10%
        ufo.rotation = suckT * Math.PI * 6; // spin rapidly
        ufo.alpha = 1 - suckT * 0.7;
        if (suckT >= 1) {
          ufo.visible = false;
          ufo.scale.set(1);
          ufo.alpha = 1;
          ufo.rotation = 0;
          ufoState.phase = 'idle';
          onUfoConsumedRef.current?.();
          scheduleUfo();
        }
      } else if (ufoState.phase === 'cow_falling') {
        // Cow drops back to planet surface with gravity-like acceleration
        ufoState.t += dt;
        const fallDuration = 0.8;
        const fallT = Math.min(1, ufoState.t / fallDuration);
        const cow = ufoState.cow;
        if (cow) {
          const fromY = ufoState.cowFallFromY ?? 0;
          const toY = ufoState.cowFallToY ?? 70;
          const eased = fallT * fallT; // accelerating fall
          cow.y = fromY + (toY - fromY) * eased;
          cow.visible = true;
        }
        if (fallT >= 1) {
          if (ufoState.cow) ufoState.cow.visible = false;
          // UFO flies away after cow drops
          const angle = Math.random() * Math.PI * 2;
          const dist = 280 + Math.random() * 120;
          ufoState.phase = 'flyaway';
          ufoState.t = 0;
          ufoState.startX = ufo.x;
          ufoState.startY = ufo.y;
          ufoState.targetX = ufo.x + Math.cos(angle) * dist;
          ufoState.targetY = ufo.y + Math.sin(angle) * dist;
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
      for (const s of activeShipsRef.current) {
        try { s.c.destroy({ children: true }); } catch { /* ignore */ }
        try { s.trailG.destroy(); } catch { /* ignore */ }
        try { s.routeG.destroy(); } catch { /* ignore */ }
      }
      activeShipsRef.current = [];
      spawnedShipIdsRef.current = new Set();
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
