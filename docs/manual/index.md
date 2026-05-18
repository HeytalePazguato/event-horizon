# Event Horizon User Manual

**Event Horizon turns any AI coding agent into a project manager.** One command creates a plan, spawns a team of AI agents, assigns roles, enforces file locks, tracks the budget, and manages the entire project — while you watch it happen live in a cosmic visualization where every agent is a planet.

This manual is the complete reference for using the extension. If you just want to get going, jump to **[Getting Started](getting-started.md)**.

!!! note "📷 Screenshot needed"
    *Hero shot — the Universe view with three connected agents (a gas giant, a rocky planet, an icy planet), ships flying between them, and the central black hole.*

---

## What Event Horizon does

You run AI coding agents — Claude Code, OpenCode, GitHub Copilot, Cursor. Event Horizon sits alongside them and does three things:

1. **Coordinates** them. Shared plans, atomic task claiming, file locking, inter-agent messaging, budget controls, and roles — so multiple agents can work the same project without stepping on each other.
2. **Visualizes** them. Every agent becomes a planet in a live cosmic system. The metaphor encodes real information: planet type is agent type, a pulsing ring means thinking, lightning arcs mean a file collision.
3. **Stays out of the way.** Everything runs locally on `127.0.0.1:28765`. No accounts, no API keys, no telemetry. If Event Horizon is closed, your agents run exactly the same.

---

## The two views

Event Horizon has one panel with two views you toggle between with ++ctrl+shift+e++ ++o++:

| View | What it is | Best for |
|------|-----------|----------|
| **Universe** | The cosmic visualization — planets, ships, the black hole | Ambient awareness, seeing the whole system at a glance |
| **Operations** | A full-screen dashboard with tabs | Drilling into plans, metrics, logs, the Kanban board, costs |

Both are driven by the same underlying event stream. Pick a default in [settings](configuration.md).

---

## How this manual is organized

<div class="grid cards" markdown>

-   :material-rocket-launch: **[Getting Started](getting-started.md)**

    Install the extension, open the universe, connect your first agent — in about two minutes.

-   :material-earth: **[Concepts](the-universe.md)**

    What the planets, ships, gauges, and dashboard tabs actually mean.

-   :material-account-group: **[Working with Agents](orchestration.md)**

    Orchestration, file locking, the knowledge graph, skills, and budgets — the coordination layer.

-   :material-connection: **[Agent Setup](setup/claude-code.md)**

    Per-agent connection guides for Claude Code, OpenCode, Copilot, and Cursor.

-   :material-cog: **[Reference](configuration.md)**

    Every setting, every MCP tool, troubleshooting, and privacy details.

</div>

---

## Requirements

- **VS Code 1.100.0 or newer** (or a compatible editor — Cursor, VSCodium, Windsurf, Gitpod, Theia, code-server)
- At least one supported AI coding agent installed (Claude Code, OpenCode, GitHub Copilot, or Cursor)
- A free TCP port — `28765` by default, [configurable](configuration.md#eventhorizonport)

You do **not** need a git repository, an account, or any API key to use Event Horizon. Some features (worktree isolation) need git; everything else works without it.

---

!!! tip "No agent handy? Run the demo"
    Open the panel and click **Demo** in the Command Center control grid. Event Horizon populates the universe with simulated agents so you can explore every visual without connecting anything real.
