/**
 * Webview provider for the universe panel (editor area) and sidebar launcher.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fsp from 'fs/promises';
import type { AgentStateManager, MetricsEngine } from '@event-horizon/core';
import { runSetupClaudeCodeHooks, isClaudeCodeHooksInstalled, removeClaudeCodeHooks } from './setupHooks.js';
import { runSetupOpenCodeHooks, isOpenCodeHooksInstalled, removeOpenCodeHooks } from './setupOpenCodeHooks.js';
import { runSetupCopilotHooks, isCopilotHooksInstalled, removeCopilotHooks } from './setupCopilotHooks.js';
import { setupCursorHooks, isCursorHooksInstalled, removeCursorHooks, registerCursorMcpServer } from './setupCursorHooks.js';
import type { SkillInfo } from './skillScanner.js';
import { planBoardManager, roleManager, agentProfiler, sharedKnowledge, spawnRegistry } from './eventServer.js';
import { getDatabase } from './extension.js';

// ── Marketplace search ───────────────────────────────────────────────────────

async function handleMarketplaceSearch(
  webview: vscode.Webview,
  marketplaceUrl: string,
  query: string,
): Promise<void> {
  const SEARCH_TIMEOUT_MS = 8000;
  try {
    if (marketplaceUrl.includes('skillhub.club')) {
      const searchUrl = `https://www.skillhub.club/api/skills/search?q=${encodeURIComponent(query)}&limit=20`;
      const response = await fetch(searchUrl, { signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as { skills?: Array<{ name?: string; description?: string; author?: string; slug?: string }> };
      const results = (data.skills ?? []).map((s: { name?: string; description?: string; author?: string; slug?: string }) => ({
        name: s.name ?? 'Unknown',
        description: s.description ?? '',
        author: s.author ?? 'Unknown',
        url: `https://www.skillhub.club/skills/${s.slug ?? s.name ?? ''}`,
        source: 'SkillHub',
      }));
      void webview.postMessage({ type: 'marketplace-search-results', results, source: marketplaceUrl });
    } else {
      const searchUrl = `${marketplaceUrl.replace(/\/$/, '')}/api/search?q=${encodeURIComponent(query)}`;
      const response = await fetch(searchUrl, { signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as { results?: Array<{ name?: string; description?: string; author?: string; url?: string }> };
      const results = (data.results ?? []).map((s: { name?: string; description?: string; author?: string; url?: string }) => ({
        name: s.name ?? 'Unknown',
        description: s.description ?? '',
        author: s.author ?? 'Unknown',
        url: s.url ?? marketplaceUrl,
        source: new URL(marketplaceUrl).hostname,
      }));
      void webview.postMessage({ type: 'marketplace-search-results', results, source: marketplaceUrl });
    }
  } catch (err) {
    const isTimeout = err instanceof DOMException && err.name === 'TimeoutError';
    void webview.postMessage({ type: 'marketplace-search-error', source: marketplaceUrl, reason: isTimeout ? 'timeout' : 'error' });
  }
}

// ── Skill helpers ────────────────────────────────────────────────────────────

async function handleCreateSkill(msg: Record<string, unknown>): Promise<void> {
  const name = msg.name as string;
  const scope = msg.scope as string;
  const category = (msg.category as string) || '';
  if (!name || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(name)) {
    void vscode.window.showErrorMessage('Invalid skill name.');
    return;
  }
  if (category && !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(category)) {
    void vscode.window.showErrorMessage('Invalid category name — use kebab-case.');
    return;
  }

  const lines: string[] = ['---'];
  lines.push(`name: ${name}`);
  if (msg.description) lines.push(`description: "${msg.description}"`);
  lines.push(`user-invocable: ${msg.userInvocable !== false}`);
  if (msg.disableModelInvocation === true) lines.push('disable-model-invocation: true');
  if (msg.argumentHint) lines.push(`argument-hint: "${msg.argumentHint}"`);
  lines.push('---');
  lines.push('');
  lines.push('<!-- Write your skill instructions here -->');
  lines.push('');
  const content = lines.join('\n');

  let skillsBase: string;
  if (scope === 'personal') {
    skillsBase = path.join(os.homedir(), '.claude', 'skills');
  } else {
    const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!wsFolder) {
      void vscode.window.showErrorMessage('No workspace folder open.');
      return;
    }
    skillsBase = path.join(wsFolder, '.claude', 'skills');
  }
  const targetDir = category
    ? path.join(skillsBase, category, name)
    : path.join(skillsBase, name);

  const filePath = path.join(targetDir, 'SKILL.md');
  try {
    await fsp.mkdir(targetDir, { recursive: true });
    await fsp.writeFile(filePath, content, 'utf8');
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
    await vscode.window.showTextDocument(doc);
    void vscode.window.showInformationMessage(`Skill "${name}" created at ${filePath}`);
  } catch (err) {
    void vscode.window.showErrorMessage(`Failed to create skill: ${err}`);
  }
}

async function handleMoveSkill(filePath: string, _newCategory: string): Promise<void> {
  const skillDir = path.dirname(filePath);
  const skillName = path.basename(skillDir);

  const normalized = filePath.split('\\').join('/');
  const parts = normalized.split('/');
  const skillsIdx = parts.lastIndexOf('skills');
  if (skillsIdx < 0) {
    void vscode.window.showErrorMessage('Cannot determine skills root directory.');
    return;
  }
  const skillsRoot = parts.slice(0, skillsIdx + 1).join(path.sep);
  const parentDir = path.dirname(skillDir);
  const newDir = path.join(skillsRoot, skillName);

  if (path.resolve(newDir) === path.resolve(skillDir)) {
    void vscode.window.showInformationMessage(`Skill "${skillName}" is already at the root.`);
    return;
  }

  try {
    await fsp.rename(skillDir, newDir);
    try {
      const remaining = await fsp.readdir(parentDir);
      if (remaining.length === 0 && path.resolve(parentDir) !== path.resolve(skillsRoot)) {
        await fsp.rmdir(parentDir);
      }
    } catch { /* ignore */ }
    void vscode.window.showInformationMessage(
      `Skill "${skillName}" moved to root. Use metadata.category in SKILL.md for categorization.`,
    );
  } catch (err) {
    void vscode.window.showErrorMessage(`Failed to move skill: ${err}`);
  }
}

async function handleDuplicateSkill(filePath: string, newName: string): Promise<void> {
  if (!newName || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(newName)) {
    void vscode.window.showErrorMessage('Invalid skill name — use kebab-case (e.g. my-skill-copy).');
    return;
  }

  const skillDir = path.dirname(filePath);
  const parentDir = path.dirname(skillDir);

  let content: string;
  try {
    content = await fsp.readFile(filePath, 'utf8');
  } catch (err) {
    void vscode.window.showErrorMessage(`Failed to read source skill: ${err}`);
    return;
  }

  content = content.replace(/^(name:\s*).+$/m, `$1${newName}`);

  const newDir = path.join(parentDir, newName);
  const newFilePath = path.join(newDir, 'SKILL.md');

  try {
    await fsp.mkdir(newDir, { recursive: true });
    await fsp.writeFile(newFilePath, content, 'utf8');
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(newFilePath));
    await vscode.window.showTextDocument(doc);
    void vscode.window.showInformationMessage(`Skill "${newName}" duplicated from "${path.basename(skillDir)}".`);
  } catch (err) {
    void vscode.window.showErrorMessage(`Failed to duplicate skill: ${err}`);
  }
}

// ── Shared webview setup ─────────────────────────────────────────────────────

async function getConnectedAgentTypes(): Promise<string[]> {
  const types: string[] = [];
  if (await isClaudeCodeHooksInstalled()) types.push('claude-code');
  if (await isOpenCodeHooksInstalled()) types.push('opencode');
  if (await isCopilotHooksInstalled()) types.push('copilot');
  if (await isCursorHooksInstalled()) types.push('cursor');
  return types;
}

// ── VS Code native settings helpers ─────────────────────────────────────────

/** Agent type keys used in VS Code settings (camelCase) → store keys (kebab-case). */
const AGENT_CONFIG_MAP: Record<string, string> = {
  claudeCode: 'claude-code',
  copilot: 'copilot',
  opencode: 'opencode',
  cursor: 'cursor',
  unknown: 'unknown',
};

/** Read the current VS Code configuration and return the settings objects. */
function readVscodeConfig(): {
  settings: Record<string, { color: string; sizeMult: number }>;
  achievementsEnabled: boolean;
  animationSpeed: number;
  eventServerPort: number;
  fileLockingEnabled: boolean;
  worktreeIsolation: boolean;
  viewMode: 'universe' | 'operations';
  planShowAllColumns: boolean;
  fontSize: 'small' | 'default' | 'large';
} {
  const cfg = vscode.workspace.getConfiguration('eventHorizon');
  const settings: Record<string, { color: string; sizeMult: number }> = {};
  for (const [cfgKey, storeKey] of Object.entries(AGENT_CONFIG_MAP)) {
    settings[storeKey] = {
      color: cfg.get<string>(`agentColors.${cfgKey}`, '#aaccff'),
      sizeMult: cfg.get<number>(`agentSizes.${cfgKey}`, 1.0),
    };
  }
  return {
    settings,
    achievementsEnabled: cfg.get<boolean>('achievementsEnabled', true),
    animationSpeed: cfg.get<number>('animationSpeed', 1.0),
    eventServerPort: cfg.get<number>('port', 28765),
    fileLockingEnabled: cfg.get<boolean>('fileLockingEnabled', false),
    worktreeIsolation: cfg.get<boolean>('worktreeIsolation', false),
    viewMode: cfg.get<'universe' | 'operations'>('defaultView', 'universe'),
    planShowAllColumns: cfg.get<boolean>('planShowAllColumns', false),
    fontSize: cfg.get<'small' | 'default' | 'large'>('fontSize', 'default'),
  };
}

/** Write settings back to VS Code configuration (user-level). */
async function writeVscodeConfig(msg: {
  settings?: Record<string, { color: string; sizeMult: number }>;
  achievementsEnabled?: boolean;
  animationSpeed?: number;
  eventServerPort?: number;
  fileLockingEnabled?: boolean;
  worktreeIsolation?: boolean;
  viewMode?: 'universe' | 'operations';
  planShowAllColumns?: boolean;
  fontSize?: 'small' | 'default' | 'large';
}): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('eventHorizon');
  if (msg.achievementsEnabled !== undefined) {
    await cfg.update('achievementsEnabled', msg.achievementsEnabled, vscode.ConfigurationTarget.Global);
  }
  if (msg.animationSpeed !== undefined) {
    await cfg.update('animationSpeed', msg.animationSpeed, vscode.ConfigurationTarget.Global);
  }
  if (msg.eventServerPort !== undefined) {
    await cfg.update('port', msg.eventServerPort, vscode.ConfigurationTarget.Global);
  }
  if (msg.fileLockingEnabled !== undefined) {
    await cfg.update('fileLockingEnabled', msg.fileLockingEnabled, vscode.ConfigurationTarget.Global);
  }
  if (msg.worktreeIsolation !== undefined) {
    await cfg.update('worktreeIsolation', msg.worktreeIsolation, vscode.ConfigurationTarget.Global);
  }
  if (msg.viewMode !== undefined) {
    await cfg.update('defaultView', msg.viewMode, vscode.ConfigurationTarget.Global);
  }
  if (msg.planShowAllColumns !== undefined) {
    await cfg.update('planShowAllColumns', msg.planShowAllColumns, vscode.ConfigurationTarget.Global);
  }
  if (msg.fontSize !== undefined) {
    await cfg.update('fontSize', msg.fontSize, vscode.ConfigurationTarget.Global);
  }
  if (msg.settings) {
    for (const [cfgKey, storeKey] of Object.entries(AGENT_CONFIG_MAP)) {
      const v = msg.settings[storeKey];
      if (v) {
        await cfg.update(`agentColors.${cfgKey}`, v.color, vscode.ConfigurationTarget.Global);
        await cfg.update(`agentSizes.${cfgKey}`, v.sizeMult, vscode.ConfigurationTarget.Global);
      }
    }
  }
}

/** Set up hydration + message handling for the full universe webview. */
function wireUniverseWebview(
  webview: vscode.Webview,
  context: vscode.ExtensionContext,
  agentStateManager: AgentStateManager,
  metricsEngine: MetricsEngine,
  getSkills?: () => SkillInfo[],
  rescanSkills?: () => Promise<SkillInfo[]>,
): void {
  // Guard to suppress config-change echoes when the webview writes back to VS Code settings
  let suppressConfigEcho = false;

  // Listen for VS Code settings changes and push to webview
  const configListener = vscode.workspace.onDidChangeConfiguration((e) => {
    if (suppressConfigEcho) return;
    if (e.affectsConfiguration('eventHorizon')) {
      const cfg = readVscodeConfig();
      const savedGeneral = context.globalState.get<Record<string, unknown>>('generalSettings');
      void webview.postMessage({
        type: 'init-settings',
        ...cfg,
        // tourCompleted is the only non-config setting still in globalState
        tourCompleted: (savedGeneral as Record<string, unknown> | undefined)?.tourCompleted,
      });
    }
  });
  // Clean up listener when webview is disposed (handled by caller via context.subscriptions)
  context.subscriptions.push(configListener);

  function hydrateWebview() {
    void getConnectedAgentTypes().then((agentTypes) => {
      void webview.postMessage({ type: 'connected-agents', agentTypes });
    });

    const agents = agentStateManager.getAllAgents();
    const metrics = metricsEngine.getAllMetrics();
    if (agents.length > 0) {
      void webview.postMessage({ type: 'init-state', agents, metrics });
    }

    // ── Send historical events from persistence for replay ──
    const db = getDatabase();
    if (db) {
      try {
        const since = Date.now() - 24 * 60 * 60 * 1000; // last 24 hours
        const historicalEvents = db.queryEvents({ since, limit: 500 });
        const sessions = db.getSessions(since);
        if (historicalEvents.length > 0) {
          void webview.postMessage({
            type: 'event-history',
            events: historicalEvents,
            sessions,
          });
        }
      } catch { /* persistence not ready yet — skip history */ }
    }

    const savedMedals = context.globalState.get<{
      unlockedAchievements: string[];
      achievementTiers: Record<string, number>;
      achievementCounts: Record<string, number>;
    }>('medals');
    // Always send init-medals (even empty) so the webview knows medals are hydrated and achievement
    // triggers can fire. Otherwise users with zero medals would never see any toasts.
    void webview.postMessage({
      type: 'init-medals',
      unlockedAchievements: savedMedals?.unlockedAchievements ?? [],
      achievementTiers: savedMedals?.achievementTiers ?? {},
      achievementCounts: savedMedals?.achievementCounts ?? {},
    });

    // Read from VS Code native settings (preferred) with globalState fallback for
    // settings not exposed in contributes.configuration (e.g. tourCompleted).
    const vscodeSettings = readVscodeConfig();
    const savedGeneral = context.globalState.get<Record<string, unknown>>('generalSettings');
    void webview.postMessage({
      type: 'init-settings',
      ...vscodeSettings,
      // Preserve non-config settings from globalState (viewMode and planShowAllColumns
      // come from VS Code config via readVscodeConfig — do NOT override from stale globalState)
      tourCompleted: (savedGeneral as Record<string, unknown> | undefined)?.tourCompleted,
    });

    const savedSingularity = context.globalState.get<Record<string, unknown>>('singularityStats');
    if (savedSingularity) {
      void webview.postMessage({ type: 'init-singularity', stats: savedSingularity });
    }

    // Hydrate shared knowledge — this is the fix for the "Knowledge tab empty forever" race.
    // sharedKnowledge.onChange() broadcasts via webviewRef.current?.postMessage, but on initial
    // activation that ref is still null. Without this line, any entries written before the
    // webview mounts (including auto-seeded instruction files) never reach the UI.
    const knowledgeEntries = sharedKnowledge.getAllEntries();
    void webview.postMessage({
      type: 'knowledge-update',
      workspace: knowledgeEntries.workspace,
      plan: knowledgeEntries.plan,
    });

    const cachedSkills = getSkills?.() ?? [];
    if (cachedSkills.length > 0) {
      void webview.postMessage({ type: 'skills-update', skills: cachedSkills });
    } else {
      const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
      void import('./skillScanner.js').then(({ getInstalledSkills }) =>
        getInstalledSkills(folders).then((skills) => {
          void webview.postMessage({ type: 'skills-update', skills });
        })
      );
    }

    // Hydrate orchestrator + role maps so the Agents sidebar can render badges
    const orchIds: Record<string, boolean> = {};
    for (const p of planBoardManager.getAllPlans()) {
      if (p.orchestratorAgentId && p.status === 'active') {
        orchIds[p.orchestratorAgentId] = true;
      }
    }
    void webview.postMessage({
      type: 'orchestrator-update',
      orchestratorAgentIds: orchIds,
      orchestratorMap: planBoardManager.getOrchestratorMap(),
    });
    void webview.postMessage({
      type: 'roles-update',
      roles: roleManager.getAllRoles(),
      assignments: roleManager.getAllAssignments(),
      profiles: agentProfiler.getAllProfiles(),
      agentRoleMap: spawnRegistry.getAgentRoleMap(),
    });

    // Hydrate all plans from persisted state
    const allPlans = planBoardManager.getAllPlans();
    if (allPlans.length > 0) {
      const activePlan = allPlans.find((p) => p.status === 'active') ?? allPlans[0];
      void webview.postMessage({
        type: 'plans-update',
        plans: allPlans.map((p) => ({
          id: p.id, name: p.name, status: p.status,
          totalTasks: p.tasks.length,
          doneTasks: p.tasks.filter((t) => t.status === 'done').length,
          lastUpdatedAt: p.lastUpdatedAt,
        })),
        activePlan: {
          loaded: true,
          id: activePlan.id,
          name: activePlan.name,
          status: activePlan.status,
          sourceFile: activePlan.sourceFile,
          lastUpdatedAt: activePlan.lastUpdatedAt,
          tasks: activePlan.tasks.map((t) => ({
            id: t.id, title: t.title, status: t.status,
            assignee: t.assigneeName ?? t.assignee,
            assigneeId: t.assignee,
            blockedBy: t.blockedBy, notes: t.notes,
          })),
        },
      });
    }
  }

  webview.onDidReceiveMessage((msg: { type?: string; agentType?: string; command?: string; label?: string; [key: string]: unknown }) => {
    if (msg?.type === 'ready') {
      hydrateWebview();
      return;
    }
    if (msg?.type === 'request-plan') {
      const planId = msg.planId as string;
      const board = planBoardManager.getPlan(planId);
      if (board) {
        void webview.postMessage({
          type: 'plan-update',
          plan: {
            loaded: true, id: board.id, name: board.name, status: board.status,
            sourceFile: board.sourceFile, lastUpdatedAt: board.lastUpdatedAt,
            tasks: board.tasks.map((t) => ({
              id: t.id, title: t.title, status: t.status,
              assignee: t.assigneeName ?? t.assignee, assigneeId: t.assignee,
              blockedBy: t.blockedBy, notes: t.notes, role: t.role,
              retryCount: t.retryCount ?? 0, failedReason: t.failedReason ?? null,
              acceptanceCriteria: t.acceptanceCriteria ?? null,
              verifyCommand: t.verifyCommand ?? null,
              complexity: t.complexity ?? null,
              modelTier: t.modelTier ?? null,
              verificationStatus: t.verificationStatus ?? null,
            })),
          },
        });
      }
      return;
    }
    if (msg?.type === 'persist-medals') {
      void context.globalState.update('medals', {
        unlockedAchievements: msg.unlockedAchievements,
        achievementTiers: msg.achievementTiers,
        achievementCounts: msg.achievementCounts,
      });
      return;
    }
    if (msg?.type === 'persist-singularity') {
      void context.globalState.update('singularityStats', msg.stats);
      return;
    }
    if (msg?.type === 'persist-settings') {
      // Write to globalState (non-config settings like tourCompleted)
      void context.globalState.update('generalSettings', {
        tourCompleted: msg.tourCompleted,
      });
      // Write to VS Code native settings — suppress echo to avoid feedback loop
      suppressConfigEcho = true;
      void writeVscodeConfig({
        settings: msg.settings as Record<string, { color: string; sizeMult: number }> | undefined,
        achievementsEnabled: msg.achievementsEnabled as boolean | undefined,
        animationSpeed: msg.animationSpeed as number | undefined,
        eventServerPort: msg.eventServerPort as number | undefined,
        fileLockingEnabled: msg.fileLockingEnabled as boolean | undefined,
        worktreeIsolation: msg.worktreeIsolation as boolean | undefined,
        viewMode: msg.viewMode as 'universe' | 'operations' | undefined,
        planShowAllColumns: msg.planShowAllColumns as boolean | undefined,
        fontSize: msg.fontSize as 'small' | 'default' | 'large' | undefined,
      }).finally(() => {
        // Re-enable after a small delay to let all config change events flush
        setTimeout(() => { suppressConfigEcho = false; }, 200);
      });
      return;
    }
    if (msg?.type === 'setup-agent' && msg.agentType === 'claude-code') {
      void runSetupClaudeCodeHooks().then(async () => {
        void webview.postMessage({ type: 'connected-agents', agentTypes: await getConnectedAgentTypes() });
      });
    } else if (msg?.type === 'setup-agent' && msg.agentType === 'opencode') {
      void runSetupOpenCodeHooks().then(async () => {
        void webview.postMessage({ type: 'connected-agents', agentTypes: await getConnectedAgentTypes() });
      });
    } else if (msg?.type === 'remove-agent' && msg.agentType === 'claude-code') {
      void removeClaudeCodeHooks().then(async () => {
        void vscode.window.showInformationMessage('Event Horizon: Claude Code hooks removed.');
        void webview.postMessage({ type: 'connected-agents', agentTypes: await getConnectedAgentTypes() });
      });
    } else if (msg?.type === 'setup-agent' && msg.agentType === 'copilot') {
      void runSetupCopilotHooks().then(async () => {
        void webview.postMessage({ type: 'connected-agents', agentTypes: await getConnectedAgentTypes() });
      });
    } else if (msg?.type === 'remove-agent' && msg.agentType === 'opencode') {
      void removeOpenCodeHooks().then(async () => {
        void vscode.window.showInformationMessage('Event Horizon: OpenCode plugin removed.');
        void webview.postMessage({ type: 'connected-agents', agentTypes: await getConnectedAgentTypes() });
      });
    } else if (msg?.type === 'remove-agent' && msg.agentType === 'copilot') {
      void removeCopilotHooks().then(async () => {
        void vscode.window.showInformationMessage('Event Horizon: Copilot hooks removed.');
        void webview.postMessage({ type: 'connected-agents', agentTypes: await getConnectedAgentTypes() });
      });
    } else if (msg?.type === 'setup-agent' && msg.agentType === 'cursor') {
      void setupCursorHooks().then(async () => {
        await registerCursorMcpServer();
        void vscode.window.showInformationMessage('Event Horizon: Cursor hooks installed.');
        void webview.postMessage({ type: 'connected-agents', agentTypes: await getConnectedAgentTypes() });
      });
    } else if (msg?.type === 'remove-agent' && msg.agentType === 'cursor') {
      void removeCursorHooks().then(async () => {
        void vscode.window.showInformationMessage('Event Horizon: Cursor hooks removed.');
        void webview.postMessage({ type: 'connected-agents', agentTypes: await getConnectedAgentTypes() });
      });
    } else if (msg?.type === 'spawn-agent' && (msg.command || msg.agentType)) {
      // Legacy spawn (simple command) or new spawn (agentType + role + prompt)
      if (msg.agentType && msg.prompt) {
        // Phase 2 spawn via SpawnRegistry
        void import('./eventServer.js').then(({ spawnRegistry: sr }) => {
          void sr.spawn(msg.agentType as string, {
            prompt: msg.prompt as string,
            role: msg.role as string | undefined,
            cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
          }).then((result) => {
            if (result.status === 'spawned') {
              void vscode.window.showInformationMessage(`Spawned ${msg.agentType} agent: ${result.terminalName}`);
            } else {
              void vscode.window.showWarningMessage(`Spawn failed: ${result.message}`);
            }
          });
        });
      } else if (msg.command) {
        const ALLOWED_COMMANDS = ['claude', 'opencode', 'aider'];
        if (!ALLOWED_COMMANDS.includes(msg.command as string)) return;
        const terminal = vscode.window.createTerminal({ name: `Event Horizon: ${msg.label ?? msg.command}` });
        terminal.sendText(msg.command as string);
        terminal.show();
      }
    } else if (msg?.type === 'open-skill-file' && typeof msg.filePath === 'string') {
      const uri = vscode.Uri.file(msg.filePath);
      void vscode.workspace.openTextDocument(uri).then((doc) => {
        void vscode.window.showTextDocument(doc);
      });
    } else if (msg?.type === 'create-skill') {
      void handleCreateSkill(msg).then(async () => {
        if (rescanSkills) {
          const skills = await rescanSkills();
          void webview.postMessage({ type: 'skills-update', skills });
        }
      });
    } else if (msg?.type === 'open-marketplace-url' && typeof msg.url === 'string') {
      void vscode.env.openExternal(vscode.Uri.parse(msg.url));
    } else if (msg?.type === 'marketplace-search' && typeof msg.marketplaceUrl === 'string' && typeof msg.query === 'string') {
      void handleMarketplaceSearch(webview, msg.marketplaceUrl, msg.query);
    } else if (msg?.type === 'install-skill-from-url' && typeof msg.url === 'string') {
      void vscode.env.openExternal(vscode.Uri.parse(msg.url));
      void vscode.window.showInformationMessage(`Opening skill page. Use "skillhub install" or download manually to install.`);
    } else if (msg?.type === 'move-skill' && typeof msg.filePath === 'string' && typeof msg.newCategory === 'string') {
      void handleMoveSkill(msg.filePath, msg.newCategory).then(async () => {
        if (rescanSkills) {
          const skills = await rescanSkills();
          void webview.postMessage({ type: 'skills-update', skills });
        }
      });
    } else if (msg?.type === 'duplicate-skill' && typeof msg.filePath === 'string' && typeof msg.newName === 'string') {
      void handleDuplicateSkill(msg.filePath, msg.newName).then(async () => {
        if (rescanSkills) {
          const skills = await rescanSkills();
          void webview.postMessage({ type: 'skills-update', skills });
        }
      });
    } else if (msg?.type === 'request-roles') {
      void webview.postMessage({
        type: 'roles-update',
        roles: roleManager.getAllRoles(),
        assignments: roleManager.getAllAssignments(),
        profiles: agentProfiler.getAllProfiles(),
        agentRoleMap: spawnRegistry.getAgentRoleMap(),
      });
    } else if (msg?.type === 'assign-role') {
      const { roleId, agentType } = msg as { roleId: string; agentType: string };
      try {
        roleManager.assignRole(roleId, agentType, null);
      } catch { /* ignore invalid assignments */ }
    } else if (msg?.type === 'create-role') {
      try {
        const role = msg.role as { id: string; name: string; description: string; skills: string[]; instructions: string };
        roleManager.addCustomRole(role);
      } catch { /* ignore invalid role creation */ }
    } else if (msg?.type === 'edit-role') {
      try {
        const role = msg.role as { id: string; name: string; description: string; skills: string[]; instructions: string };
        roleManager.editRole(role.id, role);
      } catch { /* ignore invalid role edit */ }
    } else if (msg?.type === 'delete-role') {
      roleManager.removeCustomRole(msg.roleId as string);
    } else if (msg?.type === 'tell-all-prompt') {
      void vscode.window.showInputBox({ prompt: 'Broadcast message to all agents', placeHolder: 'Enter a message...' }).then((value) => {
        if (value && value.trim()) {
          sharedKnowledge.write(`broadcast-${Date.now()}`, value.trim(), 'workspace', 'user', 'user');
          // Notify webview so it can refresh knowledge state
          void webview.postMessage({ type: 'tell-all-result', success: true });
        }
      });
    } else if (msg?.type === 'knowledge-add') {
      const validUntil = typeof msg.validUntil === 'number' ? msg.validUntil : undefined;
      const tier = (msg.tier === 'L0' || msg.tier === 'L1' || msg.tier === 'L2') ? msg.tier : undefined;
      sharedKnowledge.write(msg.key as string, msg.value as string, msg.scope as 'workspace' | 'plan', 'user', 'user', undefined, validUntil, tier);
    } else if (msg?.type === 'knowledge-edit') {
      const validUntil = typeof msg.validUntil === 'number' ? msg.validUntil : undefined;
      const tier = (msg.tier === 'L0' || msg.tier === 'L1' || msg.tier === 'L2') ? msg.tier : undefined;
      sharedKnowledge.write(msg.key as string, msg.value as string, msg.scope as 'workspace' | 'plan', 'user', 'user', undefined, validUntil, tier);
    } else if (msg?.type === 'knowledge-delete') {
      sharedKnowledge.delete(msg.key as string, msg.scope as 'workspace' | 'plan', 'user');
    } else if (msg?.type === 'search-events') {
      // Persistence-backed event search with MemPalace-style sanitization
      void (async () => {
        try {
          const ext = await import('./extension.js');
          const db = ext.getDatabase();
          if (!db) {
            void webview.postMessage({ type: 'search-results', query: msg.query as string, events: [], error: 'Persistence disabled' });
            return;
          }
          const { EventSearchEngine } = await import('./eventSearch.js');
          const engine = new EventSearchEngine(db);
          const opts: { agentId?: string; type?: string; since?: number; limit?: number } = {
            limit: typeof msg.limit === 'number' ? msg.limit : 100,
          };
          if (msg.agentId) opts.agentId = msg.agentId as string;
          if (msg.type_filter) opts.type = msg.type_filter as string;
          if (typeof msg.since === 'number') opts.since = msg.since;
          const events = engine.search(msg.query as string, opts);
          void webview.postMessage({ type: 'search-results', query: msg.query as string, events });
        } catch (err) {
          void webview.postMessage({ type: 'search-results', query: msg.query as string, events: [], error: String(err) });
        }
      })();
    } else if (msg?.type === 'request-task-execution') {
      // Drill-down: get all events during the task's execution window.
      // NOTE: we intentionally do NOT filter by agentId. The plan's assigneeId is the EH-assigned
      // agent identifier (e.g. "claude-code-main") while persisted events carry the Claude Code
      // session UUID — those IDs don't match. Filtering by time window + searching the task ID in
      // payloads is the reliable approach.
      void (async () => {
        try {
          const ext = await import('./extension.js');
          const db = ext.getDatabase();
          if (!db) {
            void webview.postMessage({ type: 'task-execution-events', taskId: msg.taskId as string, events: [], error: 'Persistence disabled — enable eventHorizon.persistence.enabled to see execution replay.' });
            return;
          }
          // Widen the time window a bit — notes may have been added well after the actual work
          const padMs = 5 * 60 * 1000; // 5 minute pad on each side
          const since = typeof msg.claimTime === 'number' ? msg.claimTime - padMs : Date.now() - 24 * 60 * 60 * 1000;
          const until = typeof msg.completeTime === 'number' ? msg.completeTime + padMs : Date.now();
          const events = db.queryEvents({
            since,
            until,
            limit: 500,
          });
          void webview.postMessage({ type: 'task-execution-events', taskId: msg.taskId as string, events });
        } catch (err) {
          void webview.postMessage({ type: 'task-execution-events', taskId: msg.taskId as string, events: [], error: String(err) });
        }
      })();
    }
  });
}

// ── Full universe panel (editor area) ────────────────────────────────────────

let universePanel: vscode.WebviewPanel | null = null;

/**
 * Open or focus the full universe in the main editor area as a WebviewPanel.
 * Returns the webview reference so the extension can forward events to it.
 */
export async function openUniversePanel(
  context: vscode.ExtensionContext,
  webviewRef: { current: vscode.Webview | null },
  agentStateManager: AgentStateManager,
  metricsEngine: MetricsEngine,
  getSkills?: () => SkillInfo[],
  rescanSkills?: () => Promise<SkillInfo[]>,
): Promise<void> {
  // If already open, just reveal it
  if (universePanel) {
    universePanel.reveal(vscode.ViewColumn.One);
    return;
  }

  const version = (context.extension.packageJSON as { version: string }).version;

  const panel = vscode.window.createWebviewPanel(
    'eventHorizon.universe',
    'Event Horizon',
    { viewColumn: vscode.ViewColumn.One, preserveFocus: false },
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'webview-dist')],
    },
  );

  universePanel = panel;
  webviewRef.current = panel.webview;

  const scriptUri = panel.webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, 'webview-dist', 'main.js'),
  );

  const connectedAgents = await getConnectedAgentTypes();
  panel.webview.html = getUniverseHtml(panel.webview, scriptUri, version, connectedAgents);

  wireUniverseWebview(panel.webview, context, agentStateManager, metricsEngine, getSkills, rescanSkills);

  panel.onDidDispose(() => {
    universePanel = null;
    webviewRef.current = null;
  });
}

// ── Sidebar launcher (activity bar) ─────────────────────────────────────────

/**
 * Minimal sidebar view that shows an "Open Universe" button and carries the
 * agent count badge on the activity bar icon.
 */
export function createSidebarProvider(
  _context: vscode.ExtensionContext,
  webviewViewRef: { current: vscode.WebviewView | null },
): vscode.WebviewViewProvider {
  return {
    resolveWebviewView(
      webviewView: vscode.WebviewView,
      _resolveContext: vscode.WebviewViewResolveContext,
      _token: vscode.CancellationToken,
    ): void {
      if (webviewViewRef) webviewViewRef.current = webviewView;

      webviewView.onDidDispose(() => {
        if (webviewViewRef) webviewViewRef.current = null;
      });

      webviewView.webview.options = { enableScripts: true };

      webviewView.webview.html = getSidebarHtml();

      webviewView.webview.onDidReceiveMessage((msg: { type?: string }) => {
        if (msg?.type === 'open-universe') {
          void vscode.commands.executeCommand('eventHorizon.open');
        }
      });
    },
  };
}

// ── HTML ──────────────────────────────────────────────────────────────────────

function getUniverseHtml(
  webview: vscode.Webview,
  scriptUri: vscode.Uri,
  version: string,
  connectedAgents: string[] = [],
): string {
  const csp = [
    "default-src 'none'",
    "script-src 'unsafe-eval' " + webview.cspSource,
    "style-src 'unsafe-inline'",
    "img-src " + webview.cspSource + " data:",
  ].join('; ');

  const scriptSrc = scriptUri.toString() + '?v=' + version;
  const initData = JSON.stringify({ connectedAgents, version });

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>Event Horizon</title>
  <style>
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; min-height: 420px; font-family: system-ui; overflow: auto; display: flex; flex-direction: column; }
    body { background: #050510 linear-gradient(180deg, #0a0a18 0%, #050508 50%, #030306 100%); }
    #root { position: relative; z-index: 1; flex: 1; min-height: 380px; min-width: 0; box-sizing: border-box; display: flex; flex-direction: column; }
    .loading { flex: 1; min-height: 320px; display: flex; align-items: center; justify-content: center; color: #8899aa; font-size: 14px; }
    .err { text-align: center; padding: 1em; color: #e88; }
  </style>
</head>
<body>
  <div id="root" data-eh-init="${initData.replace(/"/g, '&quot;')}"><div class="loading">Loading app\u2026</div></div>
  <script src="${scriptSrc}"></script>
</body>
</html>`;
}

function getSidebarHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    html, body {
      margin: 0; padding: 0; width: 100%; height: 100%;
      font-family: system-ui;
      background: #050510 linear-gradient(180deg, #0a0a18 0%, #050508 50%, #030306 100%);
      color: #8899aa;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .launcher {
      text-align: center;
      padding: 24px 16px;
    }
    .title {
      font-size: 13px;
      font-weight: 600;
      color: #90d0a0;
      margin-bottom: 8px;
      letter-spacing: 0.04em;
    }
    .subtitle {
      font-size: 10px;
      color: #4a6a5a;
      margin-bottom: 16px;
      line-height: 1.5;
    }
    .open-btn {
      display: inline-block;
      padding: 8px 20px;
      font-size: 11px;
      font-weight: 600;
      font-family: Consolas, monospace;
      color: #b0f0c0;
      background: linear-gradient(180deg, #1e3228 0%, #142820 100%);
      border: 1px solid #3a6a4a;
      border-radius: 3px;
      cursor: pointer;
      letter-spacing: 0.04em;
      transition: box-shadow 0.15s;
    }
    .open-btn:hover {
      box-shadow: 0 0 8px rgba(60,160,90,0.35);
      border-color: #50aa70;
    }
    .hint {
      font-size: 9px;
      color: #3a5a4a;
      margin-top: 12px;
    }
  </style>
</head>
<body>
  <div class="launcher">
    <div class="title">Event Horizon</div>
    <div class="subtitle">AI agent universe visualization</div>
    <button class="open-btn" id="openBtn">Open Universe</button>
    <div class="hint">Opens in the main editor area</div>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    document.getElementById('openBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'open-universe' });
    });
  </script>
</body>
</html>`;
}
