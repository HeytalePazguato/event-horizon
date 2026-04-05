/**
 * MCP (Model Context Protocol) server — JSON-RPC 2.0 over HTTP.
 * Exposes coordination tools so AI agents can proactively check/acquire file locks,
 * list other agents, and query file activity — without relying on bash hooks.
 *
 * Mounted at POST /mcp on the existing event server.
 */

import type { AgentStateManager, AgentMetrics } from '@event-horizon/core';
import type { LockManager } from './lockManager.js';
import type { PlanBoardManager } from './planBoard.js';
import type { MessageQueue } from './messageQueue.js';
import type { RoleManager } from './roleManager.js';
import type { AgentProfiler } from './agentProfiler.js';
import type { SharedKnowledgeStore } from './sharedKnowledge.js';
import type { SpawnRegistry } from './spawnRegistry.js';
import type { SessionStore } from './sessionStore.js';

// ── JSON-RPC types ──────────────────────────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
  id: number | string | null;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  id: number | string | null;
}

// ── MCP Tool definitions ────────────────────────────────────────────────────

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const MCP_TOOLS: McpToolDef[] = [
  {
    name: 'eh_check_lock',
    description: 'Check if a file is currently locked by another agent. Returns lock status and owner info.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute or relative file path to check' },
        agent_id: { type: 'string', description: 'Your agent/session ID' },
      },
      required: ['file_path', 'agent_id'],
    },
  },
  {
    name: 'eh_acquire_lock',
    description: 'Acquire an exclusive lock on a file. Returns success or failure with owner details.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'File to lock' },
        agent_id: { type: 'string', description: 'Your agent/session ID' },
        agent_name: { type: 'string', description: 'Human-readable agent name' },
        reason: { type: 'string', description: 'Why you need this file (shown to other agents)' },
      },
      required: ['file_path', 'agent_id'],
    },
  },
  {
    name: 'eh_release_lock',
    description: 'Release your lock on a file so other agents can access it.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'File to unlock' },
        agent_id: { type: 'string', description: 'Your agent/session ID' },
      },
      required: ['file_path', 'agent_id'],
    },
  },
  {
    name: 'eh_list_agents',
    description: 'List all AI agents currently connected to Event Horizon. Shows name, type, state, working directory, and active file locks.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Your agent/session ID (for context)' },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'eh_file_activity',
    description: 'Get recent file activity across all agents. Shows which files were read/written, by whom, and when.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Optional: filter to a specific file' },
        limit: { type: 'number', description: 'Max results (default 20)' },
        agent_id: { type: 'string', description: 'Your agent/session ID (for context)' },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'eh_wait_for_unlock',
    description: 'Wait until a file\'s lock is released, then acquire it. Blocks until available (max timeout).',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'File to wait for' },
        agent_id: { type: 'string', description: 'Your agent/session ID' },
        agent_name: { type: 'string', description: 'Human-readable agent name' },
        timeout_seconds: { type: 'number', description: 'Max wait time in seconds (default 30, max 60)' },
      },
      required: ['file_path', 'agent_id'],
    },
  },
  // ── Plan coordination tools ──────────────────────────────────────────────
  {
    name: 'eh_load_plan',
    description: 'Load a plan from a markdown file. Parses task checklist into claimable tasks with dependencies.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to plan markdown file' },
        agent_id: { type: 'string', description: 'Your agent/session ID' },
        content: { type: 'string', description: 'Markdown content of the plan file (alternative to file_path for agents that already read the file)' },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'eh_get_plan',
    description: 'Get a plan by ID, or the most recently loaded plan if no ID given. Returns all tasks with status, assignee, and dependencies.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Your agent/session ID' },
        plan_id: { type: 'string', description: 'Plan ID (optional — defaults to the most recently loaded plan)' },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'eh_list_plans',
    description: 'List all plans with their status, task counts, and progress.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Your agent/session ID' },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'eh_claim_task',
    description: 'Atomically claim a task. If task_id is omitted or empty, auto-selects the best available task using the recommendation algorithm (requires agent_type).',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task ID from the plan (optional — omit to auto-select the best task)' },
        agent_id: { type: 'string', description: 'Your agent/session ID' },
        agent_name: { type: 'string', description: 'Human-readable agent name' },
        agent_type: { type: 'string', description: 'Your agent type (claude-code, opencode, copilot). Required when task_id is omitted for auto-selection.' },
        plan_id: { type: 'string', description: 'Plan ID (optional — defaults to the most recently loaded plan)' },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'eh_update_task',
    description: 'Update a task you own — mark progress, done, or failed. Add notes visible to other agents.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task ID from the plan' },
        agent_id: { type: 'string', description: 'Your agent/session ID' },
        agent_name: { type: 'string', description: 'Human-readable agent name' },
        status: { type: 'string', enum: ['in_progress', 'done', 'failed', 'blocked'], description: 'New task status' },
        note: { type: 'string', description: 'Optional note for other agents' },
        plan_id: { type: 'string', description: 'Plan ID (optional — defaults to the most recently loaded plan)' },
      },
      required: ['task_id', 'agent_id', 'status'],
    },
  },
  {
    name: 'eh_archive_plan',
    description: 'Archive a plan — marks it as archived so it no longer shows as active. Tasks are preserved for reference.',
    inputSchema: {
      type: 'object',
      properties: {
        plan_id: { type: 'string', description: 'Plan ID to archive' },
        agent_id: { type: 'string', description: 'Your agent/session ID' },
      },
      required: ['plan_id', 'agent_id'],
    },
  },
  {
    name: 'eh_delete_plan',
    description: 'Permanently delete a plan and all its tasks.',
    inputSchema: {
      type: 'object',
      properties: {
        plan_id: { type: 'string', description: 'Plan ID to delete' },
        agent_id: { type: 'string', description: 'Your agent/session ID' },
      },
      required: ['plan_id', 'agent_id'],
    },
  },
  // ── Agent messaging tools ────────────────────────────────────────────────
  {
    name: 'eh_send_message',
    description: 'Send a message to another agent or broadcast to all. Messages persist until read.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Your agent ID (sender)' },
        agent_name: { type: 'string', description: 'Human-readable sender name' },
        to_agent_id: { type: 'string', description: 'Target agent ID, or \'*\' for broadcast' },
        message: { type: 'string', description: 'Message content' },
      },
      required: ['agent_id', 'to_agent_id', 'message'],
    },
  },
  {
    name: 'eh_get_messages',
    description: 'Get unread messages for your agent. Messages are marked as read after retrieval.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Your agent/session ID' },
      },
      required: ['agent_id'],
    },
  },
  // ── Role & profiling tools ──────────────────────────────────────────────
  {
    name: 'eh_list_roles',
    description: 'List all available roles and their current agent assignments. Roles define specialized behaviors with associated skills.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Your agent/session ID' },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'eh_assign_role',
    description: 'Assign a default agent type to a role. When tasks with this role are available, the assigned agent type will be recommended.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Your agent/session ID' },
        role_id: { type: 'string', description: 'Role ID to assign (e.g. researcher, planner, implementer)' },
        agent_type: { type: 'string', description: 'Agent type to assign (e.g. claude-code, copilot, opencode)' },
      },
      required: ['agent_id', 'role_id', 'agent_type'],
    },
  },
  {
    name: 'eh_get_agent_profile',
    description: 'Get historical performance profile for an agent type. Shows success rate, average duration, cost, and breakdown by role.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Your agent/session ID' },
        agent_type: { type: 'string', description: 'Agent type to get profile for (e.g. claude-code, copilot)' },
      },
      required: ['agent_id', 'agent_type'],
    },
  },
  {
    name: 'eh_recommend_agent',
    description: 'Get ranked recommendations for which agent type is best suited for a given role, based on historical task performance data.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Your agent/session ID' },
        role_id: { type: 'string', description: 'Role ID to get recommendations for' },
      },
      required: ['agent_id', 'role_id'],
    },
  },

  // ── Phase 1: Retry, recommendations, shared knowledge ─────────────────────

  {
    name: 'eh_retry_task',
    description: 'Retry a failed task: resets it to pending, increments retry count, and un-cascades any dependents that were failed due to this task.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Your agent/session ID' },
        task_id: { type: 'string', description: 'ID of the failed task to retry' },
        plan_id: { type: 'string', description: 'Plan ID (optional, defaults to active plan)' },
      },
      required: ['agent_id', 'task_id'],
    },
  },
  {
    name: 'eh_recommend_task',
    description: 'Get the best available task for you to work on, scored by role match, historical performance, current load, and dependency priority.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Your agent/session ID' },
        agent_name: { type: 'string', description: 'Your display name' },
        agent_type: { type: 'string', description: 'Your agent type (claude-code, opencode, copilot, etc.)' },
        plan_id: { type: 'string', description: 'Plan ID (optional, defaults to active plan)' },
      },
      required: ['agent_id', 'agent_type'],
    },
  },
  {
    name: 'eh_write_shared',
    description: 'Write a knowledge entry to the shared store. All agents can read all entries. Use workspace scope for persistent facts (tech stack, conventions), plan scope for task-specific findings.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Your agent/session ID' },
        agent_name: { type: 'string', description: 'Your display name' },
        key: { type: 'string', description: 'Knowledge key (e.g. "auth-findings", "tech-stack")' },
        value: { type: 'string', description: 'Knowledge value' },
        scope: { type: 'string', enum: ['workspace', 'plan'], description: 'Scope: workspace (persistent) or plan (scoped to active plan). Defaults to plan.' },
        plan_id: { type: 'string', description: 'Plan ID for plan-scoped entries (optional, defaults to active plan)' },
      },
      required: ['agent_id', 'key', 'value'],
    },
  },
  {
    name: 'eh_read_shared',
    description: 'Read shared knowledge entries. Returns merged workspace + active plan entries. Optionally filter by key.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Your agent/session ID' },
        key: { type: 'string', description: 'Specific key to read (optional, omit for all entries)' },
        plan_id: { type: 'string', description: 'Plan ID (optional, defaults to active plan)' },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'eh_get_shared_summary',
    description: 'Get a markdown digest of all shared knowledge, grouped by scope (workspace vs plan) and author. Designed to be injected into agent context.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Your agent/session ID' },
        plan_id: { type: 'string', description: 'Plan ID (optional, defaults to active plan)' },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'eh_delete_shared',
    description: 'Delete a shared knowledge entry. Agents can only delete their own entries.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Your agent/session ID' },
        key: { type: 'string', description: 'Knowledge key to delete' },
        scope: { type: 'string', enum: ['workspace', 'plan'], description: 'Scope of the entry to delete' },
        plan_id: { type: 'string', description: 'Plan ID for plan-scoped entries (optional)' },
      },
      required: ['agent_id', 'key', 'scope'],
    },
  },

  // ── Phase 2: Orchestrator & spawn tools ─────────────────────────────────

  {
    name: 'eh_claim_orchestrator',
    description: 'Claim orchestrator role for a plan. Only succeeds if the current orchestrator is disconnected or unset.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Your agent/session ID' },
        plan_id: { type: 'string', description: 'Plan ID (optional, defaults to active plan)' },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'eh_spawn_agent',
    description: 'Spawn a new AI agent in a VS Code terminal. Orchestrator-only tool.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Your agent/session ID (must be orchestrator)' },
        agent_type: { type: 'string', enum: ['claude-code', 'opencode', 'cursor'], description: 'Type of agent to spawn' },
        role: { type: 'string', description: 'Role to assign (e.g. implementer, tester)' },
        prompt: { type: 'string', description: 'Initial prompt for the agent' },
        cwd: { type: 'string', description: 'Working directory (defaults to workspace root)' },
        model: { type: 'string', description: 'Model to use (agent-specific, e.g. claude-sonnet-4-20250514)' },
        plan_id: { type: 'string', description: 'Plan ID to associate with spawned agent' },
        task_id: { type: 'string', description: 'Task ID for the spawned agent to work on' },
      },
      required: ['agent_id', 'agent_type', 'prompt'],
    },
  },
  {
    name: 'eh_stop_agent',
    description: 'Stop a spawned agent by terminating its terminal. Orchestrator-only tool.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Your agent/session ID (must be orchestrator)' },
        target_agent_id: { type: 'string', description: 'Agent ID to stop' },
      },
      required: ['agent_id', 'target_agent_id'],
    },
  },
  {
    name: 'eh_reassign_task',
    description: 'Reassign a task to a different agent. Resets the task to pending and claims it for the new agent. Orchestrator-only tool.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Your agent/session ID (must be orchestrator)' },
        task_id: { type: 'string', description: 'Task ID to reassign' },
        new_agent_id: { type: 'string', description: 'New agent ID to assign' },
        new_agent_name: { type: 'string', description: 'New agent display name' },
        plan_id: { type: 'string', description: 'Plan ID (optional, defaults to active plan)' },
      },
      required: ['agent_id', 'task_id', 'new_agent_id'],
    },
  },
  {
    name: 'eh_get_team_status',
    description: 'Get a comprehensive team status: all agents, their tasks, load, cost, and plan progress. Orchestrator-only tool.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Your agent/session ID (must be orchestrator)' },
        plan_id: { type: 'string', description: 'Plan ID (optional, defaults to active plan)' },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'eh_auto_assign',
    description: 'Auto-assign all unassigned pending tasks to connected agents using a scoring strategy. Orchestrator-only tool.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Your agent/session ID (must be orchestrator)' },
        plan_id: { type: 'string', description: 'Plan ID (optional, defaults to active plan)' },
        strategy: { type: 'string', enum: ['round-robin', 'least-busy', 'capability-match'], description: 'Assignment strategy (default: capability-match)' },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'eh_get_session',
    description: 'Check if a task has a prior session that can be resumed.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Your agent/session ID' },
        task_id: { type: 'string', description: 'Task ID to check for prior session' },
      },
      required: ['agent_id', 'task_id'],
    },
  },
  {
    name: 'eh_sync_skills',
    description: 'Sync Event Horizon bundled skills to a target agent type skill directory. Orchestrator-only tool.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Your agent/session ID (must be orchestrator)' },
        target_agent_type: { type: 'string', description: 'Agent type to sync skills for (claude-code, opencode)' },
      },
      required: ['agent_id', 'target_agent_type'],
    },
  },
];

// ── File activity tracker ───────────────────────────────────────────────────

export interface FileActivityEntry {
  filePath: string;
  agentId: string;
  agentName: string;
  action: 'read' | 'write' | 'edit';
  timestamp: number;
}

export class FileActivityTracker {
  private entries: FileActivityEntry[] = [];
  private readonly maxEntries: number;

  constructor(maxEntries = 500) {
    this.maxEntries = maxEntries;
  }

  record(entry: FileActivityEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }
  }

  query(filePath?: string, limit = 20): FileActivityEntry[] {
    let results = this.entries;
    if (filePath) {
      const norm = filePath.split('\\').join('/').toLowerCase();
      results = results.filter((e) => e.filePath.split('\\').join('/').toLowerCase() === norm);
    }
    return results.slice(-limit).reverse();
  }
}

// ── MCP Server ──────────────────────────────────────────────────────────────

export interface McpServerDeps {
  lockManager: LockManager;
  agentStateManager: AgentStateManager;
  fileActivityTracker: FileActivityTracker;
  planBoardManager: PlanBoardManager;
  messageQueue: MessageQueue;
  roleManager: RoleManager;
  agentProfiler: AgentProfiler;
  sharedKnowledge: SharedKnowledgeStore;
  getMetrics?: (agentId: string) => AgentMetrics | undefined;
  spawnRegistry?: SpawnRegistry;
  sessionStore?: SessionStore;
  syncSkills?: (agentType: string) => Promise<{ synced: boolean; path?: string; error?: string }>;
}

export class McpServer {
  private deps: McpServerDeps;

  constructor(deps: McpServerDeps) {
    this.deps = deps;
  }

  /** Handle a JSON-RPC request and return a response. */
  async handleRequest(body: unknown): Promise<JsonRpcResponse> {
    const req = body as Partial<JsonRpcRequest>;

    if (req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
      return this.error(req.id ?? null, -32600, 'Invalid JSON-RPC request');
    }

    switch (req.method) {
      case 'initialize':
        return this.handleInitialize(req);
      case 'tools/list':
        return this.handleToolsList(req);
      case 'tools/call':
        return this.handleToolsCall(req);
      default:
        return this.error(req.id ?? null, -32601, `Unknown method: ${req.method}`);
    }
  }

  private handleInitialize(req: Partial<JsonRpcRequest>): JsonRpcResponse {
    return this.success(req.id ?? null, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'event-horizon', version: '2.0.0' },
    });
  }

  private handleToolsList(req: Partial<JsonRpcRequest>): JsonRpcResponse {
    return this.success(req.id ?? null, {
      tools: MCP_TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    });
  }

  private async handleToolsCall(req: Partial<JsonRpcRequest>): Promise<JsonRpcResponse> {
    const params = req.params as { name?: string; arguments?: Record<string, unknown> } | undefined;
    if (!params?.name) {
      return this.error(req.id ?? null, -32602, 'Missing tool name in params');
    }

    const toolName = params.name;
    const args = params.arguments ?? {};

    const toolDef = MCP_TOOLS.find((t) => t.name === toolName);
    if (!toolDef) {
      return this.error(req.id ?? null, -32602, `Unknown tool: ${toolName}`);
    }

    // Validate required params
    const required = (toolDef.inputSchema.required ?? []) as string[];
    for (const key of required) {
      if (args[key] === undefined || args[key] === null || args[key] === '') {
        return this.error(req.id ?? null, -32602, `Missing required parameter: ${key}`);
      }
    }

    try {
      const result = await this.executeTool(toolName, args);
      return this.success(req.id ?? null, {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return this.error(req.id ?? null, -32000, msg);
    }
  }

  private async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const { lockManager, agentStateManager, fileActivityTracker, planBoardManager, messageQueue } = this.deps;

    switch (name) {
      case 'eh_check_lock': {
        const filePath = args.file_path as string;
        const agentId = args.agent_id as string;
        const result = lockManager.query(filePath, agentId);
        return {
          locked: !result.allowed,
          ...(result.allowed ? {} : { owner: result.owner, ownerAgent: result.ownerAgent, reason: result.reason }),
        };
      }

      case 'eh_acquire_lock': {
        const filePath = args.file_path as string;
        const agentId = args.agent_id as string;
        const agentName = (args.agent_name as string) ?? agentId;
        const reason = args.reason as string | undefined;
        const result = lockManager.acquire(filePath, agentId, agentName, reason);
        return {
          acquired: result.allowed,
          ...(result.allowed ? {} : { owner: result.owner, ownerAgent: result.ownerAgent, reason: result.reason }),
        };
      }

      case 'eh_release_lock': {
        const filePath = args.file_path as string;
        const agentId = args.agent_id as string;
        lockManager.release(filePath, agentId);
        return { released: true };
      }

      case 'eh_list_agents': {
        const agents = agentStateManager.getAllAgents();
        const locks = lockManager.getActiveLocks();

        return {
          agents: agents.map((a) => ({
            id: a.id,
            name: a.name,
            type: a.type,
            state: a.state,
            cwd: a.cwd ?? null,
            locks: locks.filter((l) => l.agentId === a.id).map((l) => ({
              file: l.path,
              reason: l.reason,
            })),
          })),
        };
      }

      case 'eh_file_activity': {
        const filePath = args.file_path as string | undefined;
        const limit = typeof args.limit === 'number' ? Math.min(args.limit, 100) : 20;
        const entries = fileActivityTracker.query(filePath, limit);
        return { entries };
      }

      case 'eh_wait_for_unlock': {
        const filePath = args.file_path as string;
        const agentId = args.agent_id as string;
        const agentName = (args.agent_name as string) ?? agentId;
        const timeoutSec = Math.min(typeof args.timeout_seconds === 'number' ? args.timeout_seconds : 30, 60);
        const result = await lockManager.waitForUnlock(filePath, agentId, agentName, timeoutSec * 1000);
        return {
          acquired: result.allowed,
          ...(result.allowed ? {} : { owner: result.owner, ownerAgent: result.ownerAgent, reason: result.reason }),
        };
      }

      // ── Plan coordination tools ────────────────────────────────────────────

      case 'eh_load_plan': {
        const filePath = (args.file_path as string | undefined) ?? 'inline';
        const content = args.content as string | undefined;

        if (!content && !args.file_path) {
          throw new Error('Either file_path or content must be provided');
        }

        const markdown = content ?? '';
        if (!markdown) {
          throw new Error('No content provided. Pass the markdown content in the "content" parameter.');
        }

        const agentId = args.agent_id as string;
        const plan = planBoardManager.loadPlan(markdown, filePath, agentId);
        return {
          loaded: true,
          plan_id: plan.id,
          name: plan.name,
          taskCount: plan.tasks.length,
          orchestrator: plan.orchestratorAgentId,
          tasks: plan.tasks.map((t) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            blockedBy: t.blockedBy,
          })),
        };
      }

      case 'eh_get_plan': {
        const planId = args.plan_id as string | undefined;
        const plan = planBoardManager.getPlan(planId);
        if (!plan) {
          return { loaded: false, message: planId ? `Plan not found: ${planId}` : 'No plan loaded. Use eh_load_plan first.' };
        }
        return {
          loaded: true,
          plan_id: plan.id,
          name: plan.name,
          status: plan.status,
          sourceFile: plan.sourceFile,
          lastUpdatedAt: plan.lastUpdatedAt,
          tasks: plan.tasks.map((t) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            assignee: t.assigneeName ?? t.assignee,
            assigneeId: t.assignee,
            blockedBy: t.blockedBy,
            notes: t.notes,
          })),
        };
      }

      case 'eh_list_plans': {
        const plans = planBoardManager.getAllPlans();
        return {
          plans: plans.map((p) => ({
            plan_id: p.id,
            name: p.name,
            status: p.status,
            sourceFile: p.sourceFile,
            totalTasks: p.tasks.length,
            doneTasks: p.tasks.filter((t) => t.status === 'done').length,
            lastUpdatedAt: p.lastUpdatedAt,
          })),
          count: plans.length,
        };
      }

      case 'eh_claim_task': {
        let taskId = args.task_id as string | undefined;
        const agentId = args.agent_id as string;
        const agentName = (args.agent_name as string) ?? agentId;
        const agentType = args.agent_type as string | undefined;
        const planId = args.plan_id as string | undefined;

        // Auto-select best task when task_id is empty/missing
        if (!taskId || taskId.trim() === '') {
          if (!agentType) {
            throw new Error('agent_type is required when task_id is omitted (for auto-selection)');
          }

          const plan = planBoardManager.getPlan(planId);
          if (!plan) {
            return { claimed: false, error: planId ? `Plan not found: ${planId}` : 'No plan loaded' };
          }

          const { roleManager: rm, agentProfiler: ap } = this.deps;
          const getMetrics = this.deps.getMetrics;

          const available = plan.tasks.filter((t) =>
            t.status === 'pending' && (!t.assignee || t.assignee === agentId),
          );

          if (available.length === 0) {
            return { claimed: false, error: 'No available tasks to claim' };
          }

          // Score each task (same algorithm as eh_recommend_task)
          const scored = available.map((task) => {
            let score = 0;
            const reasons: string[] = [];

            if (task.role) {
              const role = rm.getRole(task.role);
              const assignments = rm.getAllAssignments();
              const assignedType = assignments.find((a) => a.roleId === task.role)?.agentType;
              if (assignedType === agentType) {
                score += 40;
                reasons.push(`Role match: ${task.role}`);
              } else if (role) {
                const taskWords = `${task.title} ${task.description}`.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
                const roleWords = `${role.name} ${role.description}`.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
                const overlap = taskWords.filter((w) => roleWords.includes(w)).length;
                const kwScore = Math.min(overlap * 10, 40);
                score += kwScore;
                if (kwScore > 0) reasons.push(`Keyword match: ${kwScore}%`);
              }
            }

            const profile = ap.getProfile(agentType);
            const byRole = profile?.byRole as Record<string, { successRate?: number }> | undefined;
            if (byRole && task.role && byRole[task.role]) {
              const roleStats = byRole[task.role];
              const successScore = (roleStats.successRate ?? 0) * 30;
              score += successScore;
              if (successScore > 0) reasons.push(`Success rate: ${Math.round((roleStats.successRate ?? 0) * 100)}%`);
            }

            if (getMetrics) {
              const metrics = getMetrics(agentId);
              if (metrics) {
                const loadScore = (1 - metrics.load) * 20;
                score += loadScore;
              }
            }

            const dependentCount = plan.tasks.filter((t) => t.blockedBy.includes(task.id)).length;
            const depScore = Math.min(dependentCount * 5, 10);
            score += depScore;
            if (depScore > 0) reasons.push(`Blocks ${dependentCount} tasks`);

            return { task, score, reasons };
          });

          scored.sort((a, b) => b.score - a.score);
          const best = scored[0];
          taskId = best.task.id;

          const claimResult = planBoardManager.claimTask(taskId, agentId, agentName, planId);
          if (!claimResult.success) {
            return { claimed: false, error: claimResult.error, plan_id: claimResult.planId, task: claimResult.task ? { id: claimResult.task.id, status: claimResult.task.status, assignee: claimResult.task.assigneeName } : undefined };
          }
          return {
            claimed: true,
            auto_selected: true,
            plan_id: claimResult.planId,
            task: { id: claimResult.task!.id, title: claimResult.task!.title, status: claimResult.task!.status },
            recommendation: {
              score: Math.round(best.score),
              reasons: best.reasons,
            },
          };
        }

        const result = planBoardManager.claimTask(taskId, agentId, agentName, planId);
        if (!result.success) {
          return { claimed: false, error: result.error, plan_id: result.planId, task: result.task ? { id: result.task.id, status: result.task.status, assignee: result.task.assigneeName } : undefined };
        }
        return { claimed: true, plan_id: result.planId, task: { id: result.task!.id, title: result.task!.title, status: result.task!.status } };
      }

      case 'eh_update_task': {
        const taskId = args.task_id as string;
        const agentId = args.agent_id as string;
        const agentName = (args.agent_name as string) ?? agentId;
        const status = args.status as string;
        const note = args.note as string | undefined;
        const planId = args.plan_id as string | undefined;

        const validStatuses = ['in_progress', 'done', 'failed', 'blocked'];
        if (!validStatuses.includes(status)) {
          throw new Error(`Invalid status: ${status}. Must be one of: ${validStatuses.join(', ')}`);
        }

        const result = planBoardManager.updateTask(
          taskId, agentId,
          status as 'in_progress' | 'done' | 'failed' | 'blocked',
          note, agentName, planId,
        );
        if (!result.success) {
          return { updated: false, error: result.error, plan_id: result.planId };
        }
        return { updated: true, plan_id: result.planId, task: { id: result.task!.id, title: result.task!.title, status: result.task!.status } };
      }

      case 'eh_archive_plan': {
        const planId = args.plan_id as string;
        const result = planBoardManager.archivePlan(planId);
        if (!result.success) return { archived: false, error: result.error };
        return { archived: true, plan_id: planId };
      }

      case 'eh_delete_plan': {
        const planId = args.plan_id as string;
        const result = planBoardManager.deletePlan(planId);
        if (!result.success) return { deleted: false, error: result.error };
        return { deleted: true, plan_id: planId };
      }

      // ── Agent messaging tools ──────────────────────────────────────────────

      case 'eh_send_message': {
        const agentId = args.agent_id as string;
        const agentName = (args.agent_name as string) ?? agentId;
        const toAgentId = args.to_agent_id as string;
        const message = args.message as string;
        const msg = messageQueue.send(agentId, agentName, toAgentId, message);
        return {
          sent: true,
          messageId: msg.id,
          to: toAgentId === '*' ? 'broadcast' : toAgentId,
        };
      }

      case 'eh_get_messages': {
        const agentId = args.agent_id as string;
        const messages = messageQueue.getUnread(agentId);
        return {
          messages: messages.map((m) => ({
            id: m.id,
            from: m.fromAgentName,
            fromAgentId: m.fromAgentId,
            broadcast: m.toAgentId === '*',
            message: m.message,
            timestamp: m.timestamp,
          })),
          count: messages.length,
        };
      }

      case 'eh_list_roles': {
        const { roleManager } = this.deps;
        return {
          roles: roleManager.getAllRoles(),
          assignments: roleManager.getAllAssignments(),
        };
      }

      case 'eh_assign_role': {
        const roleId = args.role_id as string;
        const agentType = args.agent_type as string;
        const { roleManager } = this.deps;
        try {
          roleManager.assignRole(roleId, agentType, null);
          return { assigned: true, role_id: roleId, agent_type: agentType };
        } catch (e) {
          return { assigned: false, error: (e as Error).message };
        }
      }

      case 'eh_get_agent_profile': {
        const agentType = args.agent_type as string;
        const { agentProfiler } = this.deps;
        const profile = agentProfiler.getProfile(agentType);
        if (!profile) return { error: 'No profile data for this agent type' };
        return profile;
      }

      case 'eh_recommend_agent': {
        const roleId = args.role_id as string;
        const { agentProfiler } = this.deps;
        return { recommendations: agentProfiler.recommendForRole(roleId) };
      }

      // ── Phase 1: Retry, recommendations, shared knowledge ──────────────────

      case 'eh_retry_task': {
        const taskId = args.task_id as string;
        const planId = args.plan_id as string | undefined;
        const result = planBoardManager.retryTask(taskId, planId);
        if (!result.success) {
          return { retried: false, error: result.error };
        }
        return {
          retried: true,
          plan_id: result.planId,
          task: { id: result.task!.id, title: result.task!.title, status: result.task!.status, retryCount: result.task!.retryCount },
          uncascaded: result.uncascaded,
          retryAfterMs: result.retryAfterMs,
        };
      }

      case 'eh_recommend_task': {
        const agentId = args.agent_id as string;
        const agentType = args.agent_type as string;
        const planId = args.plan_id as string | undefined;
        const plan = planBoardManager.getPlan(planId);
        if (!plan) {
          return { recommendation: null, error: 'No plan loaded' };
        }

        const { roleManager: rm, agentProfiler: ap } = this.deps;
        const getMetrics = this.deps.getMetrics;

        // Find available tasks (pending or blocked-but-unblocked)
        const available = plan.tasks.filter((t) =>
          t.status === 'pending' && (!t.assignee || t.assignee === agentId),
        );

        if (available.length === 0) {
          return { recommendation: null, message: 'No available tasks to claim' };
        }

        // Score each task
        const scored = available.map((task) => {
          let score = 0;
          const reasons: string[] = [];

          // 1. Role keyword match (40%)
          if (task.role) {
            const role = rm.getRole(task.role);
            const assignments = rm.getAllAssignments();
            const assignedType = assignments.find((a) => a.roleId === task.role)?.agentType;
            if (assignedType === agentType) {
              score += 40;
              reasons.push(`Role match: ${task.role}`);
            } else if (role) {
              // Keyword matching: check if task title/desc overlaps with role description
              const taskWords = `${task.title} ${task.description}`.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
              const roleWords = `${role.name} ${role.description}`.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
              const overlap = taskWords.filter((w) => roleWords.includes(w)).length;
              const kwScore = Math.min(overlap * 10, 40);
              score += kwScore;
              if (kwScore > 0) reasons.push(`Keyword match: ${kwScore}%`);
            }
          }

          // 2. Profiler success rate (30%)
          const profile = ap.getProfile(agentType);
          const byRole = profile?.byRole as Record<string, { successRate?: number }> | undefined;
          if (byRole && task.role && byRole[task.role]) {
            const roleStats = byRole[task.role];
            const successScore = (roleStats.successRate ?? 0) * 30;
            score += successScore;
            if (successScore > 0) reasons.push(`Success rate: ${Math.round((roleStats.successRate ?? 0) * 100)}%`);
          }

          // 3. Load preference (20% — prefer less busy agents)
          if (getMetrics) {
            const metrics = getMetrics(agentId);
            if (metrics) {
              const loadScore = (1 - metrics.load) * 20;
              score += loadScore;
            }
          }

          // 4. Dependency priority (10% — tasks blocking more downstream work)
          const dependentCount = plan.tasks.filter((t) => t.blockedBy.includes(task.id)).length;
          const depScore = Math.min(dependentCount * 5, 10);
          score += depScore;
          if (depScore > 0) reasons.push(`Blocks ${dependentCount} tasks`);

          return { task, score, reasons };
        });

        scored.sort((a, b) => b.score - a.score);
        const best = scored[0];

        return {
          recommendation: {
            task_id: best.task.id,
            title: best.task.title,
            role: best.task.role,
            score: Math.round(best.score),
            reasons: best.reasons,
          },
          alternatives: scored.slice(1, 4).map((s) => ({
            task_id: s.task.id,
            title: s.task.title,
            score: Math.round(s.score),
          })),
        };
      }

      case 'eh_write_shared': {
        const { sharedKnowledge } = this.deps;
        const agentId = args.agent_id as string;
        const agentName = (args.agent_name as string) ?? agentId;
        const key = args.key as string;
        const value = args.value as string;
        const scope = (args.scope as 'workspace' | 'plan') ?? 'plan';
        const planId = args.plan_id as string | undefined;
        const entry = sharedKnowledge.write(key, value, scope, agentName, agentId, planId);
        return { written: true, key: entry.key, scope: entry.scope, author: entry.author };
      }

      case 'eh_read_shared': {
        const { sharedKnowledge } = this.deps;
        const key = args.key as string | undefined;
        const planId = args.plan_id as string | undefined;
        const entries = sharedKnowledge.read(key, planId);
        return {
          entries: entries.map((e) => ({
            key: e.key,
            value: e.value,
            scope: e.scope,
            author: e.author,
            updatedAt: e.updatedAt,
          })),
          count: entries.length,
        };
      }

      case 'eh_get_shared_summary': {
        const { sharedKnowledge } = this.deps;
        const planId = args.plan_id as string | undefined;
        return { summary: sharedKnowledge.getSummary(planId) };
      }

      case 'eh_delete_shared': {
        const { sharedKnowledge } = this.deps;
        const agentId = args.agent_id as string;
        const key = args.key as string;
        const scope = args.scope as 'workspace' | 'plan';
        const planId = args.plan_id as string | undefined;
        const deleted = sharedKnowledge.delete(key, scope, agentId, planId);
        return { deleted, key, scope };
      }

      // ── Phase 2: Orchestrator & spawn tools ──────────────────────────────

      case 'eh_claim_orchestrator': {
        const agentId = args.agent_id as string;
        const planId = args.plan_id as string | undefined;
        const connectedIds = new Set(this.deps.agentStateManager.getAllAgents().map((a) => a.id));
        const result = planBoardManager.claimOrchestrator(agentId, planId, connectedIds);
        if (!result.success) {
          return { claimed: false, error: result.error };
        }
        return { claimed: true, agent_id: agentId };
      }

      case 'eh_spawn_agent': {
        const agentId = args.agent_id as string;
        if (!planBoardManager.isOrchestrator(agentId)) {
          return { error: 'Only the orchestrator can spawn agents. Use eh_claim_orchestrator first.' };
        }
        const { spawnRegistry } = this.deps;
        if (!spawnRegistry) {
          return { error: 'Spawn registry not available' };
        }
        const agentType = args.agent_type as string;
        const role = args.role as string | undefined;
        const prompt = args.prompt as string;
        const cwd = args.cwd as string | undefined;
        const model = args.model as string | undefined;
        const planId = args.plan_id as string | undefined;
        const taskId = args.task_id as string | undefined;

        // Sync skills before spawning
        if (this.deps.syncSkills) {
          await this.deps.syncSkills(agentType);
        }

        const result = await spawnRegistry.spawn(agentType, { prompt, role, cwd, model, planId, taskId });
        return result;
      }

      case 'eh_stop_agent': {
        const agentId = args.agent_id as string;
        if (!planBoardManager.isOrchestrator(agentId)) {
          return { error: 'Only the orchestrator can stop agents.' };
        }
        const { spawnRegistry } = this.deps;
        if (!spawnRegistry) {
          return { error: 'Spawn registry not available' };
        }
        const targetAgentId = args.target_agent_id as string;
        const result = await spawnRegistry.stop(targetAgentId);
        return result;
      }

      case 'eh_reassign_task': {
        const agentId = args.agent_id as string;
        if (!planBoardManager.isOrchestrator(agentId)) {
          return { error: 'Only the orchestrator can reassign tasks.' };
        }
        const taskId = args.task_id as string;
        const newAgentId = args.new_agent_id as string;
        const newAgentName = (args.new_agent_name as string) ?? newAgentId;
        const planId = args.plan_id as string | undefined;
        const board = planBoardManager.getPlan(planId);
        if (!board) {
          return { reassigned: false, error: planId ? `Plan not found: ${planId}` : 'No plan loaded' };
        }
        const task = board.tasks.find((t) => t.id === taskId);
        if (!task) {
          return { reassigned: false, error: `Task not found: ${taskId}` };
        }
        // Reset task to pending
        task.status = 'pending';
        task.assignee = null;
        task.assigneeName = null;
        task.claimedAt = null;
        board.lastUpdatedAt = Date.now();
        // Re-claim for new agent
        const claimResult = planBoardManager.claimTask(taskId, newAgentId, newAgentName, planId);
        if (!claimResult.success) {
          return { reassigned: false, error: claimResult.error };
        }
        return {
          reassigned: true,
          task: { id: claimResult.task!.id, title: claimResult.task!.title, status: claimResult.task!.status, assignee: newAgentName },
        };
      }

      case 'eh_get_team_status': {
        const agentId = args.agent_id as string;
        if (!planBoardManager.isOrchestrator(agentId)) {
          return { error: 'Only the orchestrator can get team status.' };
        }
        const planId = args.plan_id as string | undefined;
        const agents = this.deps.agentStateManager.getAllAgents();
        const getMetrics = this.deps.getMetrics;

        const agentInfos = agents.map((a) => {
          const m = getMetrics?.(a.id);
          const currentTask = planId
            ? planBoardManager.getPlan(planId)?.tasks.find((t) => t.assignee === a.id && (t.status === 'claimed' || t.status === 'in_progress'))
            : null;
          return {
            id: a.id,
            name: a.name,
            type: a.type,
            state: a.state,
            currentTask: currentTask ? { id: currentTask.id, title: currentTask.title, status: currentTask.status } : null,
            load: m?.load ?? 0,
            cost: m?.estimatedCostUsd ?? 0,
          };
        });

        let planProgress = null;
        const board = planBoardManager.getPlan(planId);
        if (board) {
          const done = board.tasks.filter((t) => t.status === 'done').length;
          planProgress = {
            plan_id: board.id,
            name: board.name,
            done,
            total: board.tasks.length,
            percent: board.tasks.length > 0 ? Math.round((done / board.tasks.length) * 100) : 0,
          };
        }

        return { agents: agentInfos, planProgress };
      }

      case 'eh_auto_assign': {
        const agentId = args.agent_id as string;
        if (!planBoardManager.isOrchestrator(agentId)) {
          return { error: 'Only the orchestrator can auto-assign tasks.' };
        }
        const planId = args.plan_id as string | undefined;
        const strategy = (args.strategy as string) ?? 'capability-match';
        const board = planBoardManager.getPlan(planId);
        if (!board) {
          return { assigned: [], error: planId ? `Plan not found: ${planId}` : 'No plan loaded' };
        }

        const agents = this.deps.agentStateManager.getAllAgents();
        if (agents.length === 0) {
          return { assigned: [], error: 'No agents connected' };
        }

        const pending = board.tasks.filter((t) => t.status === 'pending' && !t.assignee);
        if (pending.length === 0) {
          return { assigned: [], message: 'No unassigned pending tasks' };
        }

        const { roleManager: rm, agentProfiler: ap } = this.deps;
        const getMetrics = this.deps.getMetrics;
        const assignments: Array<{ taskId: string; assignedTo: string; assignedToName: string; reason: string }> = [];
        let agentIndex = 0;

        for (const task of pending) {
          let bestAgent = agents[0];
          let bestScore = -1;
          let bestReason = 'default';

          if (strategy === 'round-robin') {
            bestAgent = agents[agentIndex % agents.length];
            bestReason = 'round-robin';
            agentIndex++;
          } else if (strategy === 'least-busy') {
            let minLoad = Infinity;
            for (const a of agents) {
              const m = getMetrics?.(a.id);
              const load = m?.load ?? 0;
              if (load < minLoad) {
                minLoad = load;
                bestAgent = a;
                bestReason = `least busy (load: ${Math.round(load * 100)}%)`;
              }
            }
          } else {
            // capability-match
            for (const a of agents) {
              let score = 0;
              const reasons: string[] = [];

              if (task.role) {
                const assignments = rm.getAllAssignments();
                const assignedType = assignments.find((asgn) => asgn.roleId === task.role)?.agentType;
                if (assignedType === a.type) {
                  score += 40;
                  reasons.push(`Role match: ${task.role}`);
                }
              }

              const profile = ap.getProfile(a.type);
              const byRole = profile?.byRole as Record<string, { successRate?: number }> | undefined;
              if (byRole && task.role && byRole[task.role]) {
                score += (byRole[task.role].successRate ?? 0) * 30;
              }

              if (getMetrics) {
                const m = getMetrics(a.id);
                if (m) score += (1 - m.load) * 20;
              }

              const depCount = board.tasks.filter((t) => t.blockedBy.includes(task.id)).length;
              score += Math.min(depCount * 5, 10);

              if (score > bestScore) {
                bestScore = score;
                bestAgent = a;
                bestReason = reasons.length > 0 ? reasons.join(', ') : `capability score: ${Math.round(score)}`;
              }
            }
          }

          const result = planBoardManager.claimTask(task.id, bestAgent.id, bestAgent.name, board.id);
          if (result.success) {
            assignments.push({ taskId: task.id, assignedTo: bestAgent.id, assignedToName: bestAgent.name, reason: bestReason });
          }
        }

        return { assigned: assignments, count: assignments.length };
      }

      case 'eh_get_session': {
        const agentId = args.agent_id as string;
        const taskId = args.task_id as string;
        const { sessionStore } = this.deps;
        if (!sessionStore) {
          return { hasSession: false, message: 'Session store not available' };
        }
        const sessionId = sessionStore.get(agentId, taskId);
        return sessionId
          ? { hasSession: true, sessionId }
          : { hasSession: false };
      }

      case 'eh_sync_skills': {
        const agentId = args.agent_id as string;
        if (!planBoardManager.isOrchestrator(agentId)) {
          return { error: 'Only the orchestrator can sync skills.' };
        }
        const targetType = args.target_agent_type as string;
        if (!this.deps.syncSkills) {
          return { error: 'Skill sync not available' };
        }
        const result = await this.deps.syncSkills(targetType);
        return result;
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  private success(id: number | string | null, result: unknown): JsonRpcResponse {
    return { jsonrpc: '2.0', result, id };
  }

  private error(id: number | string | null, code: number, message: string): JsonRpcResponse {
    return { jsonrpc: '2.0', error: { code, message }, id };
  }
}
