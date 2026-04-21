/**
 * Main PixiJS canvas + React wrapper for the cosmic universe.
 * @event-horizon/renderer
 */

import 'pixi.js/unsafe-eval';
import type { FC } from 'react';
import { useEffect, useRef, useState, useCallback, memo } from 'react';
import { Application, Container, Graphics, Text } from 'pixi.js';
import { createStars } from './entities/Stars.js';
import { createSingularity } from './entities/Singularity.js';
import { createPlanet } from './entities/Planet.js';
import type { ExtendedPlanet } from './entities/Planet.js';
import { createAstronaut } from './entities/Astronaut.js';
import { createUfo, setUfoBeam } from './entities/Ufo.js';
import type { ExtendedUfo } from './entities/Ufo.js';
import { createShip, createSkillProbe } from './entities/Ship.js';
// createMoon moved to MoonSystem
import { createSkillOrbit, updateSkillOrbit } from './entities/SkillOrbit.js';
import type { ExtendedSkillOrbit } from './entities/SkillOrbit.js';
import {
  bezierPoint,
  computeControlPoint,
  computePlanetPositions,
  computeBeltContour,
  PLANET_MIN_RADIUS,
} from './math.js';
import type { AgentView, WorkspaceGroup } from './math.js';
export type { AgentView, WorkspaceGroup } from './math.js';
import { updateShips } from './systems/ShipSystem.js';
import { updateShootingStars } from './systems/ShootingStarSystem.js';
import { updateUFO } from './systems/UFOSystem.js';
import { updateAstronaut, updateJetSpray } from './systems/AstronautSystem.js';
import type { PlanetInfo, ViewportBounds } from './systems/AstronautSystem.js';
import { createJetSprayPool } from './pools/JetSprayPool.js';
import { createShootingStarPool } from './pools/ShootingStarPool.js';
import type { GraphicsPool } from './pools/GraphicsPool.js';
import { animatePlanets } from './systems/PlanetAnimationSystem.js';
import { syncWormholes, animateWormholes } from './systems/WormholeSystem.js';
import type { ExtendedWormhole } from './entities/Wormhole.js';
import { updateMoons } from './systems/MoonSystem.js';
import { updateDebris } from './systems/DebrisSystem.js';
import type { DebrisPlan } from './systems/DebrisSystem.js';
import { updateLightning } from './systems/LightningSystem.js';
import { handleWheel, handlePointerDown, handlePointerMove, handlePointerUp } from './systems/InputHandler.js';
import type { InputRefs } from './systems/InputHandler.js';
import { StationSystem } from './systems/StationSystem.js';
import { BeamSystem } from './systems/BeamSystem.js';
import type { SpawnBeam } from './systems/BeamSystem.js';
import { ConstellationSystem } from './systems/ConstellationSystem.js';
import type { KnowledgeLink } from './systems/ConstellationSystem.js';

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
  /** Plan task debris — orbital fragments encoding task status. */
  planTasks?: DebrisPlan | null;
  /** When false, the PixiJS ticker is paused to save CPU (e.g. Operations view is active). */
  visible?: boolean;
  /** Agent IDs that are orchestrators — renders star glow behind their planets. */
  orchestratorAgentIds?: Record<string, boolean>;
  /** Heartbeat status per agent: 'alive' | 'stale' | 'lost'. */
  heartbeatStatuses?: Record<string, string>;
  /** MCP server data per agent — rendered as orbiting stations. */
  mcpServers?: Record<string, Array<{ name: string; connected: boolean; toolCount: number }>>;
  /** Agent IDs currently undergoing context compaction. */
  compactingAgentIds?: Record<string, boolean>;
  /** Orchestrator → worker beams (task assignment) and worker → orchestrator (synthesis). */
  spawnBeams?: SpawnBeam[];
  /** Knowledge links between agents for constellation visualization. */
  knowledgeLinks?: KnowledgeLink[];
  /** Agent type per agent ID — used for constellation coloring. */
  agentTypesMap?: Record<string, string>;
  /** Context usage ratio per agent (0-1) — drives planet fuel gauge. */
  contextUsage?: Record<string, number>;
  /** Wormhole connections between correlated agents (cross-agent file collaboration). */
  wormholes?: Array<{ id: string; sourceAgentId: string; targetAgentId: string; strength: number }>;
}

// --- constants -----------------------------------------------------------

// MIN_ZOOM, MAX_ZOOM moved to InputHandler
const INITIAL_W = 640;
const INITIAL_H = 400;
// Physics/ship constants moved to systems — keeping SHIP_AVOID_RADIUS import from math.ts
const UFO_INTERVAL_MIN_MS = 25000;
const UFO_INTERVAL_MAX_MS = 55000;
const UFO_FLYBY_CHANCE = 0.4; // 40% of UFOs just fly by without abducting
const SHOOTING_STAR_INTERVAL_MIN = 30000;  // ms between shooting stars
const SHOOTING_STAR_INTERVAL_MAX = 90000;
const SHOOTING_STAR_MAX_BURST = 3; // up to 3 shooting stars per event
// Astronaut jet constants moved to AstronautSystem

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
type BeltContainer = Container & { __groupAgentIds?: string[]; __positionsHash?: string };

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
  trailBuffer: Float32Array;
  trailHead: number;
  trailSize: number;
  trailColor: number;
}

// -------------------------------------------------------------------------

const UniverseImpl: FC<UniverseProps> = ({
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
  planTasks = null,
  visible = true,
  orchestratorAgentIds = {},
  heartbeatStatuses = {},
  mcpServers = {},
  compactingAgentIds = {},
  spawnBeams = [],
  knowledgeLinks = [],
  agentTypesMap = {},
  contextUsage = {},
  wormholes = [],
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
  /** Filename labels for lightning arcs — positioned at arc midpoint. */
  const lightningLabelsRef = useRef<Map<string, Text>>(new Map());
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
  const debrisContainerRef = useRef<Container | null>(null);
  const debrisTaskIdsRef = useRef<Set<string>>(new Set());
  const planTasksRef = useRef<DebrisPlan | null>(planTasks);
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
  const orchestratorIdsRef = useRef(orchestratorAgentIds);
  const heartbeatStatusesRef = useRef(heartbeatStatuses);
  const compactingAgentIdsRef = useRef(compactingAgentIds);
  const contextUsageRef = useRef(contextUsage);
  const mcpServersRef = useRef(mcpServers);
  const visibleRef = useRef(visible);
  const beltsContainerRef = useRef<Container | null>(null);
  const beltCacheRef = useRef<Map<string, BeltContainer>>(new Map());
  const lastRosterKeyRef = useRef<string | null>(null);
  const cachedLayoutRef = useRef<{ posMap: Map<string, { x: number; y: number }>; workspaceGroups: WorkspaceGroup[] } | null>(null);
  const lastCustomPositionsSizeRef = useRef<number>(0);
  const wormholesContainerRef = useRef<Container | null>(null);
  const wormholesRef = useRef<Map<string, ExtendedWormhole>>(new Map());
  const wormholesDataRef = useRef(wormholes);
  const workspaceGroupsRef = useRef<WorkspaceGroup[]>([]);
  const skillOrbitsRef = useRef<Map<string, ExtendedSkillOrbit>>(new Map());
  const agentSkillCountsRef = useRef<Record<string, number>>(agentSkillCounts);
  const activeSkillsRef = useRef<Record<string, { name: string; index: number }>>(activeSkills);
  const tickTimeRef = useRef(0);
  const stationSystemRef = useRef<StationSystem | null>(null);
  const beamSystemRef = useRef<BeamSystem | null>(null);
  const constellationSystemRef = useRef<ConstellationSystem | null>(null);
  const spawnBeamsRef = useRef<SpawnBeam[]>(spawnBeams);
  const knowledgeLinksRef = useRef<KnowledgeLink[]>(knowledgeLinks);
  const agentTypesMapRef = useRef<Record<string, string>>(agentTypesMap);
  const tetherGraphicsRef = useRef<Graphics | null>(null);
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

  const planetInfosRef = useRef<PlanetInfo[]>([]);
  const astroCallbacksRef = useRef<import('./systems/AstronautSystem.js').AstronautCallbacks | null>(null);
  const jetSprayPoolRef = useRef<GraphicsPool | null>(null);
  const shootingStarPoolRef = useRef<GraphicsPool | null>(null);

  const mountedRef = useRef(true);

  const selectedAgentIdRef = useRef<string | null>(selectedAgentId);

  // Keep control refs in sync without triggering rerenders (synchronous assignments)
  agentStatesRef.current = agentStates;
  metricsRef.current = metrics;
  pausedRef.current = pausedAgentIds;
  isolatedRef.current = isolatedAgentId;
  boostedRef.current = boostedAgentIds;
  activeSubagentsRef.current = activeSubagents;
  agentSkillCountsRef.current = agentSkillCounts;
  activeSkillsRef.current = activeSkills;
  planTasksRef.current = planTasks;
  animationSpeedRef.current = animationSpeed;
  orchestratorIdsRef.current = orchestratorAgentIds;
  heartbeatStatusesRef.current = heartbeatStatuses;
  compactingAgentIdsRef.current = compactingAgentIds;
  contextUsageRef.current = contextUsage;
  wormholesDataRef.current = wormholes;
  mcpServersRef.current = mcpServers;
  visibleRef.current = visible;
  spawnBeamsRef.current = spawnBeams;
  agentTypesMapRef.current = agentTypesMap;
  selectedAgentIdRef.current = selectedAgentId;

  // Keep visual settings in sync and bump revision to trigger planet recreation
  useEffect(() => {
    if (visualSettingsRef.current !== visualSettings) {
      visualSettingsRef.current = visualSettings;
      settingsRevRef.current++;
    }
  }, [visualSettings]);
  // Redraw constellations when knowledge data changes
  useEffect(() => {
    knowledgeLinksRef.current = knowledgeLinks;
    const sys = constellationSystemRef.current;
    if (sys) sys.update(knowledgeLinks, planetPositionsRef.current, agentTypesMapRef.current);
  }, [knowledgeLinks]);
  // Redraw constellations when agent roster (and thus positions) changes
  useEffect(() => {
    const sys = constellationSystemRef.current;
    if (sys) sys.update(knowledgeLinksRef.current, planetPositionsRef.current, agentTypesMapRef.current);
  }, [agents]);
  // Sync stations only when mcpServers or agent roster changes (not every frame)
  useEffect(() => {
    const sys = stationSystemRef.current;
    if (sys) sys.sync(mcpServersRef.current ?? {}, planetPositionsRef.current);
  }, [mcpServers, agents]);

  const sparksRef = useRef<SparkSpawn[]>(sparks);
  // Keep the ref in sync with the prop so the ticker reads current sparks
  // (without this the ticker only ever saw the initial empty array and
  // no file-collision lightning ever rendered).
  sparksRef.current = sparks;

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

        // Wormholes — drawn ABOVE planets so the violet portals are visible
        // (when behind, the planet sprite covered the spiral entirely).
        const wormholesContainer = new Container();
        world.addChild(wormholesContainer);
        wormholesContainerRef.current = wormholesContainer;

        const debrisContainer = new Container();
        world.addChild(debrisContainer);
        debrisContainerRef.current = debrisContainer;

        const shipsContainer = new Container();
        world.addChild(shipsContainer);
        shipsContainerRef.current = shipsContainer;

        const stationsContainer = new Container();
        world.addChild(stationsContainer);
        stationSystemRef.current = new StationSystem(stationsContainer);

        const beamsContainer = new Container();
        world.addChild(beamsContainer);
        beamSystemRef.current = new BeamSystem(beamsContainer);

        const constellationContainer = new Container();
        world.addChild(constellationContainer);
        constellationSystemRef.current = new ConstellationSystem(constellationContainer);

        const tetherGfx = new Graphics();
        world.addChild(tetherGfx);
        tetherGraphicsRef.current = tetherGfx;

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

    jetSprayPoolRef.current = createJetSprayPool();
    shootingStarPoolRef.current = createShootingStarPool();

    return () => {
      jetSprayPoolRef.current?.destroyAll();
      jetSprayPoolRef.current = null;
      shootingStarPoolRef.current?.destroyAll();
      shootingStarPoolRef.current = null;
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
      if (debrisContainerRef.current) {
        for (let i = debrisContainerRef.current.children.length - 1; i >= 0; i--) {
          try { debrisContainerRef.current.children[i].destroy({ children: true }); } catch { /* ignore */ }
        }
      }
      debrisContainerRef.current = null;
      debrisTaskIdsRef.current = new Set();
      shipsContainerRef.current = null;
      if (stationSystemRef.current) {
        stationSystemRef.current.destroy();
        stationSystemRef.current = null;
      }
      if (beamSystemRef.current) {
        beamSystemRef.current.destroy();
        beamSystemRef.current = null;
      }
      if (constellationSystemRef.current) {
        constellationSystemRef.current.destroy();
        constellationSystemRef.current = null;
      }
      if (tetherGraphicsRef.current) {
        try { tetherGraphicsRef.current.destroy(); } catch { /* ignore */ }
        tetherGraphicsRef.current = null;
      }
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
      for (const t of lightningLabelsRef.current.values()) { try { t.destroy(); } catch { /* ignore */ } }
      lightningLabelsRef.current = new Map();
      for (const o of skillOrbitsRef.current.values()) { try { o.destroy({ children: true }); } catch { /* ignore */ } }
      skillOrbitsRef.current = new Map();
      planetPositionsRef.current = new Map();
      ufoRef.current = null;
      singularityRef.current = null;
      starsRef.current = null;
      initedRef.current = false;
      appRef.current = null;
      try {
        const c = app?.canvas;
        if (c?.parentNode) c.remove();
      } catch { /* ignore */ }
      try {
        app?.destroy(true, { children: true });
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

    // Only recreate stars if the size changed significantly (avoids visible
    // vibration when ResizeObserver fires repeatedly in small windows).
    const oldW = stars ? (stars as unknown as { _ehW?: number })._ehW ?? 0 : 0;
    const oldH = stars ? (stars as unknown as { _ehH?: number })._ehH ?? 0 : 0;
    if (Math.abs(width - oldW) > 20 || Math.abs(height - oldH) > 20 || !stars) {
      if (stars) {
        try { stars.destroy({ children: true }); } catch { /* ignore */ }
      }
      const newStars = createStars(width * 2, height * 2);
      newStars.x = -width / 2;
      newStars.y = -height / 2;
      (newStars as unknown as { _ehW: number })._ehW = width;
      (newStars as unknown as { _ehH: number })._ehH = height;
      app.stage.addChildAt(newStars, 0);
      starsRef.current = newStars;
    } else if (stars) {
      // Just reposition the existing stars layer for small size changes.
      stars.x = -width / 2;
      stars.y = -height / 2;
    }
  }, [width, height, canvasReady]);

  // --- pause ticker when hidden (Operations view) --------------------------
  // When becoming hidden we also flush any queued spiral-out planets and ships.
  // Otherwise when we become visible again, every agent that terminated while hidden
  // animates at once ("ghost planets flying to the hole").
  useEffect(() => {
    const app = appRef.current;
    if (!app) return;
    if (visible) {
      try { app.ticker.start(); } catch { /* ignore */ }
    } else {
      try { app.ticker.stop(); } catch { /* ignore */ }
      // Drain the spiral queue — destroy everything in flight so we don't see stale animations on return
      for (const s of spiralRef.current) {
        try { s.c.destroy({ children: true }); } catch { /* already destroyed */ }
      }
      spiralRef.current = [];
      // Also clear any ships/shooting stars that were in-flight
      const shipsContainer = shipsContainerRef.current;
      if (shipsContainer) {
        while (shipsContainer.children.length > 0) {
          const c = shipsContainer.children[0];
          shipsContainer.removeChild(c);
          try { c.destroy({ children: true }); } catch { /* ignore */ }
        }
      }
      // Clear refs so updateShips doesn't operate on destroyed objects on visibility return
      activeShipsRef.current = [];
      spawnedShipIdsRef.current = new Set();
      jetSprayRef.current = [];
      astronautsRef.current = [];
    }
  }, [visible, canvasReady]);

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
    // Invalidate roster cache so main effect recomputes after reset.
    lastRosterKeyRef.current = null;
    cachedLayoutRef.current = null;
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
    // Diff-based asteroid belt update (reset-layout path)
    const beltsContainer = beltsContainerRef.current;
    if (beltsContainer) {
      const beltCache = beltCacheRef.current;
      const activeGroupKeys = new Set<string>();
      for (const group of workspaceGroups) {
        if (group.agentIds.length > 1) {
          const groupKey = [...group.agentIds].sort().join('|');
          const positionsHash = group.memberPositions.map(p => `${p.x | 0},${p.y | 0}`).join(';');
          activeGroupKeys.add(groupKey);
          const existing = beltCache.get(groupKey);
          if (existing && existing.__positionsHash === positionsHash) continue;
          if (existing) {
            beltsContainer.removeChild(existing);
            existing.destroy({ children: true });
          }
          const belt = drawAsteroidBelt(group.memberPositions, group.agentIds);
          belt.__positionsHash = positionsHash;
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
          beltCache.set(groupKey, belt);
        }
      }
      for (const [key, belt] of beltCache) {
        if (!activeGroupKeys.has(key)) {
          beltsContainer.removeChild(belt);
          belt.destroy({ children: true });
          beltCache.delete(key);
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

    // 2. Compute positions + workspace groups (skip if roster unchanged)
    const rosterKey = agents.map((a) => a.id).sort().join('|');
    const customSize = customPositionsRef.current.size;
    let posMap: Map<string, { x: number; y: number }>;
    let workspaceGroups: WorkspaceGroup[];
    if (
      rosterKey === lastRosterKeyRef.current &&
      cachedLayoutRef.current !== null &&
      customSize === lastCustomPositionsSizeRef.current
    ) {
      posMap = cachedLayoutRef.current.posMap;
      workspaceGroups = cachedLayoutRef.current.workspaceGroups;
    } else {
      ({ positions: posMap, workspaceGroups } = computePlanetPositions(agents, SESSION_SEED));
      lastRosterKeyRef.current = rosterKey;
      lastCustomPositionsSizeRef.current = customSize;
      cachedLayoutRef.current = { posMap, workspaceGroups };
    }
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

    // 2b. Diff-based asteroid belt update (main planets path)
    const beltsContainer = beltsContainerRef.current;
    if (beltsContainer) {
      const beltCache = beltCacheRef.current;
      const activeGroupKeys = new Set<string>();
      for (const group of workspaceGroups) {
        if (group.agentIds.length > 1) {
          const groupKey = [...group.agentIds].sort().join('|');
          const positionsHash = group.memberPositions.map(p => `${p.x | 0},${p.y | 0}`).join(';');
          activeGroupKeys.add(groupKey);
          const existing = beltCache.get(groupKey);
          if (existing && existing.__positionsHash === positionsHash) continue;
          if (existing) {
            beltsContainer.removeChild(existing);
            existing.destroy({ children: true });
          }
          const belt = drawAsteroidBelt(group.memberPositions, group.agentIds);
          belt.__positionsHash = positionsHash;
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
          beltCache.set(groupKey, belt);
        }
      }
      for (const [key, belt] of beltCache) {
        if (!activeGroupKeys.has(key)) {
          beltsContainer.removeChild(belt);
          belt.destroy({ children: true });
          beltCache.delete(key);
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
          isOrchestrator: !!orchestratorIdsRef.current[agent.id],
        });

        // Spawn animation: start at scale 0 with nebula cloud
        const ep = planet as unknown as import('./systems/PlanetAnimationSystem.js').AnimatedPlanet;
        ep.__spawnProgress = 0;
        const nebulaColor = TRAIL_COLORS[agent.agentType ?? ''] ?? TRAIL_COLOR_DEFAULT;
        const nebula = new Graphics();
        const nebulaR = (planet.__radius ?? 16) * 1.5;
        // Draw 4 semi-transparent circles at random offsets
        for (let ni = 0; ni < 4; ni++) {
          const offX = (Math.random() - 0.5) * nebulaR * 0.8;
          const offY = (Math.random() - 0.5) * nebulaR * 0.8;
          nebula.circle(offX, offY, nebulaR * (0.6 + Math.random() * 0.4));
          nebula.fill({ color: nebulaColor, alpha: 0.15 + Math.random() * 0.1 });
        }
        nebula.alpha = 0.7;
        planet.addChildAt(nebula, 0);
        ep.__spawnNebula = nebula as Graphics & { alpha: number };

        // Name label beneath planet (+ folder name on second line)
        let cwdNorm = agent.cwd ? agent.cwd.replace(/\\/g, '/') : '';
        while (cwdNorm.endsWith('/')) cwdNorm = cwdNorm.slice(0, -1);
        const cwdFolder = cwdNorm ? cwdNorm.split('/').pop() || '' : '';
        const labelText = cwdFolder ? `${agent.name}\n${cwdFolder}` : agent.name;
        const label = new Text({
          text: labelText,
          style: { fontFamily: 'Consolas, Courier New, monospace', fontSize: 11, fill: 0x6688aa, lineHeight: 14, align: 'center' },
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
        trailBuffer: new Float32Array(64),
        trailHead: 0,
        trailSize: 0,
        trailColor,
      });
      spawnedShipIdsRef.current.add(ship.id);
    }
  }, [ships, canvasReady]);

  // --- file collision lightning arcs ----------------------------------------
  // Sync Graphics + Text objects with active sparks — add new, remove stale.
  useEffect(() => {
    if (!canvasReady) return;
    const container = shipsContainerRef.current;
    if (!container) return;
    const arcs = lightningArcsRef.current;
    const labels = lightningLabelsRef.current;
    const activeIds = new Set(sparks.map((s) => s.id));

    // Remove arcs/labels that are no longer active
    for (const [id, g] of arcs) {
      if (!activeIds.has(id)) {
        g.destroy();
        arcs.delete(id);
      }
    }
    for (const [id, t] of labels) {
      if (!activeIds.has(id)) {
        t.destroy();
        labels.delete(id);
      }
    }
    // Create Graphics + label for new sparks
    for (const spark of sparks) {
      if (!arcs.has(spark.id)) {
        const g = new Graphics();
        container.addChild(g);
        arcs.set(spark.id, g);
      }
      if (!labels.has(spark.id)) {
        const t = new Text({
          text: spark.filePath,
          style: { fontFamily: 'Consolas, Courier New, monospace', fontSize: 9, fill: 0x88ddff, align: 'center' },
        });
        t.anchor.set(0.5, 0.5);
        t.alpha = 0.85;
        container.addChild(t);
        labels.set(spark.id, t);
      }
    }
  }, [sparks, canvasReady]);

  // --- pointer controls (delegated to InputHandler) -------------------------
  const inputRefsObj = useRef<InputRefs | null>(null);
  if (!inputRefsObj.current) {
    inputRefsObj.current = {
      scaleRef, posRef, sizeRef, dragRef, planetDragRef, beltDragRef,
      worldRef, panContainerRef, starsRef, planetsContainerRef, beltsContainerRef,
      planetPositionsRef, customPositionsRef, workspaceGroupsRef,
      drawAsteroidBelt,
    };
  }
  // Keep refs in sync
  inputRefsObj.current.drawAsteroidBelt = drawAsteroidBelt;

  const onWheel = useCallback((e: WheelEvent) => handleWheel(e, inputRefsObj.current!), []);
  const onPointerDown = useCallback((e: PointerEvent) => handlePointerDown(e, inputRefsObj.current!), []);
  const onPointerMove = useCallback((e: PointerEvent) => handlePointerMove(e, inputRefsObj.current!), []);
  const onPointerUp = useCallback(() => handlePointerUp(inputRefsObj.current!), []);

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
        // Skip UFO spawn while hidden (Operations view or browser tab)
        if (document.hidden || !visibleRef.current) { scheduleUfo(); return; }
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
        // Don't spawn shooting stars while hidden (browser tab or Operations view) —
        // they accumulate and all appear at once when visible again.
        if (document.hidden || !visibleRef.current) { spawnShootingStars(); return; }
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

          const g = shootingStarPoolRef.current?.acquire();
          if (!g) continue;
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
            // Release back to pool immediately on click
            shootingStarPoolRef.current?.release(g);
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

    let frameCount = 0;
    let lastFrameLog = performance.now();
    const phaseTimes: Record<string, number> = { debris: 0, station: 0, beam: 0, ships: 0, astro: 0, lightning: 0, shooting: 0, planets: 0 };
    const tick = () => {
      if (!world || !planetsContainer) return;
      frameCount++;
      const now = performance.now();
      if (now - lastFrameLog > 1000) {
        if (__EH_DEV__) {
          const perf = performance as Performance & { memory?: { usedJSHeapSize: number } };
          const heap = perf.memory ? (perf.memory.usedJSHeapSize / 1048576).toFixed(0) : '?';
          const children = planetsContainer.children.length;
          const phases = Object.entries(phaseTimes)
            .filter(([, v]) => v > 1)
            .map(([k, v]) => `${k}=${v.toFixed(0)}ms`)
            .join(' ');
          // eslint-disable-next-line no-console
          console.log(`[EH pixi-tick] ${frameCount}fps heap=${heap}MB planets=${children} stars=${shootingStarsRef.current.length} ${phases}`);
        }
        frameCount = 0;
        lastFrameLog = now;
        for (const k of Object.keys(phaseTimes)) phaseTimes[k] = 0;
      }
      const rawDt = app.ticker.deltaMS / 1000;
      // Cap delta to prevent animation bursts after the panel was hidden
      const dt = Math.min(rawDt, 0.1) * animationSpeedRef.current;

      // If we were hidden for a long time, flush accumulated shooting stars
      if (rawDt > 1) {
        const sstars = shootingStarsRef.current;
        for (const ss of sstars) shootingStarPoolRef.current?.release(ss.g);
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

      // Per-planet state-driven animation (delegated to PlanetAnimationSystem)
      const t = tickTimeRef.current;
      {
        const p0 = performance.now();
        animatePlanets(planetsContainer.children as unknown as import('./systems/PlanetAnimationSystem.js').AnimatedPlanet[], {
          tickTime: t,
          agentStates: agentStatesRef.current,
          metrics: metricsRef.current,
          pausedAgentIds: pausedRef.current,
          boostedAgentIds: boostedRef.current,
          isolatedAgentId: isolatedRef.current,
          heartbeatStatuses: heartbeatStatusesRef.current,
          compactingAgentIds: compactingAgentIdsRef.current,
          contextUsage: contextUsageRef.current,
        });
        phaseTimes.planets += performance.now() - p0;
      }

      // Wormholes — sync data + animate (cross-agent file collaboration visual)
      const whContainer = wormholesContainerRef.current;
      if (whContainer) {
        syncWormholes(whContainer, wormholesRef.current, wormholesDataRef.current, planetPositionsRef.current);
        animateWormholes(wormholesRef.current.values(), app.ticker.deltaTime);
      }

      // Animate skill orbit rings
      const skillOrbits = skillOrbitsRef.current;
      const activeSkillsMap = activeSkillsRef.current;
      for (const [agentId, orbit] of skillOrbits) {
        const skill = activeSkillsMap[agentId];
        updateSkillOrbit(orbit, t, skill?.name ?? null, skill?.index ?? -1);
      }

      // Manage + animate moons (delegated to MoonSystem)
      const moonsContainer = moonsContainerRef.current;
      if (moonsContainer) {
        updateMoons(moonsContainer, planetPositionsRef.current, activeSubagentsRef.current, moonCountsRef.current);
      }

      // Plan task debris (delegated to DebrisSystem)
      const debrisContainer = debrisContainerRef.current;
      if (debrisContainer) {
        const p0 = performance.now();
        updateDebris(debrisContainer, planetPositionsRef.current, planTasksRef.current, debrisTaskIdsRef.current, t, tetherGraphicsRef.current);
        phaseTimes.debris += performance.now() - p0;
      }

      // Station system (MCP servers orbiting planets)
      const stationSys = stationSystemRef.current;
      if (stationSys) {
        const p0 = performance.now();
        stationSys.update(dt, t, planetPositionsRef.current);
        phaseTimes.station += performance.now() - p0;
      }

      // Beam system (orchestrator ↔ worker beams)
      const beamSys = beamSystemRef.current;
      if (beamSys) {
        const p0 = performance.now();
        const aliveBeams = beamSys.update(spawnBeamsRef.current, t, planetPositionsRef.current);
        spawnBeamsRef.current = aliveBeams;
        phaseTimes.beam += performance.now() - p0;
      }

      // Constellation system — redraw every frame so lines track dragged planets.
      // The cost is bounded (one Graphics.clear + N lineTo calls); if profiling
      // shows hotspots, gate this on planetDragRef.current activity.
      {
        const sys = constellationSystemRef.current;
        if (sys && knowledgeLinksRef.current.length > 0) {
          sys.update(knowledgeLinksRef.current, planetPositionsRef.current, agentTypesMapRef.current);
        }
      }

      // Animate ships along bezier arcs (delegated to ShipSystem)
      {
        const p0 = performance.now();
        updateShips(activeShipsRef.current, {
          onShipRemoved: (id) => spawnedShipIdsRef.current.delete(id),
        });
        phaseTimes.ships += performance.now() - p0;
      }

      // Astronaut physics (delegated to AstronautSystem)
      const astros = astronautsRef.current;
      const planets = planetsContainer.children as ExtendedPlanet[];
      // Pre-allocated planetInfos buffer — refill in-place to avoid per-frame allocation
      const buf = planetInfosRef.current;
      buf.length = planets.length;
      for (let i = 0; i < planets.length; i++) {
        const p = planets[i];
        if (!buf[i]) buf[i] = { x: 0, y: 0, radius: 0, agentId: '' };
        buf[i].x = p.x;
        buf[i].y = p.y;
        buf[i].radius = p.__radius ?? 15;
        buf[i].agentId = p.__agentId ?? '';
      }
      const planetInfos = buf;
      const sz = sizeRef.current;
      const scale = scaleRef.current;
      const pan = posRef.current;
      const astroBounds: ViewportBounds = {
        left:   -(sz.width  / 2 + pan.x) / scale,
        right:   (sz.width  / 2 - pan.x) / scale,
        top:    -(sz.height / 2 + pan.y) / scale,
        bottom:  (sz.height / 2 - pan.y) / scale,
      };
      // Build astroCallbacks once, delegates to latest callback refs
      if (!astroCallbacksRef.current) {
        astroCallbacksRef.current = {
          onTrapped: () => onAstronautTrappedRef.current?.(),
          onEscaped: () => onAstronautEscapedRef.current?.(),
          onGrazed: () => onAstronautGrazedRef.current?.(),
          onConsumed: () => onAstronautConsumedRef.current?.(),
          onLanded: (agentId: string) => onAstronautLandedRef.current?.(agentId),
          onBounced: (id: number, count: number, edges: Set<string>) => onAstronautBouncedRef.current?.(id, count, edges),
          onRocketMan: () => onRocketManRef.current?.(),
          onTrickShot: () => onTrickShotRef.current?.(),
          onKamikaze: () => onKamikazeRef.current?.(),
        };
      }
      const astroCallbacks = astroCallbacksRef.current;
      for (let i = astros.length - 1; i >= 0; i--) {
        const a = astros[i];
        const result = updateAstronaut(a, singPos.x, singPos.y, planetInfos, astroBounds, dt, astroCallbacks);
        if (result.removed) {
          a.c.destroy({ children: true });
          astros.splice(i, 1);
          continue;
        }
        // Visual updates that depend on PixiJS container state
        if (a.inGravityWell) {
          const r = Math.sqrt((singPos.x - a.c.x) ** 2 + (singPos.y - a.c.y) ** 2);
          const shrink = Math.max(0.15, (r - 30) / (92 - 30));
          a.c.scale.set(shrink);
          a.c.alpha = shrink;
        } else {
          a.c.scale.set(0.6 + a.mass * 0.4);
          a.c.alpha = 1;
        }
        // Spawn jet spray particles if jet fired this tick
        if (result.jetFired) {
          const sprayAngle = result.jetAngle + Math.PI;
          const astroContainer = astronautsContainerRef.current;
          if (astroContainer) {
            const particleCount = 10 + Math.floor(Math.random() * 6);
            for (let pi = 0; pi < particleCount; pi++) {
              const pAngle = sprayAngle + (Math.random() - 0.5) * 1.0;
              const pSpeed = 2 + Math.random() * 3;
              const pg = jetSprayPoolRef.current?.acquire();
              if (!pg) continue;
              const pSize = 1.5 + Math.random() * 2.5;
              const pColors = [0xff6622, 0xff8822, 0xffaa33, 0xffcc44, 0xffeeaa];
              const pColor = pColors[Math.floor(Math.random() * pColors.length)];
              pg.circle(0, 0, pSize).fill({ color: pColor, alpha: 0.8 + Math.random() * 0.2 });
              pg.x = a.c.x; pg.y = a.c.y;
              astroContainer.addChild(pg);
              jetSprayRef.current.push({
                g: pg, x: a.c.x, y: a.c.y,
                vx: Math.cos(pAngle) * pSpeed, vy: Math.sin(pAngle) * pSpeed,
                life: 0, maxLife: 0.6 + Math.random() * 0.8,
              });
            }
          }
        }
      }

      // Jet spray particles (delegated to AstronautSystem)
      updateJetSpray(jetSprayRef.current, dt, (g) => jetSprayPoolRef.current?.release(g));

      // File collision — lightning arcs (delegated to LightningSystem)
      {
        const p0 = performance.now();
        updateLightning(sparksRef.current, lightningArcsRef.current, lightningLabelsRef.current, planetPositionsRef.current);
        phaseTimes.lightning += performance.now() - p0;
      }

      // Shooting stars (delegated to ShootingStarSystem)
      {
        const p0 = performance.now();
        updateShootingStars(shootingStarsRef.current, dt, (g) => shootingStarPoolRef.current?.release(g));
        phaseTimes.shooting += performance.now() - p0;
      }

      // UFO behaviour (delegated to UFOSystem)
      updateUFO(ufo, ufoStateRef.current, dt, {
        onAbduction: () => onUfoAbductionRef.current?.(),
        onConsumed: () => onUfoConsumedRef.current?.(),
        scheduleNext: scheduleUfo,
      });
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
        try { shootingStarPoolRef.current?.release(ss.g); } catch { /* ignore */ }
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

export const Universe = memo(UniverseImpl);
