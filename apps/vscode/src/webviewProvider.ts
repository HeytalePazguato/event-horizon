/**
 * Webview provider for the universe panel.
 */

import * as vscode from 'vscode';
import type { AgentStateManager, MetricsEngine } from '@event-horizon/core';
import { runSetupClaudeCodeHooks, isClaudeCodeHooksInstalled, removeClaudeCodeHooks } from './setupHooks.js';
import { runSetupOpenCodeHooks, isOpenCodeHooksInstalled, removeOpenCodeHooks } from './setupOpenCodeHooks.js';

export function createWebviewProvider(
  context: vscode.ExtensionContext,
  webviewRef: { current: vscode.Webview | null },
  agentStateManager: AgentStateManager,
  metricsEngine: MetricsEngine,
): vscode.WebviewViewProvider {
  const version = (context.extension.packageJSON as { version: string }).version;

  return {
    resolveWebviewView(
      webviewView: vscode.WebviewView,
      _resolveContext: vscode.WebviewViewResolveContext,
      _token: vscode.CancellationToken
    ): void {
      webviewRef.current = webviewView.webview;
      webviewView.onDidDispose(() => {
        webviewRef.current = null;
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
        return types;
      }

      // Kick off async detection; render HTML with empty list first, then update via message
      const connectedPromise = getConnectedAgentTypes();
      webviewView.webview.html = getWebviewHtml(webviewView.webview, scriptUri, version, []);
      void connectedPromise.then((agentTypes) => {
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

      webviewView.webview.onDidReceiveMessage((msg: { type?: string; agentType?: string; command?: string; label?: string; [key: string]: unknown }) => {
        // Persist medal state changes to globalState
        if (msg?.type === 'persist-medals') {
          void context.globalState.update('medals', {
            unlockedAchievements: msg.unlockedAchievements,
            achievementTiers: msg.achievementTiers,
            achievementCounts: msg.achievementCounts,
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
        } else if (msg?.type === 'remove-agent' && msg.agentType === 'opencode') {
          void removeOpenCodeHooks().then(async () => {
            void vscode.window.showInformationMessage('Event Horizon: OpenCode plugin removed.');
            void webviewView.webview.postMessage({ type: 'connected-agents', agentTypes: await getConnectedAgentTypes() });
          });
        } else if (msg?.type === 'spawn-agent' && msg.command) {
          // 1.1 — whitelist allowed commands to prevent arbitrary shell execution
          const ALLOWED_COMMANDS = ['claude', 'opencode', 'aider'];
          if (!ALLOWED_COMMANDS.includes(msg.command)) return;
          const terminal = vscode.window.createTerminal({ name: `Event Horizon: ${msg.label ?? msg.command}` });
          terminal.sendText(msg.command);
          terminal.show();
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
