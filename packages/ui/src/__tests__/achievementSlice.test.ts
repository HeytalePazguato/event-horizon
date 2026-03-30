/**
 * Achievement slice tests — unlock logic, duplicate guard, demo guard, achievements toggle.
 * Phase H — Test Coverage.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useCommandCenterStore } from '../store.js';

beforeEach(() => {
  useCommandCenterStore.setState(useCommandCenterStore.getInitialState());
});

// ── unlockAchievement ───────────────────────────────────────────────────────

describe('unlockAchievement', () => {
  it('unlocks a new achievement and creates a toast', () => {
    useCommandCenterStore.getState().unlockAchievement('first_contact');
    const s = useCommandCenterStore.getState();
    expect(s.unlockedAchievements).toContain('first_contact');
    expect(s.activeToasts).toHaveLength(1);
    expect(s.activeToasts[0].achievementId).toBe('first_contact');
  });

  it('ignores duplicate unlock for the same achievement', () => {
    useCommandCenterStore.getState().unlockAchievement('first_contact');
    useCommandCenterStore.getState().unlockAchievement('first_contact');
    const s = useCommandCenterStore.getState();
    expect(s.unlockedAchievements.filter((id) => id === 'first_contact')).toHaveLength(1);
    expect(s.activeToasts).toHaveLength(1);
  });

  it('can unlock multiple different achievements', () => {
    useCommandCenterStore.getState().unlockAchievement('first_contact');
    useCommandCenterStore.getState().unlockAchievement('explorer');
    const s = useCommandCenterStore.getState();
    expect(s.unlockedAchievements).toHaveLength(2);
    expect(s.activeToasts).toHaveLength(2);
  });
});

// ── dismissToast ────────────────────────────────────────────────────────────

describe('dismissToast', () => {
  it('removes a toast by instanceId', () => {
    useCommandCenterStore.getState().unlockAchievement('first_contact');
    const toast = useCommandCenterStore.getState().activeToasts[0];
    useCommandCenterStore.getState().dismissToast(toast.instanceId);
    expect(useCommandCenterStore.getState().activeToasts).toHaveLength(0);
  });

  it('does not remove unrelated toasts', () => {
    useCommandCenterStore.getState().unlockAchievement('first_contact');
    useCommandCenterStore.getState().unlockAchievement('explorer');
    const toasts = useCommandCenterStore.getState().activeToasts;
    useCommandCenterStore.getState().dismissToast(toasts[0].instanceId);
    const remaining = useCommandCenterStore.getState().activeToasts;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].achievementId).toBe('explorer');
  });
});

// ── demo guard ──────────────────────────────────────────────────────────────

describe('demo guard', () => {
  it('ignores unlockAchievement in demo mode (non-demo_activated)', () => {
    useCommandCenterStore.setState({ demoMode: true });
    useCommandCenterStore.getState().unlockAchievement('first_contact');
    expect(useCommandCenterStore.getState().unlockedAchievements).toHaveLength(0);
  });

  it('allows demo_activated to unlock even in demo mode', () => {
    useCommandCenterStore.setState({ demoMode: true });
    useCommandCenterStore.getState().unlockAchievement('demo_activated');
    expect(useCommandCenterStore.getState().unlockedAchievements).toContain('demo_activated');
  });
});

// ── achievementsEnabled guard ───────────────────────────────────────────────

describe('achievementsEnabled guard', () => {
  it('ignores unlockAchievement when achievements are disabled', () => {
    useCommandCenterStore.setState({ achievementsEnabled: false });
    useCommandCenterStore.getState().unlockAchievement('first_contact');
    expect(useCommandCenterStore.getState().unlockedAchievements).toHaveLength(0);
  });

  it('allows demo_activated even when achievements are disabled', () => {
    useCommandCenterStore.setState({ achievementsEnabled: false });
    useCommandCenterStore.getState().unlockAchievement('demo_activated');
    expect(useCommandCenterStore.getState().unlockedAchievements).toContain('demo_activated');
  });

  it('unlocks normally when achievements are enabled', () => {
    useCommandCenterStore.setState({ achievementsEnabled: true });
    useCommandCenterStore.getState().unlockAchievement('first_contact');
    expect(useCommandCenterStore.getState().unlockedAchievements).toContain('first_contact');
  });
});
