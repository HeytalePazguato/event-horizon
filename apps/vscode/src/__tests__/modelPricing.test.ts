import { describe, it, expect } from 'vitest';
import {
  MODEL_PRICES_BY_ID,
  PRICES_VERIFIED_AT,
  costOfTokens,
  priceForModel,
  priceForTier,
} from '../modelPricing.js';

describe('priceForModel', () => {
  it('returns the row for an exact model ID', () => {
    expect(priceForModel('claude-opus-5')).toEqual({ input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 });
    expect(priceForModel('claude-opus-5-5')).toEqual({ input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 });
    expect(priceForModel('claude-haiku-4-5')?.input).toBe(1);
  });

  it('returns null for unknown models (never falls back to sonnet)', () => {
    expect(priceForModel('totally-unknown')).toBeNull();
    expect(priceForModel('')).toBeNull();
    expect(priceForModel('claude-opus-9')).toBeNull();
    expect(priceForModel('claude-opus-5-6')).toBeNull();
  });

  it('resolves dated and suffixed IDs by prefix', () => {
    expect(priceForModel('claude-opus-5-20261001')).toBe(MODEL_PRICES_BY_ID['claude-opus-5']);
    expect(priceForModel('claude-opus-5[1m]')).toBe(MODEL_PRICES_BY_ID['claude-opus-5']);
  });

  it('prefers the longest matching ID', () => {
    expect(priceForModel('claude-opus-5-5-20261001')).toBe(MODEL_PRICES_BY_ID['claude-opus-5-5']);
  });
});

describe('price table', () => {
  it('has a verification date', () => {
    expect(PRICES_VERIFIED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('maps tiers to representative current rows', () => {
    expect(priceForTier('opus')).toBe(MODEL_PRICES_BY_ID['claude-opus-5']);
    expect(priceForTier('sonnet')).toBe(MODEL_PRICES_BY_ID['claude-sonnet-5']);
    expect(priceForTier('haiku')).toBe(MODEL_PRICES_BY_ID['claude-haiku-4-5']);
  });
});

describe('costOfTokens', () => {
  it('computes cost from a price row', () => {
    const cost = costOfTokens(MODEL_PRICES_BY_ID['claude-opus-5'], {
      input: 1_000_000,
      output: 1_000_000,
      cacheRead: 1_000_000,
      cacheCreation: 1_000_000,
    });
    expect(cost).toBeCloseTo(5 + 25 + 0.5 + 6.25);
  });
});
