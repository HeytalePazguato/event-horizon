# Event Horizon

**Tell one AI agent to build a feature. It creates the plan, spawns the team, and manages the entire project.**

You open three terminals. Claude Code is building the API. OpenCode is writing tests. Copilot is updating the docs. They're all editing the same project. One overwrites the other's work. You don't notice until the build breaks.

Event Horizon fixes this. It turns any AI agent into a team lead that can spawn workers, assign roles, share knowledge, track budgets, and coordinate work across your entire codebase.

![Event Horizon Demo](https://raw.githubusercontent.com/HeytalePazguato/event-horizon/master/assets/demo2.gif)

---

## How It Works

### 1. Create a plan

```
/eh:create-plan Build a REST API with auth, database layer, and tests
```

Event Horizon generates a plan with parallel tracks, dependency annotations, and verify steps. The agent that creates the plan automatically becomes the **orchestrator**.

### 2. The orchestrator spawns the team

The orchestrator agent spawns workers in visible VS Code terminals. Each worker gets a role, a task assignment, and access to the shared knowledge base. You can see every terminal, every agent, everything they're doing.

```
Orchestrator → spawns Claude Code (implementer) → claims database tasks
Orchestrator → spawns OpenCode (tester) → claims test tasks
Orchestrator → spawns Copilot (reviewer) → reviews completed work
```

### 3. Agents coordinate themselves

Workers claim tasks atomically. Dependencies are enforced. File locks prevent collisions. If a task fails, cascade failure propagates cleanly and retry recovers automatically. The Kanban board and Universe visualization update live.

---

## What It Does

### Orchestrator Role

The agent that creates a plan auto-becomes the orchestrator. It gains elevated MCP tools to spawn agents, assign tasks, monitor the team, and control budgets. Any agent type can be the orchestrator. Creating the plan IS the promotion.

### Agent Spawning

Agents spawn in **visible VS Code terminals**, not hidden background processes. You can see what every agent is doing at any moment. Click a planet in the Universe to focus its terminal. Terminals stay open on completion so you can review output.

### Shared Knowledge

A live knowledge base where both humans and agents contribute context. Two scopes:
- **Workspace knowledge** (persistent) — tech stack, conventions, constraints. Survives across plans and sessions.
- **Plan knowledge** (scoped) — discoveries, corrections, and decisions during execution. Lives and dies with the plan.

Different from CLAUDE.md: shared knowledge is real-time, team-wide, and agents contribute too.

### Plan Coordination

- **Atomic task claiming** — no race conditions, no duplicate work
- **Dependency resolution** — blocked tasks auto-unblock when dependencies complete
- **Cascade failure** — when a task fails, all transitive dependents fail cleanly with root cause
- **Auto-retry** — failed tasks retry with exponential backoff, cascade-failed dependents auto-recover
- **Smart recommendations** — agents ask "what should I work on next?" and get scored suggestions
- **Scheduling strategies** — round-robin, least-busy, capability-match, or dependency-first auto-assignment
- **Multi-plan support** — run multiple plans simultaneously, each with its own orchestrator

### File Locking

When Agent A is editing `src/server.ts`, Agent B is **hard-blocked** from touching it. Not a warning — the tool call doesn't execute. When A finishes, the lock releases automatically. Zero interleaved writes.

### Git Worktree Isolation

For full isolation, agents can work in their own git worktrees. The orchestrator creates a worktree per agent, each with its own branch. Completed work merges back automatically. Complements file locking — use locks for shared work, worktrees for isolated tracks.

### Budget Controls

Set a per-plan budget in USD. Event Horizon tracks cumulative cost across all agents. Warning at 80%, hard stop at 100%. Agents can check remaining budget before expensive operations. Per-agent cost breakdowns in the dashboard.

### Session Resume

When an agent picks up a task it previously worked on, it resumes the prior conversation instead of cold-starting. No lost context, no wasted tokens re-reading the codebase.

### Agent Roles

Six built-in roles (researcher, planner, implementer, reviewer, tester, debugger) plus custom roles. When an agent claims a task tagged with a role, it automatically receives the role's instructions and recommended skills. The profiler tracks success rate, speed, and cost per agent type per role — so you know which agent is best at what.

### Heartbeat System

Know if an agent is alive or just silent. Configurable heartbeat intervals with stale/lost detection. Dead agents show a fading planet in the Universe view.

### Live Visualization

Every agent is a planet. The cosmic metaphor encodes real information:

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
- **Plan** — Kanban board with sticky headers, progress bar, dependency annotations
- **Dependencies** — DAG visualization with critical path highlighting and cascade failure animation
- **Roles** — role definitions, agent assignments, per-role performance profiles
- **Knowledge** — workspace and plan knowledge entries, add/edit/delete, real-time updates

---

## Get Started (30 seconds)

1. **Open the universe**: Click the rocket icon (top-right of any editor tab) or `Ctrl+Shift+E H`
2. **Connect an agent**: Click **Connect** → choose your agent → **Install**
3. **Start coding**: Launch an agent session. Your planet appears.

No tokens. No config files. No API keys. Everything runs locally.

> No agent running? Click **Demo** to see the universe in action.

---

## MCP Coordination Tools

30+ MCP tools power the coordination, grouped by access level:

**Worker tools** (all agents):

| Tool | Purpose |
|------|---------|
| `eh_load_plan` / `eh_get_plan` / `eh_list_plans` | Load, view, and list plans |
| `eh_claim_task` / `eh_update_task` / `eh_retry_task` | Claim, update, and retry tasks |
| `eh_recommend_task` | Get scored task suggestions |
| `eh_archive_plan` / `eh_delete_plan` | Manage plan lifecycle |
| `eh_send_message` / `eh_get_messages` | Agent-to-agent messaging |
| `eh_check_lock` / `eh_acquire_lock` / `eh_release_lock` / `eh_wait_for_unlock` | File lock management |
| `eh_list_agents` / `eh_file_activity` | Discovery and monitoring |
| `eh_write_shared` / `eh_read_shared` / `eh_get_shared_summary` / `eh_delete_shared` | Shared knowledge |
| `eh_list_roles` / `eh_assign_role` | Role management |
| `eh_get_agent_profile` / `eh_recommend_agent` | Performance profiling |
| `eh_heartbeat` / `eh_get_budget` / `eh_get_session` | Status and session management |

**Orchestrator tools** (auto-granted when an agent creates a plan):

| Tool | Purpose |
|------|---------|
| `eh_spawn_agent` / `eh_stop_agent` | Spawn and terminate agents |
| `eh_reassign_task` | Move tasks between agents |
| `eh_get_team_status` | Full team overview |
| `eh_auto_assign` | Run scheduling strategy on unassigned tasks |
| `eh_create_worktree` / `eh_remove_worktree` | Git worktree isolation |
| `eh_request_budget_increase` | Request more budget (user approves) |
| `eh_sync_skills` | Push skills to spawned agents |

Agents don't need to know these tool names — the bundled skills handle everything.

---

## Bundled Skills

Seven coordination skills ship with the extension, auto-installed so all agents discover them:

| Skill | Role | What it does |
|-------|------|-------------|
| `/eh:create-plan` | Planner | Generate a plan with parallel tracks, dependencies, and verify steps |
| `/eh:work-on-plan` | Implementer | Claim tasks, implement, mark progress, broadcast breaking changes |
| `/eh:plan-status` | Any | View progress, blocked tasks, active agents, available work |
| `/eh:research` | Researcher | Explore codebase, gather context, output structured findings |
| `/eh:review` | Reviewer | Code review with severity levels, run tests if available |
| `/eh:test` | Tester | Write tests following project conventions, report coverage |
| `/eh:debug` | Debugger | Diagnose bugs, trace root cause, apply minimal fix, verify |

---

## Supported Agents

| Agent | Hooks | MCP Tools | File Locking | Spawnable | Token Tracking |
|-------|:-----:|:---------:|:------------:|:---------:|:--------------:|
| **Claude Code** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **OpenCode** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **GitHub Copilot** | ✅ | ✅ | — | — | Partial |
| **Cursor** | ✅ | ✅ | — | ✅ | — |

All MCP server registrations happen automatically when you connect an agent. No manual config.

---

## Why Event Horizon

- **Zero infrastructure** — install the extension and you're done. No Docker, no databases, no accounts.
- **Agent-agnostic** — works with any coding agent. Claude Code, OpenCode, Copilot, Cursor. They all share the same plan board, file locks, and message bus.
- **MCP-native** — agents use the standard MCP protocol. No custom APIs, no vendor lock-in.
- **Markdown plans** — portable, version-controllable, readable. Your plans are just markdown files.
- **100% local** — server runs on `127.0.0.1:28765`. Nothing leaves your machine. No telemetry.
- **VS Code native** — no context switching. Agents, visualization, and dashboard all live where you code.
- **Visible agents** — spawned agents run in real VS Code terminals. You can see everything they do.

---

## Privacy & Performance

- **100% local** — server runs on `127.0.0.1:28765`. Nothing leaves your machine.
- **Zero agent overhead** — hooks use `--connect-timeout 2` with silent fallback. If Event Horizon is closed, your agents run identically.
- **No telemetry** — no analytics, no tracking, no data collection.

---

## Links

- [Full documentation & source code](https://github.com/HeytalePazguato/event-horizon)
- [Changelog](https://github.com/HeytalePazguato/event-horizon/blob/master/apps/vscode/CHANGELOG.md)
- [Report an issue](https://github.com/HeytalePazguato/event-horizon/issues)
- [Rate this extension](https://marketplace.visualstudio.com/items?itemName=HeytalePazguato.event-horizon-vscode&ssr=false#review-details)

MIT License with Commons Clause — see [LICENSE](https://github.com/HeytalePazguato/event-horizon/blob/master/LICENSE).
