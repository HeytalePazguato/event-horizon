import { describe, it, expect } from 'vitest';
import { resolveSizeMult, resolveRingColor } from '../entities/Planet.js';

describe('resolveSizeMult', () => {
  it('returns default SIZE_MULT for variant when no override', () => {
    expect(resolveSizeMult('gas')).toBe(1.35);
    expect(resolveSizeMult('icy')).toBe(0.72);
    expect(resolveSizeMult('rocky')).toBe(1.0);
    expect(resolveSizeMult('volcanic')).toBe(1.12);
    expect(resolveSizeMult('ocean')).toBe(0.92);
  });

  it('uses override when provided', () => {
    expect(resolveSizeMult('gas', 2.0)).toBe(2.0);
    expect(resolveSizeMult('icy', 0.5)).toBe(0.5);
  });
});

describe('resolveRingColor', () => {
  it('returns agent-specific color when no override', () => {
    expect(resolveRingColor('claude-code')).toBe(0x88aaff);
    expect(resolveRingColor('copilot')).toBe(0xcc88ff);
    expect(resolveRingColor('opencode')).toBe(0x88ffaa);
    expect(resolveRingColor('cursor')).toBe(0x44ddcc);
  });

  it('returns default color for unknown agent type', () => {
    expect(resolveRingColor('unknown')).toBe(0xaaccff);
    expect(resolveRingColor(undefined)).toBe(0xaaccff);
  });

  it('uses override when provided', () => {
    expect(resolveRingColor('claude-code', 0xff0000)).toBe(0xff0000);
    expect(resolveRingColor(undefined, 0x123456)).toBe(0x123456);
  });
});
