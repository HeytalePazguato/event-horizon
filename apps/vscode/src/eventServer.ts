/**
 * Local HTTP server in extension host for receiving agent events.
 * Binds to 127.0.0.1 only — not reachable from the network.
 */

import * as crypto from 'crypto';
import * as http from 'http';
import * as vscode from 'vscode';
import { WebSocketServer, WebSocket } from 'ws';
import type { AgentEvent } from '@event-horizon/core';
import { AGENT_EVENT_TYPES, AGENT_TYPES } from '@event-horizon/core';
import { mapOpenCodeToEvent, mapClaudeHookToEvent, mapCopilotHookToEvent, mapCursorHookToEvent } from '@event-horizon/connectors';

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

// ── WebSocket state ──
let wss: WebSocketServer | null = null;
const wsClients = new Set<WebSocket>();

/** Debounced broadcast buffer — accumulates events for 100ms before sending. */
let wsBroadcastBuffer: Array<{ type: string; agentId: string; timestamp: number }> = [];
let wsBroadcastTimer: ReturnType<typeof setTimeout> | null = null;
const WS_DEBOUNCE_MS = 100;
const WS_PING_INTERVAL_MS = 30_000;

function wsBroadcast(event: AgentEvent): void {
  wsBroadcastBuffer.push({
    type: event.type,
    agentId: event.agentId,
    timestamp: event.timestamp,
  });
  if (wsBroadcastTimer === null) {
    wsBroadcastTimer = setTimeout(flushWsBroadcast, WS_DEBOUNCE_MS);
  }
}

function flushWsBroadcast(): void {
  wsBroadcastTimer = null;
  if (wsBroadcastBuffer.length === 0 || wsClients.size === 0) {
    wsBroadcastBuffer = [];
    return;
  }
  const payload = JSON.stringify({ type: 'events-processed', events: wsBroadcastBuffer });
  wsBroadcastBuffer = [];
  for (const client of wsClients) {
    if (client.readyState === WebSocket.OPEN) {
      try { client.send(payload); } catch { /* drop failed sends */ }
    }
  }
}

// Per-session auth token — generated once at server start, required on all requests.
let authToken: string | null = null;

/** Returns the current auth token (for hooks to include in requests). */
export function getAuthToken(): string | null {
  return authToken;
}

// ── File lock manager (extracted to lockManager.ts) ─────────────────────────
import { LockManager } from './lockManager.js';
import { McpServer, FileActivityTracker } from './mcpServer.js';
import { PlanBoardManager } from './planBoard.js';
import { MessageQueue } from './messageQueue.js';
import { RoleManager } from './roleManager.js';
import { AgentProfiler } from './agentProfiler.js';
import { SharedKnowledgeStore } from './sharedKnowledge.js';
import { SpawnRegistry, ClaudeCodeSpawner, OpenCodeSpawner, CursorSpawner } from './spawnRegistry.js';
import { SessionStore } from './sessionStore.js';
import { syncSkillsForAgent } from './skillSync.js';
import { HeartbeatManager } from './heartbeatManager.js';
import { WorktreeManager } from './worktreeManager.js';
import { BudgetManager } from './budgetManager.js';
import { TraceStore } from './traceStore.js';
import { ModelTierManager } from './modelTierManager.js';
import { TokenAnalyzer } from './tokenAnalyzer.js';

export const lockManager = new LockManager(30_000);
export const fileActivityTracker = new FileActivityTracker();
export const planBoardManager = new PlanBoardManager();
export const messageQueue = new MessageQueue();
export const roleManager = new RoleManager();
export const agentProfiler = new AgentProfiler();
export const sharedKnowledge = new SharedKnowledgeStore();
export const spawnRegistry = new SpawnRegistry();
export const sessionStore = new SessionStore();
export const heartbeatManager = new HeartbeatManager();
export const worktreeManager = new WorktreeManager();
export const budgetManager = new BudgetManager();
export const traceStore = new TraceStore();
export const modelTierManager = new ModelTierManager();
export const tokenAnalyzer = new TokenAnalyzer();

// MCP server — initialized lazily when agentStateManager is provided
let mcpServer: McpServer | null = null;

/** Initialize the MCP server with runtime dependencies. Must be called after extension activates. */
export function initMcpServer(deps: {
  agentStateManager: import('@event-horizon/core').AgentStateManager;
  metricsEngine?: import('@event-horizon/core').MetricsEngine;
}): void {
  // Register spawn backends
  const getToken = () => authToken;
  spawnRegistry.register(new ClaudeCodeSpawner(spawnRegistry, DEFAULT_PORT, getToken));
  spawnRegistry.register(new OpenCodeSpawner(spawnRegistry, DEFAULT_PORT, getToken));
  spawnRegistry.register(new CursorSpawner(spawnRegistry, DEFAULT_PORT, getToken));
  spawnRegistry.worktreeManager = worktreeManager;

  mcpServer = new McpServer({
    lockManager,
    agentStateManager: deps.agentStateManager,
    fileActivityTracker,
    planBoardManager,
    messageQueue,
    roleManager,
    agentProfiler,
    sharedKnowledge,
    getMetrics: deps.metricsEngine
      ? (agentId: string) => deps.metricsEngine!.getMetrics(agentId) ?? undefined
      : undefined,
    spawnRegistry,
    sessionStore,
    syncSkills: syncSkillsForAgent,
    heartbeatManager,
    worktreeManager,
    budgetManager,
    traceStore,
    workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    modelTierManager,
    tokenAnalyzer,
  });
}

/** @internal — exposed for testing only. */
export function _getMcpServer(): McpServer | null { return mcpServer; }
/** @internal — exposed for testing only. */
export function _setMcpServer(s: McpServer | null): void { mcpServer = s; }

// Backward-compat exports used by extension.ts
export function setFileLockingEnabled(enabled: boolean): void { lockManager.setEnabled(enabled); }
export function isFileLockingEnabled(): boolean { return lockManager.isEnabled(); }
export function releaseAgentLocks(agentId: string): void { lockManager.releaseAll(agentId); }
export function getActiveLocks() { return lockManager.getActiveLocks(); }

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

      // ── MCP endpoint (JSON-RPC 2.0) ────────────────────────────────────
      if (route === '/mcp') {
        if (!mcpServer) {
          send(503, JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'MCP server not initialized' }, id: null }));
          return;
        }
        mcpServer.handleRequest(body)
          .then((response) => send(200, JSON.stringify(response)))
          .catch(() => send(500, JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null })));
        return;
      }

      // ── Lock API ──────────────────────────────────────────────────────
      if (route === '/lock') {
        const b = body as Record<string, unknown>;
        const action = b.action as string;
        const filePath = b.filePath as string;
        const agentId = b.agentId as string;
        const agentName = (b.agentName as string) ?? agentId;

        if (!filePath || !agentId) {
          send(400, JSON.stringify({ error: 'Missing filePath or agentId' }));
          return;
        }

        if (action === 'release') {
          lockManager.release(filePath, agentId);
          send(200, JSON.stringify({ released: true }));
          return;
        }

        if (action === 'query') {
          const result = lockManager.query(filePath, agentId);
          send(result.allowed ? 200 : 409, JSON.stringify(result));
          return;
        }

        // Default: check + acquire
        const result = lockManager.acquire(filePath, agentId, agentName, b.reason as string | undefined);
        send(result.allowed ? 200 : 409, JSON.stringify(result));
        return;
      }

      // GET /lock/status — list all active locks (for UI)
      if (route === '/lock/status') {
        send(200, JSON.stringify({ enabled: lockManager.isEnabled(), locks: lockManager.getActiveLocks() }));
        return;
      }

      let event: AgentEvent | null = null;
      if (route === '/claude') {
        event = mapClaudeHookToEvent(body);
      } else if (route === '/copilot') {
        event = mapCopilotHookToEvent(body);
      } else if (route === '/opencode') {
        event = mapOpenCodeToEvent(body);
      } else if (route === '/cursor') {
        event = mapCursorHookToEvent(body);
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

const MAX_PORT_RETRIES = 5;

function tryListenOnPort(srv: http.Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      srv.removeListener('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      srv.removeListener('error', onError);
      resolve(port);
    };
    srv.once('error', onError);
    srv.once('listening', onListening);
    srv.listen(port, '127.0.0.1');
  });
}

/** Set a pre-existing auth token (restored from globalState). */
export function setAuthToken(token: string): void {
  authToken = token;
}

export async function startEventServer(cbs: EventServerCallbacks, port = DEFAULT_PORT): Promise<number> {
  callbacks = cbs;
  if (server) return port;

  // Use existing token if set (restored from globalState), otherwise generate new one
  if (!authToken) {
    authToken = crypto.randomBytes(24).toString('hex');
  }

  const srv = http.createServer(handleRequest);
  srv.on('connection', (socket) => {
    activeSockets.add(socket);
    socket.on('close', () => activeSockets.delete(socket));
  });

  // ── WebSocket server on /ws path ──
  const wsEnabled = vscode.workspace.getConfiguration('eventHorizon').get<boolean>('websocket.enabled', true);
  if (wsEnabled) {
    wss = new WebSocketServer({ noServer: true });

    srv.on('upgrade', (req, socket, head) => {
      // Only upgrade on /ws path
      if (req.url !== '/ws') {
        socket.destroy();
        return;
      }
      // Verify auth token (query param or header)
      const url = new URL(req.url, `http://127.0.0.1`);
      const token = url.searchParams.get('token')
        ?? req.headers['authorization']?.replace('Bearer ', '');
      if (authToken && token !== authToken) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      wss!.handleUpgrade(req, socket, head, (ws) => {
        wss!.emit('connection', ws, req);
      });
    });

    wss.on('connection', (ws) => {
      wsClients.add(ws);
      let alive = true;

      ws.on('pong', () => { alive = true; });
      ws.on('close', () => { wsClients.delete(ws); });
      ws.on('error', () => { wsClients.delete(ws); });

      // Handle incoming events via WebSocket
      ws.on('message', (raw) => {
        try {
          const data = JSON.parse(String(raw));
          if (data && typeof data === 'object' && data.type && data.agentId) {
            // Treat as raw AgentEvent
            if (callbacks) callbacks.onEvent(data as AgentEvent);
            ws.send(JSON.stringify({ ok: true, id: data.id }));
          }
        } catch { /* malformed message — ignore */ }
      });

      // Ping/pong health check
      const pingInterval = setInterval(() => {
        if (!alive) {
          ws.terminate();
          wsClients.delete(ws);
          clearInterval(pingInterval);
          return;
        }
        alive = false;
        ws.ping();
      }, WS_PING_INTERVAL_MS);

      ws.on('close', () => clearInterval(pingInterval));
    });
  }

  // Try configured port, then fallback to next ports
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_PORT_RETRIES; attempt++) {
    const tryPort = port + attempt;
    try {
      await tryListenOnPort(srv, tryPort);
      if (attempt > 0) {
        void vscode.window.showInformationMessage(
          `Event Horizon: Port ${port} was busy, using port ${tryPort} instead. ` +
          'Hooks will be updated automatically.',
        );
      }
      server = srv;
      boundPort = tryPort;
      return boundPort;
    } catch (err) {
      lastError = err as Error;
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EADDRINUSE') {
        // Non-port-conflict error — don't retry
        break;
      }
      // Port busy — try next one
    }
  }

  // All ports failed
  void vscode.window.showErrorMessage(
    `Event Horizon: Could not start server on ports ${port}–${port + MAX_PORT_RETRIES}. ` +
    'Another Event Horizon or application may be using these ports. ' +
    `Change the port in Settings (eventHorizon.port) or close the blocking application. Error: ${lastError?.message ?? 'unknown'}`,
  );
  throw lastError ?? new Error('Failed to start event server');
}

export function stopEventServer(): void {
  // Close WebSocket connections
  if (wss) {
    for (const client of wsClients) {
      try { client.terminate(); } catch { /* best effort */ }
    }
    wsClients.clear();
    wss.close();
    wss = null;
  }
  if (wsBroadcastTimer) {
    clearTimeout(wsBroadcastTimer);
    wsBroadcastTimer = null;
  }
  wsBroadcastBuffer = [];

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

/** Broadcast an event notification to all connected WebSocket clients (debounced at 100ms). */
export { wsBroadcast };

let boundPort = DEFAULT_PORT;

export function getEventServerPort(): number {
  return boundPort;
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
