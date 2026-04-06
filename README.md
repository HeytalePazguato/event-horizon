# Event Horizon

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/HeytalePazguato.event-horizon-vscode?label=VS%20Code%20Marketplace&color=blue)](https://marketplace.visualstudio.com/items?itemName=HeytalePazguato.event-horizon-vscode)
[![GitHub stars](https://img.shields.io/github/stars/HeytalePazguato/event-horizon?style=social)](https://github.com/HeytalePazguato/event-horizon)

**The multi-agent orchestration framework for AI coding.** Tell one agent to build a feature. It creates the plan, spawns the team, assigns roles, tracks budget, and manages the entire project. Works with Claude Code, OpenCode, Copilot, and Cursor.

![Event Horizon Demo](assets/demo2.gif)

---

## The Problem

You open three terminals. Claude Code is building the API. OpenCode is writing tests. Copilot is updating the docs. They're all editing the same project.

Then Claude overwrites OpenCode's changes to `server.ts`. OpenCode doesn't know. The build breaks. You spend 20 minutes untangling the mess.

**Event Horizon prevents this entirely.**

---

## How It Works

### 1. Create a plan

```
/eh:create-plan Build a REST API with auth, database layer, and tests
```

Event Horizon generates a plan with parallel tracks, dependency annotations, and verify steps. The agent that creates the plan automatically becomes the **orchestrator**.

### 2. The orchestrator spawns the team

The orchestrator spawns workers in visible VS Code terminals. Each worker gets a role, a task assignment, and access to the shared knowledge base.

```
Orchestrator → spawns Claude Code (implementer) → claims database tasks
Orchestrator → spawns OpenCode (tester) → claims test tasks
Orchestrator → spawns Copilot (reviewer) → reviews completed work
```

### 3. Agents coordinate themselves

Workers claim tasks atomically. Dependencies are enforced. File locks prevent collisions. If a task fails, cascade failure propagates cleanly and retry recovers automatically. The **Kanban board** and **Universe visualization** update live.

---

## Features

### Orchestrator & Agent Spawning

Any agent that creates a plan auto-becomes the orchestrator, gaining elevated MCP tools to spawn agents, assign tasks, monitor the team, and control budgets. Spawned agents run in **visible VS Code terminals** — click a planet to focus its terminal. Any agent type can be the orchestrator.

### Shared Knowledge

A live knowledge base where both humans and agents contribute context in real-time:
- **Workspace knowledge** (persistent) — tech stack, conventions, constraints
- **Plan knowledge** (scoped) — discoveries, corrections, and decisions during execution

### Plan Coordination

- **Atomic task claiming** — no race conditions, no duplicate work
- **Dependency resolution** — blocked tasks auto-unblock when dependencies complete
- **Cascade failure + retry** — failed tasks propagate cleanly, auto-retry with exponential backoff
- **Smart recommendations** — agents get scored task suggestions based on role, load, and history
- **Scheduling strategies** — auto-assignment: round-robin, least-busy, capability-match, dependency-first
- **Multi-plan support** — multiple plans simultaneously, each with its own orchestrator
- **Checkbox sync** — completed tasks update the source markdown file automatically

### File Locking & Worktree Isolation

When Agent A writes to a file, Agent B is hard-blocked from accessing it. Locks auto-expire, refresh on writes, and release on agent termination. For full isolation, agents can work in their own git worktrees with auto-merge on completion.

### Budget Controls

Per-plan budgets with warning at 80% and hard stop at 100%. Per-agent cost breakdowns. Agents can check remaining budget before expensive operations.

### Agent Roles & Profiling

Six built-in roles (researcher, planner, implementer, reviewer, tester, debugger) plus custom roles. The profiler tracks success rate, speed, and cost per agent type per role. The recommendation engine ranks agent types by suitability for each role based on real data.

### Session Resume

Agents resume prior conversations when picking up previously worked tasks. No lost context, no wasted tokens.

### Live Visualization

Each AI agent is a planet. The cosmic metaphor encodes real information:

| Visual | Meaning |
|--------|---------|
| Planet type (gas, rocky, icy, volcanic) | Agent type (Claude, OpenCode, Copilot, Cursor) |
| Orchestrator star (bright, emission rays) | The agent managing the plan |
| Pulsing ring | Agent is thinking |
| Amber breathing ring | Waiting for user input |
| Red glow | Error state |
| Orbiting moons | Active subagents |
| Ships between planets | Data transfers / cooperation |
| Lightning arcs | File collision (same file, two agents) |
| Asteroid belt | Workspace group (shared directory) |
| Orbital debris | Plan tasks (shape/color = status, glow = role) |

### Operations Dashboard

Full-screen dashboard (`Ctrl+Shift+E O`) with:

- **Agents / Plans sidebar** — agents grouped by workspace, plans grouped by status
- **Overview** — metrics grid, tool breakdowns, agent summary table
- **Files** — sortable heatmap of file activity across all agents
- **Logs** — searchable event log with type filters
- **Timeline** — horizontal swimlane of agent activity over time
- **Plan** — Kanban board with progress bar and dependency annotations
- **Dependencies** — DAG visualization with critical path highlighting
- **Roles** — role definitions, assignments, per-role performance profiles
- **Knowledge** — workspace and plan knowledge entries with real-time updates

### 30+ MCP Coordination Tools

All agents access worker-level tools via the MCP server (auto-registered on connect). Orchestrators gain elevated tools for spawning agents, assigning tasks, managing worktrees, and controlling budgets.

`eh_load_plan` `eh_get_plan` `eh_list_plans` `eh_claim_task` `eh_update_task` `eh_retry_task` `eh_recommend_task` `eh_archive_plan` `eh_delete_plan` `eh_send_message` `eh_get_messages` `eh_check_lock` `eh_acquire_lock` `eh_release_lock` `eh_wait_for_unlock` `eh_list_agents` `eh_file_activity` `eh_write_shared` `eh_read_shared` `eh_get_shared_summary` `eh_delete_shared` `eh_list_roles` `eh_assign_role` `eh_get_agent_profile` `eh_recommend_agent` `eh_heartbeat` `eh_get_budget` `eh_get_session` `eh_spawn_agent` `eh_stop_agent` `eh_reassign_task` `eh_get_team_status` `eh_auto_assign` `eh_create_worktree` `eh_remove_worktree` `eh_request_budget_increase` `eh_sync_skills`

### Bundled Skills

Seven coordination skills ship with the extension:

| Skill | Role | What it does |
|-------|------|-------------|
| `/eh:create-plan` | Planner | Generate a plan with parallel tracks, dependencies, and verify steps |
| `/eh:work-on-plan` | Implementer | Claim tasks, implement, mark progress, broadcast breaking changes |
| `/eh:plan-status` | Any | View progress, blocked tasks, active agents, available work |
| `/eh:research` | Researcher | Explore codebase, gather context, output structured findings |
| `/eh:review` | Reviewer | Code review with severity levels, run tests if available |
| `/eh:test` | Tester | Write tests following project conventions, report coverage |
| `/eh:debug` | Debugger | Diagnose bugs, trace root cause, apply minimal fix, verify |

### Achievements

28 medals tracking milestones — from first agent spawn to multi-agent file collisions, UFO encounters, and astronaut black hole dives. Some are secret. Some have tiers.

---

## Supported Agents

| Agent | Hooks | MCP Tools | File Locking | Spawnable | Token Tracking |
|-------|:-----:|:---------:|:------------:|:---------:|:--------------:|
| **Claude Code** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **OpenCode** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **GitHub Copilot** | ✅ | ✅ | — | — | Partial |
| **Cursor** | ✅ | ✅ | — | ✅ | — |

One-click connect for Claude Code, OpenCode, and Copilot. MCP server auto-registered in each agent's config. Hooks auto-updated on every extension activation.

---

## Why Event Horizon

- **Zero infrastructure** — install the extension and you're done. No Docker, no databases, no accounts.
- **Agent-agnostic** — Claude Code, OpenCode, Copilot, Cursor. They all share the same plan board, file locks, and message bus.
- **MCP-native** — standard protocol. No custom APIs, no vendor lock-in.
- **Markdown plans** — portable, version-controllable, readable. Your plans are just markdown files.
- **100% local** — nothing leaves your machine. No telemetry, no analytics, no data collection.
- **VS Code native** — no context switching. Agents, visualization, and dashboard all live where you code.
- **Visible agents** — spawned agents run in real VS Code terminals. Full transparency.

---

## Privacy

- **100% local** — HTTP server on `127.0.0.1:28765`. Nothing leaves your machine.
- **Zero agent overhead** — hooks use `--connect-timeout 2` with silent fallback. If Event Horizon is closed, agents run identically.
- **No telemetry** — no analytics, no tracking, no data collection.

---

## The Origin

I asked Claude:

> *"If you could choose a visual representation of yourself as an AI agent, how would you represent yourself and your fellow AI agents collaborating?"*

Claude's answer:

> *"Each agent is a planet — a massive entity that consumes energy, emits output, and exerts gravitational influence. Tasks orbit as moons. Data flows as ships. At the center, a black hole where completed work collapses. This scales naturally. One agent is a lonely planet. Five agents become a solar system."*

From that answer, Event Horizon was born.

---

## Getting Started

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=HeytalePazguato.event-horizon-vscode), then:

1. **Open**: Rocket icon in editor title bar, or `Ctrl+Shift+E H`
2. **Connect**: Click Connect → choose agent → Install
3. **Code**: Launch an agent session. Planet appears.

> No agent? Click **Demo** for simulated agents.

If Event Horizon is useful to you, consider [starring the repo](https://github.com/HeytalePazguato/event-horizon) to help others find it.

---

## Development

See [CONTRIBUTING.md](docs/CONTRIBUTING.md) for full guidelines.

```bash
pnpm install && pnpm build    # build all packages
pnpm test                      # run tests (500+)
pnpm dev                       # watch mode
```

Press **F5** to launch the Extension Development Host.

## Documentation

- [Changelog](apps/vscode/CHANGELOG.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Contributing](docs/CONTRIBUTING.md)
- [Code of Conduct](docs/CODE_OF_CONDUCT.md)

## License

MIT License with Commons Clause — see [LICENSE](LICENSE).
