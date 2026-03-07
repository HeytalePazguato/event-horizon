/**
 * VS Code extension entry point — activation and commands.
 */

import * as vscode from 'vscode';
import { EventBus, MetricsEngine, AgentStateManager } from '@event-horizon/core';
import { createWebviewProvider } from './webviewProvider';
import { startEventServer, stopEventServer } from './eventServer';
import { setupCopilotOutputChannel } from './copilotChannel';
import { runSetupClaudeCodeHooks } from './setupHooks';
import type { AgentEvent } from '@event-horizon/core';

const webviewRef: { current: vscode.Webview | null } = { current: null };

export function activate(context: vscode.ExtensionContext): void {
  // Instantiate core services inside activate — not at module level — to avoid
  // side effects before VS Code has activated the extension.
  const eventBus = new EventBus();
  const metricsEngine = new MetricsEngine();
  const agentStateManager = new AgentStateManager();

  function onAgentEvent(event: AgentEvent): void {
    metricsEngine.process(event);
    agentStateManager.apply(event);
    if (webviewRef.current) {
      webviewRef.current.postMessage({ type: 'event', payload: event });
    }
  }

  const unsubscribeEventBus = eventBus.on(onAgentEvent);

  startEventServer({ onEvent: (event) => eventBus.emit(event) });
  setupCopilotOutputChannel((event) => eventBus.emit(event));

  const provider = createWebviewProvider(context, webviewRef, agentStateManager, metricsEngine);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('eventHorizon.universe', provider, {
      webviewOptions: { retainContextWhenHidden: true }, // 2.2 — keep WebGL context alive when panel is hidden
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('eventHorizon.open', () => {
      vscode.commands.executeCommand('eventHorizon.universe.focus');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('eventHorizon.setupClaudeCode', runSetupClaudeCodeHooks)
  );

  // Show one-time welcome notification on first install
  const hasShownWelcome = context.globalState.get<boolean>('welcomeShown');
  if (!hasShownWelcome) {
    void context.globalState.update('welcomeShown', true);
    void vscode.window
      .showInformationMessage(
        'Event Horizon installed! Connect your AI agents to see them appear as planets.',
        'Connect Claude Code',
        'Show Demo',
      )
      .then((choice) => {
        if (choice === 'Connect Claude Code') {
          void vscode.commands.executeCommand('eventHorizon.setupClaudeCode');
        } else if (choice === 'Show Demo') {
          void vscode.commands.executeCommand('eventHorizon.universe.focus');
        }
      });
  }

  context.subscriptions.push({
    dispose: () => {
      unsubscribeEventBus();
      stopEventServer();
      webviewRef.current = null;
    },
  });
}

export function deactivate(): void {
  // stopEventServer is called by the subscription dispose registered in activate()
  webviewRef.current = null;
}
