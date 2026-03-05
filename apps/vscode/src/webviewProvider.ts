/**
 * Webview provider for the universe panel.
 */

import * as vscode from 'vscode';

export function createWebviewProvider(_context: vscode.ExtensionContext): vscode.WebviewViewProvider {
  return {
    resolveWebviewView(
      webviewView: vscode.WebviewView,
      _resolveContext: vscode.WebviewViewResolveContext,
      _token: vscode.CancellationToken
    ): void {
      webviewView.webview.options = {
        enableScripts: true,
        localResourceRoots: [],
      };
      webviewView.webview.html = getWebviewHtml(webviewView.webview);
    },
  };
}

function getWebviewHtml(_webview: vscode.Webview): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Event Horizon</title></head>
<body><p>Event Horizon universe (webview placeholder)</p></body>
</html>`;
}
