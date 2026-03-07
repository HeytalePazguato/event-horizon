/**
 * Pub/sub event bus for agent events.
 * @event-horizon/core
 */

import type { AgentEvent } from './events.js';

export type EventBusListener = (event: AgentEvent) => void;

export class EventBus {
  private listeners = new Set<EventBusListener>();

  emit(event: AgentEvent): void {
    this.listeners.forEach((fn) => {
      try { fn(event); } catch { /* prevent one listener from breaking others */ }
    });
  }

  on(listener: EventBusListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
