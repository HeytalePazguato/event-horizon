import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventBus } from '../eventBus.js';
import type { AgentEvent } from '../events.js';

function makeEvent(overrides?: Partial<AgentEvent>): AgentEvent {
  return {
    id: 'ev-1',
    agentId: 'a1',
    agentName: 'Test',
    agentType: 'claude-code',
    type: 'agent.spawn',
    timestamp: Date.now(),
    payload: {},
    ...overrides,
  };
}

describe('EventBus', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('on() subscribes and receives events', () => {
    const bus = new EventBus();
    const received: AgentEvent[] = [];
    bus.on((e) => received.push(e));

    const event = makeEvent();
    bus.emit(event);

    expect(received).toHaveLength(1);
    expect(received[0]).toBe(event);
  });

  it('emit() calls all subscribers', () => {
    const bus = new EventBus();
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    bus.on(fn1);
    bus.on(fn2);

    const event = makeEvent();
    bus.emit(event);

    expect(fn1).toHaveBeenCalledWith(event);
    expect(fn2).toHaveBeenCalledWith(event);
  });

  it('unsubscribe function works', () => {
    const bus = new EventBus();
    const fn = vi.fn();
    const unsub = bus.on(fn);

    bus.emit(makeEvent());
    expect(fn).toHaveBeenCalledTimes(1);

    unsub();
    bus.emit(makeEvent());
    expect(fn).toHaveBeenCalledTimes(1); // not called again
  });

  it('one listener throwing does not break others', () => {
    const bus = new EventBus();
    const fn1 = vi.fn(() => { throw new Error('boom'); });
    const fn2 = vi.fn();
    bus.on(fn1);
    bus.on(fn2);

    bus.emit(makeEvent());
    expect(fn2).toHaveBeenCalledTimes(1);
  });

  describe('onBatch', () => {
    it('accumulates events and fires after windowMs', () => {
      const bus = new EventBus();
      const batchFn = vi.fn();
      bus.onBatch('tool', batchFn, 100);

      // Emit 5 rapid tool.call events
      for (let i = 0; i < 5; i++) {
        bus.emit(makeEvent({ id: `ev-${i}`, type: 'tool.call' }));
      }

      // Batch handler should NOT have fired yet
      expect(batchFn).not.toHaveBeenCalled();

      // Advance time past the window
      vi.advanceTimersByTime(100);

      // Now it should fire once with all 5 events
      expect(batchFn).toHaveBeenCalledTimes(1);
      expect(batchFn.mock.calls[0][0]).toHaveLength(5);
    });

    it('regular on() still fires synchronously alongside batch', () => {
      const bus = new EventBus();
      const syncFn = vi.fn();
      const batchFn = vi.fn();

      bus.on(syncFn);
      bus.onBatch('tool', batchFn, 100);

      for (let i = 0; i < 3; i++) {
        bus.emit(makeEvent({ id: `ev-${i}`, type: 'tool.call' }));
      }

      // Sync handler fires immediately for each event
      expect(syncFn).toHaveBeenCalledTimes(3);
      // Batch handler hasn't fired yet
      expect(batchFn).not.toHaveBeenCalled();

      vi.advanceTimersByTime(100);
      expect(batchFn).toHaveBeenCalledTimes(1);
      expect(batchFn.mock.calls[0][0]).toHaveLength(3);
    });

    it('prefix matches both tool.call and tool.result', () => {
      const bus = new EventBus();
      const batchFn = vi.fn();
      bus.onBatch('tool', batchFn, 100);

      bus.emit(makeEvent({ type: 'tool.call' }));
      bus.emit(makeEvent({ type: 'tool.result' }));

      vi.advanceTimersByTime(100);

      expect(batchFn).toHaveBeenCalledTimes(1);
      expect(batchFn.mock.calls[0][0]).toHaveLength(2);
      expect(batchFn.mock.calls[0][0][0].type).toBe('tool.call');
      expect(batchFn.mock.calls[0][0][1].type).toBe('tool.result');
    });

    it('does not fire for non-matching prefixes', () => {
      const bus = new EventBus();
      const batchFn = vi.fn();
      bus.onBatch('tool', batchFn, 100);

      bus.emit(makeEvent({ type: 'agent.spawn' }));
      bus.emit(makeEvent({ type: 'task.start' }));

      vi.advanceTimersByTime(100);

      expect(batchFn).not.toHaveBeenCalled();
    });

    it('empty prefix matches all events', () => {
      const bus = new EventBus();
      const batchFn = vi.fn();
      bus.onBatch('', batchFn, 100);

      bus.emit(makeEvent({ type: 'agent.spawn' }));
      bus.emit(makeEvent({ type: 'tool.call' }));
      bus.emit(makeEvent({ type: 'task.start' }));

      vi.advanceTimersByTime(100);

      expect(batchFn).toHaveBeenCalledTimes(1);
      expect(batchFn.mock.calls[0][0]).toHaveLength(3);
    });

    it('unsubscribe stops batching', () => {
      const bus = new EventBus();
      const batchFn = vi.fn();
      const unsub = bus.onBatch('tool', batchFn, 100);

      bus.emit(makeEvent({ type: 'tool.call' }));
      unsub();
      vi.advanceTimersByTime(100);

      expect(batchFn).not.toHaveBeenCalled();
    });

    it('multiple prefixes work independently', () => {
      const bus = new EventBus();
      const toolBatch = vi.fn();
      const agentBatch = vi.fn();

      bus.onBatch('tool', toolBatch, 100);
      bus.onBatch('agent', agentBatch, 50);

      bus.emit(makeEvent({ type: 'tool.call' }));
      bus.emit(makeEvent({ type: 'agent.spawn' }));
      bus.emit(makeEvent({ type: 'tool.result' }));

      // Agent batch fires at 50ms
      vi.advanceTimersByTime(50);
      expect(agentBatch).toHaveBeenCalledTimes(1);
      expect(agentBatch.mock.calls[0][0]).toHaveLength(1);
      expect(toolBatch).not.toHaveBeenCalled();

      // Tool batch fires at 100ms
      vi.advanceTimersByTime(50);
      expect(toolBatch).toHaveBeenCalledTimes(1);
      expect(toolBatch.mock.calls[0][0]).toHaveLength(2);
    });

    it('batch handler error does not break the bus', () => {
      const bus = new EventBus();
      const batchFn = vi.fn(() => { throw new Error('batch boom'); });
      bus.onBatch('tool', batchFn, 100);

      bus.emit(makeEvent({ type: 'tool.call' }));
      vi.advanceTimersByTime(100);

      // Should not throw
      expect(batchFn).toHaveBeenCalledTimes(1);

      // Bus should still work for subsequent emissions
      const syncFn = vi.fn();
      bus.on(syncFn);
      bus.emit(makeEvent({ type: 'agent.spawn' }));
      expect(syncFn).toHaveBeenCalledTimes(1);
    });
  });
});
