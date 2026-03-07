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

const eventBus = new EventBus();
const metricsEngine = new MetricsEngine();
const agentStateManager = new AgentStateManager();

const webviewRef: { current: vscode.Webview | null } = { current: null };

function onAgentEvent(event: AgentEvent): void {
  metricsEngine.process(event);
  agentStateManager.apply(event);
  if (webviewRef.current) {
    webviewRef.current.postMessage({ type: 'event', payload: event });
  }
}

eventBus.on(onAgentEvent);

export function activate(context: vscode.ExtensionContext): void {
  startEventServer({
    onEvent: (event) => eventBus.emit(event),
  });

  setupCopilotOutputChannel((event) => eventBus.emit(event));

  const provider = createWebviewProvider(context, webviewRef);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('eventHorizon.universe', provider)
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
    context.globalState.update('welcomeShown', true);
    vscode.window
      .showInformationMessage(
        'Event Horizon installed! Connect your AI agents to see them appear as planets.',
        'Connect Claude Code',
        'Show Demo',
      )
      .then((choice) => {
        if (choice === 'Connect Claude Code') {
          vscode.commands.executeCommand('eventHorizon.setupClaudeCode');
        } else if (choice === 'Show Demo') {
          vscode.commands.executeCommand('eventHorizon.universe.focus');
        }
      });
  }

  context.subscriptions.push({
    dispose: () => {
      stopEventServer();
      webviewRef.current = null;
    },
  });
}

export function deactivate(): void {
  stopEventServer();
  webviewRef.current = null;
}
