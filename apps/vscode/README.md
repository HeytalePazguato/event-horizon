# Event Horizon

**The multi-agent control plane for AI coding.** Monitor, coordinate, and prevent file collisions across Claude Code, OpenCode, and GitHub Copilot — all from one dashboard.

![Event Horizon Demo](https://raw.githubusercontent.com/HeytalePazguato/event-horizon/master/assets/demo.gif)

---

## Why Event Horizon?

Running multiple AI agents means they can step on each other's work. Event Horizon is the first tool that **actually prevents it**:

- **File Locking** — When Agent A is editing a file, Agent B is **hard-blocked** from accessing it. Not a warning — the tool call is prevented. B sees a clear message and works on other files until A is done. No interleaved writes, no merge conflicts, no lost work.
- **File Activity Heatmap** — See which files each agent touches, which are contested (multiple agents), and which have errors. Sort by activity, contention, or recency.
- **Operations Dashboard** — Full-screen view with agent sidebar, sortable file table, searchable logs, and agent timeline. Toggle between the cosmic visualization and the ops dashboard.
- **Live Monitoring** — Per-agent token usage, cost tracking, tool call counts, error rates. Lightning arcs when agents touch the same file. Asteroid belts around workspace groups.

All of this runs **100% locally** on your machine. No data leaves localhost, no telemetry, no external calls.

## Get Started (30 seconds)

1. **Open the universe**: Click the rocket icon (top-right of any editor tab) or press `Ctrl+Shift+E H`
2. **Connect an agent**: Click **Connect** in the Command Center → choose your agent → **Install**
3. **Start coding**: Launch a Claude Code or OpenCode session. Your agent appears as a planet.

That's it. No tokens, no config files, no API keys.

> Don't have an agent running? Click **Demo** to see the universe in action with simulated agents.

## Features

### Live Agent Visualization

Each agent is a planet. Planet type reflects the agent ecosystem, gas giants for Claude Code, rocky worlds for OpenCode, icy planets for Copilot. Size scales with activity. Brightness increases with load.

### File Collision Detection

When two agents edit the same file within 10 seconds, a **lightning arc crackles between their planets** with the filename displayed at the midpoint. Spot conflicts before they become merge headaches.

### File Locking (Multi-Agent Collision Prevention)

The first distributed lock manager for AI coding agents. When enabled:

1. Agent A starts writing to `src/index.ts` → Event Horizon acquires a lock
2. Agent B tries to read or write `src/index.ts` → **tool call is blocked** (hard-block, not a warning)
3. Agent B sees: *"BLOCKED: src/index.ts is locked by Claude Code (project-a). Work on other files first, retry in 30 seconds."*
4. Agent A finishes → lock auto-releases → Agent B retries successfully

**Result:** clean sequential file access, zero interleaved writes.

Enable in Settings (`eventHorizon.fileLockingEnabled`) or toggle "Locks ON/OFF" in the Operations dashboard. Currently supported for Claude Code. OpenCode support in progress.

### Operations Dashboard

A full-screen alternative to the cosmic view. Toggle with `Ctrl+Shift+E O` or the layout icon in the editor title bar.

- **Agent Sidebar** — All connected agents grouped by workspace, with state indicators
- **Overview** — Full-width metrics grid with tool breakdown charts
- **Files** — Sortable heatmap table: Total ops, Reads, Writes, Errors, Agents, Last Active
- **Logs** — Searchable event log with type filters and auto-scroll
- **Timeline** — Horizontal swimlane showing each agent's activity over time

### Workspace Grouping

Agents sharing a directory are automatically clustered and wrapped in an **asteroid belt**. You can see at a glance which agents are working on the same project, no configuration needed.

### Token & Cost Tracking

The Command Center shows **per-agent metrics**: input/output tokens, estimated cost (USD), tool call counts, error rates, and active tasks. Know exactly what each agent is consuming.

### Subagent Moons

When an agent spawns subagents, they appear as **moons orbiting the parent planet**. Each moon has its own orbit speed and distance. When the subagent completes, the moon disappears.

### Agent Skills Management

Discover installed [Agent Skills](https://agentskills.io), create new ones with a guided wizard, browse skill marketplaces, and see which skills are actively executing, all from the Command Center.

### Command Center

A StarCraft-inspired control panel with agent identity, live metrics (Load, Tools, Prompts, Errors, Subagents, Top Tool, Uptime), event logs, achievement medals, and skill management. Click any planet to inspect it.

### Achievements

Medals tracking milestones, from your first agent spawn to multi-agent file collisions, UFO encounters, and astronaut black hole dives. Some are secret. Some have tiers.

## Supported Agents

| Agent | Status | Setup |
|-------|--------|-------|
| **Claude Code** | Supported | One-click hook install. No restart needed. |
| **OpenCode** | Supported | One-click plugin install. Restart OpenCode after. |
| **GitHub Copilot** | Supported | One-click hook install. [Known limitations](#known-limitations). |
| **Cursor** | Planned | Connector ready, UI integration coming soon. |

## Privacy & Performance

- **100% local**: HTTP server runs on `127.0.0.1:28765`. Nothing leaves your machine.
- **Zero overhead on agents**: Hooks use `--connect-timeout 2` with silent fallback (`|| true`). If Event Horizon is closed, your agents run exactly the same.
- **No telemetry**: No analytics, no tracking, no data collection of any kind.

## Known Limitations

- **Copilot**: `SessionEnd` never fires ([upstream bug](https://github.com/microsoft/vscode-copilot-release/issues)). Copilot planets persist until extension reload.

## Links

- [Full documentation & architecture](https://github.com/HeytalePazguato/event-horizon)
- [Changelog](https://github.com/HeytalePazguato/event-horizon/blob/master/apps/vscode/CHANGELOG.md)
- [Report an issue](https://github.com/HeytalePazguato/event-horizon/issues)

## License

MIT License with Commons Clause — see [LICENSE](https://github.com/HeytalePazguato/event-horizon/blob/master/LICENSE) for details.
