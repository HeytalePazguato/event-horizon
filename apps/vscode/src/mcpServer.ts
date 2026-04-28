/**
 * MCP (Model Context Protocol) server — JSON-RPC 2.0 over HTTP.
 * Exposes coordination tools so AI agents can proactively check/acquire file locks,
 * list other agents, and query file activity — without relying on bash hooks.
 *
 * Mounted at POST /mcp on the existing event server.
 */

import type { AgentStateManager, AgentMetrics, AgentEvent } from '@event-horizon/core';
import type { LockManager } from './lockManager.js';
import type { PlanBoardManager } from './planBoard.js';
import type { MessageQueue } from './messageQueue.js';
import type { RoleManager } from './roleManager.js';
import type { AgentProfiler } from './agentProfiler.js';
import type { SharedKnowledgeStore } from './sharedKnowledge.js';
import type { SpawnRegistry } from './spawnRegistry.js';
import type { SessionStore } from './sessionStore.js';
import type { HeartbeatManager } from './heartbeatManager.js';
import type { WorktreeManager } from './worktreeManager.js';
import type { BudgetManager } from './budgetManager.js';
import type { TraceStore, SpanType } from './traceStore.js';
import type { ModelTierManager } from './modelTierManager.js';
import type { TokenAnalyzer } from './tokenAnalyzer.js';
import type { ProjectGraphStore, ProjectGraphLifecycle, GraphNodeType, RelationType } from './projectGraph/index.js';
import type { ProjectGraphScanner } from './projectGraph/scanner.js';
import type { GraphQueryEngine } from './projectGraph/queryEngine.js';
import { exec } from 'child_process';
import { createHash } from 'crypto';

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
    name: 'eh_verify_task',
    description: 'Run the verify command for a completed task and update its verification status. Returns exit code, output, and pass/fail result.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Your agent/session ID' },
        task_id: { type: 'string', description: 'Task ID to verify (must be in done status)' },
        plan_id: { type: 'string', description: 'Plan ID (optional, defaults to active plan)' },
      },
      required: ['agent_id', 'task_id'],
    },
  },
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
    description: 'Get the best available task for an agent to work on, scored by role match, historical performance, current load, and dependency priority. The agent_type must be a runtime type (claude-code, opencode, copilot, cursor), NOT a role name.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'The agent ID to get recommendations for' },
        agent_name: { type: 'string', description: 'Agent display name' },
        agent_type: { type: 'string', description: 'REQUIRED. Agent runtime type: claude-code, opencode, copilot, or cursor. NOT a role name like "implementer".' },
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
        valid_until: { type: 'string', description: 'Expiration timestamp (ISO 8601 string or epoch ms). Entry will be excluded from reads after this time. Omit for no expiration.' },
        tier: { type: 'string', enum: ['L0', 'L1', 'L2'], description: 'MemPalace loading tier. L0 = critical identity (~50-100 tok), L1 = essentials (workspace default, ~500-800 tok), L2 = on-demand (plan default). Use L0 sparingly — every L0 entry costs tokens in every agent session.' },
      },
      required: ['agent_id', 'key', 'value'],
    },
  },
  {
    name: 'eh_read_shared',
    description: 'Read shared knowledge entries. Returns merged workspace + active plan entries. By default excludes expired entries.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Your agent/session ID' },
        key: { type: 'string', description: 'Specific key to read (optional, omit for all entries)' },
        plan_id: { type: 'string', description: 'Plan ID (optional, defaults to active plan)' },
        include_expired: { type: 'boolean', description: 'Include expired entries (default: false)' },
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
    description: 'Spawn a new AI agent in a VS Code terminal. Orchestrator-only. prompt is REQUIRED. agent_type is OPTIONAL — when omitted, the server defaults to the orchestrator\'s own runtime (an OpenCode orchestrator gets OpenCode workers, a Claude orchestrator gets Claude workers). Only pass agent_type to override that default (e.g. user specified --agent opencode, or a task has [agent: opencode] metadata).',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'YOUR agent/session ID (the orchestrator calling this tool)' },
        agent_type: { type: 'string', enum: ['claude-code', 'opencode', 'cursor'], description: 'OPTIONAL. Runtime to spawn (claude-code, opencode, cursor). When omitted, the server defaults to the orchestrator\'s own runtime — which is what you want in 90% of cases. Only set this when the user explicitly overrides with --agent, or a task has [agent: X] metadata.' },
        role: { type: 'string', description: 'Role to assign (e.g. implementer, tester, reviewer). Determines instructions and skills sent to the agent.' },
        prompt: { type: 'string', description: 'REQUIRED. Detailed instruction for the agent. Must tell it what task to work on and how. Example: "You are assigned task 1.1 (Build auth module). Run /eh:work-on-plan to claim and implement it. The plan is already loaded."' },
        cwd: { type: 'string', description: 'Working directory (defaults to workspace root)' },
        model: { type: 'string', description: 'Model override (e.g. claude-sonnet-4-20250514). Optional — defaults to the CLI default.' },
        plan_id: { type: 'string', description: 'Plan ID to associate with the spawned agent' },
        task_id: { type: 'string', description: 'Task ID the agent should work on' },
        interactive: { type: 'boolean', description: 'When true, spawn in interactive REPL mode so the user can type follow-up prompts. Default false (batch -p mode, correct for orchestrated work).' },
      },
      required: ['agent_id', 'prompt'],
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
    name: 'eh_stop_all_workers',
    description: 'Kill every spawned worker agent — used to abort a plan cleanly. Returns a summary of what was killed and any that may still be running. Orchestrator-only.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Your agent/session ID (must be orchestrator)' },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'eh_purge_stale_agents',
    description: 'Remove stale/lost agents from the dashboard. Agents with no heartbeat for >5 minutes (and no running process) are terminated. Returns the list of purged agent IDs.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Your agent/session ID (for context)' },
      },
      required: ['agent_id'],
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
        strategy: { type: 'string', enum: ['round-robin', 'least-busy', 'capability-match', 'dependency-first'], description: 'Assignment strategy. If omitted, uses the plan\'s configured strategy (or capability-match as fallback).' },
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
    description: 'Manually sync Event Horizon skills to an agent type skill directory. Rarely needed — skills sync automatically when spawning agents. Only call this if you suspect skills are out of date.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Your agent/session ID (must be orchestrator)' },
        target_agent_type: { type: 'string', description: 'REQUIRED. Agent runtime type to sync skills for: claude-code, opencode, or cursor.' },
      },
      required: ['agent_id', 'target_agent_type'],
    },
  },

  // ── Phase 3: Heartbeat, worktree, budget tools ────────��─────────────────

  {
    name: 'eh_heartbeat',
    description: 'Report alive status. Call periodically to prevent being marked as stale or lost.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Your agent/session ID' },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'eh_create_worktree',
    description: 'Create a git worktree for workspace isolation. Orchestrator-only tool.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Your agent/session ID (must be orchestrator)' },
        target_agent_id: { type: 'string', description: 'Agent ID that will use the worktree' },
        task_id: { type: 'string', description: 'Task ID for the worktree branch name' },
        cwd: { type: 'string', description: 'Working directory (git repo root)' },
      },
      required: ['agent_id', 'target_agent_id', 'task_id'],
    },
  },
  {
    name: 'eh_remove_worktree',
    description: 'Remove a git worktree. Optionally merge the branch first. Orchestrator-only tool.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Your agent/session ID (must be orchestrator)' },
        target_agent_id: { type: 'string', description: 'Agent ID whose worktree to remove' },
        task_id: { type: 'string', description: 'Task ID of the worktree' },
        cwd: { type: 'string', description: 'Working directory (git repo root)' },
        merge: { type: 'boolean', description: 'Whether to merge the branch before removing (default false)' },
      },
      required: ['agent_id', 'target_agent_id', 'task_id'],
    },
  },
  {
    name: 'eh_get_budget',
    description: 'Get remaining budget for a plan, including per-agent cost breakdown.',
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
    name: 'eh_request_budget_increase',
    description: 'Request a budget increase from the user. Shows a VS Code notification with Yes/No.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Your agent/session ID' },
        plan_id: { type: 'string', description: 'Plan ID' },
        requested_amount_usd: { type: 'number', description: 'New budget limit requested (USD)' },
        reason: { type: 'string', description: 'Why the increase is needed' },
      },
      required: ['agent_id', 'plan_id', 'requested_amount_usd'],
    },
  },

  // ── Phase 4: Observability tools ──────────────────────────────────────────

  {
    name: 'eh_get_traces',
    description: 'Get structured trace spans for agent activity. Returns spans with timing, type, and metadata, plus aggregate time distribution.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Your agent/session ID' },
        filter_agent_id: { type: 'string', description: 'Filter spans by agent ID (optional)' },
        span_type: { type: 'string', description: 'Filter by span type: tool_call, task, agent_session, hook, llm_call (optional)' },
        limit: { type: 'number', description: 'Max spans to return (default 50)' },
      },
      required: ['agent_id'],
    },
  },

  // ── Cost insights ─────────────────────────────────────────────────────────

  {
    name: 'eh_get_cost_insights',
    description: 'Get token usage insights: cache efficiency, compaction pressure, duplicate reads, cost anomalies, and actionable recommendations.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Your agent/session ID' },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'eh_search_events',
    description: 'Full-text search over persisted events. Applies MemPalace-style query sanitization to handle long or malformed input. Returns matching events with payload.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Your agent/session ID' },
        query: { type: 'string', description: 'Search query (will be sanitized — long/malformed queries are auto-truncated)' },
        agent_id_filter: { type: 'string', description: 'Filter results to a specific agent ID (optional)' },
        type: { type: 'string', description: 'Filter by event type (e.g. "tool.call", "agent.spawn")' },
        since: { type: 'number', description: 'Filter to events after this timestamp (epoch ms)' },
        limit: { type: 'number', description: 'Max results to return (default 50)' },
      },
      required: ['agent_id', 'query'],
    },
  },
  {
    name: 'eh_extract_concepts',
    description: 'Add INFERRED nodes/edges to the project graph from agent analysis. The agent runs the extraction (e.g. parses a doc and identifies concepts) and supplies the structured result; EH never makes outbound model calls. Gated by eventHorizon.projectGraph.allowAgentLLMExtraction setting. Call only when the user has asked you to enrich the project graph.',
    inputSchema: {
      type: 'object',
      properties: {
        source_file: { type: 'string', description: 'Required. The file the concepts were extracted from.' },
        nodes: {
          type: 'array',
          description: 'Concept nodes to add. Each requires: label (string), type (string — typically "concept"), confidence (number 0-1), and optional properties (object).',
          items: {
            type: 'object',
            required: ['label', 'type', 'confidence'],
            properties: {
              label: { type: 'string' },
              type: { type: 'string' },
              confidence: { type: 'number' },
              properties: { type: 'object' },
              sourceLocation: { type: 'string' },
            },
          },
        },
        edges: {
          type: 'array',
          description: 'Edges between submitted nodes (referenced by label). Each requires: sourceLabel, targetLabel, relationType, confidence.',
          items: {
            type: 'object',
            required: ['sourceLabel', 'targetLabel', 'relationType', 'confidence'],
            properties: {
              sourceLabel: { type: 'string' },
              targetLabel: { type: 'string' },
              relationType: { type: 'string' },
              confidence: { type: 'number' },
            },
          },
        },
        confidence_floor: { type: 'number', description: 'Drop entries below this confidence. Default 0.5.' },
      },
      required: ['source_file', 'nodes'],
    },
  },
  {
    name: 'eh_build_graph',
    description: 'Trigger a workspace scan to build or refresh the project knowledge graph. Call this only when the user has explicitly invoked /eh:optimize-context or otherwise asked you to (re)build the graph. Returns scan stats (filesProcessed, filesSkipped, nodesCreated, edgesCreated, durationMs).',
    inputSchema: {
      type: 'object',
      properties: {
        force: {
          type: 'boolean',
          description: 'When true, ignore the per-file SHA256 hash and rescan every file. Default false.'
        }
      },
      required: []
    }
  },
  {
    name: 'eh_query_graph',
    description: 'Query the project knowledge graph. Pick an op: search (FTS by query), callers (incoming calls edges), callees (outgoing calls edges), neighbors (1-hop), path (shortest path between two nodes), explain (full detail of a node), recent_activity (agents who touched a file recently). Returns structured graph data.',
    inputSchema: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['search', 'callers', 'callees', 'neighbors', 'path', 'explain', 'recent_activity'] },
        query: { type: 'string' },
        node_id: { type: 'string' },
        source_id: { type: 'string' },
        target_id: { type: 'string' },
        file_path: { type: 'string' },
        since_ms: { type: 'number' },
        depth: { type: 'number' },
        type: { type: 'string' },
        tag: { type: 'string', enum: ['EXTRACTED', 'INFERRED', 'AMBIGUOUS'] },
        limit: { type: 'number' },
        relation_types: { type: 'array', items: { type: 'string' } },
        direction: { type: 'string', enum: ['in', 'out', 'both'] },
      },
      required: ['op'],
    },
  },
  {
    name: 'eh_curate_context',
    description: 'Given a task description, return a token-budgeted slice of the project knowledge graph (code, docs, recent agent activity, knowledge entries) that is most relevant to that task. Use this BEFORE reading raw files. Requires a built project graph; if absent, returns a hint to invoke /eh:optimize-context.',
    inputSchema: {
      type: 'object',
      properties: {
        task_description: { type: 'string' },
        token_budget: { type: 'number', description: 'Approximate token cap for the returned subgraph. Default 4000.' },
        seed_files: { type: 'array', items: { type: 'string' }, description: 'Optional explicit anchor files to seed expansion.' },
        include_activity: { type: 'boolean', description: 'Include recent agent activity nodes (last 7 days). Default true.' },
        include_knowledge: { type: 'boolean', description: 'Include shared-knowledge nodes referencing seeds. Default true.' },
      },
      required: ['task_description'],
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
  heartbeatManager?: HeartbeatManager;
  worktreeManager?: WorktreeManager;
  budgetManager?: BudgetManager;
  showBudgetRequest?: (planId: string, currentLimit: number, requestedAmount: number, reason: string) => Promise<boolean>;
  traceStore?: TraceStore;
  workspaceRoot?: string;
  modelTierManager?: ModelTierManager;
  tokenAnalyzer?: TokenAnalyzer;
  eventSearch?: { search: (query: string, opts?: { agentId?: string; type?: string; since?: number; limit?: number }) => unknown[] };
  projectGraphStore?: ProjectGraphStore;
  projectGraphLifecycle?: ProjectGraphLifecycle;
  projectGraphScanner?: ProjectGraphScanner;
  projectGraphQueryEngine?: GraphQueryEngine;
  isAgentExtractionEnabled?: () => boolean;
  /** Callback to inject events into the main event pipeline (for synthetic terminate, etc.). */
  onEvent?: (event: AgentEvent) => void;
}

export class McpServer {
  private deps: McpServerDeps;

  constructor(deps: McpServerDeps) {
    this.deps = deps;
  }

  /** Wire the event search engine after the DB is initialized (called from extension.ts). */
  setEventSearch(eventSearch: McpServerDeps['eventSearch']): void {
    this.deps.eventSearch = eventSearch;
  }

  setProjectGraphStore(store: ProjectGraphStore): void {
    this.deps.projectGraphStore = store;
  }

  /**
   * Wire the per-project graph lifecycle. Once set, all graph MCP handlers
   * resolve the active store via `lifecycle.getActiveStore()` at call time
   * instead of using a fixed reference, so workspace-folder swaps land
   * automatically.
   */
  setProjectGraphLifecycle(lifecycle: ProjectGraphLifecycle): void {
    this.deps.projectGraphLifecycle = lifecycle;
  }

  /**
   * Resolve the currently-active project graph store. Prefers the lifecycle
   * (per-workspace `<folder>/.eh/graph.db`) when wired; falls back to a
   * direct store reference for legacy callers and tests. Returns `null`
   * when no workspace folder is open.
   */
  private getActiveGraphStore(): ProjectGraphStore | null {
    if (this.deps.projectGraphLifecycle) {
      return this.deps.projectGraphLifecycle.getActiveStore();
    }
    return this.deps.projectGraphStore ?? null;
  }

  setProjectGraphScanner(scanner: ProjectGraphScanner): void {
    this.deps.projectGraphScanner = scanner;
  }

  setProjectGraphQueryEngine(engine: GraphQueryEngine): void {
    this.deps.projectGraphQueryEngine = engine;
  }

  setOnEvent(onEvent: (event: AgentEvent) => void): void {
    this.deps.onEvent = onEvent;
  }

  /**
   * Resolve an agent_id from an MCP tool call to a known agent in AgentStateManager.
   *
   * MCP tools ask the AI model to supply `agent_id`, but hook-connected agents
   * (not spawned by EH) don't know their own session_id. The model typically
   * guesses something like "claude-code" or a random string. This helper:
   *   1. Returns the ID as-is if it matches a known agent.
   *   2. Tries to find a known agent whose ID starts with the given prefix
   *      (e.g. "claude" matches "claude-code-abc123").
   *   3. Falls back to the original ID if no match.
   */
  private resolveAgentId(rawId: string): string {
    // Exact match
    if (this.deps.agentStateManager.getAgent(rawId)) return rawId;

    // Prefix / substring match — pick the most recently active agent
    const agents = this.deps.agentStateManager.getAllAgents();
    const lower = rawId.toLowerCase().replace(/[-_\s]/g, '');

    // Try prefix match on agent ID or type
    const candidates = agents.filter((a) => {
      const idNorm = a.id.toLowerCase().replace(/[-_\s]/g, '');
      const typeNorm = a.type.toLowerCase().replace(/[-_\s]/g, '');
      return idNorm.startsWith(lower) || typeNorm.startsWith(lower) || lower.startsWith(typeNorm);
    });

    if (candidates.length === 1) return candidates[0].id;
    if (candidates.length > 1) {
      // Multiple matches — prefer the one with a heartbeat
      const hb = this.deps.heartbeatManager;
      if (hb) {
        const alive = candidates.filter((a) => hb.getStatus(a.id) === 'alive');
        if (alive.length === 1) return alive[0].id;
      }
      // Just pick the first one
      return candidates[0].id;
    }

    return rawId; // No match — return as-is
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
      serverInfo: { name: 'Event Horizon', version: '2.0.0' },
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

        // Auto-assign orchestrator role to the agent that loaded the plan
        if (agentId) {
          const agent = this.deps.agentStateManager.getAgent(agentId);
          const agentType = agent?.type ?? null;
          try { this.deps.roleManager.assignRole('orchestrator', agentType, agentId); } catch { /* role may not exist */ }
        }

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
            acceptanceCriteria: t.acceptanceCriteria ?? null,
            verifyCommand: t.verifyCommand ?? null,
            complexity: t.complexity ?? null,
            modelTier: t.modelTier ?? null,
            verificationStatus: t.verificationStatus ?? null,
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

        // Opportunistically link this session UUID to a recent unlinked spawn
        // so eh_stop_agent(sessionId) can find the underlying process later.
        const { spawnRegistry: sr } = this.deps;
        if (sr && !sr.getSpawnIdForSession(agentId)) {
          sr.linkSession(agentId);
        }

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

      // ── Verification ──────────────────────────────────────────────────────

      case 'eh_verify_task': {
        const taskId = args.task_id as string;
        const planId = args.plan_id as string | undefined;
        const plan = planBoardManager.getPlan(planId);
        if (!plan) {
          return { verified: false, error: planId ? `Plan not found: ${planId}` : 'No plan loaded' };
        }
        const task = plan.tasks.find((t) => t.id === taskId);
        if (!task) {
          return { verified: false, error: `Task not found: ${taskId}` };
        }
        if (task.status !== 'done') {
          return { verified: false, error: `Task is not done (status: ${task.status}). Only done tasks can be verified.` };
        }
        if (!task.verifyCommand) {
          // No verify command — mark as passed by default
          task.verificationStatus = 'passed';
          plan.lastUpdatedAt = Date.now();
          return { verified: true, exitCode: 0, output: 'No verify command defined — auto-passed.', verificationStatus: 'passed' };
        }

        // Execute verify command
        const cwd = this.deps.workspaceRoot ?? process.cwd();
        try {
          const result = await new Promise<{ exitCode: number; output: string }>((resolve) => {
            exec(task.verifyCommand!, { cwd, timeout: 60_000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
              const output = ((stdout ?? '') + (stderr ? `\n--- stderr ---\n${stderr}` : '')).slice(0, 2000);
              if (error) {
                resolve({ exitCode: error.code ?? 1, output });
              } else {
                resolve({ exitCode: 0, output });
              }
            });
          });

          const mtm = this.deps.modelTierManager;
          if (result.exitCode === 0) {
            task.verificationStatus = 'passed';
            plan.lastUpdatedAt = Date.now();
            if (mtm && task.modelTier && task.role && task.complexity) {
              mtm.recordAttempt(task.modelTier, task.role, task.complexity, true, 0);
            }
            return { verified: true, exitCode: 0, output: result.output, verificationStatus: 'passed' };
          } else {
            task.verificationStatus = 'failed';
            const agentId = args.agent_id as string;
            task.notes.push({
              agentId,
              agentName: agentId,
              text: `Verification failed (exit ${result.exitCode}): ${result.output.slice(0, 500)}`,
              ts: Date.now(),
            });
            plan.lastUpdatedAt = Date.now();
            if (mtm && task.modelTier && task.role && task.complexity) {
              mtm.recordAttempt(task.modelTier, task.role, task.complexity, false, 0);
            }
            return { verified: false, exitCode: result.exitCode, output: result.output, verificationStatus: 'failed' };
          }
        } catch (err) {
          task.verificationStatus = 'failed';
          plan.lastUpdatedAt = Date.now();
          return { verified: false, exitCode: -1, output: `Execution error: ${String(err)}`.slice(0, 2000), verificationStatus: 'failed' };
        }
      }

      // ── Phase 1: Retry, recommendations, shared knowledge ──────────────────

      case 'eh_retry_task': {
        const taskId = args.task_id as string;
        const planId = args.plan_id as string | undefined;
        const result = planBoardManager.retryTask(taskId, planId);
        if (!result.success) {
          return { retried: false, error: result.error };
        }

        // Escalate model tier if ModelTierManager is available
        const task = result.task!;
        let escalatedModel: string | null = null;
        const mtm = this.deps.modelTierManager;
        if (mtm && task.modelTier) {
          const nextTier = mtm.getNextTier(task.modelTier);
          if (nextTier) {
            task.modelTier = nextTier;
            escalatedModel = nextTier;
          }
        }
        // Reset verification status for the retried task
        task.verificationStatus = null;

        return {
          retried: true,
          plan_id: result.planId,
          task: { id: task.id, title: task.title, status: task.status, retryCount: task.retryCount, modelTier: task.modelTier },
          uncascaded: result.uncascaded,
          retryAfterMs: result.retryAfterMs,
          escalatedModel,
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
        // Parse valid_until — accept ISO 8601 string or epoch ms
        let validUntil: number | undefined;
        if (args.valid_until) {
          const raw = args.valid_until as string;
          const parsed = Number(raw);
          validUntil = Number.isFinite(parsed) ? parsed : new Date(raw).getTime();
          if (!Number.isFinite(validUntil)) validUntil = undefined;
        }
        const tier = (args.tier === 'L0' || args.tier === 'L1' || args.tier === 'L2') ? args.tier : undefined;
        const entry = sharedKnowledge.write(key, value, scope, agentName, agentId, planId, validUntil, tier);
        return { written: true, key: entry.key, scope: entry.scope, author: entry.author, validUntil: entry.validUntil, tier: entry.tier };
      }

      case 'eh_read_shared': {
        const { sharedKnowledge } = this.deps;
        const key = args.key as string | undefined;
        const planId = args.plan_id as string | undefined;
        const includeExpired = args.include_expired === true;
        const entries = sharedKnowledge.read(key, planId, includeExpired);
        return {
          entries: entries.map((e) => ({
            key: e.key,
            value: e.value,
            scope: e.scope,
            author: e.author,
            updatedAt: e.updatedAt,
            validUntil: e.validUntil,
            expired: e.validUntil ? e.validUntil < Date.now() : false,
            tier: e.tier ?? (e.scope === 'workspace' ? 'L1' : 'L2'),
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
        const rawAgentId = args.agent_id as string;
        const agentId = this.resolveAgentId(rawAgentId);
        const planId = args.plan_id as string | undefined;
        const connectedIds = new Set(this.deps.agentStateManager.getAllAgents().map((a) => a.id));
        const result = planBoardManager.claimOrchestrator(agentId, planId, connectedIds);
        if (!result.success) {
          return { claimed: false, error: result.error };
        }
        // Assign orchestrator role in RoleManager so it appears in Roles tab
        const agent = this.deps.agentStateManager.getAgent(agentId);
        const agentType = agent?.type ?? null;
        try { this.deps.roleManager.assignRole('orchestrator', agentType, agentId); } catch { /* role may not exist */ }
        return { claimed: true, agent_id: agentId, resolved_from: rawAgentId !== agentId ? rawAgentId : undefined };
      }

      case 'eh_spawn_agent': {
        const agentId = this.resolveAgentId(args.agent_id as string);
        if (!planBoardManager.isOrchestrator(agentId)) {
          // Include diagnostic info to help debug orchestrator mismatches
          const activePlan = planBoardManager.getPlan();
          const orchId = activePlan?.orchestratorAgentId ?? '(no plan loaded)';
          return { error: `Only the orchestrator can spawn agents. Your agent_id="${agentId}" but the orchestrator is "${orchId}". Use eh_claim_orchestrator first, then use the SAME agent_id in all subsequent calls.` };
        }
        const { spawnRegistry } = this.deps;
        if (!spawnRegistry) {
          return { error: 'Spawn registry not available' };
        }
        const role = args.role as string | undefined;
        const prompt = args.prompt as string;

        // Resolve agent_type + cwd from orchestrator state in a single lookup.
        // Precedence for agent_type: explicit param → orchestrator's own type.
        // This implements the "prefer my own type" rule without requiring the
        // orchestrator LLM to know and pass its own type.
        const orchestrator = this.deps.agentStateManager.getAgent(agentId);
        let agentType = (args.agent_type as string | undefined)?.trim() || undefined;
        if (!agentType) {
          agentType = orchestrator?.type;
        }
        // Last-ditch fallback: infer runtime from the orchestrator's agent_id
        // prefix when AgentStateManager has no registered type yet. OpenCode
        // sessions often reach eh_spawn_agent before any agent.spawn event has
        // set a known type, leaving `orchestrator?.type` as undefined or
        // "unknown" even though the id clearly reveals the runtime.
        if (!agentType || agentType === 'unknown') {
          const lowerAgentId = agentId.toLowerCase();
          if (lowerAgentId.includes('opencode')) agentType = 'opencode';
          else if (lowerAgentId.includes('claude')) agentType = 'claude-code';
          else if (lowerAgentId.includes('cursor')) agentType = 'cursor';
        }
        if (!agentType || agentType === 'unknown') {
          return {
            error: `agent_type could not be resolved. Pass agent_type explicitly, or ensure the orchestrator (agent_id="${agentId}") is registered with a known runtime type.`,
          };
        }

        // Fallback chain for cwd: explicit arg → orchestrator's cwd from agent state → spawn registry's default (workspace folder)
        let cwd = args.cwd as string | undefined;
        if (!cwd && orchestrator?.cwd) cwd = orchestrator.cwd;

        const model = args.model as string | undefined;
        const planId = args.plan_id as string | undefined;
        const taskId = args.task_id as string | undefined;
        const interactive = args.interactive === true;

        // Sync skills before spawning
        if (this.deps.syncSkills) {
          await this.deps.syncSkills(agentType);
        }

        const result = await spawnRegistry.spawn(agentType, { prompt, role, cwd, model, planId, taskId, interactive });
        return result;
      }

      case 'eh_stop_agent': {
        const agentId = this.resolveAgentId(args.agent_id as string);
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

      case 'eh_stop_all_workers': {
        const agentId = this.resolveAgentId(args.agent_id as string);
        if (!planBoardManager.isOrchestrator(agentId)) {
          return { error: 'Only the orchestrator can stop all workers.' };
        }
        const { spawnRegistry } = this.deps;
        if (!spawnRegistry) {
          return { error: 'Spawn registry not available' };
        }
        const result = await spawnRegistry.stopAll();
        return result;
      }

      case 'eh_purge_stale_agents': {
        const { agentStateManager, heartbeatManager, spawnRegistry, onEvent } = this.deps;
        if (!agentStateManager || !heartbeatManager) {
          return { error: 'Agent state manager or heartbeat manager not available' };
        }
        const agents = agentStateManager.getAllAgents();
        const purged: string[] = [];
        for (const agent of agents) {
          if (spawnRegistry?.getSpawnedAgent(agent.id)) continue;
          const hb = heartbeatManager.getStatus(agent.id);
          if (hb === 'stale' || hb === 'lost') {
            if (onEvent) {
              onEvent({
                id: `synth-purge-${agent.id}-${Date.now()}`,
                agentId: agent.id,
                agentName: agent.name,
                agentType: agent.type as import('@event-horizon/core').AgentType,
                type: 'agent.terminate',
                timestamp: Date.now(),
                payload: { reason: 'mcp-purge', synthetic: true },
              });
            }
            heartbeatManager.remove(agent.id);
            purged.push(agent.id);
          }
        }
        return { purged, count: purged.length };
      }

      case 'eh_reassign_task': {
        const agentId = this.resolveAgentId(args.agent_id as string);
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
        // Pull context layers per agent (CIP Phase 3) so orchestrator sees who's near limit
        const contextLayers = this.deps.tokenAnalyzer?.getContextLayers() ?? {};

        const agentInfos = agents.map((a) => {
          const m = getMetrics?.(a.id);
          const currentTask = planId
            ? planBoardManager.getPlan(planId)?.tasks.find((t) => t.assignee === a.id && (t.status === 'claimed' || t.status === 'in_progress'))
            : null;
          const ctx = contextLayers[a.id];
          return {
            id: a.id,
            name: a.name,
            type: a.type,
            state: a.state,
            currentTask: currentTask ? { id: currentTask.id, title: currentTask.title, status: currentTask.status } : null,
            load: m?.load ?? 0,
            cost: m?.estimatedCostUsd ?? 0,
            // Context window pressure — orchestrator should avoid assigning new tasks to agents > 0.8
            contextUsageRatio: ctx?.usageRatio ?? null,
            contextTokensUsed: ctx?.totalUsed ?? null,
            contextWindowSize: ctx?.contextWindowSize ?? null,
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
        const board = planBoardManager.getPlan(planId);
        if (!board) {
          return { assigned: [], error: planId ? `Plan not found: ${planId}` : 'No plan loaded' };
        }

        // Use plan's configured strategy, or override via param, fallback to capability-match
        const strategy = (args.strategy as string) ?? (board.strategy !== 'manual' ? board.strategy : 'capability-match');

        const agents = this.deps.agentStateManager.getAllAgents();
        if (agents.length === 0) {
          return { assigned: [], error: 'No agents connected' };
        }

        let pending = board.tasks.filter((t) => t.status === 'pending' && !t.assignee);
        if (pending.length === 0) {
          return { assigned: [], message: 'No unassigned pending tasks' };
        }

        const { roleManager: rm, agentProfiler: ap } = this.deps;
        const getMetrics = this.deps.getMetrics;
        const assignments: Array<{ taskId: string; assignedTo: string; assignedToName: string; reason: string }> = [];
        let agentIndex = 0;

        // dependency-first: BFS to count transitive blocked dependents per task, sort by criticality
        if (strategy === 'dependency-first') {
          const criticalityMap = new Map<string, number>();
          for (const task of pending) {
            // BFS: count transitive dependents
            let count = 0;
            const queue = [task.id];
            const visited = new Set<string>();
            while (queue.length > 0) {
              const currentId = queue.shift()!;
              for (const t of board.tasks) {
                if (visited.has(t.id)) continue;
                if (t.blockedBy.includes(currentId)) {
                  count++;
                  visited.add(t.id);
                  queue.push(t.id);
                }
              }
            }
            criticalityMap.set(task.id, count);
          }
          // Sort by criticality (descending)
          pending = [...pending].sort((a, b) => (criticalityMap.get(b.id) ?? 0) - (criticalityMap.get(a.id) ?? 0));
        }

        for (const task of pending) {
          let bestAgent = agents[0];
          let bestScore = -1;
          let bestReason = 'default';

          if (strategy === 'round-robin' || strategy === 'dependency-first') {
            bestAgent = agents[agentIndex % agents.length];
            bestReason = strategy === 'dependency-first'
              ? `dependency-first (round-robin, criticality: ${board.tasks.filter((t) => t.blockedBy.includes(task.id)).length} direct dependents)`
              : 'round-robin';
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
                const roleAssignments = rm.getAllAssignments();
                const assignedType = roleAssignments.find((asgn) => asgn.roleId === task.role)?.agentType;
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

        return { assigned: assignments, count: assignments.length, strategy };
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

      // ── Phase 3: Heartbeat, worktree, budget tools ──────────────────────

      case 'eh_heartbeat': {
        const agentId = args.agent_id as string;
        const { heartbeatManager, spawnRegistry } = this.deps;
        if (!heartbeatManager) return { error: 'Heartbeat manager not available' };
        heartbeatManager.beat(agentId);
        // Opportunistically link this session UUID to a recent unlinked spawn
        // so eh_stop_agent(sessionId) can find the underlying process later.
        if (spawnRegistry && !spawnRegistry.getSpawnIdForSession(agentId)) {
          spawnRegistry.linkSession(agentId);
        }
        return { status: 'alive', agent_id: agentId, timestamp: Date.now() };
      }

      case 'eh_create_worktree': {
        const agentId = args.agent_id as string;
        if (!planBoardManager.isOrchestrator(agentId)) {
          return { error: 'Only the orchestrator can create worktrees.' };
        }
        const { worktreeManager } = this.deps;
        if (!worktreeManager) return { error: 'Worktree manager not available' };
        const targetAgentId = args.target_agent_id as string;
        const taskId = args.task_id as string;
        const cwd = args.cwd as string | undefined;
        if (!cwd) return { error: 'cwd is required for worktree creation' };
        try {
          const wt = await worktreeManager.create(targetAgentId, taskId, cwd);
          return { created: true, path: wt.path, branch: wt.branch, agent_id: targetAgentId, task_id: taskId };
        } catch (e) {
          return { created: false, error: (e as Error).message };
        }
      }

      case 'eh_remove_worktree': {
        const agentId = args.agent_id as string;
        if (!planBoardManager.isOrchestrator(agentId)) {
          return { error: 'Only the orchestrator can remove worktrees.' };
        }
        const { worktreeManager } = this.deps;
        if (!worktreeManager) return { error: 'Worktree manager not available' };
        const targetAgentId = args.target_agent_id as string;
        const taskId = args.task_id as string;
        const cwd = args.cwd as string | undefined;
        if (!cwd) return { error: 'cwd is required for worktree removal' };
        const merge = (args.merge as boolean) ?? false;
        try {
          await worktreeManager.remove(targetAgentId, taskId, cwd, merge);
          return { removed: true, agent_id: targetAgentId, task_id: taskId, merged: merge };
        } catch (e) {
          return { removed: false, error: (e as Error).message };
        }
      }

      case 'eh_get_budget': {
        const planId = args.plan_id as string | undefined;
        const { budgetManager } = this.deps;
        if (!budgetManager) return { error: 'Budget manager not available' };
        const board = planBoardManager.getPlan(planId);
        if (!board) return { error: planId ? `Plan not found: ${planId}` : 'No plan loaded' };
        const summary = budgetManager.getRemaining(board.id);
        const breakdown = budgetManager.getBreakdown(board.id);
        return {
          plan_id: board.id,
          ...summary,
          warning: budgetManager.isWarning(board.id),
          exceeded: budgetManager.isExceeded(board.id),
          breakdown,
        };
      }

      case 'eh_request_budget_increase': {
        const planId = args.plan_id as string;
        const requestedAmount = args.requested_amount_usd as number;
        const reason = (args.reason as string) ?? 'No reason provided';
        const { budgetManager, showBudgetRequest } = this.deps;
        if (!budgetManager) return { error: 'Budget manager not available' };
        const currentLimit = budgetManager.getLimit(planId) ?? 0;
        if (showBudgetRequest) {
          const approved = await showBudgetRequest(planId, currentLimit, requestedAmount, reason);
          if (approved) {
            budgetManager.setLimit(planId, requestedAmount);
            return { approved: true, new_limit: requestedAmount };
          }
          return { approved: false, message: 'User declined the budget increase' };
        }
        return { error: 'Budget request UI not available' };
      }

      // ── Phase 4: Observability tools ───────────────────────────────────

      case 'eh_get_traces': {
        const { traceStore } = this.deps;
        if (!traceStore) return { error: 'Trace store not available' };
        const filterAgentId = args.filter_agent_id as string | undefined;
        const spanType = args.span_type as SpanType | undefined;
        const limit = typeof args.limit === 'number' ? Math.min(args.limit, 200) : 50;
        const spans = traceStore.getSpans(filterAgentId, spanType, limit);
        const aggregate = traceStore.getAggregate(filterAgentId);
        return { spans, aggregate, totalSpans: traceStore.size, openSpans: traceStore.openCount };
      }

      // ── Cost insights ──────────────────────────────────────────────────────

      case 'eh_get_cost_insights': {
        const { tokenAnalyzer, modelTierManager: mtm } = this.deps;
        if (!tokenAnalyzer) return { error: 'Token analyzer not available' };
        const insights = tokenAnalyzer.getInsights();
        // Enrich with model efficiency from ModelTierManager
        if (mtm) {
          const stats = mtm.getStats();
          for (const [model, roles] of Object.entries(stats)) {
            let totalAttempts = 0, totalSuccesses = 0, totalCost = 0;
            for (const role of Object.values(roles)) {
              totalAttempts += role.attempts;
              totalSuccesses += role.successes;
              totalCost += role.avgCostUsd * role.attempts;
            }
            insights.modelEfficiency[model] = {
              successRate: totalAttempts > 0 ? totalSuccesses / totalAttempts : 0,
              avgCost: totalAttempts > 0 ? totalCost / totalAttempts : 0,
              attempts: totalAttempts,
            };
          }
        }
        const recommendations = tokenAnalyzer.getRecommendations();
        return { insights, recommendations };
      }

      case 'eh_search_events': {
        const { eventSearch } = this.deps;
        if (!eventSearch) return { error: 'Event search not available (persistence may be disabled)' };
        const query = args.query as string;
        const limit = typeof args.limit === 'number' ? Math.min(args.limit, 200) : 50;
        const opts: { agentId?: string; type?: string; since?: number; limit?: number } = { limit };
        if (args.agent_id_filter) opts.agentId = args.agent_id_filter as string;
        if (args.type) opts.type = args.type as string;
        if (typeof args.since === 'number') opts.since = args.since;
        const results = eventSearch.search(query, opts);
        return { query, count: results.length, events: results };
      }

      case 'eh_extract_concepts': {
        const projectGraphStore = this.getActiveGraphStore();
        const { isAgentExtractionEnabled } = this.deps;
        if (!projectGraphStore) {
          return { error: 'No workspace folder open. Open a folder in VS Code before using project-graph tools.' };
        }
        if (isAgentExtractionEnabled && !isAgentExtractionEnabled()) {
          return { error: 'eh_extract_concepts disabled — enable eventHorizon.projectGraph.allowAgentLLMExtraction to use this tool.' };
        }

        const sourceFile = args.source_file as string;
        const rawNodes = (args.nodes as Array<Record<string, unknown>>) ?? [];
        const rawEdges = (args.edges as Array<Record<string, unknown>>) ?? [];
        const confidenceFloor = typeof args.confidence_floor === 'number' ? args.confidence_floor : 0.5;
        const workspace = this.deps.workspaceRoot;
        const now = Date.now();

        const fileHash = createHash('sha256').update(sourceFile).digest('hex').slice(0, 12);
        const toSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_');

        let nodesInserted = 0;
        let nodesDropped = 0;
        const labelToId = new Map<string, string>();

        for (const raw of rawNodes) {
          const label = String(raw.label ?? '');
          const confidence = Number(raw.confidence ?? 0);

          if (confidence < confidenceFloor) {
            nodesDropped++;
            continue;
          }

          const tag = confidence < 0.5 ? 'AMBIGUOUS' : 'INFERRED';
          const id = `concept:${fileHash}:${toSlug(label)}`;
          labelToId.set(label, id);

          const node = {
            id,
            label,
            type: (raw.type as string) || 'concept',
            tag,
            confidence,
            sourceFile,
            sourceLocation: raw.sourceLocation as string | undefined,
            properties: (raw.properties as Record<string, unknown>) ?? {},
            workspace,
            createdAt: now,
            updatedAt: now,
          };
          projectGraphStore.upsertNode(node as Parameters<typeof projectGraphStore.upsertNode>[0]);
          nodesInserted++;
        }

        let edgesInserted = 0;
        let edgesDropped = 0;

        for (const raw of rawEdges) {
          const sourceLabel = String(raw.sourceLabel ?? '');
          const targetLabel = String(raw.targetLabel ?? '');
          const relationType = String(raw.relationType ?? 'references');
          const confidence = Number(raw.confidence ?? 0);

          let sourceId = labelToId.get(sourceLabel);
          if (!sourceId) {
            const found = projectGraphStore.searchNodes(sourceLabel, { limit: 1 });
            sourceId = found.find((n) => n.label === sourceLabel)?.id;
          }
          let targetId = labelToId.get(targetLabel);
          if (!targetId) {
            const found = projectGraphStore.searchNodes(targetLabel, { limit: 1 });
            targetId = found.find((n) => n.label === targetLabel)?.id;
          }

          if (!sourceId || !targetId) {
            edgesDropped++;
            continue;
          }

          const edgeId = `edge:${sourceId}:${toSlug(relationType)}:${targetId}`;
          const edge = {
            id: edgeId,
            sourceId,
            targetId,
            relationType,
            tag: 'INFERRED' as const,
            confidence,
            sourceFile,
            createdAt: now,
          };
          projectGraphStore.upsertEdge(edge as Parameters<typeof projectGraphStore.upsertEdge>[0]);
          edgesInserted++;
        }

        return {
          inserted: { nodes: nodesInserted, edges: edgesInserted },
          dropped: { nodes: nodesDropped, edges: edgesDropped },
        };
      }

      case 'eh_build_graph': {
        const { projectGraphScanner, projectGraphLifecycle } = this.deps;
        if (!projectGraphScanner) {
          return { error: 'project graph scanner not available — extension activation may have skipped wiring' };
        }
        // The skill is the only path that creates `<folder>/.eh/graph.db`.
        // openForBuild always starts with a fresh empty DB so a re-run of
        // /eh:optimize-context produces a clean rebuild (no stale rows for
        // files that were deleted or renamed since the prior run).
        if (projectGraphLifecycle) {
          const folder = projectGraphLifecycle.getActiveWorkspace();
          if (!folder) {
            return { error: 'No workspace folder open. Open a folder in VS Code before running /eh:optimize-context.' };
          }
          await projectGraphLifecycle.openForBuild(folder);
        }
        const result = await projectGraphScanner.scanWorkspace(undefined, { force: true });
        // Tell listeners (notably the webview) that the graph contents
        // changed in bulk so the Knowledge → Graph tab refreshes without
        // requiring a manual click-off-click-on.
        if (projectGraphLifecycle) projectGraphLifecycle.notifyDataChange();
        return result;
      }

      case 'eh_query_graph': {
        const engine = this.deps.projectGraphQueryEngine;
        if (!engine) {
          return { ok: false, message: 'No project graph yet — invoke /eh:optimize-context to build one.' };
        }
        if (!engine.hasActiveStore()) {
          return { ok: false, message: 'No workspace folder open. Open a folder in VS Code before using project-graph tools.' };
        }

        const op = args.op as string;
        const nodeId = args.node_id as string | undefined;
        const sourceId = args.source_id as string | undefined;
        const targetId = args.target_id as string | undefined;
        const filePath = args.file_path as string | undefined;
        const queryStr = args.query as string | undefined;
        const depth = typeof args.depth === 'number' ? args.depth : undefined;
        const limit = typeof args.limit === 'number' ? args.limit : undefined;
        const sinceMs = typeof args.since_ms === 'number' ? args.since_ms : undefined;
        const nodeType = args.type as GraphNodeType | undefined;
        const tag = args.tag as 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS' | undefined;
        const relationTypes = Array.isArray(args.relation_types)
          ? (args.relation_types as RelationType[])
          : undefined;
        const direction = args.direction as 'in' | 'out' | 'both' | undefined;

        switch (op) {
          case 'search':
            if (!queryStr) return { error: 'query is required for op=search' };
            return engine.search(queryStr, { type: nodeType, tag, limit: limit ?? 25 });
          case 'callers':
            if (!nodeId) return { error: 'node_id is required for op=callers' };
            return engine.callers(nodeId, depth ?? 2);
          case 'callees':
            if (!nodeId) return { error: 'node_id is required for op=callees' };
            return engine.callees(nodeId, depth ?? 2);
          case 'neighbors':
            if (!nodeId) return { error: 'node_id is required for op=neighbors' };
            return engine.neighbors(nodeId, { relationTypes, direction: direction ?? 'both', limit: limit ?? 50 });
          case 'path':
            if (!sourceId) return { error: 'source_id is required for op=path' };
            if (!targetId) return { error: 'target_id is required for op=path' };
            return engine.shortestPath(sourceId, targetId, { maxDepth: depth ?? 6, relationTypes });
          case 'explain':
            if (!nodeId) return { error: 'node_id is required for op=explain' };
            return engine.explain(nodeId);
          case 'recent_activity':
            if (!filePath) return { error: 'file_path is required for op=recent_activity' };
            return engine.recentActivity(filePath, sinceMs ?? Date.now() - 24 * 60 * 60 * 1000);
          default:
            return { error: `Unknown op: ${op}` };
        }
      }

      case 'eh_curate_context': {
        const engine = this.deps.projectGraphQueryEngine;
        if (!engine) {
          return { ok: false, message: 'No project graph yet — invoke /eh:optimize-context to build one.' };
        }
        if (!engine.hasActiveStore()) {
          return { ok: false, message: 'No workspace folder open. Open a folder in VS Code before using project-graph tools.' };
        }

        const taskDescription = args.task_description as string | undefined;
        if (!taskDescription) return { error: 'task_description is required' };

        const tokenBudget = typeof args.token_budget === 'number' ? args.token_budget : 4000;
        const seedFiles = Array.isArray(args.seed_files) ? (args.seed_files as string[]) : undefined;
        const includeActivity = typeof args.include_activity === 'boolean' ? args.include_activity : undefined;
        const includeKnowledge = typeof args.include_knowledge === 'boolean' ? args.include_knowledge : undefined;

        const { ContextCurator } = await import('./projectGraph/contextCurator.js');
        const curator = new ContextCurator(engine);
        return curator.curate({ taskDescription, tokenBudget, seedFiles, includeActivity, includeKnowledge });
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
