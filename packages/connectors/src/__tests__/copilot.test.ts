import { describe, it, expect } from 'vitest';
import { mapCopilotOutputToEvent } from '../copilot.js';

describe('mapCopilotOutputToEvent', () => {
  it('matches "Running tool..." as task.start', () => {
    const result = mapCopilotOutputToEvent('Running tool bash');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('task.start');
    expect(result!.agentType).toBe('copilot');
  });

  it('matches "Error: something" as agent.error', () => {
    const result = mapCopilotOutputToEvent('Error: connection refused');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('agent.error');
  });

  it('does NOT match "ErrorBoundary" as agent.error', () => {
    // "ErrorBoundary" starts with "Error" but the regex requires a word boundary after
    // The regex is /^(error|failed|exception)\b/i — "ErrorBoundary" has no boundary after "Error"
    const result = mapCopilotOutputToEvent('ErrorBoundary caught an exception');
    // The regex /^(error|failed|exception)\b/ won't match "ErrorBoundary" because \b is between 'r' and 'B'
    // Actually \b IS between lowercase 'r' and uppercase 'B' — both are word chars, so \b doesn't match there.
    // Wait: \b matches between a word char and non-word char. 'r' and 'B' are both word chars, so no \b.
    // So "ErrorBoundary" does NOT match /^error\b/i — correct!
    expect(result).toBeNull();
  });

  it('does NOT match "no errors found"', () => {
    const result = mapCopilotOutputToEvent('no errors found');
    expect(result).toBeNull();
  });

  it('returns null for empty/non-matching input', () => {
    expect(mapCopilotOutputToEvent('')).toBeNull();
    expect(mapCopilotOutputToEvent('   ')).toBeNull();
    expect(mapCopilotOutputToEvent('just some random text')).toBeNull();
  });

  it('returns null for non-string input', () => {
    expect(mapCopilotOutputToEvent(null as unknown as string)).toBeNull();
    expect(mapCopilotOutputToEvent(undefined as unknown as string)).toBeNull();
  });
});
