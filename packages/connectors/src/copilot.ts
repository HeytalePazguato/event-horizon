/**
 * GitHub Copilot adapter — monitors output channel, infers events.
 * @event-horizon/connectors
 */

import type { AgentEvent } from '@event-horizon/core';

export function createCopilotAdapter(): (output: string) => AgentEvent | null {
  return (_output) => {
    // TODO: parse Copilot output channel, emit AgentEvent
    return null;
  };
}
