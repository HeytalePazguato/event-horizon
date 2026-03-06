/**
 * Webview provider for the universe panel.
 */

import * as vscode from 'vscode';

export function createWebviewProvider(
  context: vscode.ExtensionContext,
  webviewRef: { current: vscode.Webview | null }
): vscode.WebviewViewProvider {
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

      webviewView.webview.html = getWebviewHtml(webviewView.webview, scriptUri);
    },
  };
}

function getWebviewHtml(webview: vscode.Webview, scriptUri: vscode.Uri): string {
  const csp = [
    "default-src 'none'",
    "script-src 'unsafe-inline' 'unsafe-eval' " + webview.cspSource,
    "style-src 'unsafe-inline'",
    "img-src " + webview.cspSource + " data:",
  ].join('; ');

  const scriptSrc = scriptUri.toString() + '?v=2';
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>Event Horizon</title>
  <style>
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; min-height: 420px; font-family: system-ui; overflow: auto; display: flex; flex-direction: column; }
    body { background: #050510 linear-gradient(180deg, #0a0a18 0%, #050508 50%, #030306 100%); }
    #eh-static { position: relative; z-index: 1; flex-shrink: 0; box-sizing: border-box; padding: 10px 12px; background: linear-gradient(180deg, #1a2535 0%, #0f1620 100%); color: #b8d4a0; font-size: 12px; border-bottom: 2px solid #2a4a3a; border-top: 1px solid #3a5a4a; box-shadow: inset 0 1px 0 rgba(100,180,120,0.15); }
    #eh-static strong { color: #c8e4b0; text-shadow: 0 0 8px rgba(150,220,120,0.3); }
    #root { position: relative; z-index: 1; flex: 1; min-height: 380px; min-width: 0; box-sizing: border-box; display: flex; flex-direction: column; }
    .loading { flex: 1; min-height: 320px; display: flex; align-items: center; justify-content: center; color: #8899aa; font-size: 14px; }
    .err { text-align: center; padding: 1em; color: #e88; }
  </style>
</head>
<body>
  <div id="eh-static"><strong>EVENT HORIZON</strong> — Control panel. Agents = planets. Center = black hole (completed tasks disappear there).</div>
  <div id="root"><div class="loading">Loading app…</div></div>
  <script>
    window.__ehScriptLoadError = function(msg) {
      var r = document.getElementById('root');
      if (r) r.innerHTML = '<div class="err">' + msg + '</div>';
    };
    setTimeout(function() {
      var r = document.getElementById('root');
      if (r && r.innerHTML.indexOf('Loading app') !== -1) {
        r.innerHTML = '<div class="err">Still loading? Open Help → Toggle Developer Tools and check the Console for errors.</div>';
      }
    }, 8000);
  </script>
  <script src="${scriptSrc}" onerror="__ehScriptLoadError('Script failed to load. Rebuild: pnpm run build --filter=event-horizon-vscode')"></script>
</body>
</html>`;
}
