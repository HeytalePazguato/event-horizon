/**
 * VS Code extension entry point — activation and commands.
 */

import * as vscode from 'vscode';
import { EventBus, MetricsEngine, AgentStateManager } from '@event-horizon/core';
import { createWebviewProvider } from './webviewProvider';
import { startEventServer, stopEventServer } from './eventServer';
import { setupCopilotOutputChannel } from './copilotChannel';
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
