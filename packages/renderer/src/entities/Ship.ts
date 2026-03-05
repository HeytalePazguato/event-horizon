/**
 * Data transfer visualization (spaceship).
 * @event-horizon/renderer
 */

export interface ShipProps {
  fromAgentId: string;
  toAgentId: string;
  payloadSize: number;
}

export function createShip(_props: ShipProps): void {
  // TODO: PixiJS display object for ship
}
