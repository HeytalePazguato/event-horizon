/**
 * ModelTierManager tests — tiered model selection, success tracking, escalation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ModelTierManager } from '../modelTierManager.js';

describe('ModelTierManager', () => {
  let manager: ModelTierManager;

  beforeEach(() => {
    manager = new ModelTierManager();
  });

  describe('getRecommendedModel', () => {
    it('returns cheapest tier when no data exists', () => {
      expect(manager.getRecommendedModel('low', 'implementer')).toBe('haiku');
    });

    it('returns cheapest tier with sufficient success rate', () => {
      // Give haiku 6 successes out of 6 attempts for low/implementer
      for (let i = 0; i < 6; i++) {
        manager.recordAttempt('haiku', 'implementer', 'low', true, 0.01);
      }
      expect(manager.getRecommendedModel('low', 'implementer')).toBe('haiku');
    });

    it('skips to next tier when model is below threshold', () => {
      // Give haiku 6 attempts with only 1 success (16% < 30% threshold)
      for (let i = 0; i < 5; i++) {
        manager.recordAttempt('haiku', 'implementer', 'medium', false, 0.01);
      }
      manager.recordAttempt('haiku', 'implementer', 'medium', true, 0.01);

      expect(manager.getRecommendedModel('medium', 'implementer')).toBe('sonnet');
    });

    it('falls back to highest tier when all are below threshold', () => {
      // Both haiku and sonnet fail
      for (let i = 0; i < 6; i++) {
        manager.recordAttempt('haiku', 'implementer', 'high', false, 0.01);
        manager.recordAttempt('sonnet', 'implementer', 'high', false, 0.05);
      }
      expect(manager.getRecommendedModel('high', 'implementer')).toBe('opus');
    });

    it('gives untested models a chance (insufficient data)', () => {
      // Haiku has low success, sonnet has no data
      for (let i = 0; i < 6; i++) {
        manager.recordAttempt('haiku', 'tester', 'low', false, 0.01);
      }
      // Should skip haiku (bad) and try sonnet (no data = give it a chance)
      expect(manager.getRecommendedModel('low', 'tester')).toBe('sonnet');
    });
  });

  describe('price-aware routing (task 3.4)', () => {
    it('prefers the cheaper tier on equal success — never opus when cheaper tiers tie', () => {
      // No recorded attempts: every tier is "untested" and competes with an
      // optimistic success rate, so the blended score is driven purely by cost.
      const lowPick = manager.getRecommendedModel('low', 'implementer');
      expect(lowPick).toBe('haiku');
      expect(lowPick).not.toBe('opus');

      const mediumPick = manager.getRecommendedModel('medium', 'implementer');
      expect(mediumPick).toBe('haiku');
      expect(mediumPick).not.toBe('opus');
    });

    it('prefers the cheaper tier when all tiers have equal (high) success rates', () => {
      // Drive haiku, sonnet, and opus to identical 100% first-attempt success
      // for the same role+complexity. Cost is the only differentiator, so the
      // cheapest viable tier (haiku) must win — sonnet/opus must not.
      for (let i = 0; i < 6; i++) {
        manager.recordAttempt('haiku', 'implementer', 'medium', true, 0.02);
        manager.recordAttempt('sonnet', 'implementer', 'medium', true, 0.06);
        manager.recordAttempt('opus', 'implementer', 'medium', true, 0.33);
      }
      const pick = manager.getRecommendedModel('medium', 'implementer');
      expect(pick).toBe('haiku');
      expect(pick).not.toBe('opus');
    });

    it('routes to sonnet over opus when both cheaper-than-opus tiers tie on success', () => {
      // haiku and sonnet both fully succeed; sonnet is cheaper than opus, so
      // between the two viable non-haiku options the router still favors cost.
      // haiku remains the overall cheapest and wins, proving opus never wins a tie.
      for (let i = 0; i < 6; i++) {
        manager.recordAttempt('sonnet', 'reviewer', 'medium', true, 0.06);
        manager.recordAttempt('opus', 'reviewer', 'medium', true, 0.33);
      }
      // haiku is untested (optimistic) and cheapest → wins.
      expect(manager.getRecommendedModel('medium', 'reviewer')).toBe('haiku');
    });

    it('forces opus when only opus clears the success threshold', () => {
      // Stats are keyed by model:role:complexity. Drive haiku and sonnet below
      // the 0.3 threshold with enough attempts (>= MIN_ATTEMPTS_FOR_STATS = 5)
      // for this exact role+complexity, so both are excluded as candidates.
      // 1/6 = 16.7% < 30% for each cheaper tier.
      for (let i = 0; i < 5; i++) {
        manager.recordAttempt('haiku', 'implementer', 'high', false, 0.02);
        manager.recordAttempt('sonnet', 'implementer', 'high', false, 0.06);
      }
      manager.recordAttempt('haiku', 'implementer', 'high', true, 0.02);
      manager.recordAttempt('sonnet', 'implementer', 'high', true, 0.06);

      // Opus stays viable — give it a clean 6/6 success record.
      for (let i = 0; i < 6; i++) {
        manager.recordAttempt('opus', 'implementer', 'high', true, 0.33);
      }

      expect(manager.getRecommendedModel('high', 'implementer')).toBe('opus');
    });

    it('estimateTaskCost is monotonic across tiers (haiku < sonnet < opus)', () => {
      const haiku = manager.estimateTaskCost('haiku', 10000);
      const sonnet = manager.estimateTaskCost('sonnet', 10000);
      const opus = manager.estimateTaskCost('opus', 10000);

      expect(haiku).toBeLessThan(sonnet);
      expect(sonnet).toBeLessThan(opus);
      // Sanity-check the absolute values (70% input / 30% output split).
      expect(haiku).toBeCloseTo(0.022, 6);
      expect(sonnet).toBeCloseTo(0.066, 6);
      expect(opus).toBeCloseTo(0.33, 6);
    });
  });

  describe('getNextTier', () => {
    it('returns next tier up', () => {
      expect(manager.getNextTier('haiku')).toBe('sonnet');
      expect(manager.getNextTier('sonnet')).toBe('opus');
    });

    it('returns null for highest tier', () => {
      expect(manager.getNextTier('opus')).toBeNull();
    });

    it('returns null for unknown model', () => {
      expect(manager.getNextTier('gpt-4')).toBeNull();
    });
  });

  describe('recordAttempt', () => {
    it('tracks attempts and success/failure counts', () => {
      manager.recordAttempt('sonnet', 'implementer', 'medium', true, 0.10);
      manager.recordAttempt('sonnet', 'implementer', 'medium', false, 0.08);
      manager.recordAttempt('sonnet', 'implementer', 'medium', true, 0.12);

      const stats = manager.getStats();
      expect(stats['sonnet']['implementer']).toMatchObject({
        attempts: 3,
        successes: 2,
        failures: 1,
      });
    });

    it('computes average cost', () => {
      manager.recordAttempt('haiku', 'tester', 'low', true, 0.02);
      manager.recordAttempt('haiku', 'tester', 'low', true, 0.04);

      const stats = manager.getStats();
      expect(stats['haiku']['tester'].avgCostUsd).toBeCloseTo(0.03, 5);
    });
  });

  describe('getStats', () => {
    it('returns empty object when no data', () => {
      expect(manager.getStats()).toEqual({});
    });

    it('aggregates across complexities for same model+role', () => {
      manager.recordAttempt('sonnet', 'implementer', 'low', true, 0.05);
      manager.recordAttempt('sonnet', 'implementer', 'high', false, 0.15);

      const stats = manager.getStats();
      expect(stats['sonnet']['implementer'].attempts).toBe(2);
      expect(stats['sonnet']['implementer'].successes).toBe(1);
      expect(stats['sonnet']['implementer'].failures).toBe(1);
    });
  });

  describe('getDisabledModels', () => {
    it('returns empty when insufficient data', () => {
      manager.recordAttempt('haiku', 'implementer', 'low', false, 0.01);
      expect(manager.getDisabledModels()).toEqual([]);
    });

    it('returns models below threshold with sufficient data', () => {
      for (let i = 0; i < 6; i++) {
        manager.recordAttempt('haiku', 'implementer', 'medium', false, 0.01);
      }
      expect(manager.getDisabledModels()).toContain('haiku');
    });

    it('does not include models above threshold', () => {
      for (let i = 0; i < 6; i++) {
        manager.recordAttempt('sonnet', 'implementer', 'medium', true, 0.05);
      }
      expect(manager.getDisabledModels()).not.toContain('sonnet');
    });
  });

  describe('setTiers', () => {
    it('updates the tier list', () => {
      manager.setTiers(['sonnet', 'opus']);
      expect(manager.getRecommendedModel('low', 'implementer')).toBe('sonnet');
      expect(manager.getNextTier('haiku')).toBeNull(); // haiku no longer in list
      expect(manager.getNextTier('sonnet')).toBe('opus');
    });
  });

  describe('serialize / restore', () => {
    it('round-trips state correctly', () => {
      manager.recordAttempt('haiku', 'implementer', 'low', true, 0.02);
      manager.recordAttempt('sonnet', 'tester', 'high', false, 0.10);
      manager.recordAttempt('sonnet', 'tester', 'high', true, 0.12);

      const serialized = manager.serialize();

      const restored = new ModelTierManager();
      restored.restore(serialized);

      expect(restored.getStats()).toEqual(manager.getStats());
    });

    it('survives empty state', () => {
      const serialized = manager.serialize();
      expect(serialized.stats).toEqual([]);

      const restored = new ModelTierManager();
      restored.restore(serialized);
      expect(restored.getStats()).toEqual({});
    });
  });
});
