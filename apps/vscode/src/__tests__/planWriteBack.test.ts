import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { applyCheckboxes, PlanWriteBack } from '../planWriteBack';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('applyCheckboxes', () => {
  it('toggles dotted IDs without matching longer IDs', () => {
    const c = '- [ ] 1.1 first\n- [ ] 101 other\n';
    const out = applyCheckboxes(c, new Map([['1.1', true]]));
    expect(out).toBe('- [x] 1.1 first\n- [ ] 101 other\n');
  });
  it('handles regex-special IDs and unchecking', () => {
    const c = '- [x] a+b thing\n- [ ] ab thing\n';
    expect(applyCheckboxes(c, new Map([['a+b', false]]))).toBe('- [ ] a+b thing\n- [ ] ab thing\n');
  });
});

describe('PlanWriteBack', () => {
  let files: Map<string, string>;
  let events: string[];
  let locked: boolean;
  let wb: PlanWriteBack;
  const P = '/plan.md';

  beforeEach(() => {
    vi.useFakeTimers();
    files = new Map([[P, '- [ ] 1.1 a\n- [ ] 1.2 b\n']]);
    events = [];
    locked = false;
    wb = new PlanWriteBack({
      readFile: async (p) => files.get(p) ?? '',
      writeFile: async (p, s) => { events.push('write'); files.set(p, s); },
      isLockedByOther: () => locked,
      setSelfWriteHash: () => { events.push('hash'); },
    });
  });
  afterEach(() => { wb.dispose(); vi.useRealTimers(); });

  it('cancel() drops a pending write for that plan', async () => {
    wb.schedule('p', P, new Map([['1.1', true]]));
    wb.cancel('p');
    await vi.advanceTimersByTimeAsync(2500);
    expect(events).toEqual([]);
    expect(files.get(P)).toContain('- [ ] 1.1 a');
  });

  it('coalesces 10 schedules into one write with latest statuses', async () => {
    for (let i = 0; i < 10; i++) {
      wb.schedule('p', P, new Map([['1.1', i === 9]]));
      await vi.advanceTimersByTimeAsync(100);
    }
    await vi.advanceTimersByTimeAsync(2500);
    expect(events.filter((e) => e === 'write')).toHaveLength(1);
    expect(files.get(P)).toContain('- [x] 1.1 a');
  });

  it('defers while locked then writes after unlock', async () => {
    locked = true;
    wb.schedule('p', P, new Map([['1.2', true]]));
    await vi.advanceTimersByTimeAsync(5000);
    expect(events).toEqual([]);
    locked = false;
    await vi.advanceTimersByTimeAsync(1100);
    expect(events).toEqual(['hash', 'write']);
    expect(files.get(P)).toContain('- [x] 1.2 b');
  });

  it('drops and logs after max retries', async () => {
    const log = vi.fn();
    wb.dispose();
    wb = new PlanWriteBack({
      readFile: async () => '', writeFile: async () => { events.push('write'); },
      isLockedByOther: () => true, setSelfWriteHash: () => {}, log,
    });
    wb.schedule('p', P, new Map([['1.1', true]]));
    await vi.advanceTimersByTimeAsync(2000 + 31 * 1000 + 100);
    expect(log).toHaveBeenCalledTimes(1);
    expect(events).toEqual([]);
  });

  it('sets hash of new content before writing', async () => {
    const hashes: string[] = [];
    wb.dispose();
    wb = new PlanWriteBack({
      readFile: async (p) => files.get(p)!,
      writeFile: async (p, s) => { events.push('write'); files.set(p, s); },
      isLockedByOther: () => false,
      setSelfWriteHash: (_id, h) => { events.push('hash'); hashes.push(h); },
    });
    wb.schedule('p', P, new Map([['1.1', true]]));
    await vi.advanceTimersByTimeAsync(2100);
    expect(events).toEqual(['hash', 'write']);
    expect(hashes[0]).toBe(sha(files.get(P)!));
  });

  it('does not write when content is unchanged', async () => {
    wb.schedule('p', P, new Map([['1.1', false]]));
    await vi.advanceTimersByTimeAsync(2100);
    expect(events).toEqual([]);
  });
});
