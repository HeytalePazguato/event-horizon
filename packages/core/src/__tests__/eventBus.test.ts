import { describe, it, expect, vi } from 'vitest';
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
});
