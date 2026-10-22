/**
 * Claude Code statusLine input → the figures Event Horizon uses.
 *
 * Claude Code pipes a JSON snapshot of the session into the statusLine command
 * on every update. It carries Claude Code's own cost (`cost.total_cost_usd`, a
 * cumulative session total) and measured prompt-cache and context-window
 * figures that neither hooks nor OTel provide. The bridge script POSTs that
 * JSON to /claude/status.
 */

export interface StatusLineSnapshot {
  sessionId: string;
  model?: string;
  /** Cumulative session cost as computed by Claude Code. */
  costUsd?: number;
  contextUsedPercentage?: number;
  contextWindowSize?: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  cacheHitRatio?: number;
  cacheWriteTokens?: number;
  cacheMissCauses?: Record<string, number>;
  cacheExpiresAt?: number;
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
}

function num(v: unknown, opts: { min?: number; max?: number } = {}): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  if (opts.min !== undefined && v < opts.min) return undefined;
  if (opts.max !== undefined && v > opts.max) return undefined;
  return v;
}

/** Parse a statusLine JSON payload. Returns null without a session id. Never throws. */
export function parseStatusLinePayload(body: unknown): StatusLineSnapshot | null {
  const b = obj(body);
  const sessionId = typeof b.session_id === 'string' && b.session_id.length > 0 ? b.session_id.slice(0, 128) : null;
  if (!sessionId) return null;

  const model = obj(b.model);
  const cost = obj(b.cost);
  const ctx = obj(b.context_window);
  const cache = obj(b.prompt_cache);

  let missCauses: Record<string, number> | undefined;
  const rawCauses = obj(cache.miss_causes);
  for (const [k, v] of Object.entries(rawCauses)) {
    const n = num(v, { min: 0 });
    if (n !== undefined && k.length <= 64) (missCauses ??= {})[k] = n;
  }

  return {
    sessionId,
    model: typeof model.id === 'string' ? model.id : undefined,
    costUsd: num(cost.total_cost_usd, { min: 0 }),
    contextUsedPercentage: num(ctx.used_percentage, { min: 0, max: 100 }),
    contextWindowSize: num(ctx.context_window_size, { min: 1 }),
    totalInputTokens: num(ctx.total_input_tokens, { min: 0 }),
    totalOutputTokens: num(ctx.total_output_tokens, { min: 0 }),
    cacheHitRatio: num(cache.hit_ratio, { min: 0, max: 1 }),
    cacheWriteTokens: num(cache.cache_write_tokens, { min: 0 }),
    cacheMissCauses: missCauses,
    cacheExpiresAt: num(cache.expires_at, { min: 0 }),
  };
}
