/**
 * Turns on Claude Code's OpenTelemetry export to Event Horizon by merging an
 * `env` block into ~/.claude/settings.json — the same file the hook installer
 * owns. Claude Code ignores OTel variables in a repository's .claude/settings.json,
 * so the user-home file is the only place this works.
 *
 * Rules that keep this safe to run on every activation:
 * - Only per-signal variables are written (OTEL_EXPORTER_OTLP_METRICS_* /
 *   _LOGS_*). The generic OTEL_EXPORTER_OTLP_* variables may also serve the
 *   user's trace pipeline; writing our bearer token into the generic headers
 *   would send it to their trace collector.
 * - Each key's original value (or absence) is saved once to a backup file, so
 *   removeTelemetryEnv() restores exactly what was there. The backup is also
 *   the record of where the user's own telemetry went, for forwarding.
 * - An explicit CLAUDE_CODE_ENABLE_TELEMETRY=0, or a non-OTLP exporter the user
 *   configured, means we leave telemetry alone.
 * - Content gates default to "0" so prompts, responses and tool bodies are not
 *   captured. A value the user set explicitly is kept.
 */

import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

export const TELEMETRY_INTERVAL_MS = 10_000;

/** Content gates written as "0" unless the user set them explicitly. */
export const CONTENT_GATES = [
  'OTEL_LOG_USER_PROMPTS',
  'OTEL_LOG_ASSISTANT_RESPONSES',
  'OTEL_LOG_TOOL_CONTENT',
  'OTEL_LOG_RAW_API_BODIES',
  'OTEL_LOG_TOOL_DETAILS',
] as const;

export type TelemetryEnvStatus = 'applied' | 'unchanged' | 'skipped-opted-out' | 'skipped-other-exporter';

/** Where the user's own telemetry went before Event Horizon, per signal. */
export interface ForwardTarget {
  endpoint: string;
  protocol?: string;
  headers?: string;
}

export interface TelemetryBackup {
  /** Original value of every key Event Horizon manages; null = was absent. */
  original: Record<string, string | null>;
  forward: { metrics?: ForwardTarget; logs?: ForwardTarget };
  /** Whether settings.json had an `env` object at all, so removal can drop or keep it. */
  hadEnvBlock?: boolean;
}

export interface ComputeResult {
  status: TelemetryEnvStatus;
  env: Record<string, string>;
  /** New backup to persist, or null when an existing one should be kept. */
  backup: TelemetryBackup | null;
}

function managedValues(port: number, token: string | null): Record<string, string> {
  const base = `http://127.0.0.1:${port}/otlp`;
  const headers = token ? `Authorization=Bearer ${token}` : '';
  const values: Record<string, string> = {
    CLAUDE_CODE_ENABLE_TELEMETRY: '1',
    OTEL_METRICS_EXPORTER: 'otlp',
    OTEL_LOGS_EXPORTER: 'otlp',
    OTEL_EXPORTER_OTLP_METRICS_PROTOCOL: 'http/json',
    OTEL_EXPORTER_OTLP_LOGS_PROTOCOL: 'http/json',
    OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: `${base}/v1/metrics`,
    OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: `${base}/v1/logs`,
    OTEL_METRIC_EXPORT_INTERVAL: String(TELEMETRY_INTERVAL_MS),
  };
  if (headers) {
    values.OTEL_EXPORTER_OTLP_METRICS_HEADERS = headers;
    values.OTEL_EXPORTER_OTLP_LOGS_HEADERS = headers;
  }
  return values;
}

/** Every key this module may write; the backup records each one. */
export const MANAGED_KEYS: readonly string[] = [
  ...Object.keys(managedValues(0, 'x')),
  ...CONTENT_GATES,
];

function isOurs(value: string | undefined, port: number): boolean {
  return typeof value === 'string' && value.startsWith(`http://127.0.0.1:${port}/otlp`);
}

function exporterIncludesOtlp(value: string | undefined): boolean {
  return (value ?? '').split(',').map((s) => s.trim()).includes('otlp');
}

/** The user's pre-existing destination for one signal, if they exported it over OTLP. */
function forwardTargetFor(env: Record<string, string>, signal: 'METRICS' | 'LOGS', port: number): ForwardTarget | undefined {
  const exporter = env[signal === 'METRICS' ? 'OTEL_METRICS_EXPORTER' : 'OTEL_LOGS_EXPORTER'];
  if (!exporterIncludesOtlp(exporter)) return undefined;
  const specific = env[`OTEL_EXPORTER_OTLP_${signal}_ENDPOINT`];
  const generic = env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const endpoint = specific ?? (generic ? `${generic.replace(/\/+$/, '')}/v1/${signal.toLowerCase()}` : undefined);
  if (!endpoint || isOurs(endpoint, port)) return undefined;
  return {
    endpoint,
    protocol: env[`OTEL_EXPORTER_OTLP_${signal}_PROTOCOL`] ?? env.OTEL_EXPORTER_OTLP_PROTOCOL,
    headers: env[`OTEL_EXPORTER_OTLP_${signal}_HEADERS`] ?? env.OTEL_EXPORTER_OTLP_HEADERS,
  };
}

/**
 * Pure merge: given the current `env` block and any existing backup, compute
 * the new block. Never touches keys outside MANAGED_KEYS.
 */
export function computeTelemetryEnv(
  current: Record<string, string>,
  existingBackup: TelemetryBackup | null,
  port: number,
  token: string | null,
): ComputeResult {
  const env = { ...current };

  if (!existingBackup) {
    if (current.CLAUDE_CODE_ENABLE_TELEMETRY === '0' || current.CLAUDE_CODE_ENABLE_TELEMETRY === 'false') {
      return { status: 'skipped-opted-out', env, backup: null };
    }
    for (const k of ['OTEL_METRICS_EXPORTER', 'OTEL_LOGS_EXPORTER'] as const) {
      const v = current[k];
      if (v !== undefined && v !== 'none' && !exporterIncludesOtlp(v)) {
        return { status: 'skipped-other-exporter', env, backup: null };
      }
    }
  }

  const backup: TelemetryBackup | null = existingBackup ? null : {
    original: Object.fromEntries(MANAGED_KEYS.map((k) => [k, current[k] ?? null])),
    forward: {
      metrics: forwardTargetFor(current, 'METRICS', port),
      logs: forwardTargetFor(current, 'LOGS', port),
    },
  };

  for (const [k, v] of Object.entries(managedValues(port, token))) env[k] = v;
  const original = (existingBackup ?? backup!).original;
  for (const gate of CONTENT_GATES) {
    // Keep a value the user chose before we arrived; otherwise pin it off.
    env[gate] = original[gate] ?? '0';
  }

  const changed = MANAGED_KEYS.some((k) => env[k] !== current[k]);
  return { status: changed ? 'applied' : 'unchanged', env, backup };
}

/** Pure inverse: restore every managed key to its backed-up value. */
export function restoreTelemetryEnv(current: Record<string, string>, backup: TelemetryBackup): Record<string, string> {
  const env = { ...current };
  for (const [k, v] of Object.entries(backup.original)) {
    if (v === null) delete env[k];
    else env[k] = v;
  }
  return env;
}

// ── File I/O ────────────────────────────────────────────────────────────────

export interface TelemetryEnvPaths {
  settingsPath: string;
  backupPath: string;
}

export function defaultTelemetryEnvPaths(home = os.homedir()): TelemetryEnvPaths {
  return {
    settingsPath: path.join(home, '.claude', 'settings.json'),
    backupPath: path.join(home, '.event-horizon', 'telemetry-env-backup.json'),
  };
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

export async function readTelemetryBackup(paths = defaultTelemetryEnvPaths()): Promise<TelemetryBackup | null> {
  return readJson<TelemetryBackup>(paths.backupPath);
}

/** Merge the OTel env block into ~/.claude/settings.json. */
export async function setupTelemetryEnv(
  port: number,
  token: string | null,
  paths = defaultTelemetryEnvPaths(),
): Promise<TelemetryEnvStatus> {
  const settings = (await readJson<Record<string, unknown>>(paths.settingsPath)) ?? {};
  const current = (settings.env && typeof settings.env === 'object' ? settings.env : {}) as Record<string, string>;
  const existingBackup = await readTelemetryBackup(paths);
  const result = computeTelemetryEnv(current, existingBackup, port, token);
  if (result.status !== 'applied') return result.status;

  if (result.backup) {
    result.backup.hadEnvBlock = settings.env !== undefined;
    await fsp.mkdir(path.dirname(paths.backupPath), { recursive: true });
    await fsp.writeFile(paths.backupPath, JSON.stringify(result.backup, null, 2), 'utf8');
  }
  settings.env = result.env;
  await fsp.mkdir(path.dirname(paths.settingsPath), { recursive: true });
  await fsp.writeFile(paths.settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  return 'applied';
}

/** Restore the env keys Event Horizon changed and delete the backup. */
export async function removeTelemetryEnv(paths = defaultTelemetryEnvPaths()): Promise<boolean> {
  const backup = await readTelemetryBackup(paths);
  if (!backup) return false;
  const settings = await readJson<Record<string, unknown>>(paths.settingsPath);
  if (settings) {
    const current = (settings.env && typeof settings.env === 'object' ? settings.env : {}) as Record<string, string>;
    const restored = restoreTelemetryEnv(current, backup);
    if (Object.keys(restored).length === 0 && backup.hadEnvBlock === false) delete settings.env;
    else settings.env = restored;
    await fsp.writeFile(paths.settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  }
  await fsp.rm(paths.backupPath, { force: true });
  return true;
}
