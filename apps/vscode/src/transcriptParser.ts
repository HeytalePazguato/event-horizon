/**
 * Parses Claude Code transcript JSONL files to extract cumulative token usage.
 *
 * Transcript structure: each line is a JSON object. Assistant messages have the
 * shape { message: { usage: { input_tokens, output_tokens, cache_read_input_tokens, ... } } }.
 * Usage may also appear at the top level on some entry types.
 */

import * as fs from 'node:fs';
import * as readline from 'node:readline';

export interface TranscriptUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** Estimated cost in USD. */
  costUsd: number;
}

/**
 * Read a Claude Code transcript JSONL and sum up token usage across all entries.
 * Returns null if the file cannot be read or parsed.
 */
export async function parseTranscriptUsage(transcriptPath: string): Promise<TranscriptUsage | null> {
  try {
    const stat = await fs.promises.stat(transcriptPath);
    // Safety: skip huge files (>50MB) to avoid blocking
    if (stat.size > 50 * 1024 * 1024) return null;

    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheCreationTokens = 0;

    const stream = fs.createReadStream(transcriptPath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;

        // Usage lives inside entry.message.usage (assistant responses)
        // or sometimes at entry.usage (tool results, etc.)
        const msg = entry.message as Record<string, unknown> | undefined;
        const usage = (msg?.usage as Record<string, unknown>)
          ?? (entry.usage as Record<string, unknown>);
        if (!usage) continue;

        if (typeof usage.input_tokens === 'number') inputTokens += usage.input_tokens;
        if (typeof usage.output_tokens === 'number') outputTokens += usage.output_tokens;
        if (typeof usage.cache_read_input_tokens === 'number') cacheReadTokens += usage.cache_read_input_tokens;
        if (typeof usage.cache_creation_input_tokens === 'number') cacheCreationTokens += usage.cache_creation_input_tokens;
      } catch {
        // Skip malformed lines
      }
    }

    const totalInput = inputTokens + cacheReadTokens + cacheCreationTokens;
    if (totalInput === 0 && outputTokens === 0) return null;

    // Estimate cost using approximate Claude rates ($/M tokens):
    // input: $3, cache read: $0.30, cache creation: $3.75, output: $15
    const costUsd =
      (inputTokens * 3 + cacheReadTokens * 0.30 + cacheCreationTokens * 3.75 + outputTokens * 15) / 1_000_000;

    return {
      inputTokens: totalInput,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      costUsd,
    };
  } catch {
    return null;
  }
}
