/**
 * File-activity benchmark — verifies O(1) per op and O(1) LRU eviction.
 * Part of Task 4.4 (S-1 perf optimization).
 *
 * The slice is exercised directly (bypassing Zustand's setState wrapper) so the
 * benchmark measures the update algorithm itself, not harness overhead.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createActivitySlice, type ActivitySlice } from '../stores/activitySlice.js';
import { useCommandCenterStore } from '../store.js';

beforeEach(() => {
  useCommandCenterStore.setState(useCommandCenterStore.getInitialState());
});

function makeIsolatedSlice(): ActivitySlice {
  const state = {} as ActivitySlice;
  const set = (fn: (s: ActivitySlice) => Partial<ActivitySlice>) => {
    Object.assign(state, fn(state));
  };
  Object.assign(state, createActivitySlice(set));
  return state;
}

describe('recordFileOp benchmark', () => {
  // Threshold is generous so the test stays green on slow/contended CI runners
  // (GitHub Actions hosted runners can be ~2–3× slower than dev machines).
  // The point is to catch true regressions (10× slowdowns), not to enforce
  // wall-clock limits.
  it('records 10,000 file ops in under 500ms', () => {
    const slice = makeIsolatedSlice();
    // Warmup the JIT so the measured window reflects steady-state perf.
    for (let i = 0; i < 5000; i++) {
      slice.recordFileOp(`/warm${i % 50}.ts`, 'w', `agent${i % 5}`, 'A', 'claude-code', 'read');
    }
    slice.clearFileActivity();
    // Pre-populate to steady state (no growth during measurement).
    for (let i = 0; i < 50; i++) {
      slice.recordFileOp(`/src/file${i}.ts`, `file${i}.ts`, 'a1', 'A', 'claude-code', 'read');
    }

    const start = performance.now();
    for (let i = 0; i < 10_000; i++) {
      const id = i % 50;
      const op = i % 3 === 0 ? 'write' : i % 17 === 0 ? 'error' : 'read';
      slice.recordFileOp(`/src/file${id}.ts`, `file${id}.ts`, `agent${i % 5}`, `Agent ${i % 5}`, 'claude-code', op);
    }
    const duration = performance.now() - start;
    expect(duration).toBeLessThan(500);
  });

  it('scales linearly with op count (O(1) per op)', () => {
    const bench = (n: number) => {
      const slice = makeIsolatedSlice();
      for (let i = 0; i < 1000; i++) slice.recordFileOp(`/w${i % 50}`, 'w', 'a1', 'A', 'c', 'read');
      slice.clearFileActivity();
      const start = performance.now();
      for (let i = 0; i < n; i++) slice.recordFileOp(`/f${i % 50}`, 'f', 'a1', 'A', 'c', 'read');
      return performance.now() - start;
    };
    const t1k = bench(1000);
    const t10k = bench(10_000);
    // 10× workload should cost ≤ 20× — i.e. per-op cost does not inflate.
    expect(t10k).toBeLessThan(t1k * 20 + 10);
  });

  it('caps file activity at 200 entries under heavy churn', () => {
    const { recordFileOp } = useCommandCenterStore.getState();
    for (let i = 0; i < 1000; i++) {
      recordFileOp(`/src/file${i}.ts`, `file${i}.ts`, 'a1', 'Claude', 'claude-code', 'read');
    }
    const activity = useCommandCenterStore.getState().fileActivity;
    expect(Object.keys(activity).length).toBe(200);
    // Most-recent 200 files (800..999) should remain; earliest should be evicted.
    expect(activity['/src/file999.ts']).toBeDefined();
    expect(activity['/src/file0.ts']).toBeUndefined();
  });

  it('touching an old file prevents its eviction', () => {
    const { recordFileOp } = useCommandCenterStore.getState();
    recordFileOp('/src/keepme.ts', 'keepme.ts', 'a1', 'Claude', 'claude-code', 'read');
    for (let i = 0; i < 250; i++) {
      if (i % 50 === 0) recordFileOp('/src/keepme.ts', 'keepme.ts', 'a1', 'Claude', 'claude-code', 'read');
      recordFileOp(`/src/file${i}.ts`, `file${i}.ts`, 'a1', 'Claude', 'claude-code', 'read');
    }
    expect(useCommandCenterStore.getState().fileActivity['/src/keepme.ts']).toBeDefined();
  });
});
