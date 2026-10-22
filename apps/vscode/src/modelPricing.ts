/**
 * Model Pricing — per-model token list prices and cost helpers.
 * Prices are USD per 1,000,000 tokens, split by input / output / cache read /
 * cache write, mirroring the Anthropic public pricing table. Rows are keyed by
 * model ID; unknown models have no price (callers must not guess).
 */

// ── Types ──────────────────────────────────────────────────────────────────

export type ModelTier = 'haiku' | 'sonnet' | 'opus';

export interface ModelPriceRow {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

// ── Prices (USD per 1,000,000 tokens) ────────────────────────────────────────

/** Date the price table was last checked against the public pricing page. */
export const PRICES_VERIFIED_AT = '2026-10-20';

export const MODEL_PRICES_BY_ID: Record<string, ModelPriceRow> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-sonnet-4-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};

/** Representative current model per tier, for callers that only know a tier. */
const TIER_REPRESENTATIVE_ID: Record<ModelTier, string> = {
  opus: 'claude-opus-5',
  sonnet: 'claude-sonnet-5',
  haiku: 'claude-haiku-4-5',
};

/** Suffixes a real model ID may carry after the base ID: date stamp, alias, context tag. */
const ID_SUFFIX = /^(-\d{8}|-latest|@[\w.-]+|\[[^\]]*\])*$/;

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Price row for a model ID, or null if unknown. Exact match first, then the
 * longest known ID followed only by a date/alias/context suffix (e.g.
 * `claude-opus-5-20261001`, `claude-opus-5[1m]`). Never falls back to another
 * model's prices.
 */
export function priceForModel(modelId: string): ModelPriceRow | null {
  const id = modelId.trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(MODEL_PRICES_BY_ID, id)) return MODEL_PRICES_BY_ID[id];
  let best: string | null = null;
  for (const key of Object.keys(MODEL_PRICES_BY_ID)) {
    if (id.startsWith(key) && ID_SUFFIX.test(id.slice(key.length)) && (!best || key.length > best.length)) {
      best = key;
    }
  }
  return best ? MODEL_PRICES_BY_ID[best] : null;
}

/** Whole days between a YYYY-MM-DD verification date and `now` (default: today). */
export function pricesAgeDays(verifiedAt: string = PRICES_VERIFIED_AT, now: number = Date.now()): number {
  return Math.floor((now - Date.parse(verifiedAt)) / 86_400_000);
}

/** Representative current price row for a tier. */
export function priceForTier(tier: ModelTier): ModelPriceRow {
  return MODEL_PRICES_BY_ID[TIER_REPRESENTATIVE_ID[tier]];
}

/** Cost in USD for a bundle of tokens at the given price row. */
export function costOfTokens(
  price: ModelPriceRow,
  tokens: { input: number; output: number; cacheRead: number; cacheCreation: number },
): number {
  return (
    (tokens.input * price.input +
      tokens.output * price.output +
      tokens.cacheRead * price.cacheRead +
      tokens.cacheCreation * price.cacheWrite) /
    1_000_000
  );
}

/** All known tiers, cheapest first. */
export const MODEL_TIERS: readonly ModelTier[] = ['haiku', 'sonnet', 'opus'];

/** The cheapest tier available. */
export function cheapestTier(): ModelTier {
  return 'haiku';
}
