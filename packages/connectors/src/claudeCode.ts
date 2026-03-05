/**
 * Claude Code hooks adapter — receives HTTP hook POSTs, emits AgentEvents.
 * @event-horizon/connectors
 */

import type { AgentEvent } from '@event-horizon/core';

export function createClaudeCodeAdapter(): (payload: unknown) => AgentEvent | null {
  return (_payload) => {
    // TODO: map Claude Code hook payloads to AgentEvent
    return null;
  };
}
