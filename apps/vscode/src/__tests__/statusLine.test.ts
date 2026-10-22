/**
 * statusLine bridge tests — payload parsing, the /claude/status route, and
 * measured cache figures taking precedence in TokenAnalyzer.
 */

import * as http from 'http';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { parseStatusLinePayload, type StatusLineSnapshot } from '../statusLine.js';
import { handleRequest, _setAuthToken, _setCallbacks, _clearRateLimits } from '../eventServer.js';
import { TokenAnalyzer } from '../tokenAnalyzer.js';

const SAMPLE = {
  session_id: 'sess-42',
  model: { id: 'claude-opus-5', display_name: 'Opus 5' },
  cost: { total_cost_usd: 1.2345, total_duration_ms: 45000 },
  context_window: { total_input_tokens: 15500, total_output_tokens: 1200, context_window_size: 200000, used_percentage: 8 },
  prompt_cache: { hit_ratio: 0.91, cache_write_tokens: 352000, expires_at: 1738429200, miss_causes: { tools_changed: 2 } },
};

describe('parseStatusLinePayload', () => {
  it('extracts cost, model, context and cache figures', () => {
    expect(parseStatusLinePayload(SAMPLE)).toEqual({
      sessionId: 'sess-42',
      model: 'claude-opus-5',
      costUsd: 1.2345,
      contextUsedPercentage: 8,
      contextWindowSize: 200000,
      totalInputTokens: 15500,
      totalOutputTokens: 1200,
      cacheHitRatio: 0.91,
      cacheWriteTokens: 352000,
      cacheMissCauses: { tools_changed: 2 },
      cacheExpiresAt: 1738429200,
    });
  });

  it('returns null without a session id', () => {
    expect(parseStatusLinePayload({ ...SAMPLE, session_id: undefined })).toBeNull();
    expect(parseStatusLinePayload(null)).toBeNull();
    expect(parseStatusLinePayload('x')).toBeNull();
  });

  it('drops out-of-range and non-numeric values instead of trusting them', () => {
    const snap = parseStatusLinePayload({ session_id: 's', cost: { total_cost_usd: -3 }, prompt_cache: { hit_ratio: 7 }, context_window: { used_percentage: 'lots' } })!;
    expect(snap.costUsd).toBeUndefined();
    expect(snap.cacheHitRatio).toBeUndefined();
    expect(snap.contextUsedPercentage).toBeUndefined();
  });

  it('tolerates a minimal payload', () => {
    expect(parseStatusLinePayload({ session_id: 's' })).toEqual(expect.objectContaining({ sessionId: 's', costUsd: undefined }));
  });
});

describe('TokenAnalyzer measured cache', () => {
  it('prefers the measured hit ratio over the token estimate and reports causes and context', () => {
    const t = new TokenAnalyzer();
    t.onEvent({ id: '1', agentId: 'a', agentName: 'a', agentType: 'claude-code', type: 'agent.idle', timestamp: 1, payload: { inputTokens: 1000, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 10 } });
    t.recordMeasuredCache('a', { hitRatio: 0.9, missCauses: { tools_changed: 1 }, contextUsedPercentage: 42, contextWindowSize: 200000 });
    const insights = t.getInsights();
    expect(insights.cacheHitByAgent.a).toBe(0.9);
    expect(insights.measuredCacheAgents).toEqual(['a']);
    expect(insights.cacheMissCauses).toEqual({ a: { tools_changed: 1 } });
    expect(insights.contextUsage).toEqual({ a: { usedPercentage: 42, windowSize: 200000 } });
  });
});

let server: http.Server;
let baseUrl: string;
const TOKEN = 'tok-status';
let snapshots: StatusLineSnapshot[] = [];

function post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(`${baseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode!, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

beforeAll(() => new Promise<void>((resolve) => {
  server = http.createServer(handleRequest);
  server.listen(0, '127.0.0.1', () => {
    baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
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
  snapshots = [];
  _clearRateLimits();
  _setAuthToken(TOKEN);
  _setCallbacks({ onEvent: () => {}, onStatusLine: (s) => snapshots.push(s) });
});

describe('POST /claude/status', () => {
  it('requires the bearer token', async () => {
    expect((await post('/claude/status', SAMPLE)).status).toBe(401);
    expect(snapshots).toHaveLength(0);
  });

  it('answers 200 with an empty body and delivers the snapshot', async () => {
    const res = await post('/claude/status', SAMPLE, { Authorization: `Bearer ${TOKEN}` });
    expect(res).toEqual({ status: 200, text: '' });
    expect(snapshots[0]).toMatchObject({ sessionId: 'sess-42', costUsd: 1.2345, cacheHitRatio: 0.91 });
  });

  it('rejects a payload without a session id', async () => {
    const res = await post('/claude/status', { cost: { total_cost_usd: 1 } }, { Authorization: `Bearer ${TOKEN}` });
    expect(res.status).toBe(400);
    expect(snapshots).toHaveLength(0);
  });
});
