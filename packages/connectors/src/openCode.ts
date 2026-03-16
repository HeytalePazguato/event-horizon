/**
 * OpenCode plugin adapter — maps OpenCode plugin events to AgentEvent.
 * @event-horizon/connectors
 */

import type { AgentEvent, AgentEventType } from '@event-horizon/core';

const OPENCODE_TO_EVENT: Record<string, AgentEventType> = {
  // Session lifecycle
  'session.created':           'agent.spawn',
  'session.deleted':           'agent.terminate',
  'session.idle':              'agent.idle',
  'session.error':             'agent.error',
  'session.compacted':         'message.receive',
  'session.updated':           'message.receive',
  'server.instance.disposed':  'agent.terminate',
  'server.connected':          'message.receive',
  // Tool execution
  'tool.execute.before':       'tool.call',
  'tool.execute.after':        'tool.result',
  // Permission (waiting ring)
  'permission.asked':          'agent.waiting',
  'permission.replied':        'message.receive',
  // Question events (waiting ring) — from SSE stream
  'question.asked':            'agent.waiting',
  'question.replied':          'message.receive',
  'question.rejected':         'message.receive',
  // File operations
  'file.edited':               'file.write',
  'file.watcher.updated':      'file.read',
  // Informational
  'command.executed':          'message.receive',
  'lsp.client.diagnostics':   'message.receive',
  'todo.updated':              'message.receive',
};

function nextId(): string {
  return `ev-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Track seen message IDs to deduplicate message.updated events. */
const seenMessageIds = new Set<string>();
const SEEN_IDS_MAX = 10_000;

/** Track subagent session IDs → parent session IDs for remapping. */
const subagentToParent = new Map<string, string>();

/** Track cumulative token usage per agent session. */
interface TokenAccumulator {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  lastMessageId: string | null;
}
const tokenAccumulators = new Map<string, TokenAccumulator>();

/** Get or create token accumulator for an agent session. */
function getTokenAccumulator(agentId: string): TokenAccumulator {
  let acc = tokenAccumulators.get(agentId);
  if (!acc) {
    acc = { inputTokens: 0, outputTokens: 0, costUsd: 0, lastMessageId: null };
    tokenAccumulators.set(agentId, acc);
  }
  return acc;
}

/** Clear token accumulator on session end. */
function clearTokenAccumulator(agentId: string): void {
  tokenAccumulators.delete(agentId);
}

export function mapOpenCodeToEvent(raw: unknown): AgentEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const eventName = o.event ?? o.name;
  if (typeof eventName !== 'string') return null;

  const agentId = String(o.agentId ?? o.sessionId ?? 'opencode-1').slice(0, 128);
  const agentName = String(o.agentName ?? 'OpenCode').slice(0, 64);
  const rawPayload = (o.payload as Record<string, unknown>) ?? (o.data as Record<string, unknown>) ?? {};
  // Shallow copy to avoid mutating the caller's input object
  const payload = { ...rawPayload };

  // Capture working directory for workspace-aware cooperation detection
  const project = (o.project ?? payload.project) as Record<string, unknown> | undefined;
  const worktree = project?.worktree as string | undefined;
  if (worktree) payload.cwd = String(worktree).slice(0, 512);
  // Check top-level cwd field
  if (!payload.cwd && o.cwd) payload.cwd = String(o.cwd).slice(0, 512);
  // Check input.cwd (OpenCode plugin environment variable injection)
  if (!payload.cwd && o.input) {
    const input = o.input as Record<string, unknown>;
    if (input.cwd) payload.cwd = String(input.cwd).slice(0, 512);
  }

  // Capture serverUrl for SSE subagent tracking (passed at top level by plugin)
  if (o.serverUrl && typeof o.serverUrl === 'string') {
    payload.serverUrl = o.serverUrl;
  }

  // Clear dedup set and token accumulator on session end to prevent unbounded growth
  if (eventName === 'session.deleted' || eventName === 'server.instance.disposed') {
    seenMessageIds.clear();
    clearTokenAccumulator(agentId);
  }

  // Detect subagent sessions: session.created with parentID indicates a subagent
  // We track the mapping and remap all events from the subagent to its parent
  const props = (payload.properties as Record<string, unknown>) ?? {};
  const sessionInfo = props.info as Record<string, unknown> | undefined;
  const parentID = sessionInfo?.parentID as string | undefined;
  const sessionID = sessionInfo?.id as string | undefined;
  // projectID is the actual agent ID that Event Horizon uses for the parent planet
  const projectID = sessionInfo?.projectID as string | undefined;

  if (eventName === 'session.created' && parentID && sessionID && projectID) {
    // This is a subagent session — track the mapping to the PROJECT ID (not parent session ID)
    // The projectID is the agent ID that Event Horizon uses for the parent planet
    subagentToParent.set(sessionID, projectID);
    
    // Extract subagent type from title (e.g., "Count 25 seconds (@general subagent)")
    const title = sessionInfo?.title as string | undefined;
    const agentMatch = title?.match(/@(\w+)\s+subagent/i);
    const subagentType = agentMatch?.[1] ?? 'general';
    
    // Emit as task.start with isSubagent=true, targeting the PARENT agent (projectID)
    const enrichedPayload = { ...payload };
    enrichedPayload.isSubagent = true;
    enrichedPayload.subagentId = sessionID;
    enrichedPayload.subagentType = subagentType;
    enrichedPayload.taskId = title?.slice(0, 128);
    
    // Use projectID as the agentId so the moon appears on the parent planet
    return {
      id: nextId(),
      agentId: projectID,
      agentName,
      agentType: 'opencode',
      type: 'task.start',
      timestamp: Date.now(),
      payload: enrichedPayload,
    };
  }

  // Check if this event is from a known subagent session
  const eventSessionID = (props.sessionID as string) ?? sessionID;
  if (eventSessionID && subagentToParent.has(eventSessionID)) {
    const parentAgentId = subagentToParent.get(eventSessionID)!;
    
    // For subagent session events, remap to parent and mark as subagent
    if (eventName === 'session.idle' || eventName === 'session.deleted') {
      // Subagent finished — emit task.complete on parent
      const enrichedPayload = { ...payload };
      enrichedPayload.isSubagent = true;
      enrichedPayload.subagentId = eventSessionID;
      
      // Clean up mapping on session end
      if (eventName === 'session.deleted') {
        subagentToParent.delete(eventSessionID);
      }
      
      return {
        id: nextId(),
        agentId: parentAgentId,
        agentName,
        agentType: 'opencode',
        type: 'task.complete',
        timestamp: Date.now(),
        payload: enrichedPayload,
      };
    }
    
    // Skip other subagent events (they clutter the parent's timeline)
    // The parent will show the subagent as a moon, not individual events
    return null;
  }

  // message.part.updated: detect subagent spawn from subtask parts
  if (eventName === 'message.part.updated') {
    const part = (payload.properties as Record<string, unknown>)?.part as Record<string, unknown> | undefined;
    const partType = part?.type as string | undefined;

    if (partType === 'subtask') {
      // Subagent started
      const enrichedPayload = { ...payload };
      enrichedPayload.isSubagent = true;
      enrichedPayload.subagentId = part?.id as string | undefined;
      enrichedPayload.subagentType = part?.agent as string | undefined;
      enrichedPayload.taskId = (part?.description as string | undefined)?.slice(0, 128);
      enrichedPayload.prompt = (part?.prompt as string | undefined)?.slice(0, 256);
      return { id: nextId(), agentId, agentName, agentType: 'opencode', type: 'task.start', timestamp: Date.now(), payload: enrichedPayload };
    }

    // Tool part with Task tool completion — might indicate subagent finished
    if (partType === 'tool') {
      const toolName = part?.tool as string | undefined;
      const state = part?.state as Record<string, unknown> | undefined;
      const status = state?.status as string | undefined;

      if (toolName === 'Task' && status === 'completed') {
        const enrichedPayload = { ...payload };
        enrichedPayload.isSubagent = true;
        enrichedPayload.subagentId = part?.id as string | undefined;
        return { id: nextId(), agentId, agentName, agentType: 'opencode', type: 'task.complete', timestamp: Date.now(), payload: enrichedPayload };
      }
    }

    // Other part updates — skip (handled by other events)
    return null;
  }

  // message.updated: only create task.start for NEW user messages, task.progress for assistant
  if (eventName === 'message.updated') {
    const info = (payload.properties as Record<string, unknown>)?.info as Record<string, unknown> | undefined;
    const role = info?.role as string | undefined;
    const messageId = info?.id as string | undefined;

    if (role === 'user' && messageId && !seenMessageIds.has(messageId)) {
      // Evict oldest entries if set is too large
      if (seenMessageIds.size >= SEEN_IDS_MAX) {
        const first = seenMessageIds.values().next().value;
        if (first !== undefined) seenMessageIds.delete(first);
      }
      seenMessageIds.add(messageId);
      return { id: nextId(), agentId, agentName, agentType: 'opencode', type: 'task.start', timestamp: Date.now(), payload };
    }
    if (role === 'assistant' && messageId) {
      // Extract and accumulate token/cost data from assistant messages
      // OpenCode's AssistantMessage has: cost (number), tokens ({ input, output, reasoning, cache: { read, write } })
      const enrichedPayload = { ...payload };
      const acc = getTokenAccumulator(agentId);
      
      // Only accumulate if this is a new message (avoid double-counting on updates)
      if (acc.lastMessageId !== messageId) {
        acc.lastMessageId = messageId;
        
        const cost = info?.cost as number | undefined;
        const tokens = info?.tokens as Record<string, unknown> | undefined;
        
        if (typeof cost === 'number') {
          acc.costUsd += cost;
        }
        if (tokens) {
          const inputTokens = (tokens.input as number | undefined) ?? 0;
          const outputTokens = (tokens.output as number | undefined) ?? 0;
          const cacheRead = ((tokens.cache as Record<string, unknown>)?.read as number | undefined) ?? 0;
          const cacheWrite = ((tokens.cache as Record<string, unknown>)?.write as number | undefined) ?? 0;
          // Include cache tokens in input count for consistency with Claude Code
          acc.inputTokens += inputTokens + cacheRead + cacheWrite;
          acc.outputTokens += outputTokens;
        }
      }
      
      // Always emit cumulative totals
      enrichedPayload.inputTokens = acc.inputTokens;
      enrichedPayload.outputTokens = acc.outputTokens;
      enrichedPayload.costUsd = acc.costUsd;
      
      return { id: nextId(), agentId, agentName, agentType: 'opencode', type: 'task.progress', timestamp: Date.now(), payload: enrichedPayload };
    }
    // Duplicate user message or unknown role — skip
    return null;
  }

  // session.status: map busy→task.progress, idle→agent.idle
  if (eventName === 'session.status') {
    const statusType = (payload.properties as Record<string, unknown>)?.status as Record<string, unknown> | undefined;
    const sType = statusType?.type as string | undefined;
    if (sType === 'busy') {
      return { id: nextId(), agentId, agentName, agentType: 'opencode', type: 'task.progress', timestamp: Date.now(), payload };
    }
    if (sType === 'idle') {
      return { id: nextId(), agentId, agentName, agentType: 'opencode', type: 'task.complete', timestamp: Date.now(), payload };
    }
    return null;
  }

  // Extract token/cost data from session or message events if present
  const tokenProps = (payload.properties as Record<string, unknown>) ?? {};
  const usage = (payload.usage as Record<string, unknown>) ?? (tokenProps.usage as Record<string, unknown>) ?? {};
  const tokenInput = (usage.input_tokens as number) ?? (usage.inputTokens as number)
    ?? (payload.input_tokens as number) ?? (payload.inputTokens as number);
  const tokenOutput = (usage.output_tokens as number) ?? (usage.outputTokens as number)
    ?? (payload.output_tokens as number) ?? (payload.outputTokens as number);
  const costUsd = (usage.total_cost_usd as number) ?? (usage.costUsd as number)
    ?? (payload.total_cost_usd as number) ?? (payload.costUsd as number);
  if (typeof tokenInput === 'number') payload.inputTokens = tokenInput;
  if (typeof tokenOutput === 'number') payload.outputTokens = tokenOutput;
  if (typeof costUsd === 'number') payload.costUsd = costUsd;

  const type = OPENCODE_TO_EVENT[eventName] ?? (eventName.startsWith('tool.') ? 'tool.call' : null);
  if (!type) return null;

  // Extract toolName from OpenCode's event structure or from dedicated hook payload
  const enrichedPayload = { ...payload };
  if (type === 'tool.call' || type === 'tool.result') {
    const toolName = (payload.toolName as string)
      ?? (payload.tool as string)
      ?? ((payload.properties as Record<string, unknown>)?.tool as string)
      ?? undefined;
    if (toolName) enrichedPayload.toolName = toolName;
    // Extract filePath from tool input
    const input = (payload.input as Record<string, unknown>) ?? (payload.properties as Record<string, unknown>) ?? {};
    const fpTool = (input.file_path as string) ?? (input.path as string) ?? (input.filePath as string);
    if (typeof fpTool === 'string') enrichedPayload.filePath = fpTool.slice(0, 512);

    // Detect skill tool invocation — OpenCode uses a native 'skill' tool
    const toolNameLower = typeof toolName === 'string' ? toolName.toLowerCase() : '';
    if (toolNameLower === 'skill') {
      enrichedPayload.isSkill = true;
      const skillName = (input.name as string) ?? (input.skill as string);
      if (typeof skillName === 'string') enrichedPayload.skillName = skillName.slice(0, 128);
    }
  }

  // Extract filePath for file.write / file.read events
  if (type === 'file.write' || type === 'file.read') {
    const props = (payload.properties as Record<string, unknown>) ?? {};
    const fpFile = (props.path as string) ?? (props.filePath as string) ?? (payload.path as string);
    if (typeof fpFile === 'string') enrichedPayload.filePath = fpFile.slice(0, 512);
  }

  return {
    id: nextId(),
    agentId,
    agentName,
    agentType: 'opencode',
    type,
    timestamp: Number(o.timestamp) || Date.now(),
    payload: enrichedPayload,
  };
}
