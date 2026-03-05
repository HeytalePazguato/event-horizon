/**
 * Extension host <-> webview message bridge.
 */

import * as vscode from 'vscode';

export type BridgeMessage = { type: string; payload?: unknown };

export function createBridge(webview: vscode.Webview): {
  send: (msg: BridgeMessage) => void;
  onMessage: (handler: (msg: BridgeMessage) => void) => vscode.Disposable;
} {
  return {
    send: (msg) => {
      webview.postMessage(msg);
    },
    onMessage: (handler) => {
      return webview.onDidReceiveMessage(handler);
    },
  };
}
