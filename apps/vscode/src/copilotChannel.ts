/**
 * GitHub Copilot output channel monitoring — STUB.
 *
 * VS Code's OutputChannel API does not expose content for reading, so there is
 * currently no way to tap into Copilot events. This stub is kept as a placeholder
 * for future integration if/when Copilot exposes an event API or extension-to-extension
 * messaging. The corresponding connector (`@event-horizon/connectors/copilot`) has
 * regex-based output parsing ready to go once we can read the output channel.
 */

import * as vscode from 'vscode';
import type { AgentEvent } from '@event-horizon/core';

export function setupCopilotOutputChannel(_onEvent: (event: AgentEvent) => void): vscode.Disposable {
  return {
    dispose: () => {},
  };
}
