/**
 * Pub/sub event bus for agent events.
 * @event-horizon/core
 */

import type { AgentEvent } from './events.js';

export type EventBusListener = (event: AgentEvent) => void;
export type BatchListener = (events: AgentEvent[]) => void;

interface BatchBuffer {
  events: AgentEvent[];
  timer: unknown;
  handler: BatchListener;
  windowMs: number;
}

/* Declare timer functions — available in both Node and browser runtimes */
declare function setTimeout(fn: () => void, ms: number): unknown;
declare function clearTimeout(id: unknown): void;

export class EventBus {
  private listeners = new Set<EventBusListener>();
  private batchBuffers = new Map<string, BatchBuffer>();

  emit(event: AgentEvent): void {
    // Synchronous listeners — always fire immediately
    this.listeners.forEach((fn) => {
      try { fn(event); } catch { /* prevent one listener from breaking others */ }
    });

    // Batch listeners — buffer events and flush after windowMs
    if (this.batchBuffers.size > 0) {
      const eventPrefix = event.type.split('.')[0];
      for (const [prefix, buffer] of this.batchBuffers) {
        if (eventPrefix === prefix || prefix === '') {
          buffer.events.push(event);
          if (buffer.timer === null) {
            buffer.timer = setTimeout(() => this.flushBatch(prefix), buffer.windowMs);
          }
        }
      }
    }
  }

  on(listener: EventBusListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Subscribe to batched events by type prefix.
   * Events are accumulated for `windowMs` (default 100ms) and then delivered
   * as a single array. Use prefix '' to match all events.
   *
   * Inspired by Multica's 100ms debounce-per-prefix pattern.
   */
  onBatch(prefix: string, handler: BatchListener, windowMs = 100): () => void {
    this.batchBuffers.set(prefix, {
      events: [],
      timer: null,
      handler,
      windowMs,
    });
    return () => {
      const buffer = this.batchBuffers.get(prefix);
      if (buffer?.timer !== null) clearTimeout(buffer!.timer);
      this.batchBuffers.delete(prefix);
    };
  }

  private flushBatch(prefix: string): void {
    const buffer = this.batchBuffers.get(prefix);
    if (!buffer || buffer.events.length === 0) return;

    const batch = buffer.events.splice(0);
    buffer.timer = null;

    try { buffer.handler(batch); } catch { /* isolate errors */ }
  }
}
