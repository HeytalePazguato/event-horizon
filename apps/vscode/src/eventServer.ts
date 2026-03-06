/**
 * Local HTTP server in extension host for receiving agent events.
 */

import * as http from 'http';
import type { AgentEvent } from '@event-horizon/core';
import { mapOpenCodeToEvent } from '@event-horizon/connectors';
import { mapClaudeHookToEvent } from '@event-horizon/connectors';

const DEFAULT_PORT = 28765;

export interface EventServerCallbacks {
  onEvent: (event: AgentEvent) => void;
}

let server: http.Server | null = null;
let callbacks: EventServerCallbacks | null = null;

function parseBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
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
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(body);
  };

  if (req.method !== 'POST' || !req.url?.startsWith('/')) {
    send(404, JSON.stringify({ error: 'Not found' }));
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
        if (typeof b.agentId === 'string' && typeof b.type === 'string' && b.id != null && b.timestamp != null) {
          event = {
            id: String(b.id),
            agentId: b.agentId,
            agentName: typeof b.agentName === 'string' ? b.agentName : b.agentId,
            agentType: (typeof b.agentType === 'string' ? b.agentType : 'unknown') as AgentEvent['agentType'],
            type: b.type as AgentEvent['type'],
            timestamp: Number(b.timestamp),
            payload: (b.payload as Record<string, unknown>) ?? {},
          };
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
    .catch(() => send(400, JSON.stringify({ error: 'Invalid body' })));
}

export function startEventServer(cbs: EventServerCallbacks, port = DEFAULT_PORT): number {
  callbacks = cbs;
  if (server) return port;
  server = http.createServer(handleRequest);
  server.listen(port, '127.0.0.1', () => {});
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
