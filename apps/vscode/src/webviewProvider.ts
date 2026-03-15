/**
 * Webview provider for the universe panel.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fsp from 'fs/promises';
import type { AgentStateManager, MetricsEngine } from '@event-horizon/core';
import { runSetupClaudeCodeHooks, isClaudeCodeHooksInstalled, removeClaudeCodeHooks } from './setupHooks.js';
import { runSetupOpenCodeHooks, isOpenCodeHooksInstalled, removeOpenCodeHooks } from './setupOpenCodeHooks.js';
import { runSetupCopilotHooks, isCopilotHooksInstalled, removeCopilotHooks } from './setupCopilotHooks.js';
import type { SkillInfo } from './skillScanner.js';

async function handleMarketplaceSearch(
  webview: vscode.Webview,
  marketplaceUrl: string,
  query: string,
): Promise<void> {
  const SEARCH_TIMEOUT_MS = 8000;
  try {
    // SkillHub API — the only marketplace with a known API
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
      // Unknown API marketplace — try a generic JSON endpoint
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

  // Build frontmatter — only spec-supported fields
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

  // Determine target directory — includes category subfolder if provided
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

/**
 * Move a skill to the root of its skills directory (removing any category subfolder).
 * Category subfolders break agent discovery (Claude Code, OpenCode, Copilot only scan
 * one level deep: skills/<name>/SKILL.md). Use metadata.category in SKILL.md frontmatter
 * for categorization instead.
 */
async function handleMoveSkill(filePath: string, _newCategory: string): Promise<void> {
  const skillDir = path.dirname(filePath);
  const skillName = path.basename(skillDir);

  // Find the "skills" directory in the path to determine the root
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  const skillsIdx = parts.lastIndexOf('skills');
  if (skillsIdx < 0) {
    void vscode.window.showErrorMessage('Cannot determine skills root directory.');
    return;
  }
  const skillsRoot = parts.slice(0, skillsIdx + 1).join(path.sep);
  const parentDir = path.dirname(skillDir);

  // Only allow moving to the root — never into subfolders
  const newDir = path.join(skillsRoot, skillName);

  if (path.resolve(newDir) === path.resolve(skillDir)) {
    void vscode.window.showInformationMessage(`Skill "${skillName}" is already at the root.`);
    return;
  }

  try {
    await fsp.rename(skillDir, newDir);

    // Clean up empty old category folder
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

/**
 * Duplicate a skill: copy its SKILL.md to a new folder with an updated name.
 * The new skill is placed in the same scope/category as the original.
 */
async function handleDuplicateSkill(filePath: string, newName: string): Promise<void> {
  if (!newName || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(newName)) {
    void vscode.window.showErrorMessage('Invalid skill name — use kebab-case (e.g. my-skill-copy).');
    return;
  }

  const skillDir = path.dirname(filePath);
  const parentDir = path.dirname(skillDir);

  // Read source SKILL.md
  let content: string;
  try {
    content = await fsp.readFile(filePath, 'utf8');
  } catch (err) {
    void vscode.window.showErrorMessage(`Failed to read source skill: ${err}`);
    return;
  }

  // Update the name field in frontmatter
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

export function createWebviewProvider(
  context: vscode.ExtensionContext,
  webviewRef: { current: vscode.Webview | null },
  agentStateManager: AgentStateManager,
  metricsEngine: MetricsEngine,
  getSkills?: () => SkillInfo[],
  rescanSkills?: () => Promise<SkillInfo[]>,
  webviewViewRef?: { current: vscode.WebviewView | null },
): vscode.WebviewViewProvider {
  const version = (context.extension.packageJSON as { version: string }).version;

  return {
    resolveWebviewView(
      webviewView: vscode.WebviewView,
      _resolveContext: vscode.WebviewViewResolveContext,
      _token: vscode.CancellationToken
    ): void {
      webviewRef.current = webviewView.webview;
      if (webviewViewRef) webviewViewRef.current = webviewView;
      webviewView.onDidDispose(() => {
        webviewRef.current = null;
        if (webviewViewRef) webviewViewRef.current = null;
      });

      webviewView.webview.options = {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'webview-dist')],
      };

      const scriptUri = webviewView.webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, 'webview-dist', 'main.js')
      );

      async function getConnectedAgentTypes(): Promise<string[]> {
        const types: string[] = [];
        if (await isClaudeCodeHooksInstalled()) types.push('claude-code');
        if (await isOpenCodeHooksInstalled()) types.push('opencode');
        if (await isCopilotHooksInstalled()) types.push('copilot');
        return types;
      }

      // Render HTML first; hydration happens when webview sends 'ready'
      webviewView.webview.html = getWebviewHtml(webviewView.webview, scriptUri, version, []);

      function hydrateWebview() {
        // Connected agent types
        void getConnectedAgentTypes().then((agentTypes) => {
          void webviewView.webview.postMessage({ type: 'connected-agents', agentTypes });
        });

        // 2.2 — hydrate webview with accumulated state on (re)open
        const agents = agentStateManager.getAllAgents();
        const metrics = metricsEngine.getAllMetrics();
        if (agents.length > 0) {
          void webviewView.webview.postMessage({ type: 'init-state', agents, metrics });
        }

        // Hydrate persisted medals from globalState
        const savedMedals = context.globalState.get<{
          unlockedAchievements: string[];
          achievementTiers: Record<string, number>;
          achievementCounts: Record<string, number>;
        }>('medals');
        if (savedMedals?.unlockedAchievements?.length) {
          void webviewView.webview.postMessage({ type: 'init-medals', ...savedMedals });
        }

        // Hydrate persisted settings (visual + general)
        const savedSettings = context.globalState.get<Record<string, unknown>>('visualSettings');
        const savedGeneral = context.globalState.get<Record<string, unknown>>('generalSettings');
        if (savedSettings || savedGeneral) {
          void webviewView.webview.postMessage({
            type: 'init-settings',
            settings: savedSettings ?? undefined,
            ...(savedGeneral ?? {}),
          });
        }

        // Hydrate persisted singularity stats from globalState
        const savedSingularity = context.globalState.get<Record<string, unknown>>('singularityStats');
        if (savedSingularity) {
          void webviewView.webview.postMessage({ type: 'init-singularity', stats: savedSingularity });
        }

        // Hydrate installed skills — if initial scan isn't done yet, re-scan now
        const cachedSkills = getSkills?.() ?? [];
        if (cachedSkills.length > 0) {
          void webviewView.webview.postMessage({ type: 'skills-update', skills: cachedSkills });
        } else {
          // Initial scan may not have finished — re-scan and send
          const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
          void import('./skillScanner.js').then(({ getInstalledSkills }) =>
            getInstalledSkills(folders).then((skills) => {
              void webviewView.webview.postMessage({ type: 'skills-update', skills });
            })
          );
        }
      }

      webviewView.webview.onDidReceiveMessage((msg: { type?: string; agentType?: string; command?: string; label?: string; [key: string]: unknown }) => {
        // Webview JS has loaded and is ready to receive messages
        if (msg?.type === 'ready') {
          hydrateWebview();
          return;
        }
        // Persist medal state changes to globalState
        if (msg?.type === 'persist-medals') {
          void context.globalState.update('medals', {
            unlockedAchievements: msg.unlockedAchievements,
            achievementTiers: msg.achievementTiers,
            achievementCounts: msg.achievementCounts,
          });
          return;
        }
        // Persist singularity stats to globalState
        if (msg?.type === 'persist-singularity') {
          void context.globalState.update('singularityStats', msg.stats);
          return;
        }
        // Persist visual + general settings to globalState
        if (msg?.type === 'persist-settings') {
          void context.globalState.update('visualSettings', msg.settings);
          void context.globalState.update('generalSettings', {
            achievementsEnabled: msg.achievementsEnabled,
            animationSpeed: msg.animationSpeed,
            eventServerPort: msg.eventServerPort,
          });
          return;
        }
        if (msg?.type === 'setup-agent' && msg.agentType === 'claude-code') {
          void runSetupClaudeCodeHooks().then(async () => {
            void webviewView.webview.postMessage({ type: 'connected-agents', agentTypes: await getConnectedAgentTypes() });
          });
        } else if (msg?.type === 'setup-agent' && msg.agentType === 'opencode') {
          void runSetupOpenCodeHooks().then(async () => {
            void webviewView.webview.postMessage({ type: 'connected-agents', agentTypes: await getConnectedAgentTypes() });
          });
        } else if (msg?.type === 'remove-agent' && msg.agentType === 'claude-code') {
          void removeClaudeCodeHooks().then(async () => {
            void vscode.window.showInformationMessage('Event Horizon: Claude Code hooks removed.');
            void webviewView.webview.postMessage({ type: 'connected-agents', agentTypes: await getConnectedAgentTypes() });
          });
        } else if (msg?.type === 'setup-agent' && msg.agentType === 'copilot') {
          void runSetupCopilotHooks().then(async () => {
            void webviewView.webview.postMessage({ type: 'connected-agents', agentTypes: await getConnectedAgentTypes() });
          });
        } else if (msg?.type === 'remove-agent' && msg.agentType === 'opencode') {
          void removeOpenCodeHooks().then(async () => {
            void vscode.window.showInformationMessage('Event Horizon: OpenCode plugin removed.');
            void webviewView.webview.postMessage({ type: 'connected-agents', agentTypes: await getConnectedAgentTypes() });
          });
        } else if (msg?.type === 'remove-agent' && msg.agentType === 'copilot') {
          void removeCopilotHooks().then(async () => {
            void vscode.window.showInformationMessage('Event Horizon: Copilot hooks removed.');
            void webviewView.webview.postMessage({ type: 'connected-agents', agentTypes: await getConnectedAgentTypes() });
          });
        } else if (msg?.type === 'spawn-agent' && msg.command) {
          // 1.1 — whitelist allowed commands to prevent arbitrary shell execution
          const ALLOWED_COMMANDS = ['claude', 'opencode', 'aider'];
          if (!ALLOWED_COMMANDS.includes(msg.command)) return;
          const terminal = vscode.window.createTerminal({ name: `Event Horizon: ${msg.label ?? msg.command}` });
          terminal.sendText(msg.command);
          terminal.show();
        } else if (msg?.type === 'open-skill-file' && typeof msg.filePath === 'string') {
          const uri = vscode.Uri.file(msg.filePath);
          void vscode.workspace.openTextDocument(uri).then((doc) => {
            void vscode.window.showTextDocument(doc);
          });
        } else if (msg?.type === 'create-skill') {
          void handleCreateSkill(msg).then(async () => {
            if (rescanSkills) {
              const skills = await rescanSkills();
              void webviewView.webview.postMessage({ type: 'skills-update', skills });
            }
          });
        } else if (msg?.type === 'open-marketplace-url' && typeof msg.url === 'string') {
          void vscode.env.openExternal(vscode.Uri.parse(msg.url));
        } else if (msg?.type === 'marketplace-search' && typeof msg.marketplaceUrl === 'string' && typeof msg.query === 'string') {
          void handleMarketplaceSearch(webviewView.webview, msg.marketplaceUrl, msg.query);
        } else if (msg?.type === 'install-skill-from-url' && typeof msg.url === 'string') {
          // Open the skill URL in the browser — users install manually or via CLI
          void vscode.env.openExternal(vscode.Uri.parse(msg.url));
          void vscode.window.showInformationMessage(`Opening skill page. Use "skillhub install" or download manually to install.`);
        } else if (msg?.type === 'move-skill' && typeof msg.filePath === 'string' && typeof msg.newCategory === 'string') {
          void handleMoveSkill(msg.filePath, msg.newCategory).then(async () => {
            if (rescanSkills) {
              const skills = await rescanSkills();
              void webviewView.webview.postMessage({ type: 'skills-update', skills });
            }
          });
        } else if (msg?.type === 'duplicate-skill' && typeof msg.filePath === 'string' && typeof msg.newName === 'string') {
          void handleDuplicateSkill(msg.filePath, msg.newName).then(async () => {
            if (rescanSkills) {
              const skills = await rescanSkills();
              void webviewView.webview.postMessage({ type: 'skills-update', skills });
            }
          });
        }
      });
    },
  };
}

function getWebviewHtml(
  webview: vscode.Webview,
  scriptUri: vscode.Uri,
  version: string,
  connectedAgentTypes: string[],
): string {
  // unsafe-eval is required by PixiJS for WebGL shader compilation — cannot be removed.
  // unsafe-inline is limited to styles only; scripts are loaded via src= with nonce-less cspSource.
  const csp = [
    "default-src 'none'",
    "script-src 'unsafe-eval' " + webview.cspSource, // 1.6 — removed unsafe-inline for scripts
    "style-src 'unsafe-inline'",
    "img-src " + webview.cspSource + " data:",
  ].join('; ');

  // 3.5 — use extension version as cache-bust suffix so updates are picked up immediately
  const scriptSrc = scriptUri.toString() + '?v=' + version;

  // 1.6 — initial state injected via data attribute to avoid inline script (CSP compliance)
  const initData = JSON.stringify({ connectedAgents: connectedAgentTypes, version });

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
