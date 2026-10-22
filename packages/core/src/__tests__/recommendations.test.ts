import { describe, it, expect } from 'vitest';
import { isRecommendationAction } from '../recommendations.js';

describe('isRecommendationAction', () => {
  it('accepts every action kind with its required field', () => {
    expect(isRecommendationAction({ kind: 'add-to-knowledge', filePath: '/a.ts' })).toBe(true);
    expect(isRecommendationAction({ kind: 'open-file', filePath: '/a.ts' })).toBe(true);
    expect(isRecommendationAction({ kind: 'broadcast', message: 'hi' })).toBe(true);
    expect(isRecommendationAction({ kind: 'focus-agent', agentId: 'a1' })).toBe(true);
    expect(isRecommendationAction({ kind: 'open-task', taskId: '2.1' })).toBe(true);
  });

  it('rejects unknown kinds', () => {
    expect(isRecommendationAction({ kind: 'delete-everything', filePath: '/a.ts' })).toBe(false);
  });

  it('rejects a known kind missing or emptying its field', () => {
    expect(isRecommendationAction({ kind: 'add-to-knowledge' })).toBe(false);
    expect(isRecommendationAction({ kind: 'focus-agent', agentId: '' })).toBe(false);
    expect(isRecommendationAction({ kind: 'open-task', taskId: 7 })).toBe(false);
    expect(isRecommendationAction({ kind: 'broadcast', filePath: '/a.ts' })).toBe(false);
  });

  it('rejects non-objects', () => {
    for (const v of [null, undefined, 'add-to-knowledge', 3, []]) expect(isRecommendationAction(v)).toBe(false);
  });
});
