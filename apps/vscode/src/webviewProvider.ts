/**
 * Webview provider for the universe panel.
 */

import * as vscode from 'vscode';

export function createWebviewProvider(context: vscode.ExtensionContext): vscode.WebviewViewProvider {
  return {
    resolveWebviewView(
      webviewView: vscode.WebviewView,
      _resolveContext: vscode.WebviewViewResolveContext,
      _token: vscode.CancellationToken
    ): void {
      webviewView.webview.options = {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'webview-dist')],
      };

      const scriptUri = webviewView.webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, 'webview-dist', 'main.js')
      );

      webviewView.webview.html = getWebviewHtml(webviewView.webview, scriptUri);
    },
  };
}

function getWebviewHtml(webview: vscode.Webview, scriptUri: vscode.Uri): string {
  const csp = [
    "default-src 'none'",
    "script-src 'unsafe-inline' " + webview.cspSource,
    "style-src 'unsafe-inline'",
    "img-src " + webview.cspSource + " data:",
  ].join('; ');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>Event Horizon</title>
</head>
<body>
  <div id="root"></div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
}
