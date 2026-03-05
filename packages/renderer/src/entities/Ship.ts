/**
 * Data transfer visualization (spaceship).
 * For many ships, use object pooling and reuse containers (performance).
 * @event-horizon/renderer
 */

import { Container, Graphics } from 'pixi.js';

export interface ShipProps {
  fromAgentId: string;
  toAgentId: string;
  payloadSize: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

const MIN_SIZE = 4;
const MAX_SIZE = 12;
const SHIP_COLOR = 0xffdd88;

export function createShip(props: ShipProps): Container {
  const { fromX, fromY, toX, toY, payloadSize } = props;
  const container = new Container();

  const size = Math.min(MAX_SIZE, MIN_SIZE + Math.log2(1 + payloadSize));
  const g = new Graphics();
  g.moveTo(size, 0).lineTo(-size, size).lineTo(-size, -size).closePath().fill({ color: SHIP_COLOR, alpha: 0.9 });
  container.addChild(g);

  container.x = fromX;
  container.y = fromY;
  (container as Container & { __toX?: number }).__toX = toX;
  (container as Container & { __toY?: number }).__toY = toY;
  (container as Container & { __fromAgentId?: string }).__fromAgentId = props.fromAgentId;
  (container as Container & { __toAgentId?: string }).__toAgentId = props.toAgentId;

  return container;
}
