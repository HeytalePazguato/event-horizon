/**
 * Re-exports OTLP payloads to the collector the user had before Event Horizon
 * took over Claude Code's OTel endpoint, so their own dashboards keep working.
 *
 * The body is forwarded exactly as received — same bytes, same content type,
 * the user's original headers — and nothing from Event Horizon is added.
 * Forwarding is fire-and-forget with a timeout; a slow or failing collector
 * never affects local ingestion.
 *
 * We receive http/json. A destination configured for grpc or http/protobuf
 * would need re-encoding, which is not done: such targets are skipped and
 * reported once instead of being sent bytes they cannot read.
 */

import type { ForwardTarget } from '../setupTelemetryEnv.js';

export type OtlpSignal = 'metrics' | 'logs';

export const FORWARD_TIMEOUT_MS = 5_000;

type FetchFn = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number }>;

/** Parse OTEL_EXPORTER_OTLP_*_HEADERS ("k1=v1,k2=v2", values percent-encoded). */
export function parseOtlpHeaders(value: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!value) return out;
  for (const part of value.split(',')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const raw = part.slice(eq + 1).trim();
    let decoded = raw;
    try { decoded = decodeURIComponent(raw); } catch { /* keep raw */ }
    if (key) out[key] = decoded;
  }
  return out;
}

/** True when a target expects a protocol we can forward a JSON body to. */
export function acceptsJson(target: ForwardTarget): boolean {
  return target.protocol === undefined || target.protocol === 'http/json';
}

export class OtlpForwarder {
  private targets: Partial<Record<OtlpSignal, ForwardTarget>> = {};
  private readonly reported = new Set<string>();
  /** Last error per signal, for diagnostics. */
  readonly lastError: Partial<Record<OtlpSignal, string>> = {};

  constructor(
    private readonly fetchFn: FetchFn = fetch as unknown as FetchFn,
    private readonly warn: (message: string) => void = () => {},
  ) {}

  setTargets(targets: Partial<Record<OtlpSignal, ForwardTarget>> | undefined): void {
    this.targets = targets ?? {};
    this.reported.clear();
  }

  hasTarget(signal: OtlpSignal): boolean {
    return this.targets[signal] !== undefined;
  }

  /** Forward a raw OTLP request body. Never throws; resolves when done or abandoned. */
  async forward(signal: OtlpSignal, rawBody: string, contentType: string): Promise<boolean> {
    const target = this.targets[signal];
    if (!target || !rawBody) return false;
    if (!acceptsJson(target)) {
      const key = `${signal}:${target.protocol}`;
      if (!this.reported.has(key)) {
        this.reported.add(key);
        this.warn(`Event Horizon: your ${signal} collector at ${target.endpoint} expects ${target.protocol}; Event Horizon receives http/json and does not re-encode, so ${signal} are not being forwarded to it.`);
      }
      return false;
    }
    try {
      const res = await this.fetchFn(target.endpoint, {
        method: 'POST',
        headers: { ...parseOtlpHeaders(target.headers), 'Content-Type': contentType || 'application/json' },
        body: rawBody,
        signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
      });
      if (!res.ok) {
        this.lastError[signal] = `HTTP ${res.status}`;
        return false;
      }
      delete this.lastError[signal];
      return true;
    } catch (e) {
      this.lastError[signal] = e instanceof Error ? e.message : String(e);
      return false;
    }
  }
}
