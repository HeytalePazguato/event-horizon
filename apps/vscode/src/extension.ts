/**
 * VS Code extension entry point — activation and commands.
 */

import * as vscode from 'vscode';

import { createWebviewProvider } from './webviewProvider';

export function activate(context: vscode.ExtensionContext): void {
  const provider = createWebviewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('eventHorizon.universe', provider)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('eventHorizon.open', () => {
      vscode.commands.executeCommand('eventHorizon.universe.focus');
    })
  );
}

export function deactivate(): void {}
