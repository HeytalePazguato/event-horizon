/**
 * MCP (Model Context Protocol) server — JSON-RPC 2.0 over HTTP.
 * Exposes coordination tools so AI agents can proactively check/acquire file locks,
 * list other agents, and query file activity — without relying on bash hooks.
 *
 * Mounted at POST /mcp on the existing event server.
 */

import type { AgentStateManager } from '@event-horizon/core';
import type { LockManager } from './lockManager.js';
import type { PlanBoardManager } from './planBoard.js';
import type { MessageQueue } from './messageQueue.js';
import type { RoleManager } from './roleManager.js';
import type { AgentProfiler } from './agentProfiler.js';

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
    description: 'Atomically claim an unclaimed task. Fails if already claimed or blocked by dependencies.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task ID from the plan' },
        agent_id: { type: 'string', description: 'Your agent/session ID' },
        agent_name: { type: 'string', description: 'Human-readable agent name' },
        plan_id: { type: 'string', description: 'Plan ID (optional — defaults to the most recently loaded plan)' },
      },
      required: ['task_id', 'agent_id'],
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

        const plan = planBoardManager.loadPlan(markdown, filePath);
        return {
          loaded: true,
          plan_id: plan.id,
          name: plan.name,
          taskCount: plan.tasks.length,
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
        const taskId = args.task_id as string;
        const agentId = args.agent_id as string;
        const agentName = (args.agent_name as string) ?? agentId;
        const planId = args.plan_id as string | undefined;
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
