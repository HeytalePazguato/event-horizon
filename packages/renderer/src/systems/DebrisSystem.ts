/**
 * Debris System — manage plan task debris orbiting planets.
 * Each plan task spawns an orbital debris fragment around its associated planet.
 * Extracted as a standalone system (Phase K — Plan Visualization).
 * @event-horizon/renderer
 */

import type { Container } from 'pixi.js';
import { createDebris, updateDebrisStatus } from '../entities/Debris.js';
import type { DebrisStatus, ExtendedDebris } from '../entities/Debris.js';

export interface PlanTaskDebris {
  id: string;
  status: DebrisStatus;
  assigneeId: string | null;
}

export interface DebrisPlan {
  tasks: PlanTaskDebris[];
  /** Agent ID of whoever loaded the plan — debris orbits this planet. */
  sourceAgentId?: string;
}

/**
 * Sync debris with plan task state and animate orbits.
 * - New tasks → spawn debris
 * - Removed tasks → destroy debris
 * - Status changes → update visuals
 * - Every frame: orbit animation + status-specific effects
 */
export function updateDebris(
  debrisContainer: Container,
  posMap: Map<string, { x: number; y: number }>,
  plan: DebrisPlan | null,
  prevTaskIds: Set<string>,
  tickTime: number,
): void {
  if (!plan || plan.tasks.length === 0) {
    // No plan — destroy all debris
    if (debrisContainer.children.length > 0) {
      for (let i = debrisContainer.children.length - 1; i >= 0; i--) {
        const child = debrisContainer.children[i];
        debrisContainer.removeChild(child);
        child.destroy({ children: true });
      }
      prevTaskIds.clear();
    }
    return;
  }

  const taskMap = new Map(plan.tasks.map((t) => [t.id, t]));
  const currentIds = new Set(taskMap.keys());

  // Find the center planet — prefer sourceAgentId, else use first planet
  let centerPos: { x: number; y: number } | null = null;
  if (plan.sourceAgentId) {
    centerPos = posMap.get(plan.sourceAgentId) ?? null;
  }
  // Fallback: use the center of all planets
  if (!centerPos && posMap.size > 0) {
    let cx = 0, cy = 0;
    for (const pos of posMap.values()) { cx += pos.x; cy += pos.y; }
    centerPos = { x: cx / posMap.size, y: cy / posMap.size };
  }
  if (!centerPos) return;

  // Remove debris for tasks that no longer exist
  for (const id of prevTaskIds) {
    if (!currentIds.has(id)) {
      for (let i = debrisContainer.children.length - 1; i >= 0; i--) {
        const child = debrisContainer.children[i] as ExtendedDebris;
        if (child.__taskId === id) {
          debrisContainer.removeChild(child);
          child.destroy({ children: true });
        }
      }
      prevTaskIds.delete(id);
    }
  }

  // Add debris for new tasks
  let taskIndex = prevTaskIds.size;
  for (const [id, task] of taskMap) {
    if (prevTaskIds.has(id)) continue;

    const orbitDistance = 50 + (taskIndex % 12) * 8 + Math.random() * 6;
    const orbitSpeed = 0.003 + (taskIndex % 5) * 0.001 + Math.random() * 0.002;
    const size = 2 + Math.random() * 2;

    const debris = createDebris({
      taskId: id,
      status: task.status,
      orbitDistance,
      orbitSpeed: task.status === 'done' ? orbitSpeed * 0.3 : orbitSpeed,
      size,
    });

    // If task is claimed/in_progress by an agent, orbit that agent's planet instead
    if (task.assigneeId && posMap.has(task.assigneeId)) {
      debris.__parentAgentId = task.assigneeId;
    }

    debrisContainer.addChild(debris);
    prevTaskIds.add(id);
    taskIndex++;
  }

  // Update existing debris status + animation
  for (const child of debrisContainer.children) {
    const debris = child as ExtendedDebris;
    if (!debris.__taskId) continue;

    const task = taskMap.get(debris.__taskId);
    if (!task) continue;

    // Update status visuals if changed
    updateDebrisStatus(debris, task.status);

    // Update parent agent assignment
    if (task.assigneeId && posMap.has(task.assigneeId)) {
      debris.__parentAgentId = task.assigneeId;
    } else if (!task.assigneeId) {
      debris.__parentAgentId = undefined;
    }

    // Determine orbit center
    const orbitCenter = debris.__parentAgentId
      ? (posMap.get(debris.__parentAgentId) ?? centerPos)
      : centerPos;

    if (!orbitCenter) continue;

    // Orbit animation
    const speed = debris.__orbitSpeed ?? 0.005;
    const angle = (debris.__orbitAngle ?? 0) + speed;
    debris.__orbitAngle = angle;
    const dist = debris.__orbitDistance ?? 50;
    debris.x = orbitCenter.x + Math.cos(angle) * dist;
    debris.y = orbitCenter.y + Math.sin(angle) * dist;

    // Status-specific animation effects
    const phase = debris.__flashPhase ?? 0;

    if (task.status === 'in_progress') {
      // Pulsing glow — breathing effect
      debris.alpha = 0.7 + 0.3 * Math.sin(tickTime * 3 + phase);
    } else if (task.status === 'failed') {
      // Flash red
      debris.alpha = 0.4 + 0.5 * Math.abs(Math.sin(tickTime * 6 + phase));
    } else if (task.status === 'done') {
      // Slow drift outward + fade (completed tasks slowly dissipate)
      debris.alpha = Math.max(0.15, (debris.__baseAlpha ?? 0.5) - 0.001);
      debris.__baseAlpha = debris.alpha;
      if (debris.__orbitDistance !== undefined) {
        debris.__orbitDistance += 0.01; // slowly spiral outward
      }
    } else if (task.status === 'blocked') {
      // Dim, slight jitter
      debris.alpha = 0.4 + 0.1 * Math.sin(tickTime * 1.5 + phase);
    } else if (task.status === 'claimed') {
      // Steady glow
      debris.alpha = 0.75 + 0.15 * Math.sin(tickTime * 2 + phase);
    } else {
      // Pending — default
      debris.alpha = debris.__baseAlpha ?? 0.85;
    }
  }
}
