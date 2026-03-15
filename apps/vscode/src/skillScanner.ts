/**
 * Skill scanner — discovers installed SKILL.md files and parses their frontmatter.
 * Runs in the extension host (Node.js context).
 */

import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';

export type AgentTypeName = 'claude-code' | 'opencode' | 'copilot';

export interface SkillInfo {
  name: string;
  description: string;
  scope: 'personal' | 'project' | 'plugin' | 'legacy';
  filePath: string;
  userInvocable: boolean;
  disableModelInvocation: boolean;
  allowedTools: string[];
  model: string | null;
  context: 'inline' | 'fork';
  agent: string | null;
  argumentHint: string | null;
  pluginName: string | null;
  /** Category folder (e.g. 'documentation') — null if skill is at the root level. */
  category: string | null;
  /** Which agent types can use this skill — derived from the directory it was found in. */
  agentTypes: AgentTypeName[];
  /** Category from SKILL.md metadata.category (does not affect file location). */
  metadataCategory: string | null;
  /** Tags from SKILL.md metadata.tags (does not affect file location). */
  tags: string[];
}

// --- Frontmatter parser -------------------------------------------------------

/**
 * Parse YAML frontmatter from a SKILL.md file.
 * Handles the simple key-value subset used by skills — no nested objects.
 */
export function parseFrontmatter(content: string): Partial<SkillInfo> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};

  const result: Partial<SkillInfo> = {};
  let inMetadata = false;
  for (const line of match[1].split(/\r?\n/)) {
    // Detect metadata block (indented lines under `metadata:`)
    if (inMetadata) {
      if (/^\s+/.test(line)) {
        const sep = line.indexOf(':');
        if (sep < 1) continue;
        const mKey = line.slice(0, sep).trim();
        const mVal = line.slice(sep + 1).trim().replace(/^["']|["']$/g, '');
        if (mKey === 'category') result.metadataCategory = mVal || null;
        if (mKey === 'tags') {
          // Parse YAML inline array: [tag1, tag2] or comma-separated
          const inner = mVal.replace(/^\[|]$/g, '');
          result.tags = inner.split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
        }
        continue;
      }
      inMetadata = false; // non-indented line ends metadata block
    }

    const sep = line.indexOf(':');
    if (sep < 1) continue;
    const key = line.slice(0, sep).trim();
    const val = line.slice(sep + 1).trim();
    // Strip surrounding quotes
    const unquoted = val.replace(/^["']|["']$/g, '');

    switch (key) {
      case 'name': result.name = unquoted.slice(0, 64); break;
      case 'description': result.description = unquoted.slice(0, 512); break;
      case 'disable-model-invocation': result.disableModelInvocation = unquoted === 'true'; break;
      case 'user-invocable': result.userInvocable = unquoted !== 'false'; break;
      case 'allowed-tools':
        result.allowedTools = unquoted.split(',').map((s) => s.trim()).filter(Boolean);
        break;
      case 'model': result.model = unquoted || null; break;
      case 'context': result.context = unquoted === 'fork' ? 'fork' : 'inline'; break;
      case 'agent': result.agent = unquoted || null; break;
      case 'argument-hint': result.argumentHint = unquoted || null; break;
      case 'metadata': inMetadata = true; break;
    }
  }
  return result;
}

// --- Directory scanning -------------------------------------------------------

function makeSkillInfo(
  partial: Partial<SkillInfo>,
  defaults: { name: string; scope: SkillInfo['scope']; filePath: string; pluginName?: string; category?: string; agentTypes: AgentTypeName[] },
): SkillInfo {
  return {
    name: partial.name || defaults.name,
    description: partial.description || '',
    scope: defaults.scope,
    filePath: defaults.filePath,
    userInvocable: partial.userInvocable ?? true,
    disableModelInvocation: partial.disableModelInvocation ?? false,
    allowedTools: partial.allowedTools ?? [],
    model: partial.model ?? null,
    context: partial.context ?? 'inline',
    agent: partial.agent ?? null,
    argumentHint: partial.argumentHint ?? null,
    pluginName: defaults.pluginName ?? null,
    category: defaults.category ?? null,
    agentTypes: defaults.agentTypes,
    metadataCategory: partial.metadataCategory ?? null,
    tags: partial.tags ?? [],
  };
}

/**
 * Scan a skills directory (e.g. ~/.claude/skills/) for SKILL.md entries.
 * Supports both flat (`skills/<name>/SKILL.md`) and categorized
 * (`skills/<category>/<name>/SKILL.md`) layouts — one level of nesting.
 */
async function scanSkillsDir(
  dirPath: string,
  scope: SkillInfo['scope'],
  agentTypes: AgentTypeName[],
  pluginName?: string,
): Promise<SkillInfo[]> {
  const results: SkillInfo[] = [];
  let entries: string[];
  try {
    entries = await fsp.readdir(dirPath);
  } catch { return results; }

  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry);
    const skillPath = path.join(entryPath, 'SKILL.md');

    // Try flat: skills/<name>/SKILL.md
    try {
      const content = await fsp.readFile(skillPath, 'utf8');
      const parsed = parseFrontmatter(content);
      results.push(makeSkillInfo(parsed, { name: entry, scope, filePath: skillPath, agentTypes, pluginName }));
      continue; // Found SKILL.md at this level — don't scan deeper
    } catch { /* no SKILL.md here — check if it's a category folder */ }

    // Try categorized: skills/<category>/<name>/SKILL.md
    let subEntries: string[];
    try {
      subEntries = await fsp.readdir(entryPath);
    } catch { continue; }
    for (const sub of subEntries) {
      const subSkillPath = path.join(entryPath, sub, 'SKILL.md');
      try {
        const content = await fsp.readFile(subSkillPath, 'utf8');
        const parsed = parseFrontmatter(content);
        results.push(makeSkillInfo(parsed, { name: sub, scope, filePath: subSkillPath, category: entry, agentTypes, pluginName }));
      } catch { /* skip */ }
    }
  }
  return results;
}

/** Scan legacy .claude/commands/*.md files. */
async function scanLegacyCommands(dirPath: string): Promise<SkillInfo[]> {
  const results: SkillInfo[] = [];
  let entries: string[];
  try {
    entries = await fsp.readdir(dirPath);
  } catch { return results; }

  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    const filePath = path.join(dirPath, entry);
    try {
      const content = await fsp.readFile(filePath, 'utf8');
      const name = entry.replace(/\.md$/, '');
      const firstLine = content.split(/\r?\n/).find((l) => l.trim()) ?? '';
      results.push(makeSkillInfo(
        { description: firstLine.slice(0, 512) },
        { name, scope: 'legacy', filePath, agentTypes: ['claude-code'] },
      ));
    } catch { /* skip unreadable */ }
  }
  return results;
}

// --- Main API -----------------------------------------------------------------

/**
 * Scan all known locations for installed skills.
 * Returns deduplicated list (higher scope wins).
 */
export async function getInstalledSkills(workspaceFolders: string[]): Promise<SkillInfo[]> {
  const home = os.homedir();
  const claudeDir = path.join(home, '.claude');
  const opencodeDir = path.join(home, '.config', 'opencode');
  const agentsDir = path.join(home, '.agents');
  const copilotDir = path.join(home, '.copilot');

  /** All three agents read .claude/skills/ and .agents/skills/. */
  const ALL_AGENTS: AgentTypeName[] = ['claude-code', 'opencode', 'copilot'];

  const allSkills: SkillInfo[] = [];

  // ── Personal skills (global) ──
  // ~/.claude/skills/ — shared by all three agents
  allSkills.push(...await scanSkillsDir(path.join(claudeDir, 'skills'), 'personal', ALL_AGENTS));
  // ~/.config/opencode/skills/ — OpenCode only
  allSkills.push(...await scanSkillsDir(path.join(opencodeDir, 'skills'), 'personal', ['opencode']));
  // ~/.copilot/skills/ — Copilot only
  allSkills.push(...await scanSkillsDir(path.join(copilotDir, 'skills'), 'personal', ['copilot']));
  // ~/.agents/skills/ — agent-agnostic, all agents
  allSkills.push(...await scanSkillsDir(path.join(agentsDir, 'skills'), 'personal', ALL_AGENTS));

  // ── Project skills (per workspace folder) ──
  for (const folder of workspaceFolders) {
    // .claude/skills/ — shared by all three agents
    allSkills.push(...await scanSkillsDir(path.join(folder, '.claude', 'skills'), 'project', ALL_AGENTS));
    // .opencode/skills/ — OpenCode only
    allSkills.push(...await scanSkillsDir(path.join(folder, '.opencode', 'skills'), 'project', ['opencode']));
    // .github/skills/ — Copilot only
    allSkills.push(...await scanSkillsDir(path.join(folder, '.github', 'skills'), 'project', ['copilot']));
    // .agents/skills/ — agent-agnostic, all agents
    allSkills.push(...await scanSkillsDir(path.join(folder, '.agents', 'skills'), 'project', ALL_AGENTS));
  }

  // Plugin skills (~/.claude/plugins/*/skills/) — Claude Code only
  const pluginsDir = path.join(claudeDir, 'plugins');
  try {
    const pluginDirs = await fsp.readdir(pluginsDir);
    for (const pluginDir of pluginDirs) {
      const skillsDir = path.join(pluginsDir, pluginDir, 'skills');
      allSkills.push(...await scanSkillsDir(skillsDir, 'plugin', ['claude-code'], pluginDir));
    }
  } catch { /* no plugins directory */ }

  // Legacy commands
  allSkills.push(...await scanLegacyCommands(path.join(claudeDir, 'commands')));
  for (const folder of workspaceFolders) {
    allSkills.push(...await scanLegacyCommands(path.join(folder, '.claude', 'commands')));
  }

  // Deduplicate by name — higher scope wins, but merge agentTypes from all sources
  const SCOPE_PRIORITY: Record<string, number> = { personal: 3, project: 2, plugin: 1, legacy: 0 };
  const seen = new Map<string, SkillInfo>();
  for (const skill of allSkills) {
    const existing = seen.get(skill.name);
    if (!existing) {
      seen.set(skill.name, skill);
    } else {
      // Merge agentTypes from all sources
      const mergedTypes = [...new Set([...existing.agentTypes, ...skill.agentTypes])];
      // Keep higher-scope version's metadata but with merged agent types
      if ((SCOPE_PRIORITY[skill.scope] ?? 0) > (SCOPE_PRIORITY[existing.scope] ?? 0)) {
        seen.set(skill.name, { ...skill, agentTypes: mergedTypes });
      } else {
        seen.set(skill.name, { ...existing, agentTypes: mergedTypes });
      }
    }
  }

  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// --- File watcher -------------------------------------------------------------

/**
 * Create a file watcher that re-scans skills on SKILL.md or commands changes.
 * Returns a disposable to clean up the watchers.
 */
export function createSkillWatcher(
  onChange: (skills: SkillInfo[]) => void,
): vscode.Disposable {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const DEBOUNCE_MS = 500;

  function scheduleRescan() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
      void getInstalledSkills(folders).then(onChange);
    }, DEBOUNCE_MS);
  }

  const watchers: vscode.FileSystemWatcher[] = [];

  // Watch workspace-relative skill locations
  watchers.push(vscode.workspace.createFileSystemWatcher('**/SKILL.md'));
  watchers.push(vscode.workspace.createFileSystemWatcher('**/.claude/commands/*.md'));

  // Watch personal skill locations outside the workspace (home directory)
  const home = os.homedir();
  const personalDirs = [
    path.join(home, '.claude', 'skills'),
    path.join(home, '.claude', 'commands'),
    path.join(home, '.claude', 'plugins'),
    path.join(home, '.config', 'opencode', 'skills'),
    path.join(home, '.copilot', 'skills'),
    path.join(home, '.agents', 'skills'),
  ];
  for (const dir of personalDirs) {
    const pattern = new vscode.RelativePattern(vscode.Uri.file(dir), '**/*.md');
    watchers.push(vscode.workspace.createFileSystemWatcher(pattern));
  }

  for (const w of watchers) {
    w.onDidCreate(scheduleRescan);
    w.onDidChange(scheduleRescan);
    w.onDidDelete(scheduleRescan);
  }

  return {
    dispose() {
      if (debounceTimer) clearTimeout(debounceTimer);
      for (const w of watchers) w.dispose();
    },
  };
}
