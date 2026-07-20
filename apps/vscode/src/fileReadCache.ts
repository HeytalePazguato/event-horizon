/**
 * File Read Cache — pure in-memory dedup layer for agent file reads.
 *
 * Content and mtime are supplied by the caller (no fs / vscode / Node imports)
 * so this class stays trivially unit-testable. It tracks which agents read a
 * given path, invalidates on mtime/hash changes, and can emit a token-budgeted
 * digest of the most recently read files.
 */

export interface FileReadEntry {
  path: string;
  mtimeMs: number;
  contentHash: string;
  content: string;
  sizeBytes: number;
  readers: Set<string>;
  lastReadTs: number;
  tokenEstimate: number;
}

export interface FileReadCacheStats {
  files: number;
  totalTokens: number;
  dedupHits: number;
}

/** Rough token estimate: ~4 chars per token. */
function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4);
}

export class FileReadCache {
  private entries = new Map<string, FileReadEntry>();
  private dedupHits = 0;

  /**
   * Record a file read. If the entry is absent, or its mtime/hash differs, the
   * entry is (re)created with fresh content and a readers set containing this
   * agent. Otherwise the existing content is kept and the agent is added to the
   * readers set (counted as a dedup hit if it wasn't already a reader).
   * `lastReadTs` is always refreshed to `ts`.
   */
  record(path: string, content: string, mtimeMs: number, agentId: string, ts: number): void {
    const existing = this.entries.get(path);
    const hash = this.hash(content);
    const isValid = existing !== undefined && existing.mtimeMs === mtimeMs && existing.contentHash === hash;

    if (!isValid) {
      // Fresh (or changed) file — rebuild the entry and reset readers.
      this.entries.set(path, {
        path,
        mtimeMs,
        contentHash: hash,
        content,
        sizeBytes: content.length,
        readers: new Set([agentId]),
        lastReadTs: ts,
        tokenEstimate: estimateTokens(content),
      });
      return;
    }

    // Unchanged file — keep content, add this reader.
    if (!existing.readers.has(agentId)) {
      existing.readers.add(agentId);
      this.dedupHits++;
    }
    existing.lastReadTs = ts;
  }

  /** Get the entry for a path, or undefined if not cached. */
  get(path: string): FileReadEntry | undefined {
    return this.entries.get(path);
  }

  /** Whether a path is currently cached. */
  has(path: string): boolean {
    return this.entries.has(path);
  }

  /** Remove a cached entry (e.g. after a write invalidates it). */
  invalidate(path: string): void {
    this.entries.delete(path);
  }

  /**
   * Return cached entries, most-recently-read first, whose cumulative
   * `tokenEstimate` stays within `maxTokens`. Entries larger than the remaining
   * budget are skipped so the digest never exceeds the cap.
   */
  getDigest(maxTokens: number): FileReadEntry[] {
    const ordered = Array.from(this.entries.values()).sort((a, b) => b.lastReadTs - a.lastReadTs);
    const digest: FileReadEntry[] = [];
    let used = 0;
    for (const entry of ordered) {
      if (used + entry.tokenEstimate > maxTokens) continue;
      digest.push(entry);
      used += entry.tokenEstimate;
    }
    return digest;
  }

  /** Summary counters for diagnostics. */
  stats(): FileReadCacheStats {
    let totalTokens = 0;
    for (const entry of this.entries.values()) {
      totalTokens += entry.tokenEstimate;
    }
    return {
      files: this.entries.size,
      totalTokens,
      dedupHits: this.dedupHits,
    };
  }

  /** Evict least-recently-read entries until at most `maxEntries` remain. */
  prune(maxEntries = 200): void {
    if (this.entries.size <= maxEntries) return;
    const ordered = Array.from(this.entries.values()).sort((a, b) => a.lastReadTs - b.lastReadTs);
    const toEvict = this.entries.size - maxEntries;
    for (let i = 0; i < toEvict; i++) {
      this.entries.delete(ordered[i].path);
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────

  /** FNV-1a hash of content, returned as a hex string. */
  private hash(content: string): string {
    let h = 0x811c9dc5; // FNV offset basis
    for (let i = 0; i < content.length; i++) {
      h ^= content.charCodeAt(i);
      // FNV prime (16777619) via shifts, kept in 32-bit unsigned space.
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(16);
  }
}
