# Multi-Agent Orchestration

This is the heart of Event Horizon. Instead of you babysitting three terminals, **one agent becomes the project manager** — it plans the work, spawns a team, assigns roles, enforces locks, tracks the budget, retries failures, and reports back.

---

## The core idea

You give one agent a goal. It runs the [`/eh:create-plan`](skills.md#ehcreate-plan) skill:

```
/eh:create-plan Build a REST API with auth, a database layer, and tests
```

That agent **auto-becomes the orchestrator**. It now has elevated MCP tools to spawn agents, assign tasks, monitor the team, and control the budget. It breaks the goal into parallel tasks with dependencies, spawns worker agents in **visible VS Code terminals**, and manages the run to completion.

You watch it happen — on the [Kanban board](operations-dashboard.md#plans-kanban) and in the [Universe](the-universe.md), where the orchestrator wears a golden star and tasks orbit as debris.

!!! note "📷 Screenshot needed"
    *Mid-orchestration: an orchestrator planet with the golden star, three worker planets, the Kanban board showing tasks moving across columns.*

---

## Plans

A **plan** is a structured breakdown of work: a set of tasks, each with dependencies, acceptance criteria, and a verify command.

| Concept | What it is |
|---------|-----------|
| **Task** | A unit of work — claimed by one agent, has a status and a verify step |
| **Dependency** | Task B is *blocked* until task A completes; blocked tasks auto-unblock |
| **Acceptance criteria** | What "done" means for the task — the worker self-checks against this |
| **Verify command** | A command run to confirm the task actually works (tests, build, lint) |

Plans live in the [Operations Dashboard → Plans tab](operations-dashboard.md#plans-kanban) as a Kanban board with a dependency DAG. They're created and managed through skills and [MCP tools](mcp-tools.md#plans-and-tasks) — you don't hand-edit them.

### Plan scope

- **Workspace knowledge** persists across sessions and plans.
- **Plan knowledge** lives with the plan and is archived or deleted with it.

---

## Roles

Every agent can be assigned a **role** that shapes what work it picks up and how. Six are built in:

| Role | Specializes in |
|------|----------------|
| **researcher** | Exploring the codebase, gathering context, producing findings |
| **planner** | Breaking goals into structured plans |
| **implementer** | Writing the code |
| **reviewer** | Reviewing changes for correctness, style, edge cases |
| **tester** | Writing and running tests |
| **debugger** | Diagnosing bugs and applying minimal fixes |

Two more — **orchestrator** and **context-optimizer** — are claimed by behaviour rather than assigned.

### Custom roles

Define your own with the [`eventHorizon.roles.custom`](configuration.md#eventhorizonrolescustom) setting — each custom role maps to a set of skills and a block of markdown instructions sent to the agent when it takes the role. Map roles to default agent types with [`eventHorizon.roles.assignments`](configuration.md#eventhorizonrolesassignments), e.g. `{ "researcher": "claude-code", "reviewer": "copilot" }`.

### The profiler

Event Horizon tracks **success rate, speed, and cost per agent type per role** over time. That profile data — visible in the [Roles tab](operations-dashboard.md#roles) — feeds **smart task recommendations**: when there's work to assign, agents are scored by role match, historical performance, and current load.

---

## Spawning workers

The orchestrator spawns workers with the [`eh_spawn_agent`](mcp-tools.md#orchestration) MCP tool. Key things to know:

- Spawned agents run in **visible VS Code terminals** — full transparency. Click any planet to focus its terminal.
- Worker agent type defaults to the orchestrator's own runtime (a Claude Code orchestrator spawns Claude Code workers) unless explicitly overridden.
- Terminal focus behaviour is controlled by [`eventHorizon.spawnTerminalFocus`](configuration.md#eventhorizonspawnterminalfocus): keep them in the background, focus immediately, or focus only when the worker needs you.

You can also spawn an agent manually from the **Spawn** button in the [Command Center control grid](command-center.md#right-control-grid).

### The watchdog

Spawned workers that go silent — stuck on a permission prompt, hung — are **auto-failed** after [`eventHorizon.watchdog.timeoutMinutes`](configuration.md#eventhorizonwatchdogtimeoutminutes) minutes (10 by default). The orchestrator is notified through the message queue so it can retry or reassign. Set the timeout to `0` to disable.

---

## Task lifecycle

```
available → claimed → in progress → done
                          ↓
                       failed → retried (with model escalation)
```

- **Atomic claiming** — a task can only be claimed by one agent; no duplicate work.
- **Dependency resolution** — completing a task auto-unblocks everything that depended on it.
- **Cascade failure with auto-retry** — a failed task is retried, escalating the model each time (a cheap model fails → a stronger one retries → the strongest escalates). See [Budget & Cost](budget.md#tiered-model-selection).

---

## Coordination primitives

Orchestration is built on a handful of [MCP tools](mcp-tools.md) that any agent can use, orchestrator or not:

- **[Messaging](mcp-tools.md#messaging)** — `eh_send_message` / `eh_get_messages` for agents to talk to each other.
- **[File locking](file-locking.md)** — hard-block conflicting writes.
- **[Shared knowledge](knowledge-graph.md#shared-knowledge)** — a live context base humans and agents both write to.
- **[Heartbeats](mcp-tools.md#heartbeat-and-worktrees)** — `eh_heartbeat` keeps an agent marked alive.

---

## Running orchestration yourself

You don't have to memorize tool names. The [bundled skills](skills.md) wrap the common workflows:

| You want to… | Run |
|--------------|-----|
| Create a plan | [`/eh:create-plan`](skills.md#ehcreate-plan) |
| Manage a plan as orchestrator | [`/eh:orchestrate`](skills.md#ehorchestrate) |
| Work tasks from a plan | [`/eh:work-on-plan`](skills.md#ehwork-on-plan) |
| Check where a plan stands | [`/eh:plan-status`](skills.md#ehplan-status) |
| Verify completed tasks | [`/eh:verify-task`](skills.md#ehverify-task) |
