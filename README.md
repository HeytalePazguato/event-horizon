# Event Horizon — Multi-agent orchestration for AI coding agents

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/HeytalePazguato.event-horizon-vscode?label=VS%20Code%20Marketplace&color=blue)](https://marketplace.visualstudio.com/items?itemName=HeytalePazguato.event-horizon-vscode)
[![Open VSX](https://img.shields.io/open-vsx/v/HeytalePazguato/event-horizon-vscode?label=Open%20VSX)](https://open-vsx.org/extension/HeytalePazguato/event-horizon-vscode)
[![Open VSX downloads](https://img.shields.io/open-vsx/dt/HeytalePazguato/event-horizon-vscode)](https://open-vsx.org/extension/HeytalePazguato/event-horizon-vscode)
[![GitHub stars](https://img.shields.io/github/stars/HeytalePazguato/event-horizon?style=social)](https://github.com/HeytalePazguato/event-horizon)

**Turn any AI coding agent into a project manager.** One command creates a plan, spawns a team of AI agents, assigns roles, and manages the entire project -- while you watch it happen live in a cosmic visualization where every agent is a planet.

Works with Claude Code, OpenCode, GitHub Copilot, and Cursor. Mix and match freely.

![Event Horizon Demo](assets/demo2.gif)

---

## The origin

I asked Claude:

> *"If you could choose a visual representation of yourself as an AI agent, how would you represent yourself and your fellow AI agents collaborating?"*

Claude's answer:

> *"Each agent is a planet -- a massive entity that consumes energy, emits output, and exerts gravitational influence. Tasks orbit as moons. Data flows as ships. At the center, a black hole where completed work collapses. This scales naturally. One agent is a lonely planet. Five agents become a solar system."*

From that conversation, Event Horizon was born.

---

## What happens when you use it

### Before: you manage every agent manually

You open three terminals. Claude Code builds the API. OpenCode writes tests. Copilot updates docs. They all edit the same project. Claude overwrites OpenCode's changes. Nobody notices. The build breaks. You untangle the mess.

### After: your agent manages the team for you

```
/eh:create-plan Build a REST API with auth, database layer, and tests
```

Your agent becomes the **orchestrator**. It analyzes the work, breaks it into parallel tasks with dependencies, spawns worker agents in visible terminals, assigns roles, enforces file locks, tracks the budget, retries failures with model escalation, and reports back when everything is done.

You watch it happen on a live Kanban board and a cosmic universe where every agent is a planet, every task is orbital debris, and file collisions spark lightning between worlds.

---

## Install

Event Horizon is published to the VS Code Marketplace and the Open VSX Registry.

- **VS Code** -- `ext install HeytalePazguato.event-horizon-vscode` or the [Marketplace page](https://marketplace.visualstudio.com/items?itemName=HeytalePazguato.event-horizon-vscode)
- **Cursor** -- Extensions panel, search **Event Horizon** (served from Open VSX)
- **VSCodium, Windsurf, Gitpod, Eclipse Theia, Coder** -- Extensions panel or install from [Open VSX](https://open-vsx.org/extension/HeytalePazguato/event-horizon-vscode)

**Get started in 30 seconds:**

1. Click the rocket icon (top-right of any editor tab) or `Ctrl+Shift+E H`
2. Click **Connect** and choose your agent
3. Start coding -- your planet appears

No accounts. No config files. No API keys. Everything runs on your machine.

---

## Supported agents

| Agent | Hooks | MCP Tools | File Locking | Spawnable | Token Tracking |
|-------|:-----:|:---------:|:------------:|:---------:|:--------------:|
| **Claude Code** | Yes | Yes | Yes | Yes | Yes |
| **OpenCode** | Yes | Yes | Yes | Yes | Yes |
| **GitHub Copilot** | Yes | Yes | -- | -- | Partial |
| **Cursor** | Yes | Yes | -- | Yes | Yes |

One-click connect for all agents. MCP server auto-registered. Hooks auto-updated on every activation. Mix and match agents freely -- Claude orchestrating OpenCode workers is a first-class workflow.

---

## Core capabilities

**Multi-agent orchestration** -- The agent that creates a plan auto-becomes the orchestrator with elevated MCP tools to spawn agents, assign tasks, monitor progress, and control budgets. Spawned agents run in visible VS Code terminals. Any agent type can orchestrate any other.

**Plan coordination** -- Atomic task claiming, dependency resolution, cascade failure with auto-retry and model escalation (haiku fails, sonnet retries, opus escalates), smart task recommendations, scheduling strategies (round-robin, least-busy, capability-match, dependency-first), multi-plan support.

**File locking** -- When Agent A edits a file, Agent B is hard-blocked. Not a warning -- the tool call doesn't execute. Locks refresh on writes and release on termination.

**Git worktree isolation** -- Agents work in their own git worktrees with separate branches. Completed work merges back automatically.

**Shared knowledge** -- A live knowledge base where humans and agents contribute context in real-time. Auto-discovers CLAUDE.md, .cursorrules, copilot-instructions.md. Workspace knowledge persists across sessions; plan knowledge lives with the plan.

**Budget and cost controls** -- Per-plan limits with warning at 80% and hard stop. Tiered model selection tries the cheapest model first. Cost Insights panel shows cache efficiency, duplicate reads, and actionable recommendations.

**Agent roles** -- Eight built-in roles plus custom roles. Profiler tracks success rate, speed, and cost per agent type per role.

**Session resume** -- Agents resume prior conversations when picking up previously worked tasks. No lost context, no wasted tokens.

**40+ MCP tools** -- All agents access coordination tools via the auto-registered MCP server. Nine bundled skills handle common workflows so agents don't need to memorize tool names.

**28 achievements** -- Milestones tracking your multi-agent journey. Some are secret. Some have tiers. All persist across sessions.

---

## The visualization

Every agent is a planet. The metaphor encodes real information:

| Visual | Meaning |
|--------|---------|
| Planet type (gas, rocky, icy, volcanic) | Agent type (Claude, OpenCode, Copilot, Cursor) |
| Golden star with emission rays | Orchestrator managing the plan |
| Pulsing ring | Agent is thinking |
| Amber breathing ring | Waiting for user input |
| Orbiting moons | Active subagents |
| Ships between planets | Data transfers between cooperating agents |
| Lightning arcs | File collision -- two agents on the same file |
| Asteroid belt | Workspace group (shared directory) |
| Orbital debris | Plan tasks (shape and color encode status) |

The **Operations Dashboard** (`Ctrl+Shift+E O`) provides a full-screen view with agents/plans sidebar, metrics overview, file activity heatmap, searchable event logs, timeline swimlanes, Kanban board with dependency DAG, role assignments with performance profiles, cost insights, and shared knowledge management.

---

## Why Event Horizon

Most developers using AI coding agents are running them one at a time, manually, with no coordination. The moment you add a second agent, you need a system: who works on what, who can touch which files, what happens when something fails. Event Horizon is that system.

- **Zero infrastructure** -- install the extension and you're done. No Docker, no databases, no accounts.
- **Agent-agnostic** -- Claude Code, OpenCode, Copilot, Cursor. They all share the same plan board, file locks, and message bus.
- **MCP-native** -- standard protocol, no custom APIs, no vendor lock-in.
- **Markdown plans** -- portable, version-controllable, readable. Plans are just markdown files.
- **100% local** -- server on `127.0.0.1:28765`. Nothing leaves your machine. No telemetry.
- **VS Code native** -- no context switching. Everything lives where you code.
- **Visible agents** -- spawned agents run in real terminals. Full transparency.

---

## Privacy

- **100% local** -- HTTP server on `127.0.0.1:28765`. Nothing leaves your machine.
- **Zero agent overhead** -- hooks use `--connect-timeout 2` with silent fallback. If Event Horizon is closed, agents run identically.
- **No telemetry** -- no analytics, no tracking, no data collection.

---

## Development

See [CONTRIBUTING.md](docs/CONTRIBUTING.md) for full guidelines.

```bash
pnpm install && pnpm build    # build all packages
pnpm test                      # run tests (370+)
pnpm dev                       # watch mode
```

Press **F5** to launch the Extension Development Host.

## Documentation

- [Changelog](apps/vscode/CHANGELOG.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Contributing](docs/CONTRIBUTING.md)
- [Publishing](docs/PUBLISHING.md)
- [Marketplaces](docs/MARKETPLACES.md)
- [Code of Conduct](docs/CODE_OF_CONDUCT.md)

## License

MIT License with Commons Clause -- see [LICENSE](LICENSE).

If Event Horizon is useful to you, consider [starring the repo](https://github.com/HeytalePazguato/event-horizon) -- it helps others find it.
