# Event Horizon

**Turn any AI coding agent into a project manager.** One command creates a plan, spawns a team of AI agents, assigns roles, and manages the entire project -- while you watch it happen live in a cosmic visualization.

![Event Horizon Demo](https://raw.githubusercontent.com/HeytalePazguato/event-horizon/master/assets/demo2.gif)

## Get started in 30 seconds

1. Click the rocket icon (top-right of any editor tab) or press `Ctrl+Shift+E H`
2. Click **Connect** and choose your agent
3. Start coding -- your agent appears as a planet

No accounts. No config files. No API keys. Everything runs on your machine.

> No agent running? Click **Demo** to see the universe in action with simulated agents.

---

## What happens when you use Event Horizon

### Before: you manage every agent manually

You open three terminals. Claude Code builds the API. OpenCode writes tests. Copilot updates docs. They all edit the same project. Claude overwrites OpenCode's changes to `server.ts`. Nobody notices. The build breaks. You spend 20 minutes untangling.

### After: your agent manages the team for you

```
/eh:create-plan Build a REST API with auth, database layer, and tests
```

Your agent becomes the orchestrator. It analyzes the work, breaks it into parallel tasks, spawns worker agents in visible terminals, assigns roles, enforces file locks, tracks the budget, retries failures, and reports back when everything is done. You watch it happen on a live Kanban board and a cosmic visualization where every agent is a planet.

---

## Works with every major AI coding agent

| Agent | Hooks | MCP Tools | File Locking | Spawnable | Token Tracking |
|-------|:-----:|:---------:|:------------:|:---------:|:--------------:|
| **Claude Code** | Yes | Yes | Yes | Yes | Yes |
| **OpenCode** | Yes | Yes | Yes | Yes | Yes |
| **GitHub Copilot** | Yes | Yes | -- | -- | Partial |
| **Cursor** | Yes | Yes | -- | Yes | Yes |

One-click connect. MCP server auto-registered. Hooks auto-updated on every activation. Mix and match agents freely -- Claude orchestrating OpenCode workers is a first-class workflow.

---

## Core capabilities

### Multi-agent orchestration

The agent that creates a plan auto-becomes the orchestrator with elevated MCP tools to spawn agents, assign tasks, monitor the team, and control budgets. Spawned agents run in **visible VS Code terminals** -- full transparency, click any planet to focus its terminal.

### Plan coordination

Atomic task claiming (no duplicate work), dependency resolution (blocked tasks auto-unblock), cascade failure with auto-retry and model escalation (haiku fails, sonnet retries, opus escalates). Smart task recommendations score agents by role match, historical performance, and current load.

### File locking and worktree isolation

When Agent A edits a file, Agent B is **hard-blocked** -- the tool call doesn't execute. Locks refresh on writes and release on agent termination. For full isolation, agents can work in their own git worktrees with auto-merge on completion.

### Shared knowledge

A live knowledge base where humans and agents contribute context in real-time. Workspace knowledge persists across sessions. Plan knowledge lives with the plan. Auto-discovers CLAUDE.md, .cursorrules, copilot-instructions.md, and other instruction files.

### Budget and cost controls

Per-plan spending limits with warning at 80% and hard stop at 100%. Tiered model selection tries the cheapest model first per task complexity. Failed verification auto-escalates (haiku to sonnet to opus). Cost Insights panel shows cache efficiency, duplicate reads, and actionable recommendations.

### Agent roles and profiling

Eight built-in roles (researcher, planner, implementer, reviewer, tester, debugger, orchestrator, context-optimizer) plus custom roles. The profiler tracks success rate, speed, and cost per agent type per role -- so you know which agent is best at what.

---

## Live visualization

Every agent is a planet. The cosmic metaphor encodes real information:

| Visual | Meaning |
|--------|---------|
| Planet type (gas, rocky, icy, volcanic) | Agent type (Claude, OpenCode, Copilot, Cursor) |
| Golden star with emission rays | Orchestrator managing the plan |
| Pulsing ring | Agent is thinking |
| Amber breathing ring | Waiting for your input |
| Red glow | Error state |
| Orbiting moons | Active subagents |
| Ships between planets | Data transfers between cooperating agents |
| Lightning arcs | File collision -- two agents editing the same file |
| Asteroid belt | Workspace group (agents sharing a directory) |
| Orbital debris | Plan tasks (shape and color encode status) |

## Operations dashboard

Full-screen dashboard (`Ctrl+Shift+E O`) with agents/plans sidebar, metrics overview, file activity heatmap, searchable event logs, timeline swimlanes, Kanban board with dependency DAG, role assignments with performance profiles, cost insights, and a shared knowledge panel.

---

## 40+ MCP tools

All agents access coordination tools via the MCP server (auto-registered on connect):

`eh_load_plan` `eh_get_plan` `eh_list_plans` `eh_claim_task` `eh_update_task` `eh_retry_task` `eh_recommend_task` `eh_verify_task` `eh_archive_plan` `eh_delete_plan` `eh_send_message` `eh_get_messages` `eh_check_lock` `eh_acquire_lock` `eh_release_lock` `eh_wait_for_unlock` `eh_list_agents` `eh_file_activity` `eh_write_shared` `eh_read_shared` `eh_get_shared_summary` `eh_delete_shared` `eh_list_roles` `eh_assign_role` `eh_get_agent_profile` `eh_recommend_agent` `eh_heartbeat` `eh_get_budget` `eh_get_session` `eh_get_cost_insights` `eh_spawn_agent` `eh_stop_agent` `eh_reassign_task` `eh_get_team_status` `eh_auto_assign` `eh_create_worktree` `eh_remove_worktree` `eh_request_budget_increase` `eh_sync_skills` `eh_search_events`

Nine bundled skills handle common workflows so agents don't need to memorize tool names:

| Skill | What it does |
|-------|-------------|
| `/eh:create-plan` | Generate a plan with parallel tracks, dependencies, acceptance criteria, and verify steps |
| `/eh:work-on-plan` | Claim tasks, implement, self-verify against acceptance criteria, mark progress |
| `/eh:orchestrate` | Manage a plan as orchestrator -- spawn workers, assign tasks, monitor, handle failures |
| `/eh:verify-task` | Batch-verify completed tasks by running their verify commands |
| `/eh:optimize-context` | Reduce token costs by analyzing and splitting instruction files |
| `/eh:plan-status` | View progress, blocked tasks, active agents, available work |
| `/eh:research` | Explore codebase and output structured findings |
| `/eh:review` | Code review with severity levels and verification pipeline |
| `/eh:test` | Write tests following project conventions |
| `/eh:debug` | Diagnose bugs, trace root cause, apply minimal fix |

---

## 28 achievements

Milestones that track your multi-agent journey -- from spawning your first agent to surviving file collisions, catching UFOs, and diving astronauts into black holes. Some are secret. Some have tiers. All persist across sessions.

---

## Privacy

- **100% local** -- server on `127.0.0.1:28765`, nothing leaves your machine
- **Zero agent overhead** -- if Event Horizon is closed, agents run identically
- **No telemetry** -- no analytics, no tracking, no data collection

---

## Links

- [Source code and documentation](https://github.com/HeytalePazguato/event-horizon)
- [Changelog](https://github.com/HeytalePazguato/event-horizon/blob/master/apps/vscode/CHANGELOG.md)
- [Report an issue](https://github.com/HeytalePazguato/event-horizon/issues)
- [Rate this extension](https://marketplace.visualstudio.com/items?itemName=HeytalePazguato.event-horizon-vscode&ssr=false#review-details)

MIT License with Commons Clause -- see [LICENSE](https://github.com/HeytalePazguato/event-horizon/blob/master/LICENSE).
