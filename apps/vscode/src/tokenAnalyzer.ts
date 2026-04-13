/**
 * Token Analyzer — processes agent events to produce cost insights
 * and actionable recommendations for optimizing multi-agent workflows.
 */

import type { AgentEvent } from '@event-horizon/core';

// ── Types ──────────────────────────────────────────────────────────────────

/** Per-agent context window breakdown inspired by MemPalace's L0-L3 layers. */
export interface ContextLayerBreakdown {
  /** L0: System prompt / instruction files — estimated from first cache creation event. */
  systemPrompt: number;
  /** L1: Conversation history — accumulated input minus system prompt and tool results. */
  conversationHistory: number;
  /** L2: Tool results — tokens from tool.result events. */
  toolResults: number;
  /** L3: Cached tokens — cacheRead tokens (reused context, not consuming fresh window). */
  cachedTokens: number;
  /** Total context window used (systemPrompt + conversationHistory + toolResults). */
  totalUsed: number;
  /** Estimated context window size (configurable, default 200k for Claude). */
  contextWindowSize: number;
  /** Usage ratio: totalUsed / contextWindowSize. */
  usageRatio: number;
}

export interface CostInsights {
  /** cacheRead / (cacheRead + cacheCreation + input) — higher is better. */
  cacheHitRatio: number;
  /** Per-agent cache hit ratio. */
  cacheHitByAgent: Record<string, number>;

  /** Per-agent compaction frequency. */
  compactionFrequency: Record<string, { count: number; avgIntervalMs: number }>;
  /** Agents compacting more than once per 5 minutes. */
  highPressureAgents: string[];

  /** Files read by multiple agents. */
  duplicateReads: Array<{ file: string; agents: string[]; estimatedWasteTokens: number }>;

  /** Tasks that cost significantly more than average. */
  anomalies: Array<{ agentId: string; taskId: string; costUsd: number; avgCostUsd: number; ratio: number }>;

  /** Model efficiency: success rate and avg cost per model. */
  modelEfficiency: Record<string, { successRate: number; avgCost: number; attempts: number }>;
}

// ── Internal tracking ──────────────────────────────────────────────────────

interface AgentTokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
  costUsd: number;
}

interface CompactionRecord {
  timestamps: number[];
}

interface FileReadRecord {
  readers: Set<string>;
  count: number;
}

interface TaskCostRecord {
  agentId: string;
  taskId: string;
  costUsd: number;
}

const TOKENS_PER_FILE_READ = 500;
const HIGH_PRESSURE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const ANOMALY_RATIO_THRESHOLD = 3; // 3x average = anomaly
const DEFAULT_CONTEXT_WINDOW = 200_000; // 200k tokens for Claude

interface ContextLayerTracking {
  systemPromptEstimate: number;   // estimated from first cache creation
  toolResultTokens: number;        // accumulated from tool.result events
  hasSeenFirstCacheCreation: boolean;
  totalInputSeen: number;          // latest cumulative input token count
}

// ── Analyzer ───────────────────────────────────────────────────────────────

export class TokenAnalyzer {
  private agentTokens = new Map<string, AgentTokens>();
  private compactions = new Map<string, CompactionRecord>();
  private fileReads = new Map<string, FileReadRecord>();
  private taskCosts: TaskCostRecord[] = [];
  private contextTracking = new Map<string, ContextLayerTracking>();
  private contextWindowSize = DEFAULT_CONTEXT_WINDOW;

  /** Process an incoming agent event. */
  onEvent(event: AgentEvent): void {
    const { agentId, type, payload, timestamp } = event;

    // Track token usage from any event with token data
    if (payload) {
      const tokens = this.getOrCreateAgentTokens(agentId);
      // Prefer cumulative fields when present (attached on task.complete / agent.idle).
      // Otherwise accumulate the per-turn delta from the transcript watcher.
      if (typeof payload.inputTokens === 'number') {
        tokens.input = payload.inputTokens as number;
      } else if (typeof payload.inputTokensDelta === 'number') {
        tokens.input += payload.inputTokensDelta as number;
      }
      if (typeof payload.outputTokens === 'number') {
        tokens.output = payload.outputTokens as number;
      } else if (typeof payload.outputTokensDelta === 'number') {
        tokens.output += payload.outputTokensDelta as number;
      }
      if (typeof payload.cacheReadTokensDelta === 'number') tokens.cacheRead += payload.cacheReadTokensDelta as number;
      if (typeof payload.cacheCreationTokensDelta === 'number') tokens.cacheCreation += payload.cacheCreationTokensDelta as number;
      if (typeof payload.costUsd === 'number') tokens.costUsd = payload.costUsd as number;

      // ── Context layer tracking ──
      const ctx = this.getOrCreateContextTracking(agentId);
      // Estimate system prompt from first cache creation (system prompt gets cached on first request)
      if (typeof payload.cacheCreationTokensDelta === 'number' && !ctx.hasSeenFirstCacheCreation) {
        ctx.systemPromptEstimate = payload.cacheCreationTokensDelta as number;
        ctx.hasSeenFirstCacheCreation = true;
      }
      // Track cumulative input tokens (prefer absolute; fall back to accumulating delta)
      if (typeof payload.inputTokens === 'number') {
        ctx.totalInputSeen = payload.inputTokens as number;
      } else if (typeof payload.inputTokensDelta === 'number') {
        ctx.totalInputSeen += payload.inputTokensDelta as number;
      }
    }

    // Track tool result tokens for context layer breakdown
    if (type === 'tool.result' && payload && typeof payload.outputTokens === 'number') {
      const ctx = this.getOrCreateContextTracking(agentId);
      ctx.toolResultTokens += payload.outputTokens as number;
    }

    // Track file reads from tool.call events
    if (type === 'tool.call' && payload?.tool) {
      const tool = String(payload.tool).toLowerCase();
      if (tool === 'read' || tool === 'grep' || tool === 'glob') {
        const file = String(payload.file_path ?? payload.filePath ?? payload.path ?? '');
        if (file) {
          this.recordFileRead(file, agentId);
        }
      }
    }

    // Track file reads from file.read events
    if (type === 'file.read' && payload?.file) {
      this.recordFileRead(String(payload.file), agentId);
    }

    // Track compaction events
    if (type === 'task.progress' && payload?.compaction === true) {
      this.recordCompaction(agentId, timestamp);
      // Compaction resets conversation history (context was truncated)
      const ctx = this.getOrCreateContextTracking(agentId);
      ctx.toolResultTokens = 0;
    }
    // Also catch PostCompact-style events
    if (payload?.hook === 'PostCompact' || payload?.event === 'post_compact') {
      this.recordCompaction(agentId, timestamp);
      const ctx = this.getOrCreateContextTracking(agentId);
      ctx.toolResultTokens = 0;
    }

    // Track task completion costs
    if (type === 'task.complete' && typeof payload?.costUsd === 'number' && payload?.taskId) {
      this.taskCosts.push({
        agentId,
        taskId: String(payload.taskId),
        costUsd: payload.costUsd as number,
      });
    }
  }

  /** Compute current cost insights. */
  getInsights(): CostInsights {
    return {
      cacheHitRatio: this.computeGlobalCacheRatio(),
      cacheHitByAgent: this.computePerAgentCacheRatios(),
      compactionFrequency: this.computeCompactionFrequency(),
      highPressureAgents: this.computeHighPressureAgents(),
      duplicateReads: this.computeDuplicateReads(),
      anomalies: this.computeAnomalies(),
      modelEfficiency: {},  // Populated externally from ModelTierManager
    };
  }

  /** Get actionable text recommendations. */
  getRecommendations(): string[] {
    const recs: string[] = [];
    const insights = this.getInsights();

    // Duplicate read recommendations
    for (const dup of insights.duplicateReads) {
      if (dup.agents.length >= 3) {
        recs.push(`${dup.agents.length} agents read ${dup.file} — consider adding key patterns to shared knowledge`);
      }
    }

    // Low cache hit rate
    for (const [agentId, ratio] of Object.entries(insights.cacheHitByAgent)) {
      if (ratio < 0.12 && this.getAgentTokenTotal(agentId) > 1000) {
        recs.push(`Agent ${agentId} has ${Math.round(ratio * 100)}% cache hit rate — it may be re-reading files unnecessarily`);
      }
    }

    // High compaction pressure
    for (const agentId of insights.highPressureAgents) {
      const freq = insights.compactionFrequency[agentId];
      if (freq) {
        const intervalMin = Math.round(freq.avgIntervalMs / 60_000);
        recs.push(`Agent ${agentId} compacted ${freq.count} times (avg every ${intervalMin}min) — consider splitting the task`);
      }
    }

    // Cost anomalies
    for (const anomaly of insights.anomalies) {
      recs.push(`Task ${anomaly.taskId} cost $${anomaly.costUsd.toFixed(2)} (${anomaly.ratio.toFixed(1)}x average) — review for waste`);
    }

    return recs;
  }

  /** Set the estimated context window size (tokens). */
  setContextWindowSize(size: number): void {
    this.contextWindowSize = size;
  }

  /** Get per-agent context layer breakdown (inspired by MemPalace's L0-L3 stack). */
  getContextLayers(): Record<string, ContextLayerBreakdown> {
    const result: Record<string, ContextLayerBreakdown> = {};
    for (const [agentId, ctx] of this.contextTracking) {
      const tokens = this.agentTokens.get(agentId);
      const systemPrompt = ctx.systemPromptEstimate;
      const toolResults = ctx.toolResultTokens;
      const cachedTokens = tokens?.cacheRead ?? 0;
      // Conversation = total input - system prompt - tool results (clamped to 0)
      const conversationHistory = Math.max(0, ctx.totalInputSeen - systemPrompt - toolResults);
      const totalUsed = systemPrompt + conversationHistory + toolResults;
      // Skip agents with no token data — otherwise panel shows 0% / 0k for every agent forever
      if (totalUsed === 0 && cachedTokens === 0) continue;
      const usageRatio = this.contextWindowSize > 0 ? Math.min(1, totalUsed / this.contextWindowSize) : 0;

      result[agentId] = {
        systemPrompt,
        conversationHistory,
        toolResults,
        cachedTokens,
        totalUsed,
        contextWindowSize: this.contextWindowSize,
        usageRatio,
      };
    }
    return result;
  }

  // ── Private helpers ────────────────────────────────────────────────────

  private getOrCreateContextTracking(agentId: string): ContextLayerTracking {
    let ctx = this.contextTracking.get(agentId);
    if (!ctx) {
      ctx = { systemPromptEstimate: 0, toolResultTokens: 0, hasSeenFirstCacheCreation: false, totalInputSeen: 0 };
      this.contextTracking.set(agentId, ctx);
    }
    return ctx;
  }

  private getOrCreateAgentTokens(agentId: string): AgentTokens {
    let tokens = this.agentTokens.get(agentId);
    if (!tokens) {
      tokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, costUsd: 0 };
      this.agentTokens.set(agentId, tokens);
    }
    return tokens;
  }

  private getAgentTokenTotal(agentId: string): number {
    const t = this.agentTokens.get(agentId);
    if (!t) return 0;
    return t.input + t.cacheRead + t.cacheCreation;
  }

  private recordFileRead(file: string, agentId: string): void {
    const normalized = file.replace(/\\/g, '/').toLowerCase();
    let record = this.fileReads.get(normalized);
    if (!record) {
      record = { readers: new Set(), count: 0 };
      this.fileReads.set(normalized, record);
    }
    record.readers.add(agentId);
    record.count++;
  }

  private recordCompaction(agentId: string, timestamp: number): void {
    let record = this.compactions.get(agentId);
    if (!record) {
      record = { timestamps: [] };
      this.compactions.set(agentId, record);
    }
    record.timestamps.push(timestamp);
  }

  private computeGlobalCacheRatio(): number {
    let totalCacheRead = 0;
    let totalInput = 0;
    let totalCacheCreation = 0;
    for (const t of this.agentTokens.values()) {
      totalCacheRead += t.cacheRead;
      totalInput += t.input;
      totalCacheCreation += t.cacheCreation;
    }
    const total = totalCacheRead + totalCacheCreation + totalInput;
    return total > 0 ? totalCacheRead / total : 0;
  }

  private computePerAgentCacheRatios(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [agentId, t] of this.agentTokens) {
      const total = t.cacheRead + t.cacheCreation + t.input;
      // Skip agents with no actual token activity — otherwise the Costs panel
      // shows 0% forever for every agent that only fired non-token events.
      if (total === 0) continue;
      result[agentId] = t.cacheRead / total;
    }
    return result;
  }

  private computeCompactionFrequency(): Record<string, { count: number; avgIntervalMs: number }> {
    const result: Record<string, { count: number; avgIntervalMs: number }> = {};
    for (const [agentId, record] of this.compactions) {
      const count = record.timestamps.length;
      let avgIntervalMs = 0;
      if (count > 1) {
        const sorted = [...record.timestamps].sort((a, b) => a - b);
        let totalInterval = 0;
        for (let i = 1; i < sorted.length; i++) {
          totalInterval += sorted[i] - sorted[i - 1];
        }
        avgIntervalMs = totalInterval / (count - 1);
      }
      result[agentId] = { count, avgIntervalMs };
    }
    return result;
  }

  private computeHighPressureAgents(): string[] {
    const result: string[] = [];
    for (const [agentId, record] of this.compactions) {
      if (record.timestamps.length < 2) continue;
      const sorted = [...record.timestamps].sort((a, b) => a - b);
      let totalInterval = 0;
      for (let i = 1; i < sorted.length; i++) {
        totalInterval += sorted[i] - sorted[i - 1];
      }
      const avgInterval = totalInterval / (sorted.length - 1);
      if (avgInterval < HIGH_PRESSURE_INTERVAL_MS) {
        result.push(agentId);
      }
    }
    return result;
  }

  private computeDuplicateReads(): Array<{ file: string; agents: string[]; estimatedWasteTokens: number }> {
    const duplicates: Array<{ file: string; agents: string[]; estimatedWasteTokens: number }> = [];
    for (const [file, record] of this.fileReads) {
      if (record.readers.size > 1) {
        const agents = Array.from(record.readers);
        // Waste = (total reads - 1) * tokens per read (first read is not waste)
        const wasteReads = record.count - 1;
        duplicates.push({
          file,
          agents,
          estimatedWasteTokens: wasteReads * TOKENS_PER_FILE_READ,
        });
      }
    }
    // Sort by estimated waste descending
    duplicates.sort((a, b) => b.estimatedWasteTokens - a.estimatedWasteTokens);
    return duplicates;
  }

  private computeAnomalies(): Array<{ agentId: string; taskId: string; costUsd: number; avgCostUsd: number; ratio: number }> {
    if (this.taskCosts.length < 2) return [];
    const totalCost = this.taskCosts.reduce((sum, t) => sum + t.costUsd, 0);
    const avgCost = totalCost / this.taskCosts.length;
    if (avgCost <= 0) return [];

    return this.taskCosts
      .filter((t) => t.costUsd > avgCost * ANOMALY_RATIO_THRESHOLD)
      .map((t) => ({
        agentId: t.agentId,
        taskId: t.taskId,
        costUsd: t.costUsd,
        avgCostUsd: avgCost,
        ratio: t.costUsd / avgCost,
      }))
      .sort((a, b) => b.ratio - a.ratio);
  }
}
