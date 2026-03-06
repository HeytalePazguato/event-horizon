/**
 * Main PixiJS canvas + React wrapper for the cosmic universe.
 * @event-horizon/renderer
 */

import 'pixi.js/unsafe-eval';
import type { FC } from 'react';
import { useEffect, useRef, useState, useCallback } from 'react';
import { Application, Container } from 'pixi.js';
import { createStars } from './entities/Stars.js';
import { createSingularity } from './entities/Singularity.js';
import { createPlanet } from './entities/Planet.js';

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
  onPlanetHover?: (agentId: string | null) => void;
  onPlanetClick?: (agentId: string) => void;
  onReady?: (app: Application) => void;
}

const ORBIT_RADIUS = 140;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2;
const INITIAL_W = 640;
const INITIAL_H = 400;

export const Universe: FC<UniverseProps> = ({
  width = INITIAL_W,
  height = INITIAL_H,
  agents = [],
  metrics = {},
  selectedAgentId = null,
  onPlanetHover,
  onPlanetClick,
  onReady,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const worldRef = useRef<Container | null>(null);
  const singularityRef = useRef<Container | null>(null);
  const starsRef = useRef<Container | null>(null);
  const scaleRef = useRef(1);
  const posRef = useRef({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const initedRef = useRef(false);
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

        const stars = createStars(w, h);
        app.stage.addChild(stars);
        starsRef.current = stars;

        const world = new Container();
        world.x = w / 2;
        world.y = h / 2;
        app.stage.addChild(world);
        worldRef.current = world;

        const singularity = createSingularity({ x: w / 2, y: h / 2 });
        app.stage.addChild(singularity);
        singularityRef.current = singularity;

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
      worldRef.current = null;
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
    const world = worldRef.current;
    const singularity = singularityRef.current;
    if (!app || !world || !singularity) return;

    try {
      if (app.renderer) app.renderer.resize(width, height);
    } catch { /* ignore */ }

    const cx = width / 2;
    const cy = height / 2;
    world.x = cx + posRef.current.x;
    world.y = cy + posRef.current.y;
    singularity.x = cx;
    singularity.y = cy;
  }, [width, height, canvasReady]);

  useEffect(() => {
    const world = worldRef.current;
    if (!world) return;

    world.removeChildren();

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

      world.addChild(planet);
    });
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
    const world = worldRef.current;
    if (world) {
      const s = sizeRef.current;
      world.x = s.width / 2 + posRef.current.x;
      world.y = s.height / 2 + posRef.current.y;
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
