/**
 * Watches a Claude Code transcript JSONL file for new entries and emits AgentEvents.
 *
 * The watcher tails the file incrementally (tracking byte offset) so it only
 * processes new lines as they're appended. It uses a keyword dictionary to map
 * JSONL entry types/fields to AgentEvent types — if Claude Code changes the
 * transcript format, update the dictionary rather than the watcher logic.
 *
 * Hooks remain as fallback for agents that don't produce transcript files.
 */

import * as fs from 'node:fs';
import type { AgentEvent, AgentEventType } from '@event-horizon/core';

// ─── Keyword Dictionary ─────────────────────────────────────────────────────
// Maps JSONL entry patterns to AgentEvent types.
// Update this dictionary when the transcript format changes.

export interface TranscriptMapping {
  /** JSONL `type` field value (e.g. 'user', 'assistant', 'system'). */
  entryType: string;
  /** Optional subtype or nested field to further discriminate. */
  subtype?: string;
  /** The AgentEvent type to emit. */
  eventType: AgentEventType;
  /** Human-readable description of what this mapping captures. */
  description: string;
}

/**
 * Keyword dictionary — the single source of truth for mapping transcript
 * entries to agent events. If the JSONL format changes, update HERE.
 */
export const TRANSCRIPT_MAPPINGS: TranscriptMapping[] = [
  // User messages
  { entryType: 'user', subtype: 'prompt',       eventType: 'task.start',      description: 'User submitted a new prompt' },
  { entryType: 'user', subtype: 'tool_result',  eventType: 'tool.result',     description: 'Tool result returned (user approved permission or tool completed)' },

  // Assistant messages
  { entryType: 'assistant', subtype: 'tool_use',     eventType: 'tool.call',       description: 'Agent invoked a tool' },
  { entryType: 'assistant', subtype: 'text',          eventType: 'task.progress',   description: 'Agent produced text output' },
  { entryType: 'assistant', subtype: 'thinking',      eventType: 'task.progress',   description: 'Agent is thinking' },
  { entryType: 'assistant', subtype: 'end_turn',      eventType: 'agent.idle',      description: 'Agent finished its turn' },

  // System entries
  { entryType: 'system', subtype: 'stop_hook_summary', eventType: 'task.complete', description: 'Turn completed (stop hook fired)' },
  { entryType: 'system', subtype: 'turn_duration',     eventType: 'message.receive', description: 'Turn duration metadata' },

  // Progress entries
  { entryType: 'progress', subtype: 'agent_progress',  eventType: 'task.progress',   description: 'Subagent progress update' },
  { entryType: 'progress', subtype: 'hook_progress',   eventType: 'message.receive', description: 'Hook execution progress' },
];

/**
 * Tool names that trigger the waiting ring when invoked by the assistant.
 * The waiting state clears when the corresponding tool_result arrives.
 */
export const WAITING_TOOLS = new Set([
  'AskUserQuestion',
]);

/**
 * Tool names that represent file operations (for filePath extraction).
 */
export const FILE_TOOLS = new Set([
  'Read', 'Write', 'Edit', 'MultiEdit', 'ReadFile', 'WriteFile',
  'Glob', 'Grep',
]);

// ─── Entry Parser ────────────────────────────────────────────────────────────

interface ParsedEntry {
  /** The raw JSONL entry. */
  raw: Record<string, unknown>;
  /** Resolved AgentEvent type. */
  eventType: AgentEventType;
  /** Safe payload fields to include in the AgentEvent. */
  payload: Record<string, unknown>;
  /** Whether this entry should trigger the waiting ring. */
  isWaiting: boolean;
  /** Whether this entry should clear the waiting ring. */
  clearsWaiting: boolean;
  /** Tool name if this is a tool_use or tool_result. */
  toolName?: string;
}

/**
 * Parse a single JSONL entry into an intermediate representation.
 * Returns null if the entry doesn't map to any known event.
 */
function parseEntry(entry: Record<string, unknown>): ParsedEntry | null {
  const entryType = entry.type as string;
  if (!entryType) return null;

  const payload: Record<string, unknown> = {};
  let eventType: AgentEventType | null = null;
  let isWaiting = false;
  let clearsWaiting = false;
  let toolName: string | undefined;

  // Extract message content structure
  const message = entry.message as Record<string, unknown> | undefined;
  const content = message?.content;
  const contentArray = Array.isArray(content) ? content as Array<Record<string, unknown>> : null;

  if (entryType === 'user') {
    if (contentArray) {
      // Tool result — user approved a permission or tool completed
      const toolResult = contentArray.find((c) => c.type === 'tool_result');
      if (toolResult) {
        eventType = 'tool.result';
        // If this is the result for a waiting tool, clear the waiting ring
        clearsWaiting = true;
      }
    } else if (typeof content === 'string' || (message?.role === 'user' && !contentArray)) {
      // User prompt — new task
      eventType = 'task.start';
      // User prompt clears any waiting state
      clearsWaiting = true;
    }
  } else if (entryType === 'assistant') {
    if (contentArray) {
      // Check for tool_use entries
      const toolUse = contentArray.find((c) => c.type === 'tool_use');
      const textBlock = contentArray.find((c) => c.type === 'text');
      const thinkingBlock = contentArray.find((c) => c.type === 'thinking');

      if (toolUse) {
        eventType = 'tool.call';
        toolName = toolUse.name as string | undefined;
        if (toolName) payload.toolName = toolName;

        // Check if this tool triggers the waiting ring
        if (toolName && WAITING_TOOLS.has(toolName)) {
          isWaiting = true;
        }

        // Extract file path from file tools
        if (toolName && FILE_TOOLS.has(toolName)) {
          const input = toolUse.input as Record<string, unknown> | undefined;
          if (input) {
            const fp = (input.file_path as string) ?? (input.path as string);
            if (typeof fp === 'string') payload.filePath = fp.slice(0, 512);
          }
        }

        // Detect Skill tool invocation
        if (toolName === 'Skill') {
          payload.isSkill = true;
          const input = toolUse.input as Record<string, unknown> | undefined;
          if (input) {
            if (typeof input.skill === 'string') payload.skillName = (input.skill as string).slice(0, 128);
            if (typeof input.args === 'string') payload.skillArgs = (input.args as string).slice(0, 128);
          }
        }

        // Detect subagent spawning
        if (toolName === 'Agent') {
          payload.isSubagent = true;
          const input = toolUse.input as Record<string, unknown> | undefined;
          if (input) {
            if (typeof input.description === 'string') payload.taskId = (input.description as string).slice(0, 128);
          }
        }
      } else if (textBlock) {
        eventType = 'task.progress';
      } else if (thinkingBlock) {
        eventType = 'task.progress';
      }

      // Check for end_turn stop reason
      if (message?.stop_reason === 'end_turn') {
        eventType = 'agent.idle';
      }
    }

    // Extract usage data from assistant messages
    const usage = message?.usage as Record<string, unknown> | undefined;
    if (usage) {
      if (typeof usage.input_tokens === 'number') payload.inputTokensDelta = usage.input_tokens;
      if (typeof usage.output_tokens === 'number') payload.outputTokensDelta = usage.output_tokens;
      if (typeof usage.cache_read_input_tokens === 'number') payload.cacheReadTokensDelta = usage.cache_read_input_tokens;
      if (typeof usage.cache_creation_input_tokens === 'number') payload.cacheCreationTokensDelta = usage.cache_creation_input_tokens;
    }
  } else if (entryType === 'system') {
    const subtype = entry.subtype as string | undefined;
    if (subtype === 'stop_hook_summary') {
      eventType = 'task.complete';
    } else if (subtype === 'turn_duration') {
      eventType = 'message.receive';
      if (typeof entry.durationMs === 'number') payload.turnDurationMs = entry.durationMs;
    }
  } else if (entryType === 'progress') {
    const data = entry.data as Record<string, unknown> | undefined;
    const dataType = data?.type as string | undefined;
    if (dataType === 'agent_progress') {
      eventType = 'task.progress';
      payload.isSubagent = true;
    }
    // hook_progress — skip, already handled via hooks
  }

  if (!eventType) return null;

  // Common metadata
  if (entry.cwd) payload.cwd = String(entry.cwd).slice(0, 512);
  payload.fromTranscript = true;

  return { raw: entry, eventType, payload, isWaiting, clearsWaiting, toolName };
}

// ─── Transcript Watcher ──────────────────────────────────────────────────────

export interface TranscriptWatcherCallbacks {
  onEvent: (event: AgentEvent) => void;
}

let nextEventId = 0;
function makeEventId(): string {
  return `ev-tw-${Date.now()}-${(nextEventId++).toString(36)}`;
}

export class TranscriptWatcher {
  private path: string;
  private agentId: string;
  private agentName: string;
  private offset: number = 0;
  private watcher: fs.FSWatcher | null = null;
  private callbacks: TranscriptWatcherCallbacks;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  /** Tracks pending waiting tool_use IDs to match with tool_results. */
  private pendingWaitingToolIds = new Set<string>();
  /** Tracks pending Skill tool_use IDs so we can mark tool_results as isSkill. */
  private pendingSkillToolIds = new Set<string>();
  /** Cumulative token usage for this session. */
  private cumulativeInputTokens = 0;
  private cumulativeOutputTokens = 0;
  private cumulativeCacheReadTokens = 0;
  private cumulativeCacheCreationTokens = 0;
  /** Partial line buffer for incomplete trailing lines. */
  private partialLine = '';

  constructor(
    transcriptPath: string,
    agentId: string,
    agentName: string,
    _sessionId: string,
    callbacks: TranscriptWatcherCallbacks,
  ) {
    this.path = transcriptPath;
    this.agentId = agentId;
    this.agentName = agentName;
    this.callbacks = callbacks;
  }

  /** Start watching the transcript file. Reads existing content first (catch-up). */
  async start(): Promise<void> {
    if (this.destroyed) return;

    try {
      // Initial read — process existing content to build up cumulative state
      await this.readNewLines();

      // Watch for changes
      this.watcher = fs.watch(this.path, (eventType) => {
        if (eventType === 'change') {
          // Debounce rapid writes (Claude writes many lines at once)
          if (this.debounceTimer) clearTimeout(this.debounceTimer);
          this.debounceTimer = setTimeout(() => this.readNewLines(), 100);
        }
      });

      this.watcher.on('error', () => {
        // File deleted or inaccessible — stop watching silently
        this.destroy();
      });
    } catch {
      // File doesn't exist or inaccessible — no-op, hooks are the fallback
    }
  }

  /** Stop watching and clean up. */
  destroy(): void {
    this.destroyed = true;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  /** Read new lines since last offset, parse, and emit events. */
  private async readNewLines(): Promise<void> {
    if (this.destroyed) return;

    try {
      const stat = await fs.promises.stat(this.path);
      if (stat.size <= this.offset) return; // No new data

      const buf = Buffer.alloc(stat.size - this.offset);
      const fd = await fs.promises.open(this.path, 'r');
      try {
        await fd.read(buf, 0, buf.length, this.offset);
      } finally {
        await fd.close();
      }
      this.offset = stat.size;

      const text = this.partialLine + buf.toString('utf-8');
      const lines = text.split('\n');

      // Last element may be a partial line (no trailing newline yet)
      this.partialLine = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let entry: Record<string, unknown>;
        try {
          entry = JSON.parse(trimmed);
        } catch {
          continue; // Skip malformed lines
        }

        const parsed = parseEntry(entry);
        if (!parsed) continue;

        // Accumulate token usage
        if (parsed.payload.inputTokensDelta) {
          this.cumulativeInputTokens += parsed.payload.inputTokensDelta as number;
          delete parsed.payload.inputTokensDelta;
        }
        if (parsed.payload.outputTokensDelta) {
          this.cumulativeOutputTokens += parsed.payload.outputTokensDelta as number;
          delete parsed.payload.outputTokensDelta;
        }
        if (parsed.payload.cacheReadTokensDelta) {
          this.cumulativeCacheReadTokens += parsed.payload.cacheReadTokensDelta as number;
          delete parsed.payload.cacheReadTokensDelta;
        }
        if (parsed.payload.cacheCreationTokensDelta) {
          this.cumulativeCacheCreationTokens += parsed.payload.cacheCreationTokensDelta as number;
          delete parsed.payload.cacheCreationTokensDelta;
        }

        // Track waiting and skill tool_use IDs from assistant tool_use entries
        if (parsed.eventType === 'tool.call') {
          const content = (entry.message as Record<string, unknown>)?.content;
          if (Array.isArray(content)) {
            for (const c of content as Array<Record<string, unknown>>) {
              if (c.type !== 'tool_use') continue;
              const name = c.name as string | undefined;
              const id = c.id as string | undefined;
              if (!id) continue;
              if (name && WAITING_TOOLS.has(name)) this.pendingWaitingToolIds.add(id);
              if (name === 'Skill') this.pendingSkillToolIds.add(id);
            }
          }
        }

        // Check if this tool_result clears waiting or skill state
        if (parsed.eventType === 'tool.result') {
          const content = (entry.message as Record<string, unknown>)?.content;
          if (Array.isArray(content)) {
            for (const c of content as Array<Record<string, unknown>>) {
              if (c.type !== 'tool_result') continue;
              const toolUseId = c.tool_use_id as string | undefined;
              if (!toolUseId) continue;
              if (this.pendingWaitingToolIds.has(toolUseId)) {
                this.pendingWaitingToolIds.delete(toolUseId);
                parsed.payload.waitingCleared = true;
              }
              if (this.pendingSkillToolIds.has(toolUseId)) {
                this.pendingSkillToolIds.delete(toolUseId);
                parsed.payload.isSkill = true;
              }
            }
          }
        }

        // Emit the waiting event
        if (parsed.isWaiting) {
          this.emitEvent('agent.waiting', {
            ...parsed.payload,
            waitingSource: 'transcript',
            toolName: parsed.toolName,
          });
        }

        // Attach cumulative tokens on task.complete and agent.idle events
        if (parsed.eventType === 'task.complete' || parsed.eventType === 'agent.idle') {
          const totalInput = this.cumulativeInputTokens + this.cumulativeCacheReadTokens + this.cumulativeCacheCreationTokens;
          parsed.payload.inputTokens = totalInput;
          parsed.payload.outputTokens = this.cumulativeOutputTokens;
          // Estimate cost
          parsed.payload.costUsd =
            (this.cumulativeInputTokens * 3 +
             this.cumulativeCacheReadTokens * 0.30 +
             this.cumulativeCacheCreationTokens * 3.75 +
             this.cumulativeOutputTokens * 15) / 1_000_000;
        }

        this.emitEvent(parsed.eventType, parsed.payload);
      }
    } catch {
      // Read error — file may be locked or deleted
    }
  }

  private emitEvent(type: AgentEventType, payload: Record<string, unknown>): void {
    this.callbacks.onEvent({
      id: makeEventId(),
      agentId: this.agentId,
      agentName: this.agentName,
      agentType: 'claude-code',
      type,
      timestamp: Date.now(),
      payload,
    });
  }

  /** Get current cumulative usage stats. */
  getUsage() {
    return {
      inputTokens: this.cumulativeInputTokens + this.cumulativeCacheReadTokens + this.cumulativeCacheCreationTokens,
      outputTokens: this.cumulativeOutputTokens,
      cacheReadTokens: this.cumulativeCacheReadTokens,
      cacheCreationTokens: this.cumulativeCacheCreationTokens,
    };
  }
}
