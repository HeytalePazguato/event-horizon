// Shared transport for the OpenCode plugins (v1 and v2).
// The installer substitutes the token placeholder below when it writes the plugin to disk.
// No subprocesses: the token must never reach the process table via argv.

const PORT = 28765;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const AUTH_TOKEN = '__EH_AUTH_TOKEN__';
const TIMEOUT_MS = 2000;

const AUTH_HEADERS: Record<string, string> = AUTH_TOKEN
  ? { 'Content-Type': 'application/json', Authorization: 'Bearer ' + AUTH_TOKEN }
  : { 'Content-Type': 'application/json' };

export type EventExtra = Record<string, unknown>;

/** Fire-and-forget event post. */
export function send(eventName: string, extra?: EventExtra): void {
  const body = JSON.stringify({ event: eventName, ...extra });
  fetch(`${BASE_URL}/opencode`, {
    method: 'POST',
    headers: AUTH_HEADERS,
    body,
  }).catch(() => {});
}

/** Event post for shutdown: keepalive lets the request outlive the process teardown. */
export function sendFinal(eventName: string, extra?: EventExtra): void {
  const body = JSON.stringify({ event: eventName, ...extra });
  fetch(`${BASE_URL}/opencode`, {
    method: 'POST',
    headers: AUTH_HEADERS,
    body,
    keepalive: true,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(() => {});
}

/** Throws if another agent holds the lock; network errors are ignored (EH may not be running). */
export async function checkLock(filePath: string, agentId: string, agentName: string): Promise<void> {
  try {
    const resp = await fetch(`${BASE_URL}/lock`, {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({ action: 'check', filePath, agentId, agentName }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (resp.status === 409) {
      const data = (await resp.json()) as { owner?: string };
      throw new Error(
        '[Event Horizon file lock] BLOCKED: ' + filePath + ' is locked by ' + (data.owner || 'another agent') +
        ' who is actively editing it. You MUST NOT write to this file by ANY means — no Write, no Edit, no Bash echo/cat/sed, no workarounds. The lock will release automatically when they finish (within 30 seconds of their last write). Work on OTHER files first, then retry this file later.',
      );
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('is locked by')) throw e;
    // Ignore network errors — Event Horizon might not be running
  }
}

export async function releaseLock(filePath: string, agentId: string): Promise<void> {
  try {
    await fetch(`${BASE_URL}/lock`, {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({ action: 'release', filePath, agentId }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // ignore
  }
}

/**
 * Six random hex characters for a session id. Uniqueness only, not a secret,
 * but the runtime's crypto generator is the right primitive (Node and Bun both
 * provide it); the clock is a fallback for an environment without it.
 */
export function randomSuffix(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  const uuid = c?.randomUUID?.();
  return uuid ? uuid.replace(/-/g, '').slice(0, 6) : (Date.now() % 1_000_000).toString(36);
}
