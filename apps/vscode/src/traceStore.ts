/**
 * Trace Store — structured spans for observability.
 * Circular buffer of last 1000 spans with start/end pairing.
 * @event-horizon/vscode
 */

export type SpanType = 'llm_call' | 'tool_call' | 'task' | 'agent_session' | 'hook';

export interface TraceSpan {
  id: string;
  runId: string;       // session_id for correlation
  spanType: SpanType;
  name: string;        // tool name, task title, etc.
  agentId: string;
  parentSpanId?: string; // for nesting (subagent tracking)
  startMs: number;
  endMs: number;
  durationMs: number;
  metadata: Record<string, unknown>; // tokens, error, tool name, etc.
}

interface OpenSpan {
  id: string;
  runId: string;
  spanType: SpanType;
  name: string;
  agentId: string;
  parentSpanId?: string;
  startMs: number;
  metadata: Record<string, unknown>;
}

const MAX_SPANS = 1000;

let nextSpanCounter = 0;
function generateSpanId(): string {
  return `span-${Date.now()}-${++nextSpanCounter}`;
}

export class TraceStore {
  private spans: TraceSpan[] = [];
  private openSpans = new Map<string, OpenSpan>();
  /** In-flight span lookup by composite key: agentId:spanType:name */
  private inflightKeys = new Map<string, string>(); // composite key -> span id

  /** Start a new span. Returns the span ID for later closing. */
  startSpan(
    type: SpanType,
    name: string,
    agentId: string,
    runId: string,
    metadata?: Record<string, unknown>,
    parentSpanId?: string,
  ): string {
    const id = generateSpanId();
    const open: OpenSpan = {
      id,
      runId,
      spanType: type,
      name,
      agentId,
      parentSpanId,
      startMs: Date.now(),
      metadata: metadata ?? {},
    };
    this.openSpans.set(id, open);

    // Register in-flight key for matching start/end pairs
    const key = `${agentId}:${type}:${name}`;
    this.inflightKeys.set(key, id);

    return id;
  }

  /** End an open span by its span ID. Merges additional metadata. */
  endSpan(spanId: string, metadata?: Record<string, unknown>): TraceSpan | null {
    const open = this.openSpans.get(spanId);
    if (!open) return null;

    this.openSpans.delete(spanId);

    // Remove in-flight key
    const key = `${open.agentId}:${open.spanType}:${open.name}`;
    if (this.inflightKeys.get(key) === spanId) {
      this.inflightKeys.delete(key);
    }

    const endMs = Date.now();
    const span: TraceSpan = {
      id: open.id,
      runId: open.runId,
      spanType: open.spanType,
      name: open.name,
      agentId: open.agentId,
      parentSpanId: open.parentSpanId,
      startMs: open.startMs,
      endMs,
      durationMs: endMs - open.startMs,
      metadata: { ...open.metadata, ...metadata },
    };

    this.spans.push(span);
    // Circular buffer
    if (this.spans.length > MAX_SPANS) {
      this.spans = this.spans.slice(-MAX_SPANS);
    }

    return span;
  }

  /** Find in-flight span by composite key. Returns span ID or null. */
  findInflight(agentId: string, spanType: SpanType, name: string): string | null {
    const key = `${agentId}:${spanType}:${name}`;
    return this.inflightKeys.get(key) ?? null;
  }

  /** Query completed spans with optional filters. */
  getSpans(agentId?: string, spanType?: SpanType, limit = 50): TraceSpan[] {
    let results = this.spans;
    if (agentId) {
      results = results.filter((s) => s.agentId === agentId);
    }
    if (spanType) {
      results = results.filter((s) => s.spanType === spanType);
    }
    return results.slice(-limit);
  }

  /** Aggregate: % time in each span type for an agent (or all). */
  getAggregate(agentId?: string): Record<string, number> {
    let filtered = this.spans;
    if (agentId) {
      filtered = filtered.filter((s) => s.agentId === agentId);
    }

    const totalDuration = filtered.reduce((sum, s) => sum + s.durationMs, 0);
    if (totalDuration === 0) return {};

    const byType: Record<string, number> = {};
    for (const s of filtered) {
      byType[s.spanType] = (byType[s.spanType] ?? 0) + s.durationMs;
    }

    // Convert to percentages
    const result: Record<string, number> = {};
    for (const [type, duration] of Object.entries(byType)) {
      result[type] = Math.round((duration / totalDuration) * 10000) / 100; // e.g. 45.23
    }
    return result;
  }

  /** Get total span count (for stats). */
  get size(): number {
    return this.spans.length;
  }

  /** Get count of open (in-flight) spans. */
  get openCount(): number {
    return this.openSpans.size;
  }
}
