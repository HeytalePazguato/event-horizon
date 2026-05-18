# Agent Skills

**Skills** are reusable, named workflows your agents can invoke. Event Horizon ships ten of them — covering the whole coordination lifecycle — and discovers any others installed on your system.

A skill is a `SKILL.md` file: a name, a description, an allowed-tools list, and a block of instructions. When an agent invokes a skill, those instructions are loaded into its context.

---

## The ten bundled skills

These are pre-installed to `~/.claude/skills/` when you connect an agent. Invoke them with a slash command in your agent.

### `/eh:create-plan`

Create a multi-agent coordination plan and register it with Event Horizon. Produces parallel tracks, dependencies, acceptance criteria, and verify steps. The agent that runs this **becomes the orchestrator**.

```
/eh:create-plan Build a REST API with auth, a database layer, and tests
```

### `/eh:orchestrate`

Manage a plan as the orchestrator — spawn worker agents, assign tasks, monitor progress, handle failures and retries.

### `/eh:work-on-plan`

Claim and execute tasks from a plan. The agent picks up available work, implements it, self-verifies against the acceptance criteria, and marks progress.

### `/eh:verify-task`

Batch-verify completed tasks by running their verify commands. The reviewer's tool for confirming work actually holds up.

### `/eh:plan-status`

Show the status of all active plans — progress, blocked tasks, active agents, available work.

### `/eh:research`

Explore the codebase and output structured findings. Queries the [project graph](knowledge-graph.md#querying-the-graph) before falling back to grep.

### `/eh:review`

Review code changes for correctness, style, and edge cases — with severity levels and a verification pipeline.

### `/eh:test`

Write and run tests for a task, following the project's existing test conventions.

### `/eh:debug`

Diagnose and fix bugs — trace the root cause, apply a minimal fix. Also graph-aware.

### `/eh:optimize-context`

Build the [project knowledge graph](knowledge-graph.md#the-project-graph), tier instruction files into L0/L1/L2/L3, and — when invoked with a task description — hand the agent the relevant slice of the graph.

```
/eh:optimize-context "fix the auth token refresh bug"
```

---

## The Skills tab

The **Skills** tab in the [Command Center](command-center.md#skills) is where you manage skills:

- **Browse** every discovered skill, each with scope / agent-type / category badges.
- **Create** a new skill with the guided wizard — click the **+** button.
- **Organize** skills into category folders — the **Move** action on a skill card.

!!! note "📷 Screenshot needed"
    *The Skills tab showing discovered skills with their badges, and the + create button.*

---

## The skill marketplace

Click **Marketplace** in the [control grid](command-center.md#right-control-grid) to browse skill marketplaces — find and install new skills without leaving Event Horizon.

---

## Skill orbit

Each planet in the [Universe](the-universe.md#skill-orbit) has a **skill orbit ring** — a ring of dots, one per skill compatible with that agent. When a skill is **actively executing**, its dot **pulses cyan**. It's a live, at-a-glance view of which skills are in use.

---

## Syncing skills to workers

When an orchestrator spawns workers, it can push its skill definitions to them with the [`eh_sync_skills`](mcp-tools.md#orchestration) MCP tool — so every worker has the same skills available without you installing them everywhere.

---

## Creating your own skills

Use the **+** wizard in the Skills tab, or write a `SKILL.md` by hand. A skill file has front-matter (`name`, `description`, `allowed-tools`, `user-invocable`) followed by markdown instructions.

The tiering model from `/eh:optimize-context` is worth knowing here: **L3 — on-demand procedures** are exactly what skills are. Step-by-step how-tos that load *only when an agent explicitly invokes them*, rather than sitting in every agent's context all the time. Keep skills focused and invocable.
