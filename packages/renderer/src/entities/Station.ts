/**
 * MCP Server station — hexagonal entity orbiting a planet.
 * Size proportional to toolCount, color reflects connection status.
 * @event-horizon/renderer
 */

import { Container, Graphics } from 'pixi.js';

export interface StationProps {
  name: string;
  connected: boolean;
  toolCount: number;
}

const MIN_SIZE = 8;
const MAX_SIZE = 20;
const COLOR_CONNECTED = 0x40a060;
const COLOR_DISCONNECTED = 0xc65858;

export interface ExtendedStation extends Container {
  __stationName?: string;
  __connected?: boolean;
  __toolCount?: number;
  __orbitAngle?: number;
  __pulsePhase?: number;
  __isPulsing?: boolean;
}

/** Draw a regular hexagon centered at (0, 0) with given radius. */
function drawHexagon(g: Graphics, radius: number, color: number, alpha: number): void {
  const points: Array<[number, number]> = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6; // flat top
    points.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
  }
  g.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < 6; i++) {
    g.lineTo(points[i][0], points[i][1]);
  }
  g.closePath();
  g.fill({ color, alpha });
}

export function createStation(props: StationProps): ExtendedStation {
  const container = new Container() as ExtendedStation;
  const { name, connected, toolCount } = props;

  const size = Math.min(MAX_SIZE, MIN_SIZE + Math.log2(1 + (toolCount ?? 1)) * 3);
  const color = connected ? COLOR_CONNECTED : COLOR_DISCONNECTED;

  const g = new Graphics();
  drawHexagon(g, size / 2, color, 0.85);
  container.addChild(g);

  // Inner dot
  const dot = new Graphics();
  dot.circle(0, 0, size / 6);
  dot.fill({ color: 0xffffff, alpha: 0.4 });
  container.addChild(dot);

  container.__stationName = name;
  container.__connected = connected;
  container.__toolCount = toolCount;
  container.__orbitAngle = Math.random() * Math.PI * 2;
  container.__pulsePhase = 0;
  container.__isPulsing = false;

  return container;
}

/** Update station visual state (color, pulse). */
export function updateStationVisual(station: ExtendedStation, connected: boolean, isPulsing: boolean): void {
  station.__connected = connected;
  station.__isPulsing = isPulsing;
}
