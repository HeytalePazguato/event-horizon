/**
 * OpenCode plugin adapter — forwards plugin events to Event Horizon.
 * @event-horizon/connectors
 */

import type { AgentEvent } from '@event-horizon/core';

export function createOpenCodeAdapter(): (raw: unknown) => AgentEvent | null {
  return (_raw) => {
    // TODO: map OpenCode plugin events to AgentEvent
    return null;
  };
}
