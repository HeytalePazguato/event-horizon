import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { PlanFileWatcher, type WatchHandle } from '../planFileWatcher';

class FakeHandle implements WatchHandle {
  change: Array<() => void> = [];
  del: Array<() => void> = [];
  create: Array<() => void> = [];
  disposed = false;
  onDidChange(cb: () => void) { this.change.push(cb); }
  onDidDelete(cb: () => void) { this.del.push(cb); }
  onDidCreate(cb: () => void) { this.create.push(cb); }
  dispose() { this.disposed = true; }
  fireChange() { this.change.forEach((c) => c()); }
  fireDelete() { this.del.forEach((c) => c()); }
}

describe('PlanFileWatcher', () => {
  let handles: FakeHandle[];
  let selfHash: string | null;
  let content: string;
  let onContent: ReturnType<typeof vi.fn>;
  let onMissing: ReturnType<typeof vi.fn>;
  let w: PlanFileWatcher;

  beforeEach(() => {
    vi.useFakeTimers();
    handles = [];
    selfHash = null;
    content = '# plan';
    onContent = vi.fn();
    onMissing = vi.fn();
    w = new PlanFileWatcher({
      factory: () => { const h = new FakeHandle(); handles.push(h); return h; },
      readFile: async () => content,
      getSelfWriteHash: () => selfHash,
      onContent,
      onMissing,
    });
  });
  afterEach(() => vi.useRealTimers());

  it('debounces rapid changes into one onContent', async () => {
    w.watch('p', '/a/plan.md');
    for (let i = 0; i < 5; i++) { handles[0].fireChange(); await vi.advanceTimersByTimeAsync(50); }
    await vi.advanceTimersByTimeAsync(400);
    expect(onContent).toHaveBeenCalledTimes(1);
    expect(onContent).toHaveBeenCalledWith('p', '# plan');
  });

  it('skips content matching the self-write hash', async () => {
    selfHash = createHash('sha256').update(content).digest('hex');
    w.watch('p', '/a/plan.md');
    handles[0].fireChange();
    await vi.advanceTimersByTimeAsync(400);
    expect(onContent).not.toHaveBeenCalled();
  });

  it('reports delete as missing', () => {
    w.watch('p', '/a/plan.md');
    handles[0].fireDelete();
    expect(onMissing).toHaveBeenCalledWith('p');
  });

  it('reports read errors as missing', async () => {
    const w2 = new PlanFileWatcher({
      factory: () => { const h = new FakeHandle(); handles.push(h); return h; },
      readFile: async () => { throw new Error('ENOENT'); },
      getSelfWriteHash: () => null,
      onContent,
      onMissing,
    });
    w2.watch('q', '/a/q.md');
    handles[0].fireChange();
    await vi.advanceTimersByTimeAsync(400);
    expect(onMissing).toHaveBeenCalledWith('q');
  });

  it('unwatch disposes the handle and cancels pending work', async () => {
    w.watch('p', '/a/plan.md');
    handles[0].fireChange();
    w.unwatch('p');
    await vi.advanceTimersByTimeAsync(400);
    expect(handles[0].disposed).toBe(true);
    expect(onContent).not.toHaveBeenCalled();
  });

  it('re-watch disposes the previous handle', () => {
    w.watch('p', '/a/plan.md');
    w.watch('p', '/b/plan.md');
    expect(handles[0].disposed).toBe(true);
    expect(handles[1].disposed).toBe(false);
    w.disposeAll();
    expect(handles[1].disposed).toBe(true);
  });
});
