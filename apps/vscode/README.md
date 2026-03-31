# Event Horizon

**Run multiple AI agents on the same codebase. Without the chaos.**

You're running Claude Code in one terminal, OpenCode in another, maybe Copilot in the background. They're all editing the same project. One overwrites the other's work. You don't notice until the build breaks.

Event Horizon fixes this. It gives your agents a **shared plan**, **file locks**, and **real-time coordination** — so they work together instead of against each other.

![Event Horizon Demo](https://raw.githubusercontent.com/HeytalePazguato/event-horizon/master/assets/demo.gif)

---

## What It Does

### Plan Coordination — agents that actually collaborate

Create a plan, assign agents to it, and let them claim tasks without stepping on each other:

```
Terminal 1 (Claude Code):  /eh:create-plan Build a REST API with auth and tests
Terminal 2 (Claude Code):  /eh:work-on-plan api Phase 1
Terminal 3 (OpenCode):     /eh:work-on-plan api Phase 2
```

Event Horizon parses your plan into tasks, tracks who claimed what, blocks duplicate claims, resolves dependencies, and updates the source markdown file as tasks complete. Watch it all happen live on the **Kanban board**.

### File Locking — no more overwritten work

When Agent A is editing `src/server.ts`, Agent B is **hard-blocked** from touching it. Not a warning — the tool call doesn't execute. B sees exactly who holds the lock and works on something else. When A finishes, the lock releases automatically.

Zero interleaved writes. Zero merge conflicts. Zero lost work.

### Live Visualization — see everything at a glance

Every agent is a planet. Their activity drives the universe:
- **Thinking** = pulsing ring. **Error** = red glow. **Waiting for input** = amber breathing ring.
- **Subagents** orbit as moons. **Data transfers** fly as ships.
- **File collisions** spark lightning between planets.
- **Workspace groups** cluster inside asteroid belts.

### Operations Dashboard

Switch to the full-screen dashboard for the numbers: token usage, costs, tool call breakdowns, file activity heatmaps, event timeline, and the plan Kanban board. Toggle with `Ctrl+Shift+E O`.

---

## Get Started (30 seconds)

1. **Open the universe**: Click the rocket icon (top-right of any editor tab) or `Ctrl+Shift+E H`
2. **Connect an agent**: Click **Connect** → choose your agent → **Install**
3. **Start coding**: Launch an agent session. Your planet appears.

No tokens. No config files. No API keys. Everything runs locally.

> No agent running? Click **Demo** to see the universe in action.

---

## Multi-Agent Coordination

Event Horizon ships with three skills that handle the coordination for you:

| Skill | What it does |
|-------|-------------|
| `/eh:create-plan` | Generates a plan optimized for parallel work. Scope check, file map, dependency annotations, verify steps. Registers it with Event Horizon automatically. |
| `/eh:work-on-plan` | Claims tasks, implements them, marks progress, notifies other agents of breaking changes. |
| `/eh:plan-status` | Shows progress, who's working on what, blocked tasks, available work. |

Under the hood, **15 MCP tools** power the coordination:

| Tool | Purpose |
|------|---------|
| `eh_load_plan` / `eh_get_plan` / `eh_list_plans` | Load, view, and list plans |
| `eh_claim_task` / `eh_update_task` | Claim and update tasks atomically |
| `eh_archive_plan` / `eh_delete_plan` | Manage plan lifecycle |
| `eh_send_message` / `eh_get_messages` | Agent-to-agent messaging |
| `eh_check_lock` / `eh_acquire_lock` / `eh_release_lock` / `eh_wait_for_unlock` | File lock management |
| `eh_list_agents` / `eh_file_activity` | Discovery and monitoring |

Agents don't need to know these tool names — the skills handle everything.

---

## Supported Agents

| Agent | Hooks | MCP Tools | File Locking | Token Tracking |
|-------|:-----:|:---------:|:------------:|:--------------:|
| **Claude Code** | ✅ | ✅ | ✅ | ✅ |
| **OpenCode** | ✅ | ✅ | ✅ | ✅ |
| **GitHub Copilot** | ✅ | ✅ | — | Partial |
| **Cursor** | Planned | Via `.cursor/mcp.json` | — | — |

All MCP server registrations happen automatically when you connect an agent. No manual config.

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

MIT License with Commons Clause — see [LICENSE](https://github.com/HeytalePazguato/event-horizon/blob/master/LICENSE).
