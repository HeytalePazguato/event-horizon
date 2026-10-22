/**
 * OTLP route tests — auth, the empty OTLP response, parsed delivery, and the
 * raw body handed through untouched for forwarding.
 */

import * as http from 'http';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { handleRequest, _setAuthToken, _setCallbacks, _clearRateLimits } from '../eventServer.js';
import type { OtlpMetricSample, OtlpLogRecord } from '../otlp/otlpReceiver.js';

let server: http.Server;
let baseUrl: string;
const TOKEN = 'test-token-otlp';

let metricCalls: Array<{ samples: OtlpMetricSample[]; raw: string; contentType: string }> = [];
let logCalls: Array<{ records: OtlpLogRecord[]; raw: string }> = [];

function postRaw(path: string, raw: string, headers: Record<string, string> = {}): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(`${baseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode!, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(raw);
  });
}

const auth = { Authorization: `Bearer ${TOKEN}` };

// Deliberately irregular whitespace: forwarding must see these exact bytes.
const METRICS_RAW = '{ "resourceMetrics":[{"scopeMetrics":[{"metrics":[{"name":"claude_code.cost.usage","sum":{"aggregationTemporality":1,"dataPoints":[{"attributes":[{"key":"session.id","value":{"stringValue":"sess-1"}},{"key":"model","value":{"stringValue":"claude-opus-5"}}],"timeUnixNano":"1000000","asDouble":0.5}]}}]}]}] }';
const LOGS_RAW = '{"resourceLogs":[{"scopeLogs":[{"logRecords":[{"attributes":[{"key":"event.name","value":{"stringValue":"api_request"}},{"key":"session.id","value":{"stringValue":"sess-1"}}]}]}]}]}';

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
  metricCalls = [];
  logCalls = [];
  _clearRateLimits();
  _setAuthToken(TOKEN);
  _setCallbacks({
    onEvent: () => {},
    onOtlpMetrics: (samples, raw, contentType) => metricCalls.push({ samples, raw, contentType }),
    onOtlpLogs: (records, raw) => logCalls.push({ records, raw }),
  });
});

describe('POST /otlp/v1/metrics', () => {
  it('rejects requests without the bearer token', async () => {
    const res = await postRaw('/otlp/v1/metrics', METRICS_RAW);
    expect(res.status).toBe(401);
    expect(metricCalls).toHaveLength(0);
  });

  it('rejects a wrong token', async () => {
    const res = await postRaw('/otlp/v1/metrics', METRICS_RAW, { Authorization: 'Bearer nope' });
    expect(res.status).toBe(401);
  });

  it('answers 200 with an empty export response and delivers parsed samples', async () => {
    const res = await postRaw('/otlp/v1/metrics', METRICS_RAW, auth);
    expect(res.status).toBe(200);
    expect(res.text).toBe('{}');
    expect(metricCalls).toHaveLength(1);
    expect(metricCalls[0].samples[0]).toMatchObject({ metric: 'cost', sessionId: 'sess-1', model: 'claude-opus-5', value: 0.5 });
  });

  it('passes the raw body through byte-for-byte with its content type', async () => {
    await postRaw('/otlp/v1/metrics', METRICS_RAW, auth);
    expect(metricCalls[0].raw).toBe(METRICS_RAW);
    expect(metricCalls[0].contentType).toBe('application/json');
  });

  it('still answers 200 when the handler throws', async () => {
    _setCallbacks({ onEvent: () => {}, onOtlpMetrics: () => { throw new Error('boom'); } });
    const res = await postRaw('/otlp/v1/metrics', METRICS_RAW, auth);
    expect(res.status).toBe(200);
  });
});

describe('POST /otlp/v1/logs', () => {
  it('delivers parsed log records and the raw body', async () => {
    const res = await postRaw('/otlp/v1/logs', LOGS_RAW, auth);
    expect(res.status).toBe(200);
    expect(logCalls[0].records[0]).toMatchObject({ name: 'api_request', sessionId: 'sess-1' });
    expect(logCalls[0].raw).toBe(LOGS_RAW);
  });

  it('rejects requests without the bearer token', async () => {
    expect((await postRaw('/otlp/v1/logs', LOGS_RAW)).status).toBe(401);
  });
});
