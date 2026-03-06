/**
 * Main PixiJS canvas + React wrapper for the cosmic universe.
 * @event-horizon/renderer
 */

import 'pixi.js/unsafe-eval';
import type { FC } from 'react';
import { useEffect, useRef, useState, useCallback } from 'react';
import { Application, Container, Graphics } from 'pixi.js';
import { createStars } from './entities/Stars.js';
import { createSingularity } from './entities/Singularity.js';
import { createPlanet } from './entities/Planet.js';
import { createAstronaut } from './entities/Astronaut.js';
import { createUfo } from './entities/Ufo.js';

export interface AgentView {
  id: string;
  name: string;
}

export interface MetricsView {
  load: number;
}

export interface UniverseProps {
  width?: number;
  height?: number;
  agents?: AgentView[];
  metrics?: Record<string, MetricsView>;
  selectedAgentId?: string | null;
  centerRequestedAt?: number;
  onPlanetHover?: (agentId: string | null) => void;
  onPlanetClick?: (agentId: string) => void;
  onReady?: (app: Application) => void;
}

const ORBIT_RADIUS = 140;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2;
const INITIAL_W = 640;
const INITIAL_H = 400;
const GRAVITY_STRENGTH = 0.15;
const SINGULARITY_PULL = 0.4;
const ASTRONAUT_MAX_SPEED = 3;
const UFO_INTERVAL_MIN_MS = 25000;
const UFO_INTERVAL_MAX_MS = 55000;

export const Universe: FC<UniverseProps> = ({
  width = INITIAL_W,
  height = INITIAL_H,
  agents = [],
  metrics = {},
  selectedAgentId = null,
  centerRequestedAt = 0,
  onPlanetHover,
  onPlanetClick,
  onReady,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const panContainerRef = useRef<Container | null>(null);
  const worldRef = useRef<Container | null>(null);
  const planetsContainerRef = useRef<Container | null>(null);
  const astronautsContainerRef = useRef<Container | null>(null);
  const singularityRef = useRef<Container | null>(null);
  const starsRef = useRef<Container | null>(null);
  const astronautsRef = useRef<Array<{ id: number; c: Container; vx: number; vy: number }>>([]);
  const ufoRef = useRef<Container | null>(null);
  const ufoStateRef = useRef<{
    phase: 'idle' | 'fly' | 'beam' | 'flyaway';
    t: number;
    targetX: number;
    targetY: number;
    startX?: number;
    startY?: number;
    cow?: Container;
    beam?: Container;
  }>({ phase: 'idle', t: 0, targetX: 0, targetY: 0 });
  const ufoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  const mountedRef = useRef(true);

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
        panContainer.addChild(stars);
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
        const astronautsContainer = new Container();
        world.addChild(astronautsContainer);
        astronautsContainerRef.current = astronautsContainer;
        const planetsContainer = new Container();
        world.addChild(planetsContainer);
        planetsContainerRef.current = planetsContainer;
        const spiralContainer = new Container();
        world.addChild(spiralContainer);
        spiralContainerRef.current = spiralContainer;
        const ufo = createUfo();
        world.addChild(ufo);
        ufoRef.current = ufo;
        panContainer.addChild(world);
        worldRef.current = world;

        const singularity = createSingularity({ x: 0, y: 0 });
        panContainer.addChild(singularity);
        singularityRef.current = singularity;

        hitArea.on('pointertap', (e: { global: { x: number; y: number } }) => {
          const pan = panContainerRef.current;
          if (!pan) return;
          const pos = pan.toLocal(e.global);
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
      spiralContainerRef.current = null;
      astronautsContainerRef.current = null;
      astronautsRef.current = [];
      spiralRef.current = [];
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

    if (stars && panContainer.removeChild(stars)) {
      try { stars.destroy({ children: true }); } catch { /* ignore */ }
    }
    const newStars = createStars(width * 2, height * 2);
    newStars.x = -width / 2;
    newStars.y = -height / 2;
    panContainer.addChildAt(newStars, 0);
    starsRef.current = newStars;
  }, [width, height, canvasReady]);

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

  useEffect(() => {
    const planetsContainer = planetsContainerRef.current;
    const spiralContainer = spiralContainerRef.current;
    if (!planetsContainer) return;

    const currentIds = new Set(agents.map((a) => a.id));
    const removedIds = new Set(prevAgentsRef.current.filter((a) => !currentIds.has(a.id)).map((a) => a.id));

    if (spiralContainer && removedIds.size > 0) {
      const children = planetsContainer.children.slice();
      for (const child of children) {
        const id = (child as Container & { __agentId?: string }).__agentId;
        if (id && removedIds.has(id)) {
          planetsContainer.removeChild(child);
          const dx = 0 - child.x;
          const dy = 0 - child.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const speed = 0.8;
          spiralRef.current.push({
            c: child as Container,
            vx: (dx / dist) * speed,
            vy: (dy / dist) * speed,
          });
          spiralContainer.addChild(child as Container);
        }
      }
    }

    planetsContainer.removeChildren();

    agents.forEach((agent, i) => {
      const angle = (i / Math.max(1, agents.length)) * Math.PI * 2;
      const x = Math.cos(angle) * ORBIT_RADIUS;
      const y = Math.sin(angle) * ORBIT_RADIUS;
      const m = metrics[agent.id];
      const load = m?.load ?? 0.5;
      const size = 12 + load * 8;
      const planet = createPlanet({
        agentId: agent.id,
        x,
        y,
        size,
        brightness: 0.3 + load * 0.7,
      });

      planet.on('pointerover', () => onPlanetHover?.(agent.id));
      planet.on('pointerout', () => onPlanetHover?.(null));
      planet.on('pointertap', () => onPlanetClick?.(agent.id));

      if (selectedAgentId && selectedAgentId !== agent.id) {
        planet.alpha = 0.4;
      }

      (planet as Container & { __radius?: number }).__radius = size;
      planetsContainer.addChild(planet);
    });

    prevAgentsRef.current = agents;
  }, [agents, metrics, selectedAgentId, onPlanetHover, onPlanetClick]);

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
        if (kids.length === 0) {
          scheduleUfo();
          return;
        }
        const planet = kids[Math.floor(Math.random() * kids.length)] as Container & { __radius?: number };
        const radius = planet.__radius ?? 18;
        const aboveOffset = radius + 48;
        ufo.visible = true;
        ufo.x = -250;
        ufo.y = -200;
        const beamChild = ufo.children[1];
        const cowChild = ufo.children[2];
        if (beamChild) beamChild.visible = false;
        if (cowChild) {
          (cowChild as Container).visible = false;
          (cowChild as Container).y = 22;
        }
        ufoStateRef.current = {
          phase: 'fly',
          t: 0,
          targetX: planet.x,
          targetY: planet.y - aboveOffset,
          cow: cowChild as Container,
          beam: beamChild as Container,
        };
        scheduleUfo();
      }, delay);
    };
    scheduleUfo();

    const tick = () => {
      if (!world || !planetsContainer) return;
      tickTimeRef.current += 0.016;
      const singPos = { x: 0, y: 0 };

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

      const pulse = 1 + 0.03 * Math.sin(tickTimeRef.current * 3);
      for (const p of planetsContainer.children as Container[]) {
        p.scale.set(pulse);
      }

      const astros = astronautsRef.current;
      const planets = planetsContainer.children as (Container & { __radius?: number })[];
      for (let i = astros.length - 1; i >= 0; i--) {
        const a = astros[i];
        let ax = 0;
        let ay = 0;
        const dx = singPos.x - a.c.x;
        const dy = singPos.y - a.c.y;
        const r2 = dx * dx + dy * dy + 1;
        const r = Math.sqrt(r2);
        const pull = (SINGULARITY_PULL / r2) * 60 * 0.016;
        ax += (dx / r) * pull;
        ay += (dy / r) * pull;
        let removed = false;
        for (const p of planets) {
          const px = p.x - a.c.x;
          const py = p.y - a.c.y;
          const pr2 = px * px + py * py + 1;
          const pr = Math.sqrt(pr2);
          const ppull = (GRAVITY_STRENGTH / pr2) * 60 * 0.016;
          ax += (px / pr) * ppull;
          ay += (py / pr) * ppull;
          const radius = p.__radius ?? 15;
          if (pr < radius + 10) {
            a.c.destroy({ children: true });
            astros.splice(i, 1);
            removed = true;
            break;
          }
        }
        if (removed) continue;
        if (r < 35) {
          a.c.destroy({ children: true });
          astros.splice(i, 1);
          continue;
        }
        a.vx += ax;
        a.vy += ay;
        const speed = Math.sqrt(a.vx * a.vx + a.vy * a.vy);
        if (speed > ASTRONAUT_MAX_SPEED) {
          a.vx = (a.vx / speed) * ASTRONAUT_MAX_SPEED;
          a.vy = (a.vy / speed) * ASTRONAUT_MAX_SPEED;
        }
        a.c.x += a.vx;
        a.c.y += a.vy;
        const sz = sizeRef.current;
        const scale = scaleRef.current;
        const pan = posRef.current;
        const left = -(sz.width / 2 + pan.x) / scale;
        const right = (sz.width / 2 - pan.x) / scale;
        const top = -(sz.height / 2 + pan.y) / scale;
        const bottom = (sz.height / 2 - pan.y) / scale;
        const margin = 8;
        if (a.c.x < left + margin) {
          a.c.x = left + margin;
          a.vx = Math.abs(a.vx) * 0.6;
        } else if (a.c.x > right - margin) {
          a.c.x = right - margin;
          a.vx = -Math.abs(a.vx) * 0.6;
        }
        if (a.c.y < top + margin) {
          a.c.y = top + margin;
          a.vy = Math.abs(a.vy) * 0.6;
        } else if (a.c.y > bottom - margin) {
          a.c.y = bottom - margin;
          a.vy = -Math.abs(a.vy) * 0.6;
        }
      }

      const ufoState = ufoStateRef.current;
      if (ufoState.phase === 'fly') {
        ufoState.t += 0.016;
        const t = Math.min(1, ufoState.t * 0.5);
        const ease = t * t * (3 - 2 * t);
        ufo.x = -250 + (ufoState.targetX - -250) * ease;
        ufo.y = -200 + (ufoState.targetY - -200) * ease;
        if (t >= 1) {
          ufoState.phase = 'beam';
          ufoState.t = 0;
          if (ufoState.beam) ufoState.beam.visible = true;
          if (ufoState.cow) ufoState.cow.visible = true;
        }
      } else if (ufoState.phase === 'beam') {
        ufoState.t += 0.016;
        const beamT = Math.min(1, ufoState.t / 1.2);
        const cow = ufoState.cow;
        if (cow) cow.y = 22 - beamT * 17;
        if (ufoState.t > 1.5) {
          if (ufoState.beam) ufoState.beam.visible = false;
          if (cow) {
            cow.visible = false;
            cow.y = 22;
          }
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
        const t = Math.min(1, ufoState.t * 0.6);
        const ease = t * t * (3 - 2 * t);
        const sx = ufoState.startX ?? ufo.x;
        const sy = ufoState.startY ?? ufo.y;
        ufo.x = sx + (ufoState.targetX - sx) * ease;
        ufo.y = sy + (ufoState.targetY - sy) * ease;
        if (t >= 1) {
          ufo.visible = false;
          ufoState.phase = 'idle';
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
    };
  }, [canvasReady]);

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
