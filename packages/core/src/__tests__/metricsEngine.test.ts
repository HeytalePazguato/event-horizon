import { describe, it, expect, beforeEach } from 'vitest';
import { MetricsEngine } from '../metricsEngine.js';
import type { AgentEvent } from '../events.js';

function makeEvent(overrides: Partial<AgentEvent> & { type: AgentEvent['type']; agentId: string }): AgentEvent {
  return {
    id: `ev-${Date.now()}`,
    agentName: 'Test Agent',
    agentType: 'claude-code',
    timestamp: Date.now(),
    payload: {},
    ...overrides,
  };
}

describe('MetricsEngine', () => {
  let engine: MetricsEngine;

  beforeEach(() => {
    engine = new MetricsEngine();
  });

  it('process() creates metrics for new agents', () => {
    expect(engine.getMetrics('a1')).toBeNull();

    engine.process(makeEvent({ type: 'agent.spawn', agentId: 'a1', timestamp: 1000 }));

    const m = engine.getMetrics('a1');
    expect(m).not.toBeNull();
    expect(m!.agentId).toBe('a1');
    expect(m!.sessionStartedAt).toBe(1000);
  });

  it('load increases on events and decays over time', () => {
    const t0 = 1000;
    engine.process(makeEvent({ type: 'agent.spawn', agentId: 'a1', timestamp: t0 }));
    const loadAfterSpawn = engine.getMetrics('a1')!.load;
    expect(loadAfterSpawn).toBeGreaterThan(0);

    // Process another event much later — load should decay then increase
    engine.process(makeEvent({ type: 'tool.call', agentId: 'a1', timestamp: t0 + 10_000, payload: { toolName: 'Read' } }));
    const loadAfterDecayAndEvent = engine.getMetrics('a1')!.load;
    // The load decayed from the first event, then got the tool.call weight added
    expect(loadAfterDecayAndEvent).toBeGreaterThan(0);
  });

  it('agent.terminate removes metrics', () => {
    engine.process(makeEvent({ type: 'agent.spawn', agentId: 'a1', timestamp: 1000 }));
    expect(engine.getMetrics('a1')).not.toBeNull();

    engine.process(makeEvent({ type: 'agent.terminate', agentId: 'a1', timestamp: 2000 }));
    expect(engine.getMetrics('a1')).toBeNull();
    expect(engine.getAllMetrics()).toHaveLength(0);
  });

  it('out-of-order timestamps do not cause negative decay', () => {
    engine.process(makeEvent({ type: 'agent.spawn', agentId: 'a1', timestamp: 5000 }));
    // Earlier timestamp — elapsed would be negative without the Math.max(0, ...) guard
    engine.process(makeEvent({ type: 'tool.call', agentId: 'a1', timestamp: 3000, payload: { toolName: 'Read' } }));
    const m = engine.getMetrics('a1')!;
    expect(m.load).toBeGreaterThanOrEqual(0);
    expect(m.load).toBeLessThanOrEqual(1);
  });

  it('toolBreakdown is capped at 100 entries', () => {
    engine.process(makeEvent({ type: 'agent.spawn', agentId: 'a1', timestamp: 1000 }));

    // Add 110 distinct tool names
    for (let i = 0; i < 110; i++) {
      engine.process(makeEvent({
        type: 'tool.call',
        agentId: 'a1',
        timestamp: 1000 + i,
        payload: { toolName: `tool-${i}` },
      }));
    }

    const m = engine.getMetrics('a1')!;
    expect(Object.keys(m.toolBreakdown).length).toBeLessThanOrEqual(100);
  });

  it('activeTasks counter increments and decrements correctly', () => {
    engine.process(makeEvent({ type: 'agent.spawn', agentId: 'a1', timestamp: 1000 }));
    expect(engine.getMetrics('a1')!.activeTasks).toBe(0);

    engine.process(makeEvent({ type: 'task.start', agentId: 'a1', timestamp: 1001 }));
    expect(engine.getMetrics('a1')!.activeTasks).toBe(1);

    engine.process(makeEvent({ type: 'task.start', agentId: 'a1', timestamp: 1002 }));
    expect(engine.getMetrics('a1')!.activeTasks).toBe(2);

    engine.process(makeEvent({ type: 'task.complete', agentId: 'a1', timestamp: 1003 }));
    expect(engine.getMetrics('a1')!.activeTasks).toBe(1);

    engine.process(makeEvent({ type: 'task.fail', agentId: 'a1', timestamp: 1004 }));
    expect(engine.getMetrics('a1')!.activeTasks).toBe(0);
  });

  it('counter drift fallback prevents negative activeTasks', () => {
    engine.process(makeEvent({ type: 'agent.spawn', agentId: 'a1', timestamp: 1000 }));
    // Complete without a preceding start — activeTasks should not go below 0
    engine.process(makeEvent({ type: 'task.complete', agentId: 'a1', timestamp: 1001 }));
    const m = engine.getMetrics('a1')!;
    expect(m.activeTasks).toBe(0);
    expect(m.activeSubagents).toBe(0);
  });
});
