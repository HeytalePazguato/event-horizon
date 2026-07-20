// Prices are public list prices; verify before release.
/**
 * Model Pricing — per-model token list prices and cost helpers.
 * Prices are USD per 1,000,000 tokens, split by input / output / cache read /
 * cache write, mirroring the Anthropic public pricing table.
 */

// ── Types ──────────────────────────────────────────────────────────────────

export type ModelTier = 'haiku' | 'sonnet' | 'opus';

export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

// ── Prices (USD per 1,000,000 tokens) ────────────────────────────────────────

export const MODEL_PRICES: Record<ModelTier, ModelPrice> = {
  haiku: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  sonnet: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  opus: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Cost in USD for a bundle of tokens on the given tier. */
export function costOfTokens(
  tier: ModelTier,
  tokens: { input: number; output: number; cacheRead: number; cacheCreation: number },
): number {
  const price = MODEL_PRICES[tier];
  return (
    (tokens.input * price.input +
      tokens.output * price.output +
      tokens.cacheRead * price.cacheRead +
      tokens.cacheCreation * price.cacheWrite) /
    1_000_000
  );
}

/** The cheapest tier available. */
export function cheapestTier(): ModelTier {
  return 'haiku';
}
