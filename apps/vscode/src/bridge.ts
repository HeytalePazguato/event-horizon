/**
 * Extension host <-> webview message bridge.
 */

import * as vscode from 'vscode';

export type BridgeMessage = { type: string; payload?: unknown };

export function createBridge(webview: vscode.Webview): {
  send: (msg: BridgeMessage) => void;
  onMessage: (handler: (msg: BridgeMessage) => void) => void;
} {
  return {
    send: (msg) => webview.postMessage(msg),
    onMessage: (handler) => {
      // Handler is called from extension when webview sends message; wire in extension.ts
      void handler;
    },
  };
}
