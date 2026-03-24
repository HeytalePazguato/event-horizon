/**
 * Input handler — pointer events for pan, zoom, planet drag, belt drag.
 * Extracted from Universe.tsx (Phase F — 6.4.8).
 */

import type { Container } from 'pixi.js';
import type { ExtendedPlanet } from '../entities/Planet.js';
import { PLANET_MIN_RADIUS, MIN_PIXEL_DIST } from '../math.js';
import type { WorkspaceGroup } from '../math.js';

export interface InputRefs {
  scaleRef: { current: number };
  posRef: { current: { x: number; y: number } };
  sizeRef: { current: { width: number; height: number } };
  dragRef: { current: { x: number; y: number } | null };
  planetDragRef: { current: { agentId: string; startX: number; startY: number; moved: boolean } | null };
  beltDragRef: { current: { agentIds: string[]; startX: number; startY: number } | null };
  worldRef: { current: Container | null };
  panContainerRef: { current: Container | null };
  starsRef: { current: Container | null };
  planetsContainerRef: { current: Container | null };
  beltsContainerRef: { current: Container | null };
  planetPositionsRef: { current: Map<string, { x: number; y: number }> };
  customPositionsRef: { current: Map<string, { x: number; y: number }> };
  workspaceGroupsRef: { current: WorkspaceGroup[] };
  drawAsteroidBelt: (positions: Array<{ x: number; y: number }>, agentIds: string[]) => Container;
}

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2;

export function handleWheel(e: WheelEvent, refs: InputRefs): void {
  e.preventDefault();
  const world = refs.worldRef.current;
  if (!world) return;
  const delta = e.deltaY > 0 ? -0.1 : 0.1;
  refs.scaleRef.current = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, refs.scaleRef.current + delta));
  world.scale.set(refs.scaleRef.current);
}

export function handlePointerDown(e: PointerEvent, refs: InputRefs): void {
  if (refs.planetDragRef.current || refs.beltDragRef.current) return;
  if (e.button === 0) {
    refs.dragRef.current = { x: e.clientX - refs.posRef.current.x, y: e.clientY - refs.posRef.current.y };
  }
}

export function handlePointerMove(e: PointerEvent, refs: InputRefs): void {
  // Planet drag
  if (refs.planetDragRef.current) {
    const scale = refs.scaleRef.current;
    const panPos = refs.posRef.current;
    const sz = refs.sizeRef.current;
    const worldX = (e.clientX - sz.width / 2 - panPos.x) / scale;
    const worldY = (e.clientY - sz.height / 2 - panPos.y) / scale;
    const drag = refs.planetDragRef.current;
    let newX = worldX - drag.startX;
    let newY = worldY - drag.startY;

    if (!drag.moved) {
      drag.moved = true;
      const planetsContainer = refs.planetsContainerRef.current;
      if (planetsContainer) {
        for (const child of planetsContainer.children) {
          const p = child as ExtendedPlanet;
          if (p.__agentId === drag.agentId) { p.cursor = 'grabbing'; break; }
        }
      }
    }

    // Enforce minimum distance from singularity
    const dist = Math.sqrt(newX * newX + newY * newY);
    if (dist < PLANET_MIN_RADIUS) {
      const angle = Math.atan2(newY, newX);
      newX = Math.cos(angle) * PLANET_MIN_RADIUS;
      newY = Math.sin(angle) * PLANET_MIN_RADIUS;
    }

    // Enforce minimum distance from other planets
    const planetsContainer = refs.planetsContainerRef.current;
    if (planetsContainer) {
      for (const child of planetsContainer.children) {
        const other = child as ExtendedPlanet;
        if (!other.__agentId || other.__agentId === drag.agentId) continue;
        const dx = newX - other.x;
        const dy = newY - other.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < MIN_PIXEL_DIST && d > 0) {
          const pushAngle = Math.atan2(dy, dx);
          newX = other.x + Math.cos(pushAngle) * MIN_PIXEL_DIST;
          newY = other.y + Math.sin(pushAngle) * MIN_PIXEL_DIST;
        }
      }

      for (const child of planetsContainer.children) {
        const p = child as ExtendedPlanet;
        if (p.__agentId === drag.agentId) {
          p.x = newX;
          p.y = newY;
          refs.customPositionsRef.current.set(drag.agentId, { x: newX, y: newY });
          refs.planetPositionsRef.current.set(drag.agentId, { x: newX, y: newY });
          rebuildBelts(refs);
          break;
        }
      }
    }
    return;
  }

  // Belt drag
  if (refs.beltDragRef.current) {
    const scale = refs.scaleRef.current;
    const panPos = refs.posRef.current;
    const sz = refs.sizeRef.current;
    const worldX = (e.clientX - sz.width / 2 - panPos.x) / scale;
    const worldY = (e.clientY - sz.height / 2 - panPos.y) / scale;
    const belt = refs.beltDragRef.current;
    const dx = worldX - belt.startX;
    const dy = worldY - belt.startY;
    belt.startX = worldX;
    belt.startY = worldY;

    const pc = refs.planetsContainerRef.current;
    if (pc) {
      for (const memberId of belt.agentIds) {
        for (const child of pc.children) {
          const p = child as ExtendedPlanet;
          if (p.__agentId === memberId) {
            p.x += dx;
            p.y += dy;
            refs.customPositionsRef.current.set(memberId, { x: p.x, y: p.y });
            refs.planetPositionsRef.current.set(memberId, { x: p.x, y: p.y });
            break;
          }
        }
      }
      rebuildBelts(refs);
    }
    return;
  }

  // Canvas pan
  if (!refs.dragRef.current) return;
  refs.posRef.current = { x: e.clientX - refs.dragRef.current.x, y: e.clientY - refs.dragRef.current.y };
  const panContainer = refs.panContainerRef.current;
  if (panContainer) {
    const s = refs.sizeRef.current;
    panContainer.x = s.width / 2 + refs.posRef.current.x;
    panContainer.y = s.height / 2 + refs.posRef.current.y;
  }
  const stars = refs.starsRef.current;
  if (stars) {
    const s = refs.sizeRef.current;
    stars.x = -s.width / 2 + refs.posRef.current.x * 0.1;
    stars.y = -s.height / 2 + refs.posRef.current.y * 0.1;
  }
}

export function handlePointerUp(refs: InputRefs): void {
  if (refs.beltDragRef.current) {
    refs.beltDragRef.current = null;
    return;
  }
  if (refs.planetDragRef.current) {
    const planetsContainer = refs.planetsContainerRef.current;
    if (planetsContainer) {
      for (const child of planetsContainer.children) {
        const p = child as ExtendedPlanet;
        if (p.__agentId === refs.planetDragRef.current.agentId) {
          p.cursor = 'pointer';
          break;
        }
      }
    }
    setTimeout(() => { refs.planetDragRef.current = null; }, 50);
    return;
  }
  refs.dragRef.current = null;
}

function rebuildBelts(refs: InputRefs): void {
  const beltsContainer = refs.beltsContainerRef.current;
  if (!beltsContainer) return;
  for (const group of refs.workspaceGroupsRef.current) {
    group.memberPositions = group.agentIds.map((id) => refs.planetPositionsRef.current.get(id) ?? { x: 0, y: 0 });
  }
  while (beltsContainer.children.length > 0) {
    beltsContainer.children[0].destroy({ children: true });
  }
  for (const group of refs.workspaceGroupsRef.current) {
    if (group.agentIds.length > 1) {
      const newBelt = refs.drawAsteroidBelt(group.memberPositions, group.agentIds);
      newBelt.on('pointerdown', (ev: { stopPropagation: () => void; global: { x: number; y: number } }) => {
        ev.stopPropagation();
        const s = refs.scaleRef.current;
        const pp = refs.posRef.current;
        const ssz = refs.sizeRef.current;
        const wx = (ev.global.x - ssz.width / 2 - pp.x) / s;
        const wy = (ev.global.y - ssz.height / 2 - pp.y) / s;
        refs.beltDragRef.current = { agentIds: [...group.agentIds], startX: wx, startY: wy };
      });
      beltsContainer.addChild(newBelt);
    }
  }
}
