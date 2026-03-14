import { describe, it, expect } from 'vitest';
import { parseFrontmatter } from '../skillScanner.js';
import type { SkillInfo } from '../skillScanner.js';

describe('parseFrontmatter', () => {
  it('parses complete frontmatter', () => {
    const content = `---
name: my-skill
description: A useful skill for testing
disable-model-invocation: true
user-invocable: false
allowed-tools: Read, Grep, Edit
model: claude-opus
context: fork
agent: Explore
argument-hint: [file-path]
---

# Skill instructions here
`;
    const result = parseFrontmatter(content);
    expect(result.name).toBe('my-skill');
    expect(result.description).toBe('A useful skill for testing');
    expect(result.disableModelInvocation).toBe(true);
    expect(result.userInvocable).toBe(false);
    expect(result.allowedTools).toEqual(['Read', 'Grep', 'Edit']);
    expect(result.model).toBe('claude-opus');
    expect(result.context).toBe('fork');
    expect(result.agent).toBe('Explore');
    expect(result.argumentHint).toBe('[file-path]');
  });

  it('handles partial frontmatter with defaults', () => {
    const content = `---
name: simple
description: Just a simple skill
---

Do something simple.
`;
    const result = parseFrontmatter(content);
    expect(result.name).toBe('simple');
    expect(result.description).toBe('Just a simple skill');
    expect(result.disableModelInvocation).toBeUndefined();
    expect(result.userInvocable).toBeUndefined();
    expect(result.allowedTools).toBeUndefined();
    expect(result.model).toBeUndefined();
    expect(result.context).toBeUndefined();
    expect(result.agent).toBeUndefined();
  });

  it('returns empty object for missing frontmatter', () => {
    const content = '# No frontmatter here\nJust some markdown.';
    const result = parseFrontmatter(content);
    expect(result).toEqual({});
  });

  it('returns empty object for empty content', () => {
    expect(parseFrontmatter('')).toEqual({});
  });

  it('handles quoted values', () => {
    const content = `---
name: "quoted-name"
description: 'single-quoted desc'
---
`;
    const result = parseFrontmatter(content);
    expect(result.name).toBe('quoted-name');
    expect(result.description).toBe('single-quoted desc');
  });

  it('handles user-invocable: true explicitly', () => {
    const content = `---
user-invocable: true
---
`;
    const result = parseFrontmatter(content);
    expect(result.userInvocable).toBe(true);
  });

  it('handles context: inline (default)', () => {
    const content = `---
context: inline
---
`;
    const result = parseFrontmatter(content);
    expect(result.context).toBe('inline');
  });

  it('handles unknown context value as inline', () => {
    const content = `---
context: something-else
---
`;
    const result = parseFrontmatter(content);
    expect(result.context).toBe('inline');
  });

  it('handles empty allowed-tools', () => {
    const content = `---
allowed-tools:
---
`;
    const result = parseFrontmatter(content);
    expect(result.allowedTools).toEqual([]);
  });

  it('truncates long name to 64 chars', () => {
    const longName = 'a'.repeat(100);
    const content = `---
name: ${longName}
---
`;
    const result = parseFrontmatter(content);
    expect(result.name?.length).toBe(64);
  });

  it('truncates long description to 512 chars', () => {
    const longDesc = 'b'.repeat(600);
    const content = `---
description: ${longDesc}
---
`;
    const result = parseFrontmatter(content);
    expect(result.description?.length).toBe(512);
  });
});

// --- Scope deduplication (mirrors logic from getInstalledSkills) ----------------

/**
 * Replicate the dedup logic from getInstalledSkills so we can unit-test it
 * without touching the filesystem.
 */
function deduplicateSkills(allSkills: SkillInfo[]): SkillInfo[] {
  const SCOPE_PRIORITY: Record<string, number> = { personal: 3, project: 2, plugin: 1, legacy: 0 };
  const seen = new Map<string, SkillInfo>();
  for (const skill of allSkills) {
    const existing = seen.get(skill.name);
    if (!existing) {
      seen.set(skill.name, skill);
    } else {
      const mergedTypes = [...new Set([...existing.agentTypes, ...skill.agentTypes])];
      if ((SCOPE_PRIORITY[skill.scope] ?? 0) > (SCOPE_PRIORITY[existing.scope] ?? 0)) {
        seen.set(skill.name, { ...skill, agentTypes: mergedTypes });
      } else {
        seen.set(skill.name, { ...existing, agentTypes: mergedTypes });
      }
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function makeStubSkill(overrides: Partial<SkillInfo> & { name: string; scope: SkillInfo['scope'] }): SkillInfo {
  return {
    description: '',
    filePath: `/stub/${overrides.name}`,
    userInvocable: true,
    disableModelInvocation: false,
    allowedTools: [],
    model: null,
    context: 'inline',
    agent: null,
    argumentHint: null,
    pluginName: null,
    category: null,
    agentTypes: ['claude-code'],
    ...overrides,
  };
}

describe('scope deduplication', () => {
  it('keeps unique skills as-is', () => {
    const skills = [
      makeStubSkill({ name: 'alpha', scope: 'personal' }),
      makeStubSkill({ name: 'beta', scope: 'project' }),
    ];
    const result = deduplicateSkills(skills);
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.name)).toEqual(['alpha', 'beta']);
  });

  it('higher scope wins over lower scope (personal > project)', () => {
    const skills = [
      makeStubSkill({ name: 'deploy', scope: 'project', description: 'project version' }),
      makeStubSkill({ name: 'deploy', scope: 'personal', description: 'personal version' }),
    ];
    const result = deduplicateSkills(skills);
    expect(result).toHaveLength(1);
    expect(result[0].scope).toBe('personal');
    expect(result[0].description).toBe('personal version');
  });

  it('higher scope wins regardless of insertion order (personal first)', () => {
    const skills = [
      makeStubSkill({ name: 'deploy', scope: 'personal', description: 'personal version' }),
      makeStubSkill({ name: 'deploy', scope: 'project', description: 'project version' }),
    ];
    const result = deduplicateSkills(skills);
    expect(result).toHaveLength(1);
    expect(result[0].scope).toBe('personal');
    expect(result[0].description).toBe('personal version');
  });

  it('project scope wins over plugin scope', () => {
    const skills = [
      makeStubSkill({ name: 'lint', scope: 'plugin', pluginName: 'my-plugin' }),
      makeStubSkill({ name: 'lint', scope: 'project' }),
    ];
    const result = deduplicateSkills(skills);
    expect(result).toHaveLength(1);
    expect(result[0].scope).toBe('project');
    expect(result[0].pluginName).toBeNull();
  });

  it('plugin scope wins over legacy scope', () => {
    const skills = [
      makeStubSkill({ name: 'format', scope: 'legacy' }),
      makeStubSkill({ name: 'format', scope: 'plugin', pluginName: 'fmt' }),
    ];
    const result = deduplicateSkills(skills);
    expect(result).toHaveLength(1);
    expect(result[0].scope).toBe('plugin');
  });

  it('merges agentTypes from all duplicate sources', () => {
    const skills = [
      makeStubSkill({ name: 'review', scope: 'project', agentTypes: ['claude-code'] }),
      makeStubSkill({ name: 'review', scope: 'personal', agentTypes: ['opencode'] }),
    ];
    const result = deduplicateSkills(skills);
    expect(result).toHaveLength(1);
    // personal wins but agentTypes are merged
    expect(result[0].scope).toBe('personal');
    expect(result[0].agentTypes).toEqual(expect.arrayContaining(['claude-code', 'opencode']));
    expect(result[0].agentTypes).toHaveLength(2);
  });

  it('merges agentTypes without duplicates', () => {
    const skills = [
      makeStubSkill({ name: 'test', scope: 'personal', agentTypes: ['claude-code', 'opencode'] }),
      makeStubSkill({ name: 'test', scope: 'project', agentTypes: ['claude-code', 'copilot'] }),
    ];
    const result = deduplicateSkills(skills);
    expect(result).toHaveLength(1);
    expect(result[0].agentTypes).toHaveLength(3);
    expect(result[0].agentTypes).toEqual(expect.arrayContaining(['claude-code', 'opencode', 'copilot']));
  });

  it('handles three-way duplicates across personal, project, and legacy', () => {
    const skills = [
      makeStubSkill({ name: 'build', scope: 'legacy', agentTypes: ['claude-code'] }),
      makeStubSkill({ name: 'build', scope: 'project', agentTypes: ['opencode'] }),
      makeStubSkill({ name: 'build', scope: 'personal', agentTypes: ['copilot'] }),
    ];
    const result = deduplicateSkills(skills);
    expect(result).toHaveLength(1);
    expect(result[0].scope).toBe('personal');
    expect(result[0].agentTypes).toHaveLength(3);
  });

  it('returns results sorted alphabetically by name', () => {
    const skills = [
      makeStubSkill({ name: 'zebra', scope: 'personal' }),
      makeStubSkill({ name: 'alpha', scope: 'personal' }),
      makeStubSkill({ name: 'middle', scope: 'project' }),
    ];
    const result = deduplicateSkills(skills);
    expect(result.map((s) => s.name)).toEqual(['alpha', 'middle', 'zebra']);
  });
});

// --- Legacy command parsing (no frontmatter) ------------------------------------

describe('legacy command parsing (no frontmatter)', () => {
  it('returns empty object for plain markdown (no --- delimiters)', () => {
    const content = 'Review the code in the current directory and suggest improvements.';
    const result = parseFrontmatter(content);
    expect(result).toEqual({});
  });

  it('returns empty object for multi-line markdown without frontmatter', () => {
    const content = `Find all TODO comments in the codebase.
List them grouped by file.
Suggest which ones to address first.`;
    const result = parseFrontmatter(content);
    expect(result).toEqual({});
  });

  it('returns empty object for markdown with heading but no frontmatter', () => {
    const content = `# Deploy Helper
Run the deployment pipeline and report any failures.`;
    const result = parseFrontmatter(content);
    expect(result).toEqual({});
  });

  it('returns empty object when --- appears only once (not valid frontmatter)', () => {
    const content = `---
This is just a horizontal rule, not frontmatter.`;
    const result = parseFrontmatter(content);
    expect(result).toEqual({});
  });

  it('first non-empty line serves as description in legacy workflow', () => {
    // This mirrors how scanLegacyCommands uses parseFrontmatter result:
    // parseFrontmatter returns {} and the caller uses the first line as description.
    const content = `  Refactor the authentication module to use JWT tokens.

Additional details here.`;
    const parsed = parseFrontmatter(content);
    expect(parsed).toEqual({});

    // Simulate scanLegacyCommands: first non-empty trimmed line becomes description
    const firstLine = content.split(/\r?\n/).find((l) => l.trim()) ?? '';
    expect(firstLine.trim()).toBe('Refactor the authentication module to use JWT tokens.');
  });

  it('handles empty legacy file gracefully', () => {
    const parsed = parseFrontmatter('');
    expect(parsed).toEqual({});

    // Simulate scanLegacyCommands: no first line → empty description
    const firstLine = ''.split(/\r?\n/).find((l) => l.trim()) ?? '';
    expect(firstLine).toBe('');
  });

  it('handles file with only whitespace lines', () => {
    const content = `

    `;
    const parsed = parseFrontmatter(content);
    expect(parsed).toEqual({});

    const firstLine = content.split(/\r?\n/).find((l) => l.trim()) ?? '';
    expect(firstLine).toBe('');
  });
});
