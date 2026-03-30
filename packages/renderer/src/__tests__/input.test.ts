/**
 * Input handler tests — pure functions, no WebGL needed.
 */

import { describe, it, expect } from 'vitest';
import { clampZoom, screenToWorld, worldToScreen, zoomAtPoint, smoothPan, createInputState } from '../input.js';

describe('clampZoom', () => {
  it('clamps below minimum', () => {
    expect(clampZoom(0.1)).toBe(0.3);
  });
  it('clamps above maximum', () => {
    expect(clampZoom(5.0)).toBe(3.0);
  });
  it('passes through valid zoom', () => {
    expect(clampZoom(1.5)).toBe(1.5);
  });
});

describe('screenToWorld / worldToScreen roundtrip', () => {
  it('converts back and forth', () => {
    const world = screenToWorld(150, 200, 50, 100, 2);
    const screen = worldToScreen(world.x, world.y, 50, 100, 2);
    expect(screen.x).toBeCloseTo(150);
    expect(screen.y).toBeCloseTo(200);
  });
});

describe('zoomAtPoint', () => {
  it('keeps pivot point fixed', () => {
    const pivotX = 300, pivotY = 200;
    const currentZoom = 1, newZoom = 2;
    const { panX, panY } = zoomAtPoint(0, 0, currentZoom, newZoom, pivotX, pivotY);
    // After zoom, the world point at pivot should map back to the same screen position
    const worldX = (pivotX - 0) / currentZoom;
    const worldY = (pivotY - 0) / currentZoom;
    const screenX = worldX * newZoom + panX;
    const screenY = worldY * newZoom + panY;
    expect(screenX).toBeCloseTo(pivotX);
    expect(screenY).toBeCloseTo(pivotY);
  });
});

describe('smoothPan', () => {
  it('moves toward target', () => {
    const result = smoothPan(0, 100, 0.5);
    expect(result).toBe(50);
  });
  it('stays at target when already there', () => {
    expect(smoothPan(100, 100)).toBe(100);
  });
});

describe('createInputState', () => {
  it('returns default state', () => {
    const state = createInputState();
    expect(state.zoom).toBe(1);
    expect(state.isPanning).toBe(false);
    expect(state.dragPlanetId).toBeNull();
  });
});
