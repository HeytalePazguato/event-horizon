import { describe, it, expect } from 'vitest';
import { CostResolver, COST_SOURCE_PRECEDENCE } from '../costResolver';

describe('CostResolver', () => {
  describe('precedence', () => {
    it('exports precedence otel > statusline > agent-reported > transcript-estimated', () => {
      expect([...COST_SOURCE_PRECEDENCE]).toEqual(['otel', 'statusline', 'agent-reported', 'transcript-estimated']);
    });

    it('treats agent-reported cost as measured and above the transcript estimate', () => {
      const r = new CostResolver();
      r.submit('a', 'transcript-estimated', 9.99);
      r.submit('a', 'agent-reported', 2.5);
      expect(r.resolve('a')).toEqual({ costUsd: 2.5, source: 'agent-reported', estimated: false });
    });

    it('resolves to otel for all six arrival orders of the three sources', () => {
      const values = { otel: 1.23, statusline: 4.56, 'transcript-estimated': 9.99 } as const;
      const orders: Array<Array<keyof typeof values>> = [
        ['otel', 'statusline', 'transcript-estimated'],
        ['otel', 'transcript-estimated', 'statusline'],
        ['statusline', 'otel', 'transcript-estimated'],
        ['statusline', 'transcript-estimated', 'otel'],
        ['transcript-estimated', 'otel', 'statusline'],
        ['transcript-estimated', 'statusline', 'otel'],
      ];
      for (const order of orders) {
        const r = new CostResolver();
        for (const source of order) r.submit('a', source, values[source]);
        expect(r.resolve('a'), order.join(' → ')).toEqual({ costUsd: 1.23, source: 'otel', estimated: false });
      }
    });

    it('later transcript submission never overwrites earlier otel', () => {
      const r = new CostResolver();
      r.submit('a', 'otel', 1.23);
      r.submit('a', 'transcript-estimated', 9.99);
      expect(r.resolve('a')).toEqual({ costUsd: 1.23, source: 'otel', estimated: false });
    });

    it('statusline beats transcript regardless of arrival order', () => {
      const r = new CostResolver();
      r.submit('a', 'statusline', 2);
      r.submit('a', 'transcript-estimated', 5);
      expect(r.resolve('a')?.source).toBe('statusline');
      const r2 = new CostResolver();
      r2.submit('a', 'transcript-estimated', 5);
      r2.submit('a', 'statusline', 2);
      expect(r2.resolve('a')?.costUsd).toBe(2);
    });

    it('otel beats statusline', () => {
      const r = new CostResolver();
      r.submit('a', 'otel', 3);
      r.submit('a', 'statusline', 4);
      expect(r.resolve('a')?.source).toBe('otel');
    });

    it('keeps the latest value per source', () => {
      const r = new CostResolver();
      r.submit('a', 'otel', 1);
      r.submit('a', 'otel', 2);
      expect(r.resolve('a')?.costUsd).toBe(2);
    });
  });

  describe('estimated flag', () => {
    it('is true when only transcript-estimated exists', () => {
      const r = new CostResolver();
      r.submit('a', 'transcript-estimated', 0.5);
      expect(r.resolve('a')).toEqual({ costUsd: 0.5, source: 'transcript-estimated', estimated: true });
    });

    it('is true when the winning source is flagged unpriced', () => {
      const r = new CostResolver();
      r.submit('a', 'statusline', 0.5, { unpriced: true });
      expect(r.resolve('a')?.estimated).toBe(true);
    });
  });

  describe('input validation', () => {
    it('ignores non-finite and negative costs', () => {
      const r = new CostResolver();
      r.submit('a', 'otel', NaN);
      r.submit('a', 'otel', Infinity);
      r.submit('a', 'otel', -1);
      expect(r.resolve('a')).toBeNull();
    });

    it('does not let an invalid value replace a valid one', () => {
      const r = new CostResolver();
      r.submit('a', 'otel', 1);
      r.submit('a', 'otel', -5);
      expect(r.resolve('a')?.costUsd).toBe(1);
    });

    it('accepts zero', () => {
      const r = new CostResolver();
      r.submit('a', 'otel', 0);
      expect(r.resolve('a')?.costUsd).toBe(0);
    });
  });

  describe('agents and clear', () => {
    it('returns null for unknown agents', () => {
      expect(new CostResolver().resolve('nope')).toBeNull();
    });

    it('isolates agents', () => {
      const r = new CostResolver();
      r.submit('a', 'otel', 1);
      r.submit('b', 'statusline', 2);
      expect(r.resolve('a')?.costUsd).toBe(1);
      expect(r.resolve('b')?.source).toBe('statusline');
    });

    it('clear removes all sources for the agent only', () => {
      const r = new CostResolver();
      r.submit('a', 'otel', 1);
      r.submit('a', 'statusline', 2);
      r.submit('b', 'otel', 3);
      r.clear('a');
      expect(r.resolve('a')).toBeNull();
      expect(r.resolve('b')?.costUsd).toBe(3);
    });
  });
});
