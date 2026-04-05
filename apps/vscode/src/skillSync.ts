/**
 * Skill Sync — copies bundled skill files to agent-specific skill directories
 * before spawning, so spawned agents discover Event Horizon skills automatically.
 */

import * as os from 'os';
import * as path from 'path';
import * as fsp from 'fs/promises';

const BUNDLED_SKILLS_DIR = path.join(os.homedir(), '.claude', 'skills');

/** Skill directories by agent type. */
const SKILL_TARGETS: Record<string, string> = {
  'claude-code': path.join(os.homedir(), '.claude', 'skills', 'event-horizon'),
  'opencode': path.join(os.homedir(), '.config', 'opencode', 'plugins', 'skills', 'event-horizon'),
  // Cursor has no skill directory convention — skip
};

/**
 * Sync bundled EH skills to the target agent's skill directory.
 * Copies SKILL.md files from the bundled skills location.
 */
export async function syncSkillsForAgent(agentType: string): Promise<{ synced: boolean; path?: string; error?: string }> {
  const targetDir = SKILL_TARGETS[agentType];
  if (!targetDir) {
    return { synced: false, error: `No skill directory configured for agent type: ${agentType}` };
  }

  try {
    // Read bundled skill directories
    const entries = await fsp.readdir(BUNDLED_SKILLS_DIR, { withFileTypes: true });
    const skillDirs = entries.filter((e) => e.isDirectory() && e.name.startsWith('eh-'));

    await fsp.mkdir(targetDir, { recursive: true });

    for (const skillDir of skillDirs) {
      const srcFile = path.join(BUNDLED_SKILLS_DIR, skillDir.name, 'SKILL.md');
      const destDir = path.join(targetDir, skillDir.name);
      const destFile = path.join(destDir, 'SKILL.md');

      try {
        const content = await fsp.readFile(srcFile, 'utf8');
        await fsp.mkdir(destDir, { recursive: true });
        await fsp.writeFile(destFile, content, 'utf8');
      } catch {
        // Skip individual skill failures
      }
    }

    return { synced: true, path: targetDir };
  } catch (err) {
    return { synced: false, error: String(err) };
  }
}

/**
 * Get skills needed for a role by reading the role definition's skill list.
 */
export function getSkillsForRole(roleSkills: string[]): string[] {
  return roleSkills.map((s) => s.startsWith('eh-') ? s : `eh-${s}`);
}
