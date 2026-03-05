/**
 * Main PixiJS canvas + React wrapper for the cosmic universe.
 * @event-horizon/renderer
 */

import type { FC } from 'react';
import { useEffect, useRef } from 'react';
import { Application } from 'pixi.js';
import { createStars } from './entities/Stars.js';
import { createSingularity } from './entities/Singularity.js';

export interface UniverseProps {
  width?: number;
  height?: number;
  onReady?: (app: Application) => void;
}

export const Universe: FC<UniverseProps> = ({
  width = 800,
  height = 600,
  onReady,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);

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

      onReady?.(app);
    })();

    return () => {
      app.destroy(true, { children: true });
      app.canvas.remove();
      appRef.current = null;
    };
  }, [width, height, onReady]);

  return <div ref={containerRef} data-universe aria-label="Event Horizon universe" />;
};
