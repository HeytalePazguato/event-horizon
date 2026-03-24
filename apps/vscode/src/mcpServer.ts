/**
 * MCP (Model Context Protocol) server — JSON-RPC 2.0 over HTTP.
 * Exposes coordination tools so AI agents can proactively check/acquire file locks,
 * list other agents, and query file activity — without relying on bash hooks.
 *
 * Mounted at POST /mcp on the existing event server.
 */

import type { AgentStateManager } from '@event-horizon/core';
import type { LockManager } from './lockManager.js';

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
      const norm = filePath.replace(/\\/g, '/').toLowerCase();
      results = results.filter((e) => e.filePath.replace(/\\/g, '/').toLowerCase() === norm);
    }
    return results.slice(-limit).reverse();
  }
}

// ── MCP Server ──────────────────────────────────────────────────────────────

export interface McpServerDeps {
  lockManager: LockManager;
  agentStateManager: AgentStateManager;
  fileActivityTracker: FileActivityTracker;
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
    const { lockManager, agentStateManager, fileActivityTracker } = this.deps;

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
