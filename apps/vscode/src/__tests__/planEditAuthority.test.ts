import { describe, it, expect } from 'vitest';
import { PlanEditAuthority } from '../planEditAuthority.js';

describe('PlanEditAuthority', () => {
  it('lastWriter returns latest writer within window', () => {
    const a = new PlanEditAuthority();
    const now = Date.now();
    a.recordWrite('a', 'C:\\proj\\PLAN.md', now - 1000);
    a.recordWrite('b', 'c:/proj/plan.md', now - 500);
    expect(a.lastWriter('c:/proj/plan.md')).toBe('b');
  });

  it('lastWriter returns null after window', () => {
    const a = new PlanEditAuthority();
    a.recordWrite('a', 'plan.md', Date.now() - 10_000);
    expect(a.lastWriter('plan.md')).toBeNull();
    expect(a.lastWriter('other.md')).toBeNull();
  });

  it('ownershipRuleFor maps plan files to orchestrator, ignoring inline/null', () => {
    const a = new PlanEditAuthority();
    const rule = a.ownershipRuleFor(() => [
      { sourceFile: 'inline', orchestratorAgentId: 'x' },
      { sourceFile: 'C:\\p\\a.md', orchestratorAgentId: null },
      { sourceFile: 'C:\\p\\b.md', orchestratorAgentId: 'orch' },
    ]);
    expect(rule('c:/p/b.md')).toBe('orch');
    expect(rule('c:/p/a.md')).toBeNull();
    expect(rule('inline')).toBeNull();
    expect(rule('c:/p/other.ts')).toBeNull();
  });
});
