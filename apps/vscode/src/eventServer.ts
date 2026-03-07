/**
 * Local HTTP server in extension host for receiving agent events.
 * Binds to 127.0.0.1 only — not reachable from the network.
 */

import * as http from 'http';
import * as vscode from 'vscode';
import type { AgentEvent } from '@event-horizon/core';
import { AGENT_EVENT_TYPES } from '@event-horizon/core';
import { mapOpenCodeToEvent, mapClaudeHookToEvent } from '@event-horizon/connectors';

const DEFAULT_PORT = 28765;
// 1.1 — reject requests larger than 1 MB to prevent memory exhaustion
const MAX_BODY_BYTES = 1_048_576;
// 1.2 — rate limiting: max requests per second per remote address
const RATE_LIMIT_RPS = 200;

export interface EventServerCallbacks {
  onEvent: (event: AgentEvent) => void;
}

let server: http.Server | null = null;
let callbacks: EventServerCallbacks | null = null;

// 1.2 — sliding-window rate limiter
const rateCounts = new Map<string, { count: number; resetAt: number }>();
function isRateLimited(addr: string): boolean {
  const now = Date.now();
  let entry = rateCounts.get(addr);
  if (!entry || now >= entry.resetAt) {
    // Clean up expired entries to prevent unbounded growth
    for (const [k, v] of rateCounts) { if (now >= v.resetAt) rateCounts.delete(k); }
    entry = { count: 0, resetAt: now + 1000 };
    rateCounts.set(addr, entry);
  }
  entry.count++;
  return entry.count > RATE_LIMIT_RPS;
}

// 1.4 — clamp string length from untrusted input
function clamp(s: unknown, max: number): string {
  return typeof s === 'string' ? s.slice(0, max) : String(s ?? '').slice(0, max);
}

function parseBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    req.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        // 1.1 — destroy connection and reject; response sent in handleRequest
        req.destroy();
        reject(Object.assign(new Error('Payload too large'), { code: 'PAYLOAD_TOO_LARGE' }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
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

  // 1.2 — rate limit by remote address
  const addr = req.socket.remoteAddress ?? '127.0.0.1';
  if (isRateLimited(addr)) {
    send(429, JSON.stringify({ error: 'Too many requests' }));
    return;
  }

  parseBody(req)
    .then((body) => {
      const cb = callbacks;
      if (!cb) {
        send(503, JSON.stringify({ error: 'Not ready' }));
        return;
      }

      let event: AgentEvent | null = null;
      if (req.url === '/claude') {
        event = mapClaudeHookToEvent(body);
      } else if (req.url === '/opencode') {
        event = mapOpenCodeToEvent(body);
      } else if (req.url === '/events' && typeof body === 'object' && body !== null) {
        const b = body as Record<string, unknown>;
        // 1.3 — validate event type against the known list before constructing the event
        const eventType = typeof b.type === 'string' ? b.type : '';
        if (
          typeof b.agentId === 'string' && b.id != null && b.timestamp != null &&
          (AGENT_EVENT_TYPES as readonly string[]).includes(eventType)
        ) {
          event = {
            id: clamp(b.id, 128),
            agentId: clamp(b.agentId, 128),          // 1.4
            agentName: clamp(b.agentName ?? b.agentId, 64), // 1.4
            agentType: (typeof b.agentType === 'string' ? b.agentType : 'unknown') as AgentEvent['agentType'],
            type: eventType as AgentEvent['type'],
            timestamp: Number(b.timestamp),
            payload: (b.payload as Record<string, unknown>) ?? {},
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
        send(200, JSON.stringify({ ok: true }));
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

export function startEventServer(cbs: EventServerCallbacks, port = DEFAULT_PORT): number {
  callbacks = cbs;
  if (server) return port;
  server = http.createServer(handleRequest);
  // 2.3 — report port conflicts to the user instead of silently failing
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      void vscode.window.showErrorMessage(
        `Event Horizon: Port ${port} is already in use. ` +
        'Another Event Horizon window may be running. Close it and reload this window.',
      );
    }
  });
  server.listen(port, '127.0.0.1');
  return port;
}

export function stopEventServer(): void {
  if (server) {
    server.close();
    server = null;
  }
  callbacks = null;
}

export function getEventServerPort(): number {
  return DEFAULT_PORT;
}
