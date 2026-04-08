/**
 * TokenAnalyzer tests — cache ratios, compaction tracking, duplicate reads, anomalies.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TokenAnalyzer } from '../tokenAnalyzer.js';
import type { AgentEvent } from '@event-horizon/core';

function makeEvent(overrides: Partial<AgentEvent>): AgentEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2, 8)}`,
    agentId: 'agent-1',
    agentName: 'Agent 1',
    agentType: 'claude-code',
    type: 'tool.call',
    timestamp: Date.now(),
    payload: {},
    ...overrides,
  };
}

describe('TokenAnalyzer', () => {
  let analyzer: TokenAnalyzer;

  beforeEach(() => {
    analyzer = new TokenAnalyzer();
  });

  describe('cache hit ratio', () => {
    it('returns 0 when no data', () => {
      const insights = analyzer.getInsights();
      expect(insights.cacheHitRatio).toBe(0);
    });

    it('computes global cache hit ratio', () => {
      analyzer.onEvent(makeEvent({
        agentId: 'a1',
        type: 'task.progress',
        payload: { inputTokens: 1000, cacheReadTokensDelta: 4000, cacheCreationTokensDelta: 0 },
      }));
      const insights = analyzer.getInsights();
      // cacheRead=4000 / (cacheRead=4000 + cacheCreation=0 + input=1000) = 0.8
      expect(insights.cacheHitRatio).toBeCloseTo(0.8, 2);
    });

    it('computes per-agent cache ratios', () => {
      analyzer.onEvent(makeEvent({
        agentId: 'a1',
        type: 'task.progress',
        payload: { inputTokens: 500, cacheReadTokensDelta: 500 },
      }));
      analyzer.onEvent(makeEvent({
        agentId: 'a2',
        type: 'task.progress',
        payload: { inputTokens: 900, cacheReadTokensDelta: 100 },
      }));
      const insights = analyzer.getInsights();
      expect(insights.cacheHitByAgent['a1']).toBeCloseTo(0.5, 2);
      expect(insights.cacheHitByAgent['a2']).toBeCloseTo(0.1, 2);
    });
  });

  describe('compaction tracking', () => {
    it('tracks compaction events', () => {
      const now = Date.now();
      analyzer.onEvent(makeEvent({ agentId: 'a1', type: 'task.progress', timestamp: now, payload: { compaction: true } }));
      analyzer.onEvent(makeEvent({ agentId: 'a1', type: 'task.progress', timestamp: now + 120_000, payload: { compaction: true } }));
      analyzer.onEvent(makeEvent({ agentId: 'a1', type: 'task.progress', timestamp: now + 240_000, payload: { compaction: true } }));

      const insights = analyzer.getInsights();
      expect(insights.compactionFrequency['a1'].count).toBe(3);
      expect(insights.compactionFrequency['a1'].avgIntervalMs).toBeCloseTo(120_000, -3);
    });

    it('detects high pressure agents', () => {
      const now = Date.now();
      // 3 compactions in 4 minutes = high pressure (avg < 5min)
      analyzer.onEvent(makeEvent({ agentId: 'a1', type: 'task.progress', timestamp: now, payload: { compaction: true } }));
      analyzer.onEvent(makeEvent({ agentId: 'a1', type: 'task.progress', timestamp: now + 120_000, payload: { compaction: true } }));
      analyzer.onEvent(makeEvent({ agentId: 'a1', type: 'task.progress', timestamp: now + 240_000, payload: { compaction: true } }));

      const insights = analyzer.getInsights();
      expect(insights.highPressureAgents).toContain('a1');
    });

    it('does not flag agents with infrequent compaction', () => {
      const now = Date.now();
      analyzer.onEvent(makeEvent({ agentId: 'a1', type: 'task.progress', timestamp: now, payload: { compaction: true } }));
      analyzer.onEvent(makeEvent({ agentId: 'a1', type: 'task.progress', timestamp: now + 600_000, payload: { compaction: true } }));

      const insights = analyzer.getInsights();
      expect(insights.highPressureAgents).not.toContain('a1');
    });
  });

  describe('duplicate reads', () => {
    it('detects files read by multiple agents', () => {
      analyzer.onEvent(makeEvent({ agentId: 'a1', type: 'tool.call', payload: { tool: 'Read', file_path: 'src/auth.ts' } }));
      analyzer.onEvent(makeEvent({ agentId: 'a2', type: 'tool.call', payload: { tool: 'Read', file_path: 'src/auth.ts' } }));
      analyzer.onEvent(makeEvent({ agentId: 'a3', type: 'tool.call', payload: { tool: 'Read', file_path: 'src/auth.ts' } }));

      const insights = analyzer.getInsights();
      expect(insights.duplicateReads.length).toBe(1);
      expect(insights.duplicateReads[0].agents).toHaveLength(3);
      expect(insights.duplicateReads[0].file).toContain('src/auth.ts');
    });

    it('does not flag single-agent reads', () => {
      analyzer.onEvent(makeEvent({ agentId: 'a1', type: 'tool.call', payload: { tool: 'Read', file_path: 'src/foo.ts' } }));
      analyzer.onEvent(makeEvent({ agentId: 'a1', type: 'tool.call', payload: { tool: 'Read', file_path: 'src/foo.ts' } }));

      const insights = analyzer.getInsights();
      expect(insights.duplicateReads.length).toBe(0);
    });

    it('normalizes file paths', () => {
      analyzer.onEvent(makeEvent({ agentId: 'a1', type: 'tool.call', payload: { tool: 'Read', file_path: 'src\\Auth.ts' } }));
      analyzer.onEvent(makeEvent({ agentId: 'a2', type: 'tool.call', payload: { tool: 'read', file_path: 'src/auth.ts' } }));

      const insights = analyzer.getInsights();
      expect(insights.duplicateReads.length).toBe(1);
    });

    it('tracks file.read events', () => {
      analyzer.onEvent(makeEvent({ agentId: 'a1', type: 'file.read', payload: { file: 'src/config.ts' } }));
      analyzer.onEvent(makeEvent({ agentId: 'a2', type: 'file.read', payload: { file: 'src/config.ts' } }));

      const insights = analyzer.getInsights();
      expect(insights.duplicateReads.length).toBe(1);
    });

    it('estimates waste tokens', () => {
      // 3 reads of same file by 2 agents = 2 waste reads = 1000 waste tokens
      analyzer.onEvent(makeEvent({ agentId: 'a1', type: 'tool.call', payload: { tool: 'Read', file_path: 'src/x.ts' } }));
      analyzer.onEvent(makeEvent({ agentId: 'a2', type: 'tool.call', payload: { tool: 'Read', file_path: 'src/x.ts' } }));
      analyzer.onEvent(makeEvent({ agentId: 'a2', type: 'tool.call', payload: { tool: 'Read', file_path: 'src/x.ts' } }));

      const insights = analyzer.getInsights();
      expect(insights.duplicateReads[0].estimatedWasteTokens).toBe(1000); // (3-1) * 500
    });
  });

  describe('cost anomalies', () => {
    it('detects tasks costing >3x average', () => {
      // 4 tasks: $0.50, $0.40, $0.60, $5.00 → avg = $1.625 → $5.00 / $1.625 = 3.08x
      analyzer.onEvent(makeEvent({ agentId: 'a1', type: 'task.complete', payload: { taskId: 't1', costUsd: 0.50 } }));
      analyzer.onEvent(makeEvent({ agentId: 'a1', type: 'task.complete', payload: { taskId: 't2', costUsd: 0.40 } }));
      analyzer.onEvent(makeEvent({ agentId: 'a2', type: 'task.complete', payload: { taskId: 't3', costUsd: 0.60 } }));
      analyzer.onEvent(makeEvent({ agentId: 'a2', type: 'task.complete', payload: { taskId: 't4', costUsd: 5.00 } }));

      const insights = analyzer.getInsights();
      expect(insights.anomalies.length).toBe(1);
      expect(insights.anomalies[0].taskId).toBe('t4');
      expect(insights.anomalies[0].ratio).toBeGreaterThan(3);
    });

    it('returns empty when all costs are similar', () => {
      analyzer.onEvent(makeEvent({ agentId: 'a1', type: 'task.complete', payload: { taskId: 't1', costUsd: 0.50 } }));
      analyzer.onEvent(makeEvent({ agentId: 'a1', type: 'task.complete', payload: { taskId: 't2', costUsd: 0.55 } }));

      const insights = analyzer.getInsights();
      expect(insights.anomalies.length).toBe(0);
    });
  });

  describe('getRecommendations', () => {
    it('recommends sharing for files read by 3+ agents', () => {
      analyzer.onEvent(makeEvent({ agentId: 'a1', type: 'tool.call', payload: { tool: 'Read', file_path: 'src/shared.ts' } }));
      analyzer.onEvent(makeEvent({ agentId: 'a2', type: 'tool.call', payload: { tool: 'Read', file_path: 'src/shared.ts' } }));
      analyzer.onEvent(makeEvent({ agentId: 'a3', type: 'tool.call', payload: { tool: 'Read', file_path: 'src/shared.ts' } }));

      const recs = analyzer.getRecommendations();
      expect(recs.some(r => r.includes('shared knowledge'))).toBe(true);
    });

    it('flags high compaction pressure', () => {
      const now = Date.now();
      analyzer.onEvent(makeEvent({ agentId: 'a1', type: 'task.progress', timestamp: now, payload: { compaction: true } }));
      analyzer.onEvent(makeEvent({ agentId: 'a1', type: 'task.progress', timestamp: now + 60_000, payload: { compaction: true } }));
      analyzer.onEvent(makeEvent({ agentId: 'a1', type: 'task.progress', timestamp: now + 120_000, payload: { compaction: true } }));

      const recs = analyzer.getRecommendations();
      expect(recs.some(r => r.includes('compacted'))).toBe(true);
    });

    it('flags cost anomalies', () => {
      analyzer.onEvent(makeEvent({ agentId: 'a1', type: 'task.complete', payload: { taskId: 't1', costUsd: 0.10 } }));
      analyzer.onEvent(makeEvent({ agentId: 'a1', type: 'task.complete', payload: { taskId: 't2', costUsd: 0.10 } }));
      analyzer.onEvent(makeEvent({ agentId: 'a1', type: 'task.complete', payload: { taskId: 't3', costUsd: 0.10 } }));
      analyzer.onEvent(makeEvent({ agentId: 'a1', type: 'task.complete', payload: { taskId: 't4', costUsd: 5.00 } }));

      const recs = analyzer.getRecommendations();
      expect(recs.some(r => r.includes('review for waste'))).toBe(true);
    });

    it('returns empty when nothing notable', () => {
      const recs = analyzer.getRecommendations();
      expect(recs).toEqual([]);
    });
  });
});
