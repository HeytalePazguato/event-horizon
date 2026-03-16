/**
 * Watches an OpenCode SSE event stream for subagent and question events.
 *
 * OpenCode exposes a Server-Sent Events endpoint at /event that streams all
 * internal bus events including:
 * - message.part.updated with type="subtask" — subagent spawn
 * - question.asked / question.replied — user input prompts (waiting ring)
 * - session.status — busy/idle state changes
 *
 * The SSE watcher provides richer events than plugin hooks alone, particularly
 * for subagent tracking which is not available via hooks (issue #16627).
 * Plugin hooks remain as fallback for basic events.
 */

import type { AgentEvent, AgentEventType } from '@event-horizon/core';

// ─── Types ───────────────────────────────────────────────────────────────────

/** SSE event from OpenCode's /event endpoint */
interface OpenCodeSSEEvent {
  type: string;
  properties: Record<string, unknown>;
}

/** SubtaskPart from message.part.updated events */
interface SubtaskPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: 'subtask';
  prompt: string;
  description: string;
  agent: string;
  model?: { providerID: string; modelID: string };
  command?: string;
}

/** ToolPart from message.part.updated events */
interface ToolPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: 'tool';
  callID: string;
  tool: string;
  state: {
    status: 'pending' | 'running' | 'completed' | 'error';
    input?: Record<string, unknown>;
    output?: string;
    title?: string;
    time?: { start: number; end?: number };
  };
}

/** QuestionRequest from question.asked events */
interface QuestionAsked {
  id: string;
  sessionID: string;
  questions: Array<{
    question: string;
    header: string;
    options: Array<{ label: string; description: string }>;
    multiple?: boolean;
    custom?: boolean;
  }>;
  tool?: { messageID: string; callID: string };
}

// ─── SSE Watcher ─────────────────────────────────────────────────────────────

export interface OpenCodeSSEWatcherCallbacks {
  onEvent: (event: AgentEvent) => void;
  onLog?: (message: string) => void;
}

let nextEventId = 0;
function makeEventId(): string {
  return `ev-oc-sse-${Date.now()}-${(nextEventId++).toString(36)}`;
}

export class OpenCodeSSEWatcher {
  private serverUrl: string;
  private agentId: string;
  private agentName: string;
  private cwd: string | undefined;
  private callbacks: OpenCodeSSEWatcherCallbacks;
  private abortController: AbortController | null = null;
  private destroyed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 2000; // Start with 2s, exponential backoff

  /** Tracks active subagent part IDs to detect completion */
  private activeSubagents = new Map<string, { agent: string; description: string; startTime: number }>();

  /** Tracks pending question IDs for waiting ring */
  private pendingQuestions = new Set<string>();

  constructor(
    serverUrl: string,
    agentId: string,
    agentName: string,
    cwd: string | undefined,
    callbacks: OpenCodeSSEWatcherCallbacks,
  ) {
    // Ensure URL doesn't have trailing slash
    this.serverUrl = serverUrl.replace(/\/$/, '');
    this.agentId = agentId;
    this.agentName = agentName;
    this.cwd = cwd;
    this.callbacks = callbacks;
  }

  /** Start watching the SSE stream. */
  async start(): Promise<void> {
    if (this.destroyed) return;

    try {
      await this.connect();
    } catch {
      // Connection failed — schedule reconnect
      this.scheduleReconnect();
    }
  }

  /** Stop watching and clean up. */
  destroy(): void {
    this.destroyed = true;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.activeSubagents.clear();
    this.pendingQuestions.clear();
  }

  /** Log a message via the callback if available. */
  private log(message: string): void {
    this.callbacks.onLog?.(`[OpenCodeSSE] ${message}`);
  }

  /** Connect to the SSE endpoint and start processing events. */
  private async connect(): Promise<void> {
    if (this.destroyed) return;

    this.abortController = new AbortController();
    const url = `${this.serverUrl}/event`;

    this.log(`Connecting to ${url}`);

    // Add directory header for workspace context
    const headers: Record<string, string> = {
      'Accept': 'text/event-stream',
      'Cache-Control': 'no-cache',
    };
    if (this.cwd) {
      headers['x-opencode-directory'] = encodeURIComponent(this.cwd);
    }

    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: this.abortController.signal,
    });

    if (!response.ok) {
      this.log(`Connection failed: ${response.status} ${response.statusText}`);
      throw new Error(`SSE connection failed: ${response.status} ${response.statusText}`);
    }

    if (!response.body) {
      this.log('Response has no body');
      throw new Error('SSE response has no body');
    }

    this.log('Connected successfully');

    // Reset reconnect state on successful connection
    this.reconnectAttempts = 0;
    this.reconnectDelay = 2000;

    // Process the SSE stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (!this.destroyed) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE messages (double newline separated)
        const messages = buffer.split('\n\n');
        buffer = messages.pop() ?? ''; // Keep incomplete message in buffer

        for (const message of messages) {
          this.processSSEMessage(message);
        }
      }
    } catch {
      if (!this.destroyed) {
        // Connection lost — schedule reconnect
        this.scheduleReconnect();
      }
    }
  }

  /** Schedule a reconnection attempt with exponential backoff. */
  private scheduleReconnect(): void {
    if (this.destroyed) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      // Give up — fall back to hooks
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectAttempts++;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000); // Max 30s
      this.connect().catch(() => this.scheduleReconnect());
    }, this.reconnectDelay);
  }

  /** Process a single SSE message. */
  private processSSEMessage(message: string): void {
    // SSE format: "data: {json}\n" or "event: name\ndata: {json}\n"
    const lines = message.split('\n');
    let data: string | null = null;

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        data = line.slice(6);
      }
    }

    if (!data) return;

    try {
      const event = JSON.parse(data) as OpenCodeSSEEvent;
      this.handleSSEEvent(event);
    } catch {
      // Malformed JSON — skip
    }
  }

  /** Handle a parsed SSE event. */
  private handleSSEEvent(event: OpenCodeSSEEvent): void {
    const { type, properties } = event;

    switch (type) {
      case 'message.part.updated':
        this.handlePartUpdated(properties);
        break;

      case 'question.asked':
        this.handleQuestionAsked(properties as unknown as QuestionAsked);
        break;

      case 'question.replied':
      case 'question.rejected':
        this.handleQuestionResolved(properties);
        break;

      case 'session.status':
        this.handleSessionStatus(properties);
        break;

      case 'server.heartbeat':
        // Keep-alive, no action needed
        break;

      // Other events are handled by the plugin hooks
    }
  }

  /** Handle message.part.updated events — detect subagent spawn/completion. */
  private handlePartUpdated(properties: Record<string, unknown>): void {
    const part = properties.part as Record<string, unknown> | undefined;
    if (!part) return;

    const partType = part.type as string | undefined;
    this.log(`Part updated: type=${partType}`);

    // Subagent spawn
    if (partType === 'subtask') {
      const subtask = part as unknown as SubtaskPart;
      const partId = subtask.id;

      this.log(`Subtask detected: id=${partId}, agent=${subtask.agent}, desc=${subtask.description?.slice(0, 50)}`);

      if (!this.activeSubagents.has(partId)) {
        // New subagent started
        this.activeSubagents.set(partId, {
          agent: subtask.agent,
          description: subtask.description,
          startTime: Date.now(),
        });

        this.log(`Emitting subagent spawn: ${subtask.agent}`);
        this.emitEvent('task.start', {
          isSubagent: true,
          subagentId: partId,
          subagentType: subtask.agent,
          taskId: subtask.description.slice(0, 128),
          prompt: subtask.prompt?.slice(0, 256),
          fromSSE: true,
        });
      }
    }

    // Tool completion might indicate subagent finished
    // We detect subagent completion when we see the next assistant message
    // or when session goes idle after a subtask was active
    if (partType === 'tool') {
      const toolPart = part as unknown as ToolPart;
      // Check if this is a Task tool result (subagent completion)
      if (toolPart.tool === 'Task' && toolPart.state.status === 'completed') {
        // Find and remove the corresponding subagent
        // The Task tool output often contains the subagent result
        this.completeOldestSubagent();
      }
    }
  }

  /** Handle question.asked events — trigger waiting ring. */
  private handleQuestionAsked(question: QuestionAsked): void {
    this.pendingQuestions.add(question.id);

    this.emitEvent('agent.waiting', {
      waitingSource: 'sse',
      questionId: question.id,
      questions: question.questions.map((q) => q.header).join(', '),
      fromSSE: true,
    });
  }

  /** Handle question.replied/rejected events — clear waiting ring. */
  private handleQuestionResolved(properties: Record<string, unknown>): void {
    const requestId = properties.requestID as string | undefined;
    if (requestId && this.pendingQuestions.has(requestId)) {
      this.pendingQuestions.delete(requestId);

      // Only emit if no more pending questions
      if (this.pendingQuestions.size === 0) {
        this.emitEvent('message.receive', {
          waitingCleared: true,
          fromSSE: true,
        });
      }
    }
  }

  /** Handle session.status events — detect idle state to complete subagents. */
  private handleSessionStatus(properties: Record<string, unknown>): void {
    const status = properties.status as Record<string, unknown> | undefined;
    const statusType = status?.type as string | undefined;

    if (statusType === 'idle') {
      // Session went idle — complete all active subagents
      this.completeAllSubagents();
    }
  }

  /** Complete the oldest active subagent (FIFO). */
  private completeOldestSubagent(): void {
    if (this.activeSubagents.size === 0) return;

    // Get the oldest subagent (first entry)
    const [partId, info] = this.activeSubagents.entries().next().value as [string, { agent: string; description: string; startTime: number }];
    this.activeSubagents.delete(partId);

    this.emitEvent('task.complete', {
      isSubagent: true,
      subagentId: partId,
      subagentType: info.agent,
      taskId: info.description.slice(0, 128),
      durationMs: Date.now() - info.startTime,
      fromSSE: true,
    });
  }

  /** Complete all active subagents (called when session goes idle). */
  private completeAllSubagents(): void {
    for (const [partId, info] of this.activeSubagents) {
      this.emitEvent('task.complete', {
        isSubagent: true,
        subagentId: partId,
        subagentType: info.agent,
        taskId: info.description.slice(0, 128),
        durationMs: Date.now() - info.startTime,
        fromSSE: true,
      });
    }
    this.activeSubagents.clear();
  }

  /** Emit an AgentEvent to the callback. */
  private emitEvent(type: AgentEventType, payload: Record<string, unknown>): void {
    if (this.cwd) payload.cwd = this.cwd;

    this.callbacks.onEvent({
      id: makeEventId(),
      agentId: this.agentId,
      agentName: this.agentName,
      agentType: 'opencode',
      type,
      timestamp: Date.now(),
      payload,
    });
  }

  /** Check if the watcher is currently connected. */
  isConnected(): boolean {
    return !this.destroyed && this.abortController !== null;
  }

  /** Get the number of active subagents being tracked. */
  getActiveSubagentCount(): number {
    return this.activeSubagents.size;
  }
}
