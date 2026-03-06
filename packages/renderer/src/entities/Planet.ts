/**
 * Agent visualization (planet) — diverse types: rocky, gas, icy, volcanic.
 * StarCraft-style star map look with distinct colors and simple detail.
 * @event-horizon/renderer
 */

import { Container, Graphics } from 'pixi.js';

export type PlanetVariant = 'rocky' | 'gas' | 'icy' | 'volcanic';

export interface PlanetProps {
  agentId: string;
  x: number;
  y: number;
  size: number;
  brightness: number;
  variant?: PlanetVariant;
}

const VARIANTS: Record<
  PlanetVariant,
  { base: number; band?: number; spot?: number; glow: number }
> = {
  rocky: { base: 0x8b5a3c, band: 0x6b4428, spot: 0xa07050, glow: 0x4a3020 },
  gas: { base: 0x6ba3c4, band: 0x4a8aa8, spot: 0x8cc8e0, glow: 0x2a5070 },
  icy: { base: 0x5a9aa8, band: 0x3a7a8a, spot: 0x7ac0d0, glow: 0x204050 },
  volcanic: { base: 0xc05040, band: 0x903830, spot: 0xe07050, glow: 0x502020 },
};

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function createPlanet(props: PlanetProps): Container {
  const { x, y, size, brightness, agentId } = props;
  const variant: PlanetVariant =
    props.variant ?? (['rocky', 'gas', 'icy', 'volcanic'] as const)[hash(agentId) % 4];
  const v = VARIANTS[variant];

  const container = new Container();
  container.x = x;
  container.y = y;
  container.eventMode = 'static';
  container.cursor = 'pointer';
  (container as Container & { __agentId?: string }).__agentId = agentId;

  const glowRadius = size * 1.4;
  const glow = new Graphics();
  glow.circle(0, 0, glowRadius).fill({
    color: v.glow,
    alpha: 0.25 * brightness,
  });
  container.addChild(glow);

  const body = new Graphics();
  body.circle(0, 0, size).fill({
    color: v.base,
    alpha: 0.85 + 0.15 * brightness,
  });
  container.addChild(body);

  if (v.band !== undefined) {
    const band = new Graphics();
    const bandWidth = size * 0.15;
    const bandY = (hash(agentId + '1') % 100) / 100 * size * 0.6 - size * 0.3;
    band.ellipse(0, bandY, size * 0.9, bandWidth).fill({
      color: v.band,
      alpha: 0.6,
    });
    container.addChild(band);
  }

  if (v.spot !== undefined) {
    const spot = new Graphics();
    const sx = ((hash(agentId + '2') % 100) / 100 - 0.5) * size * 0.8;
    const sy = ((hash(agentId + '3') % 100) / 100 - 0.5) * size * 0.8;
    const spotR = size * 0.25;
    spot.circle(sx, sy, spotR).fill({
      color: v.spot,
      alpha: 0.5,
    });
    container.addChild(spot);
  }

  return container;
}
