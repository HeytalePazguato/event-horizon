/**
 * OTel env block tests — merge rules, opt-outs, content gates, forwarding
 * capture, and exact restore. File I/O runs against a temp home directory.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  computeTelemetryEnv,
  restoreTelemetryEnv,
  setupTelemetryEnv,
  removeTelemetryEnv,
  readTelemetryBackup,
  defaultTelemetryEnvPaths,
  CONTENT_GATES,
  MANAGED_KEYS,
} from '../setupTelemetryEnv.js';

const PORT = 28765;
const TOKEN = 'tok-123';

describe('computeTelemetryEnv', () => {
  it('enables per-signal OTLP export to Event Horizon', () => {
    const { status, env } = computeTelemetryEnv({}, null, PORT, TOKEN);
    expect(status).toBe('applied');
    expect(env).toMatchObject({
      CLAUDE_CODE_ENABLE_TELEMETRY: '1',
      OTEL_METRICS_EXPORTER: 'otlp',
      OTEL_LOGS_EXPORTER: 'otlp',
      OTEL_EXPORTER_OTLP_METRICS_PROTOCOL: 'http/json',
      OTEL_EXPORTER_OTLP_LOGS_PROTOCOL: 'http/json',
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: 'http://127.0.0.1:28765/otlp/v1/metrics',
      OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: 'http://127.0.0.1:28765/otlp/v1/logs',
      OTEL_EXPORTER_OTLP_METRICS_HEADERS: 'Authorization=Bearer tok-123',
      OTEL_METRIC_EXPORT_INTERVAL: '10000',
    });
  });

  it('pins every content gate to "0"', () => {
    const { env } = computeTelemetryEnv({}, null, PORT, TOKEN);
    for (const gate of CONTENT_GATES) expect(env[gate]).toBe('0');
    expect(CONTENT_GATES).toEqual(expect.arrayContaining(['OTEL_LOG_USER_PROMPTS', 'OTEL_LOG_ASSISTANT_RESPONSES', 'OTEL_LOG_TOOL_CONTENT', 'OTEL_LOG_RAW_API_BODIES']));
  });

  it('keeps a content gate the user set explicitly', () => {
    const { env } = computeTelemetryEnv({ OTEL_LOG_USER_PROMPTS: '1' }, null, PORT, TOKEN);
    expect(env.OTEL_LOG_USER_PROMPTS).toBe('1');
    expect(env.OTEL_LOG_RAW_API_BODIES).toBe('0');
  });

  it('never writes the generic OTEL_EXPORTER_OTLP_* variables (they may serve traces)', () => {
    const current = { OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.corp:4318', OTEL_EXPORTER_OTLP_HEADERS: 'x-api-key=corp', OTEL_TRACES_EXPORTER: 'otlp' };
    const { env } = computeTelemetryEnv(current, null, PORT, TOKEN);
    expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe('https://collector.corp:4318');
    expect(env.OTEL_EXPORTER_OTLP_HEADERS).toBe('x-api-key=corp');
    expect(env.OTEL_EXPORTER_OTLP_PROTOCOL).toBeUndefined();
    for (const k of MANAGED_KEYS) expect(k.startsWith('OTEL_EXPORTER_OTLP_') ? /_(METRICS|LOGS)_/.test(k) : true).toBe(true);
  });

  it('preserves unrelated env keys', () => {
    const { env } = computeTelemetryEnv({ FOO: 'bar', ANTHROPIC_BASE_URL: 'x' }, null, PORT, TOKEN);
    expect(env.FOO).toBe('bar');
    expect(env.ANTHROPIC_BASE_URL).toBe('x');
  });

  it('respects an explicit opt-out', () => {
    for (const v of ['0', 'false']) {
      const r = computeTelemetryEnv({ CLAUDE_CODE_ENABLE_TELEMETRY: v }, null, PORT, TOKEN);
      expect(r.status).toBe('skipped-opted-out');
      expect(r.env).toEqual({ CLAUDE_CODE_ENABLE_TELEMETRY: v });
    }
  });

  it('leaves a non-OTLP exporter alone', () => {
    const r = computeTelemetryEnv({ OTEL_METRICS_EXPORTER: 'prometheus' }, null, PORT, TOKEN);
    expect(r.status).toBe('skipped-other-exporter');
    expect(r.env.OTEL_METRICS_EXPORTER).toBe('prometheus');
  });

  it("captures the user's own OTLP destination for forwarding", () => {
    const current = {
      CLAUDE_CODE_ENABLE_TELEMETRY: '1',
      OTEL_METRICS_EXPORTER: 'otlp',
      OTEL_LOGS_EXPORTER: 'otlp',
      OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.corp:4318/',
      OTEL_EXPORTER_OTLP_HEADERS: 'x-api-key=corp',
    };
    const { backup } = computeTelemetryEnv(current, null, PORT, TOKEN);
    expect(backup!.forward.metrics).toEqual({ endpoint: 'https://collector.corp:4318/v1/metrics', protocol: 'http/json', headers: 'x-api-key=corp' });
    expect(backup!.forward.logs!.endpoint).toBe('https://collector.corp:4318/v1/logs');
  });

  it('prefers per-signal endpoints when capturing the forward target', () => {
    const { backup } = computeTelemetryEnv({ OTEL_METRICS_EXPORTER: 'otlp', OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: 'http://m:4318/v1/metrics', OTEL_EXPORTER_OTLP_METRICS_PROTOCOL: 'grpc' }, null, PORT, TOKEN);
    expect(backup!.forward.metrics).toEqual({ endpoint: 'http://m:4318/v1/metrics', protocol: 'grpc', headers: undefined });
    expect(backup!.forward.logs).toBeUndefined();
  });

  it('does not treat its own endpoint as a forward target', () => {
    const first = computeTelemetryEnv({}, null, PORT, TOKEN);
    const { backup } = computeTelemetryEnv(first.env, null, PORT, TOKEN);
    expect(backup!.forward.metrics).toBeUndefined();
  });

  it('is unchanged on a second run and keeps the first backup', () => {
    const first = computeTelemetryEnv({ FOO: '1' }, null, PORT, TOKEN);
    const second = computeTelemetryEnv(first.env, first.backup, PORT, TOKEN);
    expect(second.status).toBe('unchanged');
    expect(second.backup).toBeNull();
  });

  it('updates the header when the token changes', () => {
    const first = computeTelemetryEnv({}, null, PORT, TOKEN);
    const second = computeTelemetryEnv(first.env, first.backup, PORT, 'new-token');
    expect(second.status).toBe('applied');
    expect(second.env.OTEL_EXPORTER_OTLP_LOGS_HEADERS).toBe('Authorization=Bearer new-token');
  });

  it('restore returns every managed key to its original value or absence', () => {
    const current = { FOO: 'bar', OTEL_METRIC_EXPORT_INTERVAL: '60000' };
    const { env, backup } = computeTelemetryEnv(current, null, PORT, TOKEN);
    expect(restoreTelemetryEnv(env, backup!)).toEqual(current);
  });
});

describe('setupTelemetryEnv / removeTelemetryEnv (files)', () => {
  let home: string;
  beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-otel-')); });
  afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

  const write = (p: string, v: unknown) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2), 'utf8'); };

  it('round-trips settings.json byte-for-byte', async () => {
    const paths = defaultTelemetryEnvPaths(home);
    const original = { hooks: { Stop: [] }, env: { FOO: 'bar' }, model: 'opus' };
    write(paths.settingsPath, original);
    const before = fs.readFileSync(paths.settingsPath, 'utf8');

    expect(await setupTelemetryEnv(PORT, TOKEN, paths)).toBe('applied');
    expect(JSON.parse(fs.readFileSync(paths.settingsPath, 'utf8')).env.OTEL_METRICS_EXPORTER).toBe('otlp');
    expect(await readTelemetryBackup(paths)).not.toBeNull();

    expect(await removeTelemetryEnv(paths)).toBe(true);
    expect(fs.readFileSync(paths.settingsPath, 'utf8')).toBe(before);
    expect(fs.existsSync(paths.backupPath)).toBe(false);
  });

  it('drops the env block on removal when there was none before', async () => {
    const paths = defaultTelemetryEnvPaths(home);
    write(paths.settingsPath, { hooks: {} });
    const before = fs.readFileSync(paths.settingsPath, 'utf8');
    await setupTelemetryEnv(PORT, TOKEN, paths);
    await removeTelemetryEnv(paths);
    expect(fs.readFileSync(paths.settingsPath, 'utf8')).toBe(before);
  });

  it('keeps an empty env block that the user had', async () => {
    const paths = defaultTelemetryEnvPaths(home);
    write(paths.settingsPath, { env: {} });
    await setupTelemetryEnv(PORT, TOKEN, paths);
    await removeTelemetryEnv(paths);
    expect(JSON.parse(fs.readFileSync(paths.settingsPath, 'utf8'))).toEqual({ env: {} });
  });

  it('creates settings.json when missing and does not rewrite when unchanged', async () => {
    const paths = defaultTelemetryEnvPaths(home);
    expect(await setupTelemetryEnv(PORT, TOKEN, paths)).toBe('applied');
    const mtime = fs.statSync(paths.settingsPath).mtimeMs;
    expect(await setupTelemetryEnv(PORT, TOKEN, paths)).toBe('unchanged');
    expect(fs.statSync(paths.settingsPath).mtimeMs).toBe(mtime);
  });

  it('removal without a backup is a no-op', async () => {
    expect(await removeTelemetryEnv(defaultTelemetryEnvPaths(home))).toBe(false);
  });
});
