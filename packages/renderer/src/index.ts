/**
 * @event-horizon/renderer
 */

export { Universe } from './Universe.js';
export type { UniverseProps } from './Universe.js';
export { createPlanet } from './entities/Planet.js';
export type { PlanetProps } from './entities/Planet.js';
export { createMoon } from './entities/Moon.js';
export type { MoonProps } from './entities/Moon.js';
export { createShip } from './entities/Ship.js';
export type { ShipProps } from './entities/Ship.js';
export { createSingularity } from './entities/Singularity.js';
export type { SingularityProps } from './entities/Singularity.js';
export { createStars } from './entities/Stars.js';
export { createPulseWave, updatePulseWave } from './effects/PulseWave.js';
export { createSolarFlare, updateSolarFlare } from './effects/SolarFlare.js';
export { createTrafficRoute } from './effects/TrafficRoute.js';
export type { TrafficRouteProps } from './effects/TrafficRoute.js';
