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

      function getConnectedAgentTypes(): string[] {
        const types: string[] = [];
        if (isClaudeCodeHooksInstalled()) types.push('claude-code');
        if (isOpenCodeHooksInstalled()) types.push('opencode');
        return types;
      }

      webviewView.webview.html = getWebviewHtml(webviewView.webview, scriptUri, version, getConnectedAgentTypes());

      // 2.2 — hydrate webview with accumulated state on (re)open
      const agents = agentStateManager.getAllAgents();
      const metrics = metricsEngine.getAllMetrics();
      if (agents.length > 0) {
        void webviewView.webview.postMessage({ type: 'init-state', agents, metrics });
      }

      webviewView.webview.onDidReceiveMessage((msg: { type?: string; agentType?: string; command?: string; label?: string }) => {
        if (msg?.type === 'setup-agent' && msg.agentType === 'claude-code') {
          void runSetupClaudeCodeHooks().then(() => {
            void webviewView.webview.postMessage({ type: 'connected-agents', agentTypes: getConnectedAgentTypes() });
          });
        } else if (msg?.type === 'setup-agent' && msg.agentType === 'opencode') {
          void runSetupOpenCodeHooks().then(() => {
            void webviewView.webview.postMessage({ type: 'connected-agents', agentTypes: getConnectedAgentTypes() });
          });
        } else if (msg?.type === 'remove-agent' && msg.agentType === 'claude-code') {
          removeClaudeCodeHooks();
          void vscode.window.showInformationMessage('Event Horizon: Claude Code hooks removed.');
          void webviewView.webview.postMessage({ type: 'connected-agents', agentTypes: getConnectedAgentTypes() });
        } else if (msg?.type === 'remove-agent' && msg.agentType === 'opencode') {
          removeOpenCodeHooks();
          void vscode.window.showInformationMessage('Event Horizon: OpenCode hooks removed.');
          void webviewView.webview.postMessage({ type: 'connected-agents', agentTypes: getConnectedAgentTypes() });
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
  const initData = JSON.stringify({ connectedAgents: connectedAgentTypes });

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
