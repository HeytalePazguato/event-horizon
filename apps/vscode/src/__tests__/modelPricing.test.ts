import { describe, it, expect } from 'vitest';
import {
  MODEL_PRICES_BY_ID,
  PRICES_VERIFIED_AT,
  costOfTokens,
  priceForModel,
  priceForTier,
  pricesAgeDays,
} from '../modelPricing.js';

/** Verified USD per 1M tokens, from https://platform.claude.com/docs/en/about-claude/pricing */
const VERIFIED_PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-sonnet-4-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};

const MAX_PRICE_AGE_DAYS = 180;

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

describe('price table rows match verified prices', () => {
  it('covers exactly the verified model IDs', () => {
    expect(Object.keys(MODEL_PRICES_BY_ID).sort()).toEqual(Object.keys(VERIFIED_PRICES).sort());
  });

  for (const [id, expected] of Object.entries(VERIFIED_PRICES)) {
    it(`${id} is priced at the verified rates`, () => {
      expect(MODEL_PRICES_BY_ID[id]).toEqual(expected);
      expect(priceForModel(id)).toEqual(expected);
    });
  }

  it('returns null for unknown model IDs', () => {
    for (const id of ['claude-unknown-9', 'gpt-4o', 'claude-haiku-3', '']) {
      expect(priceForModel(id)).toBeNull();
    }
  });
});

describe('price staleness guard', () => {
  const DAY_MS = 86_400_000;

  it(`prices were verified within the last ${MAX_PRICE_AGE_DAYS} days`, () => {
    const age = pricesAgeDays(PRICES_VERIFIED_AT);
    expect(
      age,
      `PRICES_VERIFIED_AT (${PRICES_VERIFIED_AT}) is ${age} days old (limit ${MAX_PRICE_AGE_DAYS}). ` +
        'Re-verify every row in MODEL_PRICES_BY_ID against https://platform.claude.com/docs/en/about-claude/pricing, ' +
        'then update PRICES_VERIFIED_AT in apps/vscode/src/modelPricing.ts.',
    ).toBeLessThanOrEqual(MAX_PRICE_AGE_DAYS);
  });

  it('pricesAgeDays flags a date 200 days old as stale', () => {
    const now = Date.parse('2026-10-20');
    const old = new Date(now - 200 * DAY_MS).toISOString().slice(0, 10);
    expect(pricesAgeDays(old, now)).toBe(200);
    expect(pricesAgeDays(old, now)).toBeGreaterThan(MAX_PRICE_AGE_DAYS);
  });

  it('pricesAgeDays is 0 on the verification date', () => {
    expect(pricesAgeDays('2026-10-20', Date.parse('2026-10-20'))).toBe(0);
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
