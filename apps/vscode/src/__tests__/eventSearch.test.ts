/**
 * EventSearchEngine tests — query sanitization pipeline and search filtering.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventHorizonDB } from '../persistence.js';
import { EventSearchEngine } from '../eventSearch.js';
import type { AgentEvent } from '@event-horizon/core';

function makeEvent(overrides?: Partial<AgentEvent>): AgentEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2, 8)}`,
    agentId: 'agent-1',
    agentName: 'Agent 1',
    agentType: 'claude-code',
    type: 'tool.call',
    timestamp: Date.now(),
    payload: { tool: 'Read', file: 'src/main.ts' },
    ...overrides,
  };
}

describe('EventSearchEngine', () => {
  let db: EventHorizonDB;
  let engine: EventSearchEngine;

  beforeEach(async () => {
    db = await EventHorizonDB.create();
    engine = new EventSearchEngine(db);
  });

  afterEach(() => {
    db.close();
  });

  // ── sanitizeQuery ───────────────────────────────────────────────────────

  describe('sanitizeQuery', () => {
    it('Stage 1: short query (≤200 chars) passes through unchanged', () => {
      const query = 'find tool calls';
      expect(engine.sanitizeQuery(query)).toBe(query);
    });

    it('Stage 1: query of exactly 200 chars passes through unchanged', () => {
      const query = 'a'.repeat(200);
      expect(engine.sanitizeQuery(query)).toBe(query);
    });

    it('Stage 2: long query with "?" extracts the last question', () => {
      const prefix = 'x'.repeat(201) + '\n';
      const question = 'What tool was used?';
      const query = prefix + question;
      expect(engine.sanitizeQuery(query)).toBe(question);
    });

    it('Stage 2: extracts question from middle of long query when segment ≥10 chars', () => {
      const longPreamble = 'a'.repeat(100) + '\n';
      const question = 'Which file was edited?';
      const suffix = '\n' + 'b'.repeat(100);
      // The last '?' is in the question; suffix has no '?'
      const query = longPreamble + question + suffix;
      // total > 200, has '?', segment around last '?' should be ≥10
      const result = engine.sanitizeQuery(query);
      expect(result).toContain('?');
      expect(result.length).toBeGreaterThanOrEqual(10);
    });

    it('Stage 3: long query without "?" extracts last meaningful sentence', () => {
      const filler = 'some irrelevant context. ';
      const lastSentence = 'find recent file writes';
      const query = filler.repeat(10) + lastSentence;
      // query > 200 chars, no '?'
      expect(query.length).toBeGreaterThan(200);
      const result = engine.sanitizeQuery(query);
      expect(result).toBe(lastSentence);
    });

    it('Stage 4: very long query with no sentences ≥10 chars extracts last 500 chars', () => {
      // Segments separated by '.' so Stage 3 sees them, but each segment < 10 chars
      // "ab.cd.ef." repeated 60 times = 540 chars total, no segment ≥ 10 chars
      const unit = 'ab.cd.ef.';
      const query = unit.repeat(60); // 540 chars > 200, no '?', all split segments < 10 chars
      expect(query.length).toBeGreaterThan(500);
      const result = engine.sanitizeQuery(query);
      expect(result).toBe(query.slice(-500));
      expect(result.length).toBe(500);
    });

    it('trims leading/trailing whitespace before processing', () => {
      const query = '  short query  ';
      expect(engine.sanitizeQuery(query)).toBe('short query');
    });
  });

  // ── search ──────────────────────────────────────────────────────────────

  describe('search', () => {
    it('returns events from db matching the query', () => {
      const event = makeEvent({ payload: { tool: 'uniqueToolXYZ123' } });
      db.insertEvent(event);

      const results = engine.search('uniqueToolXYZ123');
      expect(results.some(e => e.id === event.id)).toBe(true);
    });

    it('post-filter by agentId returns only matching agent events', () => {
      const e1 = makeEvent({ agentId: 'agent-alpha', payload: { note: 'hello world' } });
      const e2 = makeEvent({ agentId: 'agent-beta', payload: { note: 'hello world' } });
      db.insertEvent(e1);
      db.insertEvent(e2);

      const results = engine.search('hello world', { agentId: 'agent-alpha' });
      expect(results.every(e => e.agentId === 'agent-alpha')).toBe(true);
      expect(results.some(e => e.id === e1.id)).toBe(true);
      expect(results.some(e => e.id === e2.id)).toBe(false);
    });

    it('post-filter by type returns only matching event types', () => {
      const e1 = makeEvent({ type: 'tool.call', payload: { data: 'searchable content abc' } });
      const e2 = makeEvent({ type: 'task.start', payload: { data: 'searchable content abc' } });
      db.insertEvent(e1);
      db.insertEvent(e2);

      const results = engine.search('searchable content abc', { type: 'tool.call' });
      expect(results.every(e => e.type === 'tool.call')).toBe(true);
      expect(results.some(e => e.id === e1.id)).toBe(true);
      expect(results.some(e => e.id === e2.id)).toBe(false);
    });

    it('post-filter by since timestamp excludes older events', () => {
      const oldTime = Date.now() - 100_000;
      const newTime = Date.now();
      const oldEvent = makeEvent({ timestamp: oldTime, payload: { note: 'filter test data' } });
      const newEvent = makeEvent({ timestamp: newTime, payload: { note: 'filter test data' } });
      db.insertEvent(oldEvent);
      db.insertEvent(newEvent);

      const cutoff = oldTime + 1;
      const results = engine.search('filter test data', { since: cutoff });
      expect(results.some(e => e.id === newEvent.id)).toBe(true);
      expect(results.some(e => e.id === oldEvent.id)).toBe(false);
    });

    it('returns empty array when no events match', () => {
      const results = engine.search('absolutely_no_match_xyz987');
      expect(results).toEqual([]);
    });
  });
});
