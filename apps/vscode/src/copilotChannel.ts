/**
 * GitHub Copilot output channel monitoring.
 * VS Code OutputChannel API does not expose content for reading; this is a stub
 * that can be extended when Copilot exposes events or when using a different integration.
 */

import * as vscode from 'vscode';
import type { AgentEvent } from '@event-horizon/core';

export function setupCopilotOutputChannel(_onEvent: (event: AgentEvent) => void): vscode.Disposable {
  return {
    dispose: () => {},
  };
}
