/**
 * Moon (subagent) system — manage + animate orbiting moons.
 * Extracted from Universe.tsx ticker (Phase F — 6.4.8).
 */

import type { Container } from 'pixi.js';
import { createMoon } from '../entities/Moon.js';

type MoonExt = Container & {
  __planetId?: string;
  __orbitSpeed?: number;
  __orbitDistance?: number;
  __orbitAngle?: number;
  __taskId?: string;
  __moonIndex?: number;
};

/**
 * Sync moon count per agent and animate orbits.
 * Incrementally adds/removes moons only when counts change.
 */
export function updateMoons(
  moonsContainer: Container,
  posMap: Map<string, { x: number; y: number }>,
  subCounts: Record<string, number>,
  prevCounts: Map<string, number>,
): void {
  // Add/remove moons
  for (const [agentId] of posMap) {
    const want = Math.min(subCounts[agentId] ?? 0, 6);
    const have = prevCounts.get(agentId) ?? 0;
    if (want === have) continue;

    if (want > have) {
      const parentPos = posMap.get(agentId);
      if (parentPos) {
        for (let mi = have; mi < want; mi++) {
          const orbitDistance = 28 + mi * 12;
          const orbitSpeed = 0.012 + mi * 0.004;
          const moon = createMoon({ taskId: `${agentId}-sub-${mi}`, planetId: agentId, orbitSpeed, orbitDistance });
          const initAngle = Math.random() * Math.PI * 2;
          (moon as MoonExt).__orbitAngle = initAngle;
          moon.x = parentPos.x + Math.cos(initAngle) * orbitDistance;
          moon.y = parentPos.y + Math.sin(initAngle) * orbitDistance;
          (moon as MoonExt).__moonIndex = mi;
          moonsContainer.addChild(moon);
        }
      }
    } else {
      const agentMoons = moonsContainer.children
        .filter((c) => (c as MoonExt).__planetId === agentId) as MoonExt[];
      agentMoons.sort((a, b) => (b.__moonIndex ?? 0) - (a.__moonIndex ?? 0));
      const toRemove = have - want;
      for (let ri = 0; ri < toRemove && ri < agentMoons.length; ri++) {
        moonsContainer.removeChild(agentMoons[ri]);
        agentMoons[ri].destroy({ children: true });
      }
    }
    prevCounts.set(agentId, want);
  }

  // Remove moons for agents that no longer exist
  for (const [agentId] of prevCounts) {
    if (!posMap.has(agentId)) {
      for (let ci = moonsContainer.children.length - 1; ci >= 0; ci--) {
        const child = moonsContainer.children[ci] as MoonExt;
        if (child.__planetId === agentId) {
          moonsContainer.removeChild(child);
          child.destroy({ children: true });
        }
      }
      prevCounts.delete(agentId);
    }
  }

  // Animate orbits
  for (const moon of moonsContainer.children) {
    const em = moon as MoonExt;
    const parentPos = em.__planetId ? posMap.get(em.__planetId) : null;
    if (!parentPos) continue;
    const angle = (em.__orbitAngle ?? 0) + (em.__orbitSpeed ?? 0.01);
    em.__orbitAngle = angle;
    const dist = em.__orbitDistance ?? 28;
    moon.x = parentPos.x + Math.cos(angle) * dist;
    moon.y = parentPos.y + Math.sin(angle) * dist;
  }
}
