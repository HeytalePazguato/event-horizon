/**
 * Tracks in-flight and recently-finished workspace scans by scanId so the
 * `eh_build_graph` MCP tool can return immediately and agents can poll
 * `eh_scan_status` for progress instead of holding a socket open for the
 * scan's duration. This is the canonical async-start + poll pattern for
 * long-running RPC calls on a single-shot JSON-RPC HTTP transport.
 */

import * as crypto from 'crypto';
import type { ScanSummary } from './scanner.js';

export type ScanStatus = 'running' | 'done' | 'failed';

export interface ScanHandle {
  scanId: string;
  status: ScanStatus;
  startedAt: number;
  /** Total files matched for scanning. 0 until the directory walk completes. */
  filesMatched: number;
  /** Files processed so far (including skips). Updates live during the scan. */
  filesProcessed: number;
  /** Wall-clock duration in ms once the scan finishes. */
  durationMs?: number;
  /** Final scan summary, populated when status flips to 'done'. */
  summary?: ScanSummary;
  /** Error message, populated when status flips to 'failed'. */
  error?: string;
}

/**
 * Bounded LRU of scan handles. Keeps the most recent N to support
 * eh_scan_status polls that arrive after the scan finishes, but bounds
 * memory if the user re-runs /eh:optimize-context many times in a session.
 */
export class ScanRegistry {
  private scans = new Map<string, ScanHandle>();
  private static readonly MAX_RETAINED = 16;

  /** Create a new running handle and return it. The caller drives the scan. */
  start(): ScanHandle {
    const handle: ScanHandle = {
      scanId: crypto.randomBytes(8).toString('hex'),
      status: 'running',
      startedAt: Date.now(),
      filesMatched: 0,
      filesProcessed: 0,
    };
    this.scans.set(handle.scanId, handle);
    this.evictIfNeeded();
    return handle;
  }

  /** Set the total file count once the directory walk finishes. */
  setFilesMatched(scanId: string, n: number): void {
    const h = this.scans.get(scanId);
    if (h && h.status === 'running') h.filesMatched = n;
  }

  /** Bump the processed counter by one — called from the scanner's progress callback. */
  incrementProcessed(scanId: string): void {
    const h = this.scans.get(scanId);
    if (h && h.status === 'running') h.filesProcessed++;
  }

  /** Mark scan complete and attach the final summary. */
  finish(scanId: string, summary: ScanSummary): void {
    const h = this.scans.get(scanId);
    if (!h) return;
    h.status = 'done';
    h.durationMs = summary.durationMs;
    h.summary = summary;
    // Reconcile counters from the authoritative summary so a poll right
    // after completion reflects the real totals (the progress callback
    // doesn't fire for files dropped during the walk's pre-filter pass).
    h.filesMatched = summary.filesMatched;
    h.filesProcessed = summary.filesProcessed + summary.filesSkipped;
  }

  /** Mark scan failed with an error message. */
  fail(scanId: string, error: string): void {
    const h = this.scans.get(scanId);
    if (!h) return;
    h.status = 'failed';
    h.durationMs = Date.now() - h.startedAt;
    h.error = error;
  }

  /** Look up a handle. Returns null if the scanId is unknown or evicted. */
  get(scanId: string): ScanHandle | null {
    return this.scans.get(scanId) ?? null;
  }

  /** Returns the currently-running scan, if any. Used to reject concurrent starts. */
  findRunning(): ScanHandle | null {
    for (const h of this.scans.values()) {
      if (h.status === 'running') return h;
    }
    return null;
  }

  private evictIfNeeded(): void {
    if (this.scans.size <= ScanRegistry.MAX_RETAINED) return;
    // Map preserves insertion order — drop the oldest finished entry.
    for (const [id, h] of this.scans.entries()) {
      if (h.status !== 'running') {
        this.scans.delete(id);
        if (this.scans.size <= ScanRegistry.MAX_RETAINED) return;
      }
    }
  }
}
