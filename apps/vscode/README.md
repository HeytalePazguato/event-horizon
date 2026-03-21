# Event Horizon

**Real-time visual monitoring for AI coding agents.** See what Claude Code, OpenCode, and GitHub Copilot are doing, at a glance.

![Event Horizon Demo](https://raw.githubusercontent.com/HeytalePazguato/event-horizon/master/assets/demo.gif)

---

## Why Event Horizon?

Running AI agents in your editor means trusting processes you can't easily see. Event Horizon gives you **instant situational awareness**:

- **Which agents are running** and what state they're in (thinking, tool use, waiting for input, error)
- **File collisions**: two agents editing the same file trigger a visible lightning arc between their planets
- **Token burn & cost**: per-agent token usage and estimated USD cost, updated in real time
- **Agent cooperation**: agents sharing a workspace show automatic data-transfer ships between them
- **Subagent tracking**: spawned subagents appear as moons orbiting the parent planet

All of this runs **locally on your machine**, no data leaves localhost, no telemetry, no external calls.

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
