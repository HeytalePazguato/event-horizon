/**
 * Local HTTP server in extension host for receiving agent events.
 * Binds to 127.0.0.1 only — not reachable from the network.
 */

import * as crypto from 'crypto';
import * as http from 'http';
import * as vscode from 'vscode';
import type { AgentEvent } from '@event-horizon/core';
import { AGENT_EVENT_TYPES, AGENT_TYPES } from '@event-horizon/core';
import { mapOpenCodeToEvent, mapClaudeHookToEvent, mapCopilotHookToEvent } from '@event-horizon/connectors';

export const DEFAULT_PORT = 28765;
export const MAX_BODY_BYTES = 1_048_576;
export const RATE_LIMIT_RPS = 200;
/** Abort requests that stall mid-stream after this many milliseconds. */
export const REQUEST_TIMEOUT_MS = 10_000;
/** Maximum nesting depth for payload objects to prevent stack-overflow on serialization. */
export const MAX_PAYLOAD_DEPTH = 10;
/** Maximum JSON-stringified size of the payload field (bytes). */
export const MAX_PAYLOAD_SIZE = 65_536;

export interface EventServerCallbacks {
  onEvent: (event: AgentEvent) => void;
}

let server: http.Server | null = null;
let callbacks: EventServerCallbacks | null = null;
const activeSockets = new Set<import('net').Socket>();

// Per-session auth token — generated once at server start, required on all requests.
let authToken: string | null = null;

/** Returns the current auth token (for hooks to include in requests). */
export function getAuthToken(): string | null {
  return authToken;
}

// ── File lock registry ──────────────────────────────────────────────────────
// Distributed lock manager for AI agents. When enabled, PreToolUse hooks
// check this registry before writing to a file. If another agent holds
// the lock, the hook returns non-zero and the agent's tool call is blocked.

interface FileLock {
  agentId: string;
  agentName: string;
  acquiredAt: number;
}

/** File locks keyed by normalized path. */
const fileLocks = new Map<string, FileLock>();
/** Lock TTL — auto-expire after 30 seconds to prevent stale locks from crashed agents. */
const LOCK_TTL_MS = 30_000;
/** Whether file locking is enabled (read from VS Code settings). */
let fileLockingEnabled = false;

export function setFileLockingEnabled(enabled: boolean): void {
  fileLockingEnabled = enabled;
  if (!enabled) fileLocks.clear();
}

export function isFileLockingEnabled(): boolean {
  return fileLockingEnabled;
}

/** Get all active locks (for UI display). */
export function getActiveLocks(): Array<{ path: string; agentId: string; agentName: string; acquiredAt: number }> {
  pruneExpiredLocks();
  return [...fileLocks.entries()].map(([p, l]) => ({ path: p, ...l }));
}

function pruneExpiredLocks(): void {
  const now = Date.now();
  for (const [path, lock] of fileLocks) {
    if (now - lock.acquiredAt > LOCK_TTL_MS) fileLocks.delete(path);
  }
}

function normalizeLockPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').toLowerCase();
}

/**
 * Check if a file can be written by the given agent.
 * Returns { allowed: true } or { allowed: false, owner: ... }.
 */
function checkAndAcquireLock(filePath: string, agentId: string, agentName: string): { allowed: boolean; owner?: string; ownerAgent?: string } {
  if (!fileLockingEnabled) return { allowed: true };

  pruneExpiredLocks();
  const norm = normalizeLockPath(filePath);
  const existing = fileLocks.get(norm);

  if (existing && existing.agentId !== agentId) {
    // Another agent holds the lock
    return { allowed: false, owner: existing.agentName, ownerAgent: existing.agentId };
  }

  // Acquire or refresh the lock
  fileLocks.set(norm, { agentId, agentName, acquiredAt: Date.now() });
  return { allowed: true };
}

/** Release a lock held by the given agent. */
function releaseLock(filePath: string, agentId: string): void {
  const norm = normalizeLockPath(filePath);
  const existing = fileLocks.get(norm);
  if (existing && existing.agentId === agentId) {
    fileLocks.delete(norm);
  }
}

/** Release all locks held by a specific agent (on agent termination). */
export function releaseAgentLocks(agentId: string): void {
  for (const [path, lock] of fileLocks) {
    if (lock.agentId === agentId) fileLocks.delete(path);
  }
}

// Sliding-window rate limiter
const rateCounts = new Map<string, { count: number; resetAt: number }>();

export function isRateLimited(addr: string): boolean {
  const now = Date.now();
  let entry = rateCounts.get(addr);
  if (!entry || now >= entry.resetAt) {
    for (const [k, v] of rateCounts) { if (now >= v.resetAt) rateCounts.delete(k); }
    entry = { count: 0, resetAt: now + 1000 };
    rateCounts.set(addr, entry);
  }
  entry.count++;
  return entry.count > RATE_LIMIT_RPS;
}

export function clamp(s: unknown, max: number): string {
  return typeof s === 'string' ? s.slice(0, max) : String(s ?? '').slice(0, max);
}

/** Check that an object's nesting depth doesn't exceed the limit. */
export function checkDepth(obj: unknown, maxDepth: number, current = 0): boolean {
  if (current > maxDepth) return false;
  if (obj && typeof obj === 'object') {
    for (const val of Object.values(obj as Record<string, unknown>)) {
      if (!checkDepth(val, maxDepth, current + 1)) return false;
    }
  }
  return true;
}

/** Validate and constrain a payload object. Returns null if invalid. */
export function sanitizePayload(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return {};
  if (!checkDepth(raw, MAX_PAYLOAD_DEPTH)) return null;
  try {
    const json = JSON.stringify(raw);
    if (json.length > MAX_PAYLOAD_SIZE) return null;
  } catch {
    return null;
  }
  return raw as Record<string, unknown>;
}

export function parseBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;

    // Abort stalled requests (slow-client protection)
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      if (!settled) {
        settled = true;
        req.destroy();
        reject(new Error('Request timeout'));
      }
    });

    req.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        if (!settled) {
          settled = true;
          req.destroy();
          reject(Object.assign(new Error('Payload too large'), { code: 'PAYLOAD_TOO_LARGE' }));
        }
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', (err) => {
      if (!settled) { settled = true; reject(err); }
    });
  });
}

export function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  const send = (status: number, body: string) => {
    if (!res.headersSent) {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(body);
    }
  };

  if (req.method !== 'POST' || !req.url?.startsWith('/')) {
    send(404, JSON.stringify({ error: 'Not found' }));
    return;
  }

  // Rate limit by remote address
  const addr = req.socket.remoteAddress ?? '127.0.0.1';
  if (isRateLimited(addr)) {
    send(429, JSON.stringify({ error: 'Too many requests' }));
    return;
  }

  // Auth token validation — check Authorization header or ?token= query param
  if (authToken) {
    const authHeader = req.headers['authorization'];
    const urlToken = req.url && new URL(req.url, 'http://localhost').searchParams.get('token');
    const provided = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : urlToken;
    if (provided !== authToken) {
      send(401, JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
  }

  // Strip query string from URL for route matching
  const route = req.url?.split('?')[0];

  parseBody(req)
    .then((body) => {
      const cb = callbacks;
      if (!cb) {
        send(503, JSON.stringify({ error: 'Not ready' }));
        return;
      }

      // ── Lock API ──────────────────────────────────────────────────────
      // POST /lock — check/acquire a file lock before a write operation.
      // Body: { action: 'check' | 'release', filePath, agentId, agentName }
      // Response: { allowed: true } or { allowed: false, owner: '...' }
      if (route === '/lock') {
        const b = body as Record<string, unknown>;
        const action = b.action as string;
        const filePath = b.filePath as string;
        const agentId = b.agentId as string;
        // DEBUG: log lock requests to VS Code output
        console.log(`[EH-LOCK] action=${action} file=${filePath} agent=${agentId} enabled=${fileLockingEnabled}`);
        const agentName = (b.agentName as string) ?? agentId;

        if (!filePath || !agentId) {
          send(400, JSON.stringify({ error: 'Missing filePath or agentId' }));
          return;
        }

        if (action === 'release') {
          releaseLock(filePath, agentId);
          send(200, JSON.stringify({ released: true }));
          return;
        }

        // 'query' — check if locked by someone else, but don't acquire (for Read operations)
        if (action === 'query') {
          if (!fileLockingEnabled) { send(200, JSON.stringify({ allowed: true })); return; }
          pruneExpiredLocks();
          const norm = normalizeLockPath(filePath);
          const existing = fileLocks.get(norm);
          if (existing && existing.agentId !== agentId) {
            send(409, JSON.stringify({ allowed: false, owner: existing.agentName, ownerAgent: existing.agentId }));
          } else {
            send(200, JSON.stringify({ allowed: true }));
          }
          return;
        }

        // Default: check + acquire (for Write operations)
        const result = checkAndAcquireLock(filePath, agentId, agentName);
        if (result.allowed) {
          send(200, JSON.stringify({ allowed: true }));
        } else {
          send(409, JSON.stringify({ allowed: false, owner: result.owner, ownerAgent: result.ownerAgent }));
        }
        return;
      }

      // GET /lock/status — list all active locks (for UI)
      if (route === '/lock/status') {
        send(200, JSON.stringify({ enabled: fileLockingEnabled, locks: getActiveLocks() }));
        return;
      }

      let event: AgentEvent | null = null;
      if (route === '/claude') {
        event = mapClaudeHookToEvent(body);
      } else if (route === '/copilot') {
        event = mapCopilotHookToEvent(body);
      } else if (route === '/opencode') {
        event = mapOpenCodeToEvent(body);
      } else if (route === '/events' && typeof body === 'object' && body !== null) {
        const b = body as Record<string, unknown>;
        const eventType = typeof b.type === 'string' ? b.type : '';
        if (
          typeof b.agentId === 'string' && b.id != null && b.timestamp != null &&
          (AGENT_EVENT_TYPES as readonly string[]).includes(eventType)
        ) {
          // Validate agentType against the known union
          const rawType = typeof b.agentType === 'string' ? b.agentType : 'unknown';
          const agentType = (AGENT_TYPES as readonly string[]).includes(rawType)
            ? rawType as AgentEvent['agentType']
            : 'unknown';

          // Validate and constrain payload
          const payload = sanitizePayload(b.payload);
          if (payload === null) {
            send(400, JSON.stringify({ error: 'Payload too large or too deeply nested' }));
            return;
          }

          event = {
            id: clamp(b.id, 128),
            agentId: clamp(b.agentId, 128),
            agentName: clamp(b.agentName ?? b.agentId, 64),
            agentType,
            type: eventType as AgentEvent['type'],
            timestamp: Number(b.timestamp),
            payload,
          };
        } else if (!eventType || !(AGENT_EVENT_TYPES as readonly string[]).includes(eventType)) {
          send(400, JSON.stringify({ error: 'Invalid event type' }));
          return;
        } else {
          event = mapOpenCodeToEvent(body);
        }
      }

      if (event) {
        cb.onEvent(event);
        if (route === '/claude') {
          send(200, '');
        } else {
          send(200, JSON.stringify({ ok: true }));
        }
      } else {
        send(400, JSON.stringify({ error: 'Could not parse event' }));
      }
    })
    .catch((err: { code?: string }) => {
      if (err?.code === 'PAYLOAD_TOO_LARGE') {
        send(413, JSON.stringify({ error: 'Payload too large' }));
      } else {
        send(400, JSON.stringify({ error: 'Invalid body' }));
      }
    });
}

export function startEventServer(cbs: EventServerCallbacks, port = DEFAULT_PORT): Promise<number> {
  callbacks = cbs;
  if (server) return Promise.resolve(port);

  // Generate per-session auth token
  authToken = crypto.randomBytes(24).toString('hex');

  return new Promise((resolve, reject) => {
    const srv = http.createServer(handleRequest);
    srv.on('connection', (socket) => {
      activeSockets.add(socket);
      socket.on('close', () => activeSockets.delete(socket));
    });
    srv.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        void vscode.window.showErrorMessage(
          `Event Horizon: Port ${port} is already in use. ` +
          'Another Event Horizon window may be running. Close it and reload this window.',
        );
      }
      reject(err);
    });
    srv.on('listening', () => {
      server = srv;
      resolve(port);
    });
    srv.listen(port, '127.0.0.1');
  });
}

export function stopEventServer(): void {
  if (server) {
    // Destroy active connections so the port is released immediately
    for (const socket of activeSockets) socket.destroy();
    activeSockets.clear();
    server.close();
    server = null;
  }
  callbacks = null;
  authToken = null;
  rateCounts.clear();
}

export function getEventServerPort(): number {
  return DEFAULT_PORT;
}

/** @internal — exposed for testing only. */
export function _setAuthToken(token: string | null): void {
  authToken = token;
}

/** @internal — exposed for testing only. */
export function _setCallbacks(cbs: EventServerCallbacks | null): void {
  callbacks = cbs;
}

/** @internal — exposed for testing only. */
export function _clearRateLimits(): void {
  rateCounts.clear();
}
