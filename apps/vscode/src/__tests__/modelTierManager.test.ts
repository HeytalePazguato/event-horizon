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
