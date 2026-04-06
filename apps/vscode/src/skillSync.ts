/**
 * Skill Sync — writes bundled skill definitions to agent-specific skill directories
 * before spawning, so spawned agents discover Event Horizon skills automatically.
 *
 * Sources skill content directly from bundledSkills.ts (in-memory) rather than
 * reading from disk, so skills work for ALL agent types regardless of whether
 * Claude Code is installed.
 */

import * as os from 'os';
import * as path from 'path';
import * as fsp from 'fs/promises';
import { getBundledSkills } from './bundledSkills.js';

/** Skill directories by agent type. */
const SKILL_TARGETS: Record<string, string> = {
  'claude-code': path.join(os.homedir(), '.claude', 'skills', 'event-horizon'),
  'opencode': path.join(os.homedir(), '.config', 'opencode', 'plugins', 'skills', 'event-horizon'),
  'cursor': path.join(os.homedir(), '.cursor', 'skills', 'event-horizon'),
};

/**
 * Sync bundled EH skills to the target agent's skill directory.
 * Reads skill content from the extension's built-in bundledSkills definitions
 * and writes SKILL.md files to the target directory.
 */
export async function syncSkillsForAgent(agentType: string): Promise<{ synced: boolean; path?: string; error?: string }> {
  const targetDir = SKILL_TARGETS[agentType];
  if (!targetDir) {
    return { synced: false, error: `No skill directory configured for agent type: ${agentType}` };
  }

  try {
    const bundledSkills = getBundledSkills();

    await fsp.mkdir(targetDir, { recursive: true });

    for (const skill of bundledSkills) {
      const destDir = path.join(targetDir, skill.dirName);
      const destFile = path.join(destDir, 'SKILL.md');

      try {
        await fsp.mkdir(destDir, { recursive: true });
        await fsp.writeFile(destFile, skill.content, 'utf8');
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
