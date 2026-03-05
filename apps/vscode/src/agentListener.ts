/**
 * Listens for agent events and forwards to event bus.
 */

import type { EventBus } from '@event-horizon/core';

export function createAgentListener(_eventBus: EventBus): void {
  // TODO: subscribe to OpenCode / Claude Code / Copilot adapters, call eventBus.emit
}
