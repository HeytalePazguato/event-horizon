/**
 * OTLP forwarder tests — verbatim body and headers against a real local HTTP
 * collector, no EH enrichment, failure isolation, and unsupported protocols.
 */

import * as http from 'http';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { OtlpForwarder, parseOtlpHeaders, acceptsJson } from '../otlp/otlpForwarder.js';

let collector: http.Server;
let collectorUrl: string;
let received: Array<{ url: string; headers: http.IncomingHttpHeaders; body: string }> = [];
let respondWith = 200;
let delayMs = 0;

beforeAll(() => new Promise<void>((resolve) => {
  collector = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      received.push({ url: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
      setTimeout(() => { res.statusCode = respondWith; res.end('{}'); }, delayMs);
    });
  });
  collector.listen(0, '127.0.0.1', () => {
    collectorUrl = `http://127.0.0.1:${(collector.address() as { port: number }).port}`;
    resolve();
  });
}));

afterAll(() => new Promise<void>((resolve) => collector.close(() => resolve())));

beforeEach(() => { received = []; respondWith = 200; delayMs = 0; });

const RAW = '{ "resourceMetrics": [ {"scopeMetrics":[]} ] ,"x":1}';

describe('OtlpForwarder', () => {
  it('forwards the body byte-for-byte with the original content type', async () => {
    const f = new OtlpForwarder();
    f.setTargets({ metrics: { endpoint: `${collectorUrl}/v1/metrics`, protocol: 'http/json' } });
    expect(await f.forward('metrics', RAW, 'application/json')).toBe(true);
    expect(received).toHaveLength(1);
    expect(received[0].url).toBe('/v1/metrics');
    expect(received[0].body).toBe(RAW);
    expect(received[0].headers['content-type']).toBe('application/json');
  });

  it("sends the user's original headers and nothing from Event Horizon", async () => {
    const f = new OtlpForwarder();
    f.setTargets({ logs: { endpoint: `${collectorUrl}/v1/logs`, headers: 'x-api-key=corp%20key,x-team=obs' } });
    await f.forward('logs', RAW, 'application/json');
    const h = received[0].headers;
    expect(h['x-api-key']).toBe('corp key');
    expect(h['x-team']).toBe('obs');
    expect(h.authorization).toBeUndefined();
    expect(Object.keys(h).filter((k) => k.startsWith('x-eh') || k.includes('event-horizon'))).toEqual([]);
  });

  it('does nothing without a target for the signal', async () => {
    const f = new OtlpForwarder();
    f.setTargets({ metrics: { endpoint: `${collectorUrl}/v1/metrics` } });
    expect(await f.forward('logs', RAW, 'application/json')).toBe(false);
    expect(received).toHaveLength(0);
  });

  it('reports a collector error without throwing', async () => {
    respondWith = 500;
    const f = new OtlpForwarder();
    f.setTargets({ metrics: { endpoint: `${collectorUrl}/v1/metrics` } });
    expect(await f.forward('metrics', RAW, 'application/json')).toBe(false);
    expect(f.lastError.metrics).toBe('HTTP 500');
  });

  it('survives an unreachable collector', async () => {
    const f = new OtlpForwarder();
    f.setTargets({ metrics: { endpoint: 'http://127.0.0.1:1/v1/metrics' } });
    await expect(f.forward('metrics', RAW, 'application/json')).resolves.toBe(false);
    expect(f.lastError.metrics).toBeDefined();
  });

  it('gives up on a slow collector at the timeout', async () => {
    const f = new OtlpForwarder(((_url: string, init: { signal: AbortSignal }) =>
      new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))) as never);
    f.setTargets({ metrics: { endpoint: 'http://example.invalid/v1/metrics' } });
    const started = Date.now();
    expect(await f.forward('metrics', RAW, 'application/json')).toBe(false);
    expect(Date.now() - started).toBeLessThan(7_000);
  }, 10_000);

  it('skips grpc / protobuf targets and warns once', async () => {
    const warnings: string[] = [];
    const f = new OtlpForwarder(undefined, (m) => warnings.push(m));
    f.setTargets({ metrics: { endpoint: `${collectorUrl}/v1/metrics`, protocol: 'grpc' } });
    expect(await f.forward('metrics', RAW, 'application/json')).toBe(false);
    expect(await f.forward('metrics', RAW, 'application/json')).toBe(false);
    expect(received).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('grpc');
  });
});

describe('parseOtlpHeaders / acceptsJson', () => {
  it('parses comma-separated, percent-encoded pairs', () => {
    expect(parseOtlpHeaders('Authorization=Bearer%20abc, x-a = 1 ,bad,=nokey')).toEqual({ Authorization: 'Bearer abc', 'x-a': '1' });
    expect(parseOtlpHeaders(undefined)).toEqual({});
  });

  it('accepts http/json and unspecified protocols only', () => {
    expect(acceptsJson({ endpoint: 'x' })).toBe(true);
    expect(acceptsJson({ endpoint: 'x', protocol: 'http/json' })).toBe(true);
    expect(acceptsJson({ endpoint: 'x', protocol: 'http/protobuf' })).toBe(false);
    expect(acceptsJson({ endpoint: 'x', protocol: 'grpc' })).toBe(false);
  });
});
