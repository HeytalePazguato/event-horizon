/**
 * Hook freshness tests.
 *
 * The bug: `isCurrentEhHook` accepted any command Event Horizon might install,
 * regardless of which event it was attached to. When UserPromptSubmit moved
 * from the generic POST-and-discard command to the inbox command, the old one
 * still counted as current — so it was neither removed as stale nor replaced,
 * and the feature never reached anyone who already had hooks installed.
 */

import { describe, it, expect } from 'vitest';
import { __hookTestables } from '../setupHooks.js';

const { expectedCommandFor, isCurrentEhHook, isEhHook } = __hookTestables;

describe('expectedCommandFor', () => {
  it('gives UserPromptSubmit the inbox command that keeps stdout', () => {
    const cmd = expectedCommandFor('UserPromptSubmit');
    expect(cmd).toContain('/claude/inbox');
    // Discarding stdout would defeat the notice: Claude Code injects a
    // UserPromptSubmit hook's output into the turn.
    expect(cmd).not.toContain('> /dev/null');
  });

  it('gives PreToolUse the lock-check script', () => {
    expect(expectedCommandFor('PreToolUse')).toContain('eh-lock-check.sh');
  });

  it('gives every other event the generic command', () => {
    const cmd = expectedCommandFor('Stop');
    expect(cmd).toContain('/claude');
    expect(cmd).not.toContain('/claude/inbox');
    expect(cmd).toContain('> /dev/null');
  });
});

describe('isCurrentEhHook', () => {
  it('rejects the generic command on UserPromptSubmit', () => {
    // Exactly the stale hook found installed on a real machine: it posted to
    // /claude and threw the response away, so no notice could ever appear.
    const stale = { command: expectedCommandFor('Stop') };
    expect(isEhHook(stale)).toBe(true);
    expect(isCurrentEhHook(stale, 'UserPromptSubmit')).toBe(false);
  });

  it('accepts the inbox command on UserPromptSubmit', () => {
    const fresh = { command: expectedCommandFor('UserPromptSubmit') };
    expect(isCurrentEhHook(fresh, 'UserPromptSubmit')).toBe(true);
  });

  it('rejects the inbox command on an event that should not have it', () => {
    const wrong = { command: expectedCommandFor('UserPromptSubmit') };
    expect(isCurrentEhHook(wrong, 'Stop')).toBe(false);
  });

  it('accepts the generic command on a generic event', () => {
    expect(isCurrentEhHook({ command: expectedCommandFor('Stop') }, 'Stop')).toBe(true);
  });

  it('rejects legacy query-string-token hooks outright', () => {
    expect(isCurrentEhHook({ command: 'curl http://127.0.0.1:28765/claude?token=abc' }, 'Stop')).toBe(false);
  });

  it('treats a stale hook as ours, so it gets replaced rather than duplicated', () => {
    expect(isEhHook({ command: 'curl http://127.0.0.1:28765/claude?token=old' })).toBe(true);
  });
});
