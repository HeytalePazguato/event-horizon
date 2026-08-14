/**
 * Backfill OpenCode session spend from the OpenCode server.
 *
 * The connector's token accumulator starts at zero and only sees assistant
 * messages that arrive while Event Horizon is attached. Anything the session
 * spent before that — because it was started first, or because VS Code
 * restarted — is invisible, so the Operations view reported a fraction of the
 * real figure (a session at $202.68 showed $0.62).
 *
 * The OpenCode plugin already sends us its `serverUrl`, so we can ask OpenCode
 * for the session's message history and seed the true totals.
 *
 * Everything here is best-effort. If the endpoint is unreachable or shaped
 * differently than expected, we log once and leave the live accumulator alone —
 * the result is today's undercount, never a crash and never a wrong figure
 * presented as authoritative.
 */

import { seedTokenAccumulator } from '@event-horizon/connectors';

export interface SessionTotals {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  messageIds: string[];
  /** How many assistant messages contributed to the totals. */
  messageCount: number;
}

/** Sessions already backfilled, so we only pay for the fetch once each. */
const backfilled = new Set<string>();

/** Reset tracking for a session (on terminate, or for tests). */
export function forgetBackfill(sessionId: string): void {
  backfilled.delete(sessionId);
}

/** Clear all tracking (tests). */
export function resetBackfillState(): void {
  backfilled.clear();
}

/**
 * Pull one number out of an object, trying several key spellings.
 * OpenCode has renamed these fields across versions, so accept what we find
 * rather than assuming a single shape.
 */
function pickNumber(source: Record<string, unknown> | undefined, keys: string[]): number {
  if (!source) return 0;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return 0;
}

/**
 * Total an OpenCode message list.
 *
 * Accepts the shapes seen in the wild: a bare array, `{ messages: [...] }`, or
 * `{ data: [...] }`; each entry either flat or wrapped in `info`. Only
 * assistant messages carry cost, and each id is counted once.
 */
export function sumSessionMessages(payload: unknown): SessionTotals {
  const totals: SessionTotals = {
    inputTokens: 0, outputTokens: 0, costUsd: 0, messageIds: [], messageCount: 0,
  };

  const list = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as Record<string, unknown> | null)?.messages)
      ? (payload as { messages: unknown[] }).messages
      : Array.isArray((payload as Record<string, unknown> | null)?.data)
        ? (payload as { data: unknown[] }).data
        : null;

  if (!list) return totals;

  const seen = new Set<string>();
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const wrapper = entry as Record<string, unknown>;
    const info = (wrapper.info && typeof wrapper.info === 'object'
      ? wrapper.info
      : wrapper) as Record<string, unknown>;

    if (info.role !== 'assistant') continue;
    const id = typeof info.id === 'string' ? info.id : undefined;
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
      totals.messageIds.push(id);
    }

    totals.messageCount += 1;
    totals.costUsd += pickNumber(info, ['cost', 'costUsd', 'total_cost_usd']);

    const tokens = info.tokens as Record<string, unknown> | undefined;
    const cache = tokens?.cache as Record<string, unknown> | undefined;
    // Cache reads/writes count as input, matching how the live path and the
    // Claude Code connector report it.
    totals.inputTokens += pickNumber(tokens, ['input', 'input_tokens'])
      + pickNumber(cache, ['read'])
      + pickNumber(cache, ['write']);
    totals.outputTokens += pickNumber(tokens, ['output', 'output_tokens']);
  }

  return totals;
}

/** Candidate endpoints, newest naming first. */
function messageEndpoints(serverUrl: string, sessionId: string): string[] {
  const base = serverUrl.replace(/\/$/, '');
  const id = encodeURIComponent(sessionId);
  return [
    `${base}/session/${id}/message`,
    `${base}/session/${id}/messages`,
  ];
}

export interface BackfillDeps {
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
}

/**
 * Fetch a session's history and seed the accumulator with its real totals.
 *
 * Runs at most once per session. Returns the totals applied, or null when the
 * history could not be read — in which case the live accumulator is untouched.
 */
export async function backfillSessionCost(
  sessionId: string,
  serverUrl: string | undefined,
  cwd: string | undefined,
  deps: BackfillDeps = {},
): Promise<SessionTotals | null> {
  if (!serverUrl || backfilled.has(sessionId)) return null;
  // Claim it up front so concurrent events don't each start a fetch.
  backfilled.add(sessionId);

  const doFetch = deps.fetchImpl ?? fetch;
  const log = deps.log ?? (() => { /* silent by default */ });

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (cwd) headers['x-opencode-directory'] = encodeURIComponent(cwd);

  for (const url of messageEndpoints(serverUrl, sessionId)) {
    try {
      const response = await doFetch(url, { method: 'GET', headers });
      if (!response.ok) continue;

      const totals = sumSessionMessages(await response.json());
      if (totals.messageCount === 0) continue;

      seedTokenAccumulator(
        sessionId,
        { inputTokens: totals.inputTokens, outputTokens: totals.outputTokens, costUsd: totals.costUsd },
        totals.messageIds,
      );
      log(
        `[Event Horizon] Backfilled OpenCode session ${sessionId}: `
        + `${totals.messageCount} messages, $${totals.costUsd.toFixed(4)}`,
      );
      return totals;
    } catch {
      // Try the next endpoint spelling.
    }
  }

  log(`[Event Horizon] Could not backfill OpenCode session ${sessionId} from ${serverUrl}`);
  return null;
}
