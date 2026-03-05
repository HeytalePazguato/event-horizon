/**
 * Agent visualization (planet).
 * @event-horizon/renderer
 */

export interface PlanetProps {
  agentId: string;
  x: number;
  y: number;
  size: number;
  brightness: number;
}

export function createPlanet(_props: PlanetProps): void {
  // TODO: PixiJS display object for planet
}
