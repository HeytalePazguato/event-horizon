/**
 * Event search module with MemPalace-style query sanitization.
 * Wraps EventHorizonDB FTS queries with a 4-stage sanitization pipeline
 * that handles arbitrarily long or malformed user input.
 */

import type { AgentEvent } from '@event-horizon/core';
import type { EventHorizonDB } from './persistence.js';

export class EventSearchEngine {
  constructor(private db: EventHorizonDB) {}

  /**
   * 4-stage sanitization pipeline.
   *
   * Stage 1: Short queries (≤200 chars) pass through unchanged.
   * Stage 2: Extract last question — text up to the last '?'.
   * Stage 3: Extract last meaningful sentence (≥10 chars).
   * Stage 4: Truncate to last 500 chars.
   */
  sanitizeQuery(raw: string): string {
    const trimmed = raw.trim();

    // Stage 1: short queries pass through
    if (trimmed.length <= 200) return trimmed;

    // Stage 2: extract last question (text up to last '?')
    const lastQ = trimmed.lastIndexOf('?');
    if (lastQ > 0) {
      const segStart = trimmed.lastIndexOf('\n', lastQ);
      const segment = trimmed.slice(segStart + 1, lastQ + 1).trim();
      if (segment.length >= 10) return segment;
    }

    // Stage 3: last meaningful sentence (10–500 chars).
    // Sentences longer than 500 chars fall through to Stage 4 — they're
    // typically a single un-delimited blob rather than a real sentence.
    const sentences = trimmed.split(/[.!?\n]+/).filter(s => {
      const len = s.trim().length;
      return len >= 10 && len <= 500;
    });
    if (sentences.length > 0) return sentences[sentences.length - 1].trim();

    // Stage 4: truncate to last 500 chars
    return trimmed.slice(-500);
  }

  search(
    query: string,
    opts?: { agentId?: string; type?: string; since?: number; limit?: number },
  ): AgentEvent[] {
    const sanitized = this.sanitizeQuery(query);
    let results = this.db.searchEvents(sanitized, opts?.limit ?? 50);

    // Post-filter
    if (opts?.agentId) results = results.filter(e => e.agentId === opts.agentId);
    if (opts?.type) results = results.filter(e => e.type === opts.type);
    if (opts?.since) results = results.filter(e => e.timestamp >= opts.since!);

    return results;
  }
}
