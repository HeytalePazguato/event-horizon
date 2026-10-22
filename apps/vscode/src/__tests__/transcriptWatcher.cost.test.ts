import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AgentEvent } from '@event-horizon/core';
import { TranscriptWatcher, computeTranscriptCost, type TranscriptTokens } from '../transcriptWatcher.js';

const tokens = (t: Partial<TranscriptTokens>): TranscriptTokens => ({
  input: 0, output: 0, cacheRead: 0, cacheCreation: 0, ...t,
});

describe('computeTranscriptCost', () => {
  it('prices an Opus 5-only transcript at 5/25, not 15/75', () => {
    const { costUsd, costUnpriced } = computeTranscriptCost(
      new Map([['claude-opus-5', tokens({ input: 1_000_000, output: 1_000_000 })]]),
    );
    expect(costUsd).toBeCloseTo(30, 6);
    expect(costUnpriced).toBe(false);
  });

  it('sums mixed models', () => {
    const { costUsd, costUnpriced } = computeTranscriptCost(
      new Map([
        ['claude-opus-5', tokens({ input: 1_000_000 })], // 5
        ['claude-haiku-4-5', tokens({ output: 1_000_000 })], // 5
        ['claude-sonnet-4-5', tokens({ cacheRead: 1_000_000, cacheCreation: 1_000_000 })], // 0.3 + 3.75
      ]),
    );
    expect(costUsd).toBeCloseTo(14.05, 6);
    expect(costUnpriced).toBe(false);
  });

  it('flags unknown models as unpriced and contributes 0 for them', () => {
    const { costUsd, costUnpriced } = computeTranscriptCost(
      new Map([
        ['claude-opus-5', tokens({ input: 1_000_000 })],
        ['mystery-model', tokens({ input: 9_000_000 })],
      ]),
    );
    expect(costUsd).toBeCloseTo(5, 6);
    expect(costUnpriced).toBe(true);
  });

  it('does not flag an unknown model that used no tokens', () => {
    expect(computeTranscriptCost(new Map([['unknown', tokens({})]])).costUnpriced).toBe(false);
  });
});

describe('TranscriptWatcher cost payloads', () => {
  it('stamps costSource and per-model cost on task.complete / agent.idle', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-tw-'));
    const file = path.join(dir, 't.jsonl');
    const lines = [
      { type: 'assistant', message: { model: 'claude-opus-5', content: [{ type: 'text', text: 'a' }], usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 } } },
      { type: 'system', subtype: 'stop_hook_summary' },
      { type: 'assistant', message: { model: 'mystery', stop_reason: 'end_turn', content: [{ type: 'text', text: 'b' }], usage: { input_tokens: 10 } } },
    ];
    fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');

    const events: AgentEvent[] = [];
    const w = new TranscriptWatcher(file, 'a1', 'agent', 's1', { onEvent: (e) => events.push(e) });
    try {
      await w.start();
    } finally {
      w.destroy();
      fs.rmSync(dir, { recursive: true, force: true });
    }

    const complete = events.find((e) => e.type === 'task.complete');
    const idle = events.find((e) => e.type === 'agent.idle');
    expect(complete?.payload?.costUsd).toBeCloseTo(30, 6);
    expect(complete?.payload?.costUnpriced).toBeUndefined();
    expect(idle?.payload?.costUnpriced).toBe(true);
    for (const e of [complete, idle]) {
      expect(e?.payload?.costSource).toBe('transcript-estimated');
    }
  });
});
