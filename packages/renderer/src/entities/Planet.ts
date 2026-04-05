/**
 * Agent visualization (planet).
 *
 * Each variant is structurally distinct — not just recolored:
 *   gas      (claude-code)  large Jupiter-style: bands + Great Storm oval + ring arc
 *   icy      (copilot)      small, bright: polar ice caps + crystal facet lines
 *   rocky    (opencode)     medium: multiple impact craters with raised rims
 *   volcanic (unknown)      dark: lava crack veins + hot glow spots
 *
 * Size multipliers encode agent operating profile:
 *   gas=1.35×  icy=0.72×  rocky=1.0×  volcanic=1.12×
 *
 * State-driven visual children (__thinkingRing, __errorGlow) are created
 * hidden and toggled/animated by Universe.tsx each tick.
 * @event-horizon/renderer
 */

import { Container, Graphics } from 'pixi.js';

export type PlanetVariant = 'rocky' | 'gas' | 'icy' | 'volcanic' | 'ocean';

export interface PlanetProps {
  agentId: string;
  x: number;
  y: number;
  size: number;
  brightness: number;
  variant?: PlanetVariant;
  agentType?: string;
  /** Override the thinking ring color (hex number, e.g. 0x88aaff). */
  ringColorOverride?: number;
  /** Override the size multiplier instead of using SIZE_MULT. */
  sizeMultOverride?: number;
  /** When true, renders a star glow behind the planet (for orchestrator agents). */
  isOrchestrator?: boolean;
}

/** Per-variant size multipliers — encodes agent operating profile. */
const SIZE_MULT: Record<PlanetVariant, number> = {
  gas:      1.35,  // large context reasoner
  icy:      0.72,  // small fast autocomplete
  rocky:    1.0,   // medium tools-heavy
  volcanic: 1.12,  // experimental, slightly overloaded
  ocean:    0.92,  // fluid, IDE-native cursor agent
};

/** Ring color for the thinking-state orbiting dots, keyed by agentType. */
const THINKING_RING_COLORS: Record<string, number> = {
  'claude-code': 0x88aaff,
  'copilot':     0xcc88ff,
  'opencode':    0x88ffaa,
  'cursor':      0x44ddcc,
};
const DEFAULT_RING_COLOR = 0xaaccff;

/** Map agentType string to a planet variant. */
const AGENT_TYPE_VARIANT: Record<string, PlanetVariant> = {
  'claude-code': 'gas',
  'copilot':     'icy',
  'opencode':    'rocky',
  'cursor':      'ocean',
};

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export type ExtendedPlanet = Container & {
  __agentId?: string;
  __radius?: number;
  __variant?: PlanetVariant;
  __thinkingRing?: Container;
  __errorGlow?: Graphics;
  __waitingRing?: Graphics;
  __aura?: Graphics;
  __orchestratorGlow?: Graphics;
  __heartbeatRing?: Graphics;
};

/** Resolve the effective size multiplier (exported for testing). */
export function resolveSizeMult(variant: PlanetVariant, override?: number): number {
  return override ?? SIZE_MULT[variant];
}

/** Resolve the effective ring color (exported for testing). */
export function resolveRingColor(agentType?: string, override?: number): number {
  return override ?? (agentType ? THINKING_RING_COLORS[agentType] : undefined) ?? DEFAULT_RING_COLOR;
}

export function createPlanet(props: PlanetProps): ExtendedPlanet {
  const { x, y, size, brightness, agentId, agentType, ringColorOverride, sizeMultOverride, isOrchestrator } = props;

  const variant: PlanetVariant =
    props.variant ??
    (agentType ? AGENT_TYPE_VARIANT[agentType] : undefined) ??
    (['rocky', 'gas', 'icy', 'volcanic'] as const)[hash(agentId) % 4];

  const r = size * resolveSizeMult(variant, sizeMultOverride); // actual rendered radius

  const container = new Container() as ExtendedPlanet;
  container.x = x;
  container.y = y;
  container.eventMode = 'static';
  container.cursor = 'pointer';
  container.__agentId = agentId;
  container.__radius = r;
  container.__variant = variant;

  // ── Error glow (red, behind everything, hidden by default) ──────────────
  const errorGlow = new Graphics();
  errorGlow.circle(0, 0, r * 2.2).fill({ color: 0xff2200, alpha: 0.3 });
  errorGlow.visible = false;
  container.addChild(errorGlow);
  container.__errorGlow = errorGlow;

  // ── Orchestrator star glow (bright emission rays behind the planet) ──────
  if (isOrchestrator) {
    const starGlow = new Graphics();
    // Large soft golden glow
    starGlow.circle(0, 0, r * 2.8).fill({ color: 0xffcc44, alpha: 0.12 });
    starGlow.circle(0, 0, r * 2.0).fill({ color: 0xffdd66, alpha: 0.18 });
    // Emission rays (8 lines radiating out)
    const rayCount = 8;
    for (let i = 0; i < rayCount; i++) {
      const angle = (i / rayCount) * Math.PI * 2;
      const innerR = r * 1.3;
      const outerR = r * 2.5 + (i % 2 === 0 ? r * 0.5 : 0); // alternating long/short
      starGlow.moveTo(Math.cos(angle) * innerR, Math.sin(angle) * innerR)
        .lineTo(Math.cos(angle) * outerR, Math.sin(angle) * outerR)
        .stroke({ width: 1.5, color: 0xffcc44, alpha: 0.3 });
    }
    container.addChild(starGlow);
    container.__orchestratorGlow = starGlow;
  }

  switch (variant) {
    case 'gas':      drawGasGiant(container, r, brightness, agentId);      break;
    case 'icy':      drawIcyPlanet(container, r, brightness, agentId);     break;
    case 'rocky':    drawRockyPlanet(container, r, brightness, agentId);   break;
    case 'volcanic': drawVolcanicPlanet(container, r, brightness, agentId); break;
    case 'ocean':    drawOceanPlanet(container, r, brightness, agentId);   break;
  }

  // ── Colored aura (always visible — makes user color overrides obvious) ──
  const auraColor = resolveRingColor(agentType, ringColorOverride);
  const aura = new Graphics();
  aura.circle(0, 0, r * 1.35).fill({ color: auraColor, alpha: 0.12 });
  aura.circle(0, 0, r * 1.15).stroke({ width: 1.5, color: auraColor, alpha: 0.25 });
  container.addChild(aura);
  container.__aura = aura;

  // ── Waiting ring (amber pulsing ring, hidden by default) ────────────────
  const waitingRing = new Graphics();
  waitingRing.circle(0, 0, r * 1.8).stroke({ width: 2.5, color: 0xffaa33, alpha: 0.8 });
  waitingRing.circle(0, 0, r * 2.1).stroke({ width: 1.2, color: 0xffcc66, alpha: 0.4 });
  waitingRing.visible = false;
  container.addChild(waitingRing);
  container.__waitingRing = waitingRing;

  // ── Heartbeat pulse ring (alive=teal, stale=amber, lost=grey, hidden by default) ──
  const heartbeatRing = new Graphics();
  heartbeatRing.circle(0, 0, r * 1.6).stroke({ width: 1.5, color: 0x40a060, alpha: 0.5 });
  heartbeatRing.visible = false;
  heartbeatRing.alpha = 0;
  container.addChild(heartbeatRing);
  container.__heartbeatRing = heartbeatRing;

  // ── Thinking ring (orbiting dots, hidden by default) ────────────────────
  const ringColor = resolveRingColor(agentType, ringColorOverride);
  const ringContainer = new Container();
  const ringRadius = r * 2.0;
  const numDots = 8;
  const dotG = new Graphics();
  for (let i = 0; i < numDots; i++) {
    const a = (i / numDots) * Math.PI * 2;
    const dotSize = i % 2 === 0 ? 1.8 : 1.2;
    dotG.circle(Math.cos(a) * ringRadius, Math.sin(a) * ringRadius, dotSize)
        .fill({ color: ringColor, alpha: 0.9 });
  }
  ringContainer.addChild(dotG);
  ringContainer.visible = false;
  container.addChild(ringContainer);
  container.__thinkingRing = ringContainer;

  return container;
}

// ── Gas Giant (claude-code) ───────────────────────────────────────────────────
// Jupiter-style: multiple horizontal bands, Great Storm oval, faint ring arc.
// Large size encodes "massive reasoning context".
function drawGasGiant(c: Container, r: number, brightness: number, agentId: string) {
  // Ambient glow
  const glow = new Graphics();
  glow.circle(0, 0, r * 1.5).fill({ color: 0x604820, alpha: 0.35 * brightness });
  c.addChild(glow);

  // Body
  const body = new Graphics();
  body.circle(0, 0, r).fill({ color: 0xc8b090, alpha: 1 });
  c.addChild(body);

  // 3 horizontal cloud bands
  const bands = new Graphics();
  bands.ellipse(0, -r * 0.42, r * 0.98, r * 0.15).fill({ color: 0x907050, alpha: 0.88 });
  bands.ellipse(0,  r * 0.04, r * 0.99, r * 0.11).fill({ color: 0xd4c098, alpha: 0.70 });
  bands.ellipse(0,  r * 0.40, r * 0.92, r * 0.14).fill({ color: 0x7a5838, alpha: 0.85 });
  c.addChild(bands);

  // Great Storm oval (position seeded by agentId)
  const sx = ((hash(agentId + 'sx') % 100) / 100 - 0.5) * r * 0.35;
  const sy = ((hash(agentId + 'sy') % 100) / 100 - 0.5) * r * 0.25;
  const storm = new Graphics();
  storm.ellipse(sx, sy, r * 0.28, r * 0.18).fill({ color: 0xe07040, alpha: 0.92 });
  storm.ellipse(sx, sy, r * 0.17, r * 0.10).fill({ color: 0xf09868, alpha: 0.80 });
  c.addChild(storm);

  // Faint ring arc (tilted ellipses — hint of Saturn)
  const ring = new Graphics();
  ring.ellipse(0, 0, r * 1.75, r * 0.24).stroke({ width: 1.8, color: 0xc0a060, alpha: 0.28 });
  ring.ellipse(0, 0, r * 1.52, r * 0.20).stroke({ width: 1.0, color: 0xd8b870, alpha: 0.18 });
  c.addChild(ring);
}

// ── Icy Planet (copilot) ──────────────────────────────────────────────────────
// Small, bright, crystalline — polar ice caps + facet highlight lines.
// Small size encodes "fast reactive autocomplete".
function drawIcyPlanet(c: Container, r: number, brightness: number, agentId: string) {
  // Ambient glow (cold blue)
  const glow = new Graphics();
  glow.circle(0, 0, r * 1.4).fill({ color: 0x1a3a4a, alpha: 0.45 * brightness });
  c.addChild(glow);

  // Body
  const body = new Graphics();
  body.circle(0, 0, r).fill({ color: 0x7ac8e8, alpha: 1 });
  c.addChild(body);

  // Polar ice caps
  const caps = new Graphics();
  caps.ellipse(0, -r * 0.60, r * 0.56, r * 0.33).fill({ color: 0xddf6ff, alpha: 0.92 });
  caps.ellipse(0,  r * 0.65, r * 0.40, r * 0.22).fill({ color: 0xddf6ff, alpha: 0.76 });
  c.addChild(caps);

  // Crystal facet lines across the surface
  const numFacets = 4 + (hash(agentId + 'nf') % 3);
  const facets = new Graphics();
  for (let i = 0; i < numFacets; i++) {
    const a = (hash(agentId + 'fa' + i) % 314) / 100;
    const nx = Math.cos(a + Math.PI / 2);
    const ny = Math.sin(a + Math.PI / 2);
    facets
      .moveTo(-nx * r * 0.85, -ny * r * 0.85)
      .lineTo( nx * r * 0.85,  ny * r * 0.85)
      .stroke({ width: 0.8, color: 0xaaeeff, alpha: 0.40 });
  }
  c.addChild(facets);

  // Surface sheen
  const sheen = new Graphics();
  sheen.ellipse(-r * 0.24, -r * 0.26, r * 0.33, r * 0.19).fill({ color: 0xffffff, alpha: 0.18 });
  c.addChild(sheen);
}

// ── Rocky Planet (opencode) ───────────────────────────────────────────────────
// Medium, cratered — multiple impact craters with raised rims.
// Structure encodes "deterministic tools-heavy agent".
function drawRockyPlanet(c: Container, r: number, brightness: number, agentId: string) {
  // Ambient glow
  const glow = new Graphics();
  glow.circle(0, 0, r * 1.4).fill({ color: 0x3a2010, alpha: 0.35 * brightness });
  c.addChild(glow);

  // Body
  const body = new Graphics();
  body.circle(0, 0, r).fill({ color: 0x8b5a3c, alpha: 1 });
  // A couple of subtle surface patches for variation
  body.ellipse( r * 0.28, -r * 0.18, r * 0.38, r * 0.28).fill({ color: 0x7a5030, alpha: 0.40 });
  body.ellipse(-r * 0.20,  r * 0.30, r * 0.32, r * 0.22).fill({ color: 0x9a6848, alpha: 0.30 });
  c.addChild(body);

  // 4 impact craters: outer rim → inner floor → shadow
  const numCraters = 4;
  const craters = new Graphics();
  for (let i = 0; i < numCraters; i++) {
    const angle = (hash(agentId + 'ca' + i) % 628) / 100;
    const dist  = r * 0.12 + (hash(agentId + 'cd' + i) % 60) / 100 * r * 0.56;
    const cx = Math.cos(angle) * dist;
    const cy = Math.sin(angle) * dist;
    const cr = r * (0.09 + (hash(agentId + 'cs' + i) % 40) / 100 * 0.10);
    craters.circle(cx, cy, cr + cr * 0.45).fill({ color: 0xa07050, alpha: 0.80 }); // raised rim
    craters.circle(cx, cy, cr).fill({ color: 0x5a3820, alpha: 0.95 });              // crater floor
    craters.arc(cx + cr * 0.1, cy + cr * 0.1, cr * 0.8, 0.3, Math.PI + 0.3)
           .fill({ color: 0x000000, alpha: 0.22 });                                  // shadow
  }
  c.addChild(craters);

  // Highlight
  const sheen = new Graphics();
  sheen.ellipse(-r * 0.3, -r * 0.3, r * 0.3, r * 0.17).fill({ color: 0xc08060, alpha: 0.22 });
  c.addChild(sheen);
}

// ── Ocean Planet (cursor) ─────────────────────────────────────────────────────
// Blue-teal water world: deep ocean base, swirling current arcs, small green
// landmasses, white surf highlights. Fluid + IDE-native feel.
function drawOceanPlanet(c: Container, r: number, brightness: number, agentId: string) {
  // Ambient glow (teal-cyan)
  const glow = new Graphics();
  glow.circle(0, 0, r * 1.42).fill({ color: 0x083844, alpha: 0.55 * brightness });
  c.addChild(glow);

  // Deep ocean body
  const body = new Graphics();
  body.circle(0, 0, r).fill({ color: 0x0e7090, alpha: 1 });
  // Deeper trench patches
  body.ellipse(-r * 0.22, r * 0.18, r * 0.44, r * 0.30).fill({ color: 0x085870, alpha: 0.55 });
  body.ellipse( r * 0.30, -r * 0.25, r * 0.36, r * 0.24).fill({ color: 0x0a6880, alpha: 0.45 });
  c.addChild(body);

  // Swirling current arcs — the defining structural feature
  const currents = new Graphics();
  const numCurrents = 3 + (hash(agentId + 'nc') % 2);
  for (let i = 0; i < numCurrents; i++) {
    const startA = (hash(agentId + 'cs' + i) % 628) / 100;
    const sweep  = 1.4 + (hash(agentId + 'sw' + i) % 80) / 100;
    const dist   = r * (0.30 + (hash(agentId + 'cd' + i) % 50) / 100 * 0.45);
    const pts = 20;
    for (let j = 0; j < pts - 1; j++) {
      const a0 = startA + (j / pts) * sweep;
      const a1 = startA + ((j + 1) / pts) * sweep;
      currents
        .moveTo(Math.cos(a0) * dist, Math.sin(a0) * dist)
        .lineTo(Math.cos(a1) * dist, Math.sin(a1) * dist)
        .stroke({ width: 1.0, color: 0x3ab8d0, alpha: 0.50 });
    }
  }
  c.addChild(currents);

  // Small land/island patches (2-3)
  const numLands = 2 + (hash(agentId + 'nl') % 2);
  const lands = new Graphics();
  for (let i = 0; i < numLands; i++) {
    const a  = (hash(agentId + 'la' + i) % 628) / 100;
    const d  = r * (0.08 + (hash(agentId + 'ld' + i) % 55) / 100 * 0.50);
    const lx = Math.cos(a) * d;
    const ly = Math.sin(a) * d;
    const lr = r * (0.08 + (hash(agentId + 'ls' + i) % 30) / 100 * 0.09);
    lands.ellipse(lx, ly, lr, lr * 0.75).fill({ color: 0x2a8040, alpha: 0.80 });
    // Beach fringe
    lands.ellipse(lx, ly, lr + lr * 0.4, lr * 0.75 + lr * 0.3).fill({ color: 0xd4b870, alpha: 0.30 });
  }
  c.addChild(lands);

  // Surf/wave highlights along coastlines
  const surf = new Graphics();
  surf.circle(0, 0, r * 0.88).stroke({ width: 0.9, color: 0x88eeff, alpha: 0.20 });
  surf.circle(0, 0, r * 0.94).stroke({ width: 0.6, color: 0xaaf4ff, alpha: 0.14 });
  c.addChild(surf);

  // Polar sheen (top-left highlight)
  const sheen = new Graphics();
  sheen.ellipse(-r * 0.25, -r * 0.28, r * 0.32, r * 0.18).fill({ color: 0xffffff, alpha: 0.16 });
  c.addChild(sheen);
}

// ── Volcanic Planet (unknown) ─────────────────────────────────────────────────
// Dark with lava crack veins + hot glow spots.
// Structure encodes "error-prone / experimental agent".
function drawVolcanicPlanet(c: Container, r: number, brightness: number, agentId: string) {
  // Ambient glow (hot red-orange)
  const glow = new Graphics();
  glow.circle(0, 0, r * 1.48).fill({ color: 0x501010, alpha: 0.55 * brightness });
  c.addChild(glow);

  // Body (dark basalt)
  const body = new Graphics();
  body.circle(0, 0, r).fill({ color: 0x281410, alpha: 1 });
  body.ellipse( r * 0.28, -r * 0.18, r * 0.42, r * 0.30).fill({ color: 0x381c14, alpha: 0.55 });
  body.ellipse(-r * 0.18,  r * 0.28, r * 0.36, r * 0.24).fill({ color: 0x180c08, alpha: 0.50 });
  c.addChild(body);

  // Lava crack veins (radiating from near-center)
  const numCracks = 4 + (hash(agentId + 'nc') % 3);
  const cracks = new Graphics();
  for (let i = 0; i < numCracks; i++) {
    const a   = (i / numCracks) * Math.PI * 2 + (hash(agentId + 'ca' + i) % 100) / 100 * 0.8;
    const len = r * (0.42 + (hash(agentId + 'cl' + i) % 40) / 100 * 0.42);
    const x0 = Math.cos(a) * r * 0.12;
    const y0 = Math.sin(a) * r * 0.12;
    const x1 = Math.cos(a) * len;
    const y1 = Math.sin(a) * len;
    cracks.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 1.4, color: 0xff6622, alpha: 0.85 });
    cracks.moveTo(x0, y0).lineTo(x1 * 0.65, y1 * 0.65).stroke({ width: 0.6, color: 0xffcc88, alpha: 0.70 });
  }
  c.addChild(cracks);

  // Hot spots at crack intersections
  const numSpots = 2 + (hash(agentId + 'hs') % 3);
  const spots = new Graphics();
  for (let i = 0; i < numSpots; i++) {
    const a = (hash(agentId + 'hsa' + i) % 628) / 100;
    const d = (hash(agentId + 'hsd' + i) % 70) / 100 * r * 0.68;
    spots.circle(Math.cos(a) * d, Math.sin(a) * d, r * 0.065)
         .fill({ color: 0xff9944, alpha: 0.92 });
  }
  c.addChild(spots);
}
