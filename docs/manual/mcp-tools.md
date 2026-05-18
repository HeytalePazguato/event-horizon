# MCP Tools Reference

Event Horizon exposes **50 coordination tools** to your agents through an MCP server that is auto-registered when you [connect an agent](getting-started.md#3-connect-an-agent). Agents call these tools directly; you rarely invoke them by hand — the [bundled skills](skills.md) wrap the common workflows.

This page documents all 50, grouped by category. Every tool name is prefixed `eh_`.

!!! info "You don't need to memorize these"
    Skills exist precisely so agents (and you) don't have to. Reach for this reference when you're writing a custom skill, debugging an agent's behaviour, or want to understand exactly what a skill is doing under the hood.

---

## Locking and activity

Coordinate file access between agents. See [File Locking](file-locking.md).

| Tool | What it does |
|------|--------------|
| `eh_check_lock` | Check whether a file is locked, and by which agent |
| `eh_acquire_lock` | Acquire a lock on a file before writing it |
| `eh_release_lock` | Release a lock the agent holds |
| `eh_wait_for_unlock` | Block until a locked file becomes available |
| `eh_list_agents` | List all currently connected agents |
| `eh_file_activity` | Get file activity (who touched what) since a timestamp |

---

## Plans and tasks

Create and work [coordination plans](orchestration.md#plans).

| Tool | What it does |
|------|--------------|
| `eh_load_plan` | Create and register a plan with Event Horizon |
| `eh_get_plan` | Fetch a plan and its current state |
| `eh_list_plans` | List all plans |
| `eh_claim_task` | Atomically claim a task — no other agent can take it |
| `eh_update_task` | Update a task's status, notes, or progress |
| `eh_verify_task` | Run a task's verify command to confirm it works |
| `eh_retry_task` | Retry a failed task (with [model escalation](budget.md#tiered-model-selection)) |
| `eh_recommend_task` | Get scored task recommendations for an agent |
| `eh_archive_plan` | Archive a completed plan |
| `eh_delete_plan` | Delete a plan |

---

## Messaging

Direct agent-to-agent communication. Drives the [wormhole](the-universe.md#wormholes-communication-channels) visuals.

| Tool | What it does |
|------|--------------|
| `eh_send_message` | Send a message to one or more agents |
| `eh_get_messages` | Retrieve messages addressed to this agent |

---

## Roles and profiling

Assign [roles](orchestration.md#roles) and read performance data.

| Tool | What it does |
|------|--------------|
| `eh_list_roles` | List all available roles (built-in and custom) |
| `eh_assign_role` | Assign a role to an agent |
| `eh_get_agent_profile` | Get success rate, speed, and cost stats for an agent |
| `eh_recommend_agent` | Recommend the best agent for a given task |

---

## Shared knowledge

Read and write the [shared knowledge base](knowledge-graph.md#shared-knowledge).

| Tool | What it does |
|------|--------------|
| `eh_write_shared` | Add a knowledge entry (workspace- or plan-scoped) |
| `eh_read_shared` | Read knowledge entries |
| `eh_get_shared_summary` | Get a summary of the shared knowledge base |
| `eh_delete_shared` | Delete a knowledge entry |

---

## Orchestration

The elevated toolset an [orchestrator](orchestration.md) uses to run a team. Some of these resolve agents fuzzily (by ID prefix, type, or heartbeat) so an orchestrator that only knows a rough ID still works.

| Tool | What it does |
|------|--------------|
| `eh_claim_orchestrator` | Become the orchestrator of a plan |
| `eh_spawn_agent` | Spawn a new worker agent in a visible terminal |
| `eh_stop_agent` | Stop a specific agent |
| `eh_stop_all_workers` | Stop every worker agent for a plan in one call |
| `eh_purge_stale_agents` | Remove stale/lost agents with no running process |
| `eh_reassign_task` | Move a task from one agent to another |
| `eh_get_team_status` | Get the orchestrator's view of the whole team |
| `eh_auto_assign` | Auto-recommend and assign available tasks to free agents |
| `eh_get_session` | Get the current orchestration session |
| `eh_sync_skills` | Push the orchestrator's skill definitions to workers |

---

## Heartbeat and worktrees

Liveness and git [worktree isolation](file-locking.md#worktree-isolation).

| Tool | What it does |
|------|--------------|
| `eh_heartbeat` | Send a heartbeat — keeps the agent marked alive, resets the [watchdog](orchestration.md#the-watchdog) |
| `eh_create_worktree` | Create a git worktree for this agent |
| `eh_remove_worktree` | Clean up the agent's worktree |

---

## Budget, traces, and cost

Spending controls and cost analysis. See [Budget & Cost](budget.md).

| Tool | What it does |
|------|--------------|
| `eh_get_budget` | Get current spend and remaining budget for a plan |
| `eh_request_budget_increase` | Request a higher budget ceiling |
| `eh_get_traces` | Get execution traces |
| `eh_get_cost_insights` | Get cost analysis — cache efficiency, duplicate reads, recommendations |

---

## Search

| Tool | What it does |
|------|--------------|
| `eh_search_events` | Full-text search across all persisted events (tool names, file paths, agent names, payload text) |

---

## Project graph

Build and query the [project knowledge graph](knowledge-graph.md). Event Horizon itself never makes model calls — `eh_extract_concepts` runs through the calling agent's model.

| Tool | What it does |
|------|--------------|
| `eh_build_graph` | Start a workspace graph scan — returns a scan ID immediately (async) |
| `eh_scan_status` | Poll the progress of a running scan |
| `eh_query_graph` | Query the graph — search, callers, callees, neighbours, shortest path, explain, recent activity |
| `eh_curate_context` | Get a task-aware, token-budgeted slice of the graph |
| `eh_extract_concepts` | Agent-driven LLM extraction of inferred concepts (opt-in, agent's own tokens) |
| `eh_rescan_files` | Re-extract specific files only, without a full rebuild |

---

## How skills map to tools

For reference, here's roughly which tools each [bundled skill](skills.md) leans on:

| Skill | Primary tools |
|-------|---------------|
| `/eh:create-plan` | `eh_load_plan`, `eh_claim_orchestrator` |
| `/eh:orchestrate` | `eh_spawn_agent`, `eh_auto_assign`, `eh_get_team_status`, `eh_reassign_task`, `eh_stop_agent` |
| `/eh:work-on-plan` | `eh_recommend_task`, `eh_claim_task`, `eh_update_task`, `eh_acquire_lock`, `eh_verify_task` |
| `/eh:verify-task` | `eh_get_plan`, `eh_verify_task`, `eh_update_task` |
| `/eh:plan-status` | `eh_list_plans`, `eh_get_plan`, `eh_get_team_status` |
| `/eh:optimize-context` | `eh_build_graph`, `eh_scan_status`, `eh_curate_context` |
| `/eh:research` | `eh_query_graph`, `eh_search_events`, `eh_write_shared` |
| `/eh:debug` | `eh_query_graph`, `eh_search_events` |
