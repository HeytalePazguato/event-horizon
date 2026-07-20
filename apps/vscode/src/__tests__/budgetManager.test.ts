/**
 * BudgetManager tests — enforcement modes and shouldHalt (task 3.3).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BudgetManager } from '../budgetManager.js';

describe('BudgetManager', () => {
  let budget: BudgetManager;

  beforeEach(() => {
    budget = new BudgetManager();
  });

  describe('enforcement mode', () => {
    it("defaults to 'warn' mode", () => {
      expect(budget.getEnforcementMode()).toBe('warn');
    });

    it('round-trips the set enforcement mode', () => {
      budget.setEnforcementMode('hard');
      expect(budget.getEnforcementMode()).toBe('hard');

      budget.setEnforcementMode('off');
      expect(budget.getEnforcementMode()).toBe('off');

      budget.setEnforcementMode('warn');
      expect(budget.getEnforcementMode()).toBe('warn');
    });
  });

  describe('shouldHalt', () => {
    const planId = 'plan-1';
    const agentId = 'agent-1';

    it("does not halt in default 'warn' mode even when over limit", () => {
      budget.setLimit(planId, 1.0);
      budget.recordCost(planId, agentId, 2.0);

      expect(budget.isExceeded(planId)).toBe(true);
      expect(budget.shouldHalt(planId)).toBe(false);
    });

    it("halts in 'hard' mode when over limit", () => {
      budget.setLimit(planId, 1.0);
      budget.recordCost(planId, agentId, 2.0);
      budget.setEnforcementMode('hard');

      expect(budget.isExceeded(planId)).toBe(true);
      expect(budget.shouldHalt(planId)).toBe(true);
    });

    it("does not halt in 'off' mode even when over limit", () => {
      budget.setLimit(planId, 1.0);
      budget.recordCost(planId, agentId, 2.0);
      budget.setEnforcementMode('off');

      expect(budget.isExceeded(planId)).toBe(true);
      expect(budget.shouldHalt(planId)).toBe(false);
    });

    it("does not halt a within-budget plan even in 'hard' mode", () => {
      budget.setLimit(planId, 10.0);
      budget.recordCost(planId, agentId, 2.0);
      budget.setEnforcementMode('hard');

      expect(budget.isExceeded(planId)).toBe(false);
      expect(budget.shouldHalt(planId)).toBe(false);
    });
  });
});
