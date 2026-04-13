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
import { signJwt, verifyJwt } from '../mcpOAuth.js';

// ── Test HTTP server on random port ─────────────────────────────────────────

let server: http.Server;
let port: number;
let baseUrl: string;
const receivedEvents: AgentEvent[] = [];

function post(path: string, body: unknown, headers?: Record<string, string>): Promise<{ status: number; body: unknown; headers: http.IncomingHttpHeaders }> {
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
          resolve({ status: res.statusCode!, body: JSON.parse(text), headers: res.headers });
        } catch {
          resolve({ status: res.statusCode!, body: text, headers: res.headers });
        }
      });
    });
    req.on('error', reject);
    req.end(data);
  });
}

function get(path: string, headers?: Record<string, string>): Promise<{ status: number; body: unknown; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request(`${baseUrl}${path}`, { method: 'GET', headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try {
          resolve({ status: res.statusCode!, body: JSON.parse(text), headers: res.headers });
        } catch {
          resolve({ status: res.statusCode!, body: text, headers: res.headers });
        }
      });
    });
    req.on('error', reject);
    req.end();
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

    it('rejects ?token= query-string auth (v2.0.0 breaking change)', async () => {
      _setAuthToken('test-secret-token');
      const res = await post('/claude?token=test-secret-token', { hook_event_name: 'SessionStart' });
      expect(res.status).toBe(401);
    });

    it('rejects wrong token', async () => {
      _setAuthToken('test-secret-token');
      const res = await post('/claude', { hook_event_name: 'SessionStart' }, {
        Authorization: 'Bearer wrong-token',
      });
      expect(res.status).toBe(401);
    });
  });

  describe('OAuth 2.1 (RFC 6749/8414/7591/9728)', () => {
    const SECRET = 'test-startup-token-abcdef0123456789';

    it('serves RFC 9728 protected-resource metadata publicly (GET, no auth)', async () => {
      _setAuthToken(SECRET);
      const res = await get('/.well-known/oauth-protected-resource');
      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(typeof body.resource).toBe('string');
      expect(body.authorization_servers).toBeInstanceOf(Array);
      expect(body.bearer_methods_supported).toEqual(['header']);
    });

    it('serves RFC 8414 authorization-server metadata publicly (GET, no auth)', async () => {
      _setAuthToken(SECRET);
      const res = await get('/.well-known/oauth-authorization-server');
      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body.grant_types_supported).toEqual(['authorization_code', 'refresh_token', 'client_credentials']);
      expect(body.response_types_supported).toEqual(['code']);
      expect(body.code_challenge_methods_supported).toEqual(['S256', 'plain']);
      expect(typeof body.authorization_endpoint).toBe('string');
      expect(typeof body.token_endpoint).toBe('string');
      expect(typeof body.registration_endpoint).toBe('string');
    });

    it('/oauth/authorize returns unsupported_response_type (stub endpoint)', async () => {
      _setAuthToken(SECRET);
      const res = await get('/oauth/authorize');
      expect(res.status).toBe(400);
      expect((res.body as { error: string }).error).toBe('unsupported_response_type');
    });

    it('DCR is open (RFC 7591) — registers without auth header', async () => {
      _setAuthToken(SECRET);
      const res = await post('/oauth/register', {});
      expect(res.status).toBe(201);
      const body = res.body as Record<string, unknown>;
      expect(typeof body.client_id).toBe('string');
      expect(body.client_secret).toBe(SECRET);
    });

    it('DCR also works when the caller happens to send a Bearer header', async () => {
      _setAuthToken(SECRET);
      const res = await post('/oauth/register', {}, { Authorization: `Bearer ${SECRET}` });
      expect(res.status).toBe(201);
    });

    it('mints a JWT access token on client_credentials grant', async () => {
      _setAuthToken(SECRET);
      const res = await post('/oauth/token', {
        grant_type: 'client_credentials',
        client_id: 'test-client',
        client_secret: SECRET,
      });
      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(typeof body.access_token).toBe('string');
      expect(body.token_type).toBe('Bearer');

      const verified = verifyJwt(body.access_token as string, SECRET);
      expect(verified.valid).toBe(true);
    });

    it('rejects token request with wrong client_secret', async () => {
      _setAuthToken(SECRET);
      const res = await post('/oauth/token', {
        grant_type: 'client_credentials',
        client_id: 'test-client',
        client_secret: 'wrong',
      });
      expect(res.status).toBe(401);
      expect((res.body as { error: string }).error).toBe('invalid_client');
    });

    it('rejects unsupported grant types', async () => {
      _setAuthToken(SECRET);
      const res = await post('/oauth/token', {
        grant_type: 'password',
        username: 'a',
        password: 'b',
      });
      expect(res.status).toBe(400);
      expect((res.body as { error: string }).error).toBe('unsupported_grant_type');
    });

    it('accepts form-encoded /oauth/token bodies (MCP SDK default)', async () => {
      _setAuthToken(SECRET);
      const formBody = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: 'test-client',
        client_secret: SECRET,
      }).toString();
      const res = await new Promise<{ status: number; body: unknown }>((resolve, reject) => {
        const req = http.request(`${baseUrl}/oauth/token`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(formBody).toString(),
          },
        }, (r) => {
          const chunks: Buffer[] = [];
          r.on('data', (c) => chunks.push(c));
          r.on('end', () => {
            const t = Buffer.concat(chunks).toString('utf8');
            try { resolve({ status: r.statusCode!, body: JSON.parse(t) }); }
            catch { resolve({ status: r.statusCode!, body: t }); }
          });
        });
        req.on('error', reject);
        req.end(formBody);
      });
      expect(res.status).toBe(200);
      expect(typeof (res.body as { access_token: string }).access_token).toBe('string');
    });

    it('full authorization_code + PKCE flow via HTTP', async () => {
      _setAuthToken(SECRET);

      // Step 1 — DCR
      const dcr = await post('/oauth/register', {
        redirect_uris: ['http://localhost:9999/cb'],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        client_name: 'Test Client',
      });
      expect(dcr.status).toBe(201);
      const clientId = (dcr.body as { client_id: string }).client_id;

      // Step 2 — /authorize
      const crypto = await import('crypto');
      const verifier = 'abcdefghijklmnopqrstuvwxyz0123456789abcdef0123';
      const challenge = crypto.createHash('sha256').update(verifier).digest('base64')
        .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
      const authUrl = `/oauth/authorize?${new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: 'http://localhost:9999/cb',
        state: 'abc',
        code_challenge: challenge,
        code_challenge_method: 'S256',
      }).toString()}`;
      const authRes = await get(authUrl);
      expect(authRes.status).toBe(302);
      const loc = String(authRes.headers.location ?? '');
      const code = new URL(loc).searchParams.get('code')!;

      // Step 3 — /token with authorization_code
      const tokenRes = await post('/oauth/token', {
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'http://localhost:9999/cb',
        client_id: clientId,
        code_verifier: verifier,
      });
      expect(tokenRes.status).toBe(200);
      const accessToken = (tokenRes.body as { access_token: string }).access_token;

      // Step 4 — /mcp with the JWT
      const mcpRes = await post('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, {
        Authorization: `Bearer ${accessToken}`,
      });
      // Without a real mcpServer wired the route returns 503; auth itself
      // should have passed (not 401). Accept either 503 or 500.
      expect([500, 503]).toContain(mcpRes.status);
      expect(mcpRes.headers['www-authenticate']).toBeUndefined();
    });

    it('returns 401 + WWW-Authenticate with resource_metadata on /mcp without JWT', async () => {
      _setAuthToken(SECRET);
      const res = await post('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' });
      expect(res.status).toBe(401);
      const wwwAuth = res.headers['www-authenticate'];
      expect(typeof wwwAuth).toBe('string');
      expect(String(wwwAuth)).toMatch(/^Bearer resource_metadata="http:\/\/.+\/\.well-known\/oauth-protected-resource"$/);
    });

    it('rejects /mcp with the startup token used as Bearer (JWT required)', async () => {
      _setAuthToken(SECRET);
      const res = await post('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, {
        Authorization: `Bearer ${SECRET}`,
      });
      expect(res.status).toBe(401);
    });

    it('rejects /mcp with an expired JWT', async () => {
      _setAuthToken(SECRET);
      const expired = signJwt({ sub: 'test', iss: baseUrl }, SECRET, -1);
      const res = await post('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, {
        Authorization: `Bearer ${expired}`,
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
