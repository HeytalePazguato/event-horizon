/**
 * FileReadCache tests — record/dedup, mtime/hash invalidation, digest budgeting, prune, stats.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { FileReadCache } from '../fileReadCache.js';

describe('FileReadCache', () => {
  let cache: FileReadCache;

  beforeEach(() => {
    cache = new FileReadCache();
  });

  describe('record', () => {
    it('creates a new entry retrievable via get/has with correct token estimate and readers', () => {
      const content = 'hello world!!!!'; // 15 chars → ceil(15/4) = 4 tokens
      cache.record('src/a.ts', content, 100, 'agentA', 1000);

      expect(cache.has('src/a.ts')).toBe(true);
      const entry = cache.get('src/a.ts');
      expect(entry).toBeDefined();
      expect(entry!.tokenEstimate).toBe(Math.ceil(content.length / 4));
      expect(entry!.readers.size).toBe(1);
      expect(entry!.readers.has('agentA')).toBe(true);
      expect(entry!.lastReadTs).toBe(1000);
    });
  });

  describe('multi-agent dedup', () => {
    it('adds a second reader without replacing content and counts a dedup hit', () => {
      const content = 'shared file content';
      cache.record('src/shared.ts', content, 100, 'agentA', 1000);
      cache.record('src/shared.ts', content, 100, 'agentB', 2000);

      const entry = cache.get('src/shared.ts');
      expect(entry!.readers.size).toBe(2);
      expect(entry!.readers.has('agentA')).toBe(true);
      expect(entry!.readers.has('agentB')).toBe(true);
      expect(entry!.lastReadTs).toBe(2000);
      expect(cache.stats().dedupHits).toBe(1);
    });

    it('does not double-count when the same agent re-reads an unchanged file', () => {
      const content = 'same agent re-read';
      cache.record('src/x.ts', content, 100, 'agentA', 1000);
      cache.record('src/x.ts', content, 100, 'agentA', 1500);

      expect(cache.get('src/x.ts')!.readers.size).toBe(1);
      expect(cache.stats().dedupHits).toBe(0);
    });
  });

  describe('mtime/hash-change replace', () => {
    it('rebuilds the entry and resets readers when content changes with a newer mtime', () => {
      cache.record('src/y.ts', 'original content', 100, 'agentA', 1000);
      const originalHash = cache.get('src/y.ts')!.contentHash;

      cache.record('src/y.ts', 'brand new different content', 200, 'agentB', 3000);
      const entry = cache.get('src/y.ts');

      expect(entry!.content).toBe('brand new different content');
      expect(entry!.contentHash).not.toBe(originalHash);
      expect(entry!.mtimeMs).toBe(200);
      expect(entry!.readers.size).toBe(1);
      expect(entry!.readers.has('agentB')).toBe(true);
      expect(entry!.readers.has('agentA')).toBe(false);
      // reset (not dedup) so no dedup hit is recorded
      expect(cache.stats().dedupHits).toBe(0);
    });
  });

  describe('invalidate', () => {
    it('removes a cached entry', () => {
      cache.record('src/z.ts', 'to be removed', 100, 'agentA', 1000);
      expect(cache.has('src/z.ts')).toBe(true);

      cache.invalidate('src/z.ts');
      expect(cache.has('src/z.ts')).toBe(false);
      expect(cache.get('src/z.ts')).toBeUndefined();
    });
  });

  describe('getDigest', () => {
    it('returns entries within the token budget ordered newest-first', () => {
      // Each file: 40 chars → ceil(40/4) = 10 tokens.
      const body = 'x'.repeat(40);
      cache.record('src/one.ts', body, 100, 'agentA', 1000);
      cache.record('src/two.ts', body, 100, 'agentA', 2000);
      cache.record('src/three.ts', body, 100, 'agentA', 3000);
      cache.record('src/four.ts', body, 100, 'agentA', 4000);

      // Budget of 25 tokens fits 2 entries (10 + 10 = 20; a third would be 30 > 25).
      const digest = cache.getDigest(25);
      expect(digest.length).toBe(2);
      // newest-first by lastReadTs desc
      expect(digest[0].path).toBe('src/four.ts');
      expect(digest[1].path).toBe('src/three.ts');
      const totalTokens = digest.reduce((sum, e) => sum + e.tokenEstimate, 0);
      expect(totalTokens).toBeLessThanOrEqual(25);
    });
  });

  describe('prune', () => {
    it('evicts the least-recently-read entries to cap the size', () => {
      cache.record('src/p1.ts', 'a', 100, 'agentA', 1000);
      cache.record('src/p2.ts', 'b', 100, 'agentA', 2000);
      cache.record('src/p3.ts', 'c', 100, 'agentA', 3000);
      cache.record('src/p4.ts', 'd', 100, 'agentA', 4000);

      cache.prune(2);

      expect(cache.stats().files).toBe(2);
      // The two oldest are evicted.
      expect(cache.has('src/p1.ts')).toBe(false);
      expect(cache.has('src/p2.ts')).toBe(false);
      // The two most-recently-read remain.
      expect(cache.has('src/p3.ts')).toBe(true);
      expect(cache.has('src/p4.ts')).toBe(true);
    });
  });

  describe('stats', () => {
    it('aggregates file count and total tokens', () => {
      cache.record('src/s1.ts', 'x'.repeat(8), 100, 'agentA', 1000); // 2 tokens
      cache.record('src/s2.ts', 'x'.repeat(12), 100, 'agentA', 2000); // 3 tokens

      const stats = cache.stats();
      expect(stats.files).toBe(2);
      expect(stats.totalTokens).toBe(Math.ceil(8 / 4) + Math.ceil(12 / 4)); // 2 + 3 = 5
    });
  });
});
