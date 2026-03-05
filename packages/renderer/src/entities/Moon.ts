/**
 * Task visualization (moon).
 * @event-horizon/renderer
 */

export interface MoonProps {
  taskId: string;
  planetId: string;
  orbitSpeed: number;
  orbitDistance: number;
}

export function createMoon(_props: MoonProps): void {
  // TODO: PixiJS display object for moon
}
