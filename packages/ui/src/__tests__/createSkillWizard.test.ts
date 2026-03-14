/**
 * Tests for SKILL.md generation and skill file path construction.
 */

import { describe, it, expect } from 'vitest';
import { generateSkillMd, buildSkillPath } from '../panels/CreateSkillWizard.js';
import type { CreateSkillRequest } from '../panels/CreateSkillWizard.js';

// ── generateSkillMd ─────────────────────────────────────────────────────────

describe('generateSkillMd', () => {
  const fullRequest: CreateSkillRequest = {
    name: 'code-review',
    description: 'Review code changes and suggest improvements',
    scope: 'project',
    category: 'development',
    userInvocable: true,
    disableModelInvocation: true,
    argumentHint: '[file-path]',
  };

  it('generates valid YAML frontmatter with all fields filled', () => {
    const output = generateSkillMd(fullRequest);
    expect(output).toContain('name: code-review');
    expect(output).toContain('description: "Review code changes and suggest improvements"');
    expect(output).toContain('user-invocable: true');
    expect(output).toContain('disable-model-invocation: true');
    expect(output).toContain('argument-hint: "[file-path]"');
  });

  it('generates minimal frontmatter (only name, userInvocable true)', () => {
    const minimal: CreateSkillRequest = {
      name: 'my-skill',
      description: '',
      scope: 'project',
      category: '',
      userInvocable: true,
      disableModelInvocation: false,
      argumentHint: '',
    };
    const output = generateSkillMd(minimal);
    expect(output).toContain('name: my-skill');
    expect(output).toContain('user-invocable: true');
    expect(output).not.toContain('description:');
    expect(output).not.toContain('disable-model-invocation');
    expect(output).not.toContain('argument-hint');
  });

  it('always includes user-invocable field when true', () => {
    const req: CreateSkillRequest = {
      name: 'test-skill',
      description: '',
      scope: 'project',
      category: '',
      userInvocable: true,
      disableModelInvocation: false,
      argumentHint: '',
    };
    const output = generateSkillMd(req);
    expect(output).toContain('user-invocable: true');
  });

  it('always includes user-invocable field when false', () => {
    const req: CreateSkillRequest = {
      name: 'test-skill',
      description: '',
      scope: 'project',
      category: '',
      userInvocable: false,
      disableModelInvocation: false,
      argumentHint: '',
    };
    const output = generateSkillMd(req);
    expect(output).toContain('user-invocable: false');
  });

  it('includes disable-model-invocation: true only when set', () => {
    const withDisable: CreateSkillRequest = { ...fullRequest, disableModelInvocation: true };
    const withoutDisable: CreateSkillRequest = { ...fullRequest, disableModelInvocation: false };

    expect(generateSkillMd(withDisable)).toContain('disable-model-invocation: true');
    expect(generateSkillMd(withoutDisable)).not.toContain('disable-model-invocation');
  });

  it('wraps description in quotes', () => {
    const output = generateSkillMd(fullRequest);
    expect(output).toContain('description: "Review code changes and suggest improvements"');
  });

  it('wraps argument-hint in quotes', () => {
    const output = generateSkillMd(fullRequest);
    expect(output).toContain('argument-hint: "[file-path]"');
  });

  it('omits description if empty', () => {
    const req: CreateSkillRequest = { ...fullRequest, description: '' };
    const output = generateSkillMd(req);
    expect(output).not.toContain('description:');
  });

  it('omits argument-hint if empty', () => {
    const req: CreateSkillRequest = { ...fullRequest, argumentHint: '' };
    const output = generateSkillMd(req);
    expect(output).not.toContain('argument-hint');
  });

  it('output starts with --- and contains closing ---', () => {
    const output = generateSkillMd(fullRequest);
    expect(output.startsWith('---\n')).toBe(true);
    // The closing --- should appear after the opening one
    const lines = output.split('\n');
    const closingIndex = lines.indexOf('---', 1);
    expect(closingIndex).toBeGreaterThan(0);
  });
});

// ── buildSkillPath ──────────────────────────────────────────────────────────

describe('buildSkillPath', () => {
  it('personal scope, no category', () => {
    expect(buildSkillPath('personal', '', 'my-skill')).toBe('~/.claude/skills/my-skill/SKILL.md');
  });

  it('personal scope, with category', () => {
    expect(buildSkillPath('personal', 'development', 'my-skill')).toBe(
      '~/.claude/skills/development/my-skill/SKILL.md',
    );
  });

  it('project scope, no category', () => {
    expect(buildSkillPath('project', '', 'my-skill')).toBe('.claude/skills/my-skill/SKILL.md');
  });

  it('project scope, with category', () => {
    expect(buildSkillPath('project', 'tooling', 'my-skill')).toBe(
      '.claude/skills/tooling/my-skill/SKILL.md',
    );
  });
});
