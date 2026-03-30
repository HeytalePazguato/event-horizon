/**
 * Settings slice tests — view mode, animation speed, event server port, toggles.
 * Phase H — Test Coverage.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useCommandCenterStore } from '../store.js';

beforeEach(() => {
  useCommandCenterStore.setState(useCommandCenterStore.getInitialState());
});

// ── setViewMode / toggleViewMode ────────────────────────────────────────────

describe('viewMode', () => {
  it('defaults to universe', () => {
    expect(useCommandCenterStore.getState().viewMode).toBe('universe');
  });

  it('setViewMode changes to operations', () => {
    useCommandCenterStore.getState().setViewMode('operations');
    expect(useCommandCenterStore.getState().viewMode).toBe('operations');
  });

  it('setViewMode changes back to universe', () => {
    useCommandCenterStore.getState().setViewMode('operations');
    useCommandCenterStore.getState().setViewMode('universe');
    expect(useCommandCenterStore.getState().viewMode).toBe('universe');
  });

  it('toggleViewMode switches from universe to operations', () => {
    useCommandCenterStore.getState().toggleViewMode();
    expect(useCommandCenterStore.getState().viewMode).toBe('operations');
  });

  it('toggleViewMode switches from operations back to universe', () => {
    useCommandCenterStore.getState().setViewMode('operations');
    useCommandCenterStore.getState().toggleViewMode();
    expect(useCommandCenterStore.getState().viewMode).toBe('universe');
  });
});

// ── setAnimationSpeed ───────────────────────────────────────────────────────

describe('animationSpeed', () => {
  it('defaults to 1.0', () => {
    expect(useCommandCenterStore.getState().animationSpeed).toBe(1.0);
  });

  it('sets a valid speed', () => {
    useCommandCenterStore.getState().setAnimationSpeed(2.0);
    expect(useCommandCenterStore.getState().animationSpeed).toBe(2.0);
  });

  it('clamps to minimum 0.25', () => {
    useCommandCenterStore.getState().setAnimationSpeed(0.1);
    expect(useCommandCenterStore.getState().animationSpeed).toBe(0.25);
  });

  it('clamps to maximum 3.0', () => {
    useCommandCenterStore.getState().setAnimationSpeed(5.0);
    expect(useCommandCenterStore.getState().animationSpeed).toBe(3.0);
  });

  it('clamps negative values to 0.25', () => {
    useCommandCenterStore.getState().setAnimationSpeed(-1);
    expect(useCommandCenterStore.getState().animationSpeed).toBe(0.25);
  });
});

// ── setEventServerPort ──────────────────────────────────────────────────────

describe('eventServerPort', () => {
  it('defaults to 28765', () => {
    expect(useCommandCenterStore.getState().eventServerPort).toBe(28765);
  });

  it('sets a valid port', () => {
    useCommandCenterStore.getState().setEventServerPort(3000);
    expect(useCommandCenterStore.getState().eventServerPort).toBe(3000);
  });

  it('clamps to minimum 1024', () => {
    useCommandCenterStore.getState().setEventServerPort(80);
    expect(useCommandCenterStore.getState().eventServerPort).toBe(1024);
  });

  it('clamps to maximum 65535', () => {
    useCommandCenterStore.getState().setEventServerPort(70000);
    expect(useCommandCenterStore.getState().eventServerPort).toBe(65535);
  });
});

// ── toggleSettings ──────────────────────────────────────────────────────────

describe('toggleSettings', () => {
  it('defaults to closed', () => {
    expect(useCommandCenterStore.getState().settingsOpen).toBe(false);
  });

  it('opens settings on first toggle', () => {
    useCommandCenterStore.getState().toggleSettings();
    expect(useCommandCenterStore.getState().settingsOpen).toBe(true);
  });

  it('closes settings on second toggle', () => {
    useCommandCenterStore.getState().toggleSettings();
    useCommandCenterStore.getState().toggleSettings();
    expect(useCommandCenterStore.getState().settingsOpen).toBe(false);
  });
});

// ── toggleConnect ───────────────────────────────────────────────────────────

describe('toggleConnect', () => {
  it('defaults to closed', () => {
    expect(useCommandCenterStore.getState().connectOpen).toBe(false);
  });

  it('opens on first toggle', () => {
    useCommandCenterStore.getState().toggleConnect();
    expect(useCommandCenterStore.getState().connectOpen).toBe(true);
  });

  it('closes on second toggle', () => {
    useCommandCenterStore.getState().toggleConnect();
    useCommandCenterStore.getState().toggleConnect();
    expect(useCommandCenterStore.getState().connectOpen).toBe(false);
  });
});

// ── toggleSpawn ─────────────────────────────────────────────────────────────

describe('toggleSpawn', () => {
  it('defaults to closed', () => {
    expect(useCommandCenterStore.getState().spawnOpen).toBe(false);
  });

  it('opens on first toggle', () => {
    useCommandCenterStore.getState().toggleSpawn();
    expect(useCommandCenterStore.getState().spawnOpen).toBe(true);
  });

  it('closes on second toggle', () => {
    useCommandCenterStore.getState().toggleSpawn();
    useCommandCenterStore.getState().toggleSpawn();
    expect(useCommandCenterStore.getState().spawnOpen).toBe(false);
  });
});
