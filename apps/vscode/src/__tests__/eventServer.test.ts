/**
 * Event server tests — exercises HTTP handling, auth, rate limiting, and payload validation.
 * Uses a real HTTP server on a random port to test the full request lifecycle.
 */

import * as http from 'http';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { AgentEvent } from '@event-horizon/core';
import {
  handleRequest,
  _setAuthToken,
  _setCallbacks,
  _clearRateLimits,
  clamp,
  checkDepth,
  sanitizePayload,
  isRateLimited,
  RATE_LIMIT_RPS,
} from '../eventServer.js';

// ── Test HTTP server on random port ─────────────────────────────────────────

let server: http.Server;
let port: number;
let baseUrl: string;
const receivedEvents: AgentEvent[] = [];

function post(path: string, body: unknown, headers?: Record<string, string>): Promise<{ status: number; body: unknown }> {
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try {
          resolve({ status: res.statusCode!, body: JSON.parse(text) });
        } catch {
          resolve({ status: res.statusCode!, body: text });
        }
      });
    });
    req.on('error', reject);
    req.end(data);
  });
}

beforeAll(() => new Promise<void>((resolve) => {
  server = http.createServer(handleRequest);
  server.listen(0, '127.0.0.1', () => {
    const addr = server.address() as { port: number };
    port = addr.port;
    baseUrl = `http://127.0.0.1:${port}`;
    resolve();
  });
}));

afterAll(() => new Promise<void>((resolve) => {
  _setAuthToken(null);
  _setCallbacks(null);
  _clearRateLimits();
  server.close(() => resolve());
}));

beforeEach(() => {
  receivedEvents.length = 0;
  _setCallbacks({ onEvent: (e) => receivedEvents.push(e) });
  _setAuthToken(null);
  _clearRateLimits();
});

// ── Pure function tests ─────────────────────────────────────────────────────

describe('clamp', () => {
  it('truncates strings', () => {
    expect(clamp('hello world', 5)).toBe('hello');
  });
  it('converts non-strings', () => {
    expect(clamp(123, 10)).toBe('123');
    expect(clamp(null, 10)).toBe('');
    expect(clamp(undefined, 10)).toBe('');
  });
});

describe('checkDepth', () => {
  it('allows shallow objects', () => {
    expect(checkDepth({ a: 1 }, 3)).toBe(true);
  });
  it('rejects too-deep objects', () => {
    const deep = { a: { b: { c: { d: 1 } } } };
    expect(checkDepth(deep, 2)).toBe(false);
    expect(checkDepth(deep, 4)).toBe(true);
  });
  it('handles primitives', () => {
    expect(checkDepth('hello', 0)).toBe(true);
    expect(checkDepth(42, 0)).toBe(true);
  });
});

describe('sanitizePayload', () => {
  it('returns empty object for null/undefined', () => {
    expect(sanitizePayload(null)).toEqual({});
    expect(sanitizePayload(undefined)).toEqual({});
  });
  it('passes valid payloads', () => {
    expect(sanitizePayload({ key: 'value' })).toEqual({ key: 'value' });
  });
  it('rejects deeply nested payloads', () => {
    let obj: Record<string, unknown> = { val: true };
    for (let i = 0; i < 15; i++) obj = { nested: obj };
    expect(sanitizePayload(obj)).toBeNull();
  });
  it('rejects oversized payloads', () => {
    const big = { data: 'x'.repeat(70_000) };
    expect(sanitizePayload(big)).toBeNull();
  });
});

describe('isRateLimited', () => {
  it('allows requests under the limit', () => {
    _clearRateLimits();
    for (let i = 0; i < RATE_LIMIT_RPS; i++) {
      expect(isRateLimited('test-addr')).toBe(false);
    }
  });
  it('blocks requests over the limit', () => {
    _clearRateLimits();
    for (let i = 0; i < RATE_LIMIT_RPS; i++) isRateLimited('test-addr-2');
    expect(isRateLimited('test-addr-2')).toBe(true);
  });
});

// ── HTTP integration tests ──────────────────────────────────────────────────

describe('HTTP server', () => {
  describe('routing', () => {
    it('rejects GET requests with 404', async () => {
      const res = await new Promise<{ status: number; body: unknown }>((resolve, reject) => {
        http.get(`${baseUrl}/claude`, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve({
            status: res.statusCode!,
            body: JSON.parse(Buffer.concat(chunks).toString()),
          }));
        }).on('error', reject);
      });
      expect(res.status).toBe(404);
    });

    it('returns 400 for unknown routes', async () => {
      const res = await post('/unknown', { hook_event_name: 'SessionStart' });
      expect(res.status).toBe(400);
    });
  });

  describe('auth', () => {
    it('rejects requests without token when auth is enabled', async () => {
      _setAuthToken('test-secret-token');
      const res = await post('/claude', { hook_event_name: 'SessionStart' });
      expect(res.status).toBe(401);
    });

    it('accepts Bearer token in Authorization header', async () => {
      _setAuthToken('test-secret-token');
      const res = await post('/claude', { hook_event_name: 'SessionStart' }, {
        Authorization: 'Bearer test-secret-token',
      });
      expect(res.status).toBe(200);
    });

    it('accepts token in query parameter', async () => {
      _setAuthToken('test-secret-token');
      const res = await post('/claude?token=test-secret-token', { hook_event_name: 'SessionStart' });
      expect(res.status).toBe(200);
    });

    it('rejects wrong token', async () => {
      _setAuthToken('test-secret-token');
      const res = await post('/claude', { hook_event_name: 'SessionStart' }, {
        Authorization: 'Bearer wrong-token',
      });
      expect(res.status).toBe(401);
    });
  });

  describe('/claude route', () => {
    it('maps SessionStart to agent.spawn', async () => {
      const res = await post('/claude', {
        hook_event_name: 'SessionStart',
        session_id: 'sess-1',
      });
      expect(res.status).toBe(200);
      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].type).toBe('agent.spawn');
      expect(receivedEvents[0].agentId).toBe('sess-1');
      expect(receivedEvents[0].agentType).toBe('claude-code');
    });

    it('maps PreToolUse to tool.call with toolName', async () => {
      const res = await post('/claude', {
        hook_event_name: 'PreToolUse',
        session_id: 'sess-1',
        tool_name: 'Read',
      });
      expect(res.status).toBe(200);
      expect(receivedEvents[0].type).toBe('tool.call');
      expect(receivedEvents[0].payload?.toolName).toBe('Read');
    });

    it('rejects unknown hook events', async () => {
      const res = await post('/claude', { hook_event_name: 'UnknownEvent' });
      expect(res.status).toBe(400);
    });
  });

  describe('/opencode route', () => {
    it('maps session.created to agent.spawn', async () => {
      const res = await post('/opencode', {
        event: 'session.created',
        agentId: 'oc-1',
        agentName: 'OpenCode',
      });
      expect(res.status).toBe(200);
      expect(receivedEvents[0].type).toBe('agent.spawn');
      expect(receivedEvents[0].agentType).toBe('opencode');
    });
  });

  describe('/events route', () => {
    it('accepts valid raw events', async () => {
      const res = await post('/events', {
        id: 'evt-1',
        agentId: 'agent-1',
        agentName: 'Test',
        agentType: 'claude-code',
        type: 'agent.spawn',
        timestamp: Date.now(),
        payload: {},
      });
      expect(res.status).toBe(200);
      expect(receivedEvents[0].agentId).toBe('agent-1');
    });

    it('falls back to unknown for invalid agentType', async () => {
      const res = await post('/events', {
        id: 'evt-2',
        agentId: 'agent-2',
        agentType: 'invalid-type',
        type: 'agent.spawn',
        timestamp: Date.now(),
      });
      expect(res.status).toBe(200);
      expect(receivedEvents[0].agentType).toBe('unknown');
    });

    it('rejects invalid event type', async () => {
      const res = await post('/events', {
        id: 'evt-3',
        agentId: 'agent-3',
        type: 'not.a.real.type',
        timestamp: Date.now(),
      });
      expect(res.status).toBe(400);
    });

    it('rejects deeply nested payloads', async () => {
      let nested: Record<string, unknown> = { v: true };
      for (let i = 0; i < 15; i++) nested = { n: nested };
      const res = await post('/events', {
        id: 'evt-4',
        agentId: 'agent-4',
        type: 'agent.spawn',
        timestamp: Date.now(),
        payload: nested,
      });
      expect(res.status).toBe(400);
      expect((res.body as { error: string }).error).toContain('nested');
    });

    it('clamps oversized string fields', async () => {
      const longId = 'x'.repeat(300);
      const res = await post('/events', {
        id: longId,
        agentId: longId,
        agentName: longId,
        type: 'agent.spawn',
        timestamp: Date.now(),
      });
      expect(res.status).toBe(200);
      expect(receivedEvents[0].id.length).toBeLessThanOrEqual(128);
      expect(receivedEvents[0].agentId.length).toBeLessThanOrEqual(128);
      expect(receivedEvents[0].agentName.length).toBeLessThanOrEqual(64);
    });
  });

  describe('error handling', () => {
    it('returns 400 for invalid JSON body', async () => {
      const res = await new Promise<{ status: number; body: unknown }>((resolve, reject) => {
        const req = http.request(`${baseUrl}/claude`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve({
            status: res.statusCode!,
            body: JSON.parse(Buffer.concat(chunks).toString()),
          }));
        });
        req.on('error', reject);
        req.end('not valid json {{{');
      });
      expect(res.status).toBe(400);
    });

    it('returns 503 when callbacks not set', async () => {
      _setCallbacks(null);
      const res = await post('/claude', { hook_event_name: 'SessionStart' });
      expect(res.status).toBe(503);
    });
  });
});
