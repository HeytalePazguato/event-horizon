/**
 * Debris System — manage plan task debris orbiting planets.
 * Each plan task spawns an orbital debris fragment around its associated planet.
 * Extracted as a standalone system (Phase K — Plan Visualization).
 * @event-horizon/renderer
 */

import { Container, Graphics } from 'pixi.js';
import { createDebris, updateDebrisStatus } from '../entities/Debris.js';
import type { DebrisStatus, ExtendedDebris } from '../entities/Debris.js';

export interface PlanTaskDebris {
  id: string;
  status: DebrisStatus;
  assigneeId: string | null;
  role: string | null;
  retryCount?: number;
  failedReason?: string | null;
  blockedBy?: string[];
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
 * - Dependency tethers: lines between debris with blockedBy relationships
 * - Critical path glow: tasks on longest dependency chain glow brighter
 * - Cascade failure zigzag: red lightning line between cascade-failed debris and its dependency
 * - Completed chain stardust: tether fades out when both tasks are done
 */
export function updateDebris(
  debrisContainer: Container,
  posMap: Map<string, { x: number; y: number }>,
  plan: DebrisPlan | null,
  prevTaskIds: Set<string>,
  tickTime: number,
  tetherGraphics?: Graphics | null,
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
      role: task.role,
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

    // Track retry count for animation
    debris.__retryCount = task.retryCount ?? 0;
    debris.__failedReason = task.failedReason ?? null;

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
      if ((debris.__retryCount ?? 0) > 0) {
        // Retry pulse — alternating red and gold (task was retried before, may retry again)
        const pulse = Math.sin(tickTime * 4 + phase);
        debris.alpha = 0.6 + 0.4 * Math.abs(pulse);
        debris.tint = pulse > 0 ? 0xff8844 : 0xc65858; // gold / red
      } else if (debris.__failedReason?.startsWith('Cascade')) {
        // Cascade failure — rapid red pulse, dimmer than root failure (propagated failure)
        debris.alpha = 0.3 + 0.4 * Math.abs(Math.sin(tickTime * 8 + phase));
        debris.tint = 0xaa3333; // darker red for cascade
      } else {
        // Flash red — standard failure (root cause)
        debris.alpha = 0.4 + 0.5 * Math.abs(Math.sin(tickTime * 6 + phase));
      }
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

  // ── Dependency tethers ────────────────────────────────────────────────────
  if (tetherGraphics && plan && plan.tasks.length > 0) {
    tetherGraphics.clear();

    // Build a position map of debris by taskId
    const debrisPosMap = new Map<string, { x: number; y: number }>();
    for (const child of debrisContainer.children) {
      const d = child as ExtendedDebris;
      if (d.__taskId) {
        debrisPosMap.set(d.__taskId, { x: d.x, y: d.y });
      }
    }

    // Compute critical path depth (transitive dependent count) for glow brightness
    const depCountMap = new Map<string, number>();
    const taskById = new Map(plan.tasks.map((t) => [t.id, t]));

    function countDependents(taskId: string, visited: Set<string>): number {
      if (visited.has(taskId)) return 0;
      visited.add(taskId);
      let count = 0;
      for (const t of plan!.tasks) {
        if (t.blockedBy?.includes(taskId)) {
          count += 1 + countDependents(t.id, visited);
        }
      }
      return count;
    }

    for (const task of plan.tasks) {
      depCountMap.set(task.id, countDependents(task.id, new Set()));
    }
    const maxDeps = Math.max(1, ...Array.from(depCountMap.values()));

    // Draw tethers
    for (const task of plan.tasks) {
      if (!task.blockedBy || task.blockedBy.length === 0) continue;
      const taskPos = debrisPosMap.get(task.id);
      if (!taskPos) continue;

      for (const depId of task.blockedBy) {
        const depPos = debrisPosMap.get(depId);
        if (!depPos) continue;

        const depTask = taskById.get(depId);
        const bothDone = task.status === 'done' && depTask?.status === 'done';

        // Cascade failure zigzag
        if (task.failedReason?.startsWith('Cascade') && depTask?.status === 'failed') {
          const dx = taskPos.x - depPos.x;
          const dy = taskPos.y - depPos.y;
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          const perpX = -dy / len;
          const perpY = dx / len;
          const segments = 8;

          tetherGraphics.moveTo(depPos.x, depPos.y);
          for (let s = 1; s < segments; s++) {
            const frac = s / segments;
            const baseX = depPos.x + dx * frac;
            const baseY = depPos.y + dy * frac;
            const jitter = (s % 2 === 0 ? 1 : -1) * Math.sin(frac * Math.PI) * len * 0.12;
            tetherGraphics.lineTo(baseX + perpX * jitter, baseY + perpY * jitter);
          }
          tetherGraphics.lineTo(taskPos.x, taskPos.y);
          tetherGraphics.stroke({ width: 1.2, color: 0xcc3333, alpha: 0.6 + 0.3 * Math.abs(Math.sin(tickTime * 5)) });
          continue;
        }

        // Completed chain stardust — fade out tether
        if (bothDone) {
          const fadeAlpha = Math.max(0, 0.15 - (tickTime % 30) * 0.005);
          if (fadeAlpha > 0.01) {
            tetherGraphics.moveTo(depPos.x, depPos.y);
            tetherGraphics.lineTo(taskPos.x, taskPos.y);
            tetherGraphics.stroke({ width: 0.5, color: 0x40a060, alpha: fadeAlpha });
          }
          continue;
        }

        // Normal tether — brightness based on critical path depth
        const depCount = depCountMap.get(depId) ?? 0;
        const criticalFactor = depCount / maxDeps;
        const alpha = 0.15 + criticalFactor * 0.35;

        tetherGraphics.moveTo(depPos.x, depPos.y);
        tetherGraphics.lineTo(taskPos.x, taskPos.y);
        tetherGraphics.stroke({
          width: 0.6 + criticalFactor * 0.6,
          color: criticalFactor > 0.6 ? 0xd4a84a : 0x4a7a58,
          alpha,
        });
      }
    }
  }
}
