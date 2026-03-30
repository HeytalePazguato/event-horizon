/**
 * Input handler — pan, zoom, drag-to-rearrange, click-to-select.
 * Separated from the ticker for testability and clarity.
 * Phase F — Universe ECS Refactor.
 */

export interface InputState {
  /** Current pan offset. */
  panX: number;
  panY: number;
  /** Current zoom level. */
  zoom: number;
  /** Whether a pan drag is in progress. */
  isPanning: boolean;
  /** Whether a planet drag is in progress. */
  isDraggingPlanet: boolean;
  /** Start position of the current drag. */
  dragStartX: number;
  dragStartY: number;
  /** ID of the planet being dragged (if any). */
  dragPlanetId: string | null;
}

export function createInputState(): InputState {
  return {
    panX: 0, panY: 0, zoom: 1,
    isPanning: false, isDraggingPlanet: false,
    dragStartX: 0, dragStartY: 0, dragPlanetId: null,
  };
}

/** Clamp zoom to safe range. */
export function clampZoom(zoom: number, min = 0.3, max = 3.0): number {
  return Math.max(min, Math.min(max, zoom));
}

/** Convert screen coordinates to world coordinates given pan and zoom. */
export function screenToWorld(screenX: number, screenY: number, panX: number, panY: number, zoom: number): { x: number; y: number } {
  return {
    x: (screenX - panX) / zoom,
    y: (screenY - panY) / zoom,
  };
}

/** Convert world coordinates to screen coordinates. */
export function worldToScreen(worldX: number, worldY: number, panX: number, panY: number, zoom: number): { x: number; y: number } {
  return {
    x: worldX * zoom + panX,
    y: worldY * zoom + panY,
  };
}

/** Apply zoom centered on a screen point. Returns new pan offset. */
export function zoomAtPoint(
  currentPanX: number, currentPanY: number,
  currentZoom: number, newZoom: number,
  pivotScreenX: number, pivotScreenY: number,
): { panX: number; panY: number } {
  // Convert pivot to world space at current zoom
  const worldX = (pivotScreenX - currentPanX) / currentZoom;
  const worldY = (pivotScreenY - currentPanY) / currentZoom;
  // Recompute pan so the pivot stays fixed on screen
  return {
    panX: pivotScreenX - worldX * newZoom,
    panY: pivotScreenY - worldY * newZoom,
  };
}

/** Smooth animation toward target pan (spring-like). Returns interpolated value. */
export function smoothPan(current: number, target: number, smoothing = 0.12): number {
  return current + (target - current) * smoothing;
}
