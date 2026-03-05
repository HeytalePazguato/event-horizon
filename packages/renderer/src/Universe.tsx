/**
 * Main PixiJS canvas + React wrapper for the cosmic universe.
 * @event-horizon/renderer
 */

import type { FC } from 'react';
import { useEffect, useRef } from 'react';
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

export const Universe: FC<UniverseProps> = ({
  width = 800,
  height = 600,
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
  const scaleRef = useRef(1);
  const posRef = useRef({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const app = new Application();
    appRef.current = app;

    void (async () => {
      await app.init({
        width,
        height,
        backgroundColor: 0x0a0a12,
        antialias: true,
      });

      el.appendChild(app.canvas);

      const centerX = width / 2;
      const centerY = height / 2;

      const starsLayer = createStars(width, height);
      app.stage.addChild(starsLayer);

      const singularity = createSingularity({ x: centerX, y: centerY });
      app.stage.addChild(singularity);

      const world = new Container();
      world.x = centerX;
      world.y = centerY;
      app.stage.addChild(world);
      worldRef.current = world;

      onReady?.(app);
    })();

    return () => {
      worldRef.current = null;
      app.destroy(true, { children: true });
      app.canvas.remove();
      appRef.current = null;
    };
  }, [width, height, onReady]);

  useEffect(() => {
    const app = appRef.current;
    const world = worldRef.current;
    if (!app || !world) return;

    world.removeChildren();

    const list = agents.length ? agents : [];
    list.forEach((agent, i) => {
      const angle = (i / Math.max(1, list.length)) * Math.PI * 2;
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

  useEffect(() => {
    const app = appRef.current;
    const el = containerRef.current;
    if (!app?.canvas || !el) return;

    const canvas = app.canvas;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const world = worldRef.current;
      if (!world) return;
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      scaleRef.current = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scaleRef.current + delta));
      world.scale.set(scaleRef.current);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button === 0) dragRef.current = { x: e.clientX - posRef.current.x, y: e.clientY - posRef.current.y };
    };

    const onPointerMove = (e: PointerEvent) => {
      if (dragRef.current) {
        posRef.current = { x: e.clientX - dragRef.current.x, y: e.clientY - dragRef.current.y };
        const world = worldRef.current;
        if (world) {
          world.x = width / 2 + posRef.current.x;
          world.y = height / 2 + posRef.current.y;
        }
      }
    };

    const onPointerUp = () => {
      dragRef.current = null;
    };

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
  }, [width, height]);

  return <div ref={containerRef} data-universe aria-label="Event Horizon universe" />;
};
