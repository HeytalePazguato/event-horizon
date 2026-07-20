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
});
