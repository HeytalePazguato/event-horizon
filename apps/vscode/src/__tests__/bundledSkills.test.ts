import { describe, it, expect } from 'vitest';
import { getBundledSkills } from '../bundledSkills.js';

describe('getBundledSkills', () => {
  it('returns an array containing the eh-architect skill', () => {
    const skills = getBundledSkills();
    expect(Array.isArray(skills)).toBe(true);
    const architect = skills.find((s) => s.dirName === 'eh-architect');
    expect(architect).toBeDefined();
  });

  it('eh-architect has valid YAML frontmatter with the correct name and invocability', () => {
    const architect = getBundledSkills().find((s) => s.dirName === 'eh-architect');
    expect(architect).toBeDefined();
    expect(architect!.content.startsWith('---')).toBe(true);
    expect(architect!.content).toContain('name: eh:architect');
    expect(architect!.content).toContain('user-invocable: true');
  });

  it('eh-architect references the /eh:create-plan hand-off and the Architecture Brief', () => {
    const architect = getBundledSkills().find((s) => s.dirName === 'eh-architect');
    expect(architect!.content).toContain('/eh:create-plan');
    expect(architect!.content).toContain('Architecture Brief');
  });

  it('still includes the pre-existing eh-create-plan skill', () => {
    const createPlan = getBundledSkills().find((s) => s.dirName === 'eh-create-plan');
    expect(createPlan).toBeDefined();
    expect(createPlan!.content).toContain('name: eh:create-plan');
  });

  describe('plan file sync wording', () => {
    const skills = getBundledSkills();

    it('no skill claims the server cannot read files or asks for full markdown text', () => {
      for (const s of skills) {
        expect(s.content, s.dirName).not.toContain('cannot read files');
        expect(s.content, s.dirName).not.toContain('full markdown text');
      }
    });

    it('no skill tells workers to flip "- [ ]" to "- [x]"', () => {
      for (const s of skills) {
        expect(s.content, s.dirName).not.toMatch(/change\s+\\?`?- \[ \]\\?`?\s+to\s+\\?`?- \[x\]/i);
        expect(s.content, s.dirName).not.toContain('ALWAYS UPDATE THE PLAN FILE');
      }
    });

    it('create-plan loads by file_path', () => {
      const s = skills.find((x) => x.dirName === 'eh-create-plan')!;
      expect(s.content).toContain('file_path');
      expect(s.content).toContain('eh_claim_orchestrator');
    });

    it('orchestrate mentions eh_cancel_task and since_revision', () => {
      const s = skills.find((x) => x.dirName === 'eh-orchestrate')!;
      expect(s.content).toContain('eh_cancel_task');
      expect(s.content).toContain('since_revision');
    });

    it('work-on-plan forbids editing the plan file and handles cancellation', () => {
      const s = skills.find((x) => x.dirName === 'eh-work-on-plan')!;
      expect(s.content).toContain('Never edit the plan file');
      expect(s.content).toContain('aborted');
    });
  });
});
