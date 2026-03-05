/**
 * Visible traffic route between agents (heavy collaboration).
 * @event-horizon/renderer
 */

import { Graphics } from 'pixi.js';

export interface TrafficRouteProps {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  intensity?: number;
}

const ROUTE_COLOR = 0x4488ff;
const MAX_ALPHA = 0.25;

export function createTrafficRoute(props: TrafficRouteProps): Graphics {
  const { fromX, fromY, toX, toY, intensity = 1 } = props;
  const g = new Graphics();
  g.moveTo(fromX, fromY).lineTo(toX, toY).stroke({
    width: 2,
    color: ROUTE_COLOR,
    alpha: MAX_ALPHA * intensity,
  });
  return g;
}
