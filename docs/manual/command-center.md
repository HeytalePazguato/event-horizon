# Command Center

The **Command Center** is the panel docked at the bottom of the Universe view. It is your control surface — agent identity on the left, tabbed information in the center, and a control grid on the right.

Its visual design is modelled on the StarCraft II Terran command card: chamfered corners, side panels that protrude above the center, LED indicator dots.

!!! note "📷 Screenshot needed"
    *The full Command Center with a planet selected — left identity panel, center tabs on Info, right control grid.*

---

## Left — Agent identity

When you select a planet, the left panel shows that agent's:

- **Name** — the agent's identifier
- **Type** — Claude Code, OpenCode, Copilot, Cursor, or unknown
- **State** — idle, thinking, waiting, error, terminated

With no planet selected, this panel is empty — select a planet in the universe to populate it.

---

## Center — Information tabs

The center panel has four tabs:

### Info

Live metrics for the selected agent:

- **Load** — how hard the agent is working right now
- **Tool calls** — count of tools the agent has invoked
- **Prompts** — count of prompts processed
- **Errors** — error count
- **Uptime** — how long the agent has been connected
- **Activity sparkline** — a small graph of recent activity

### Logs

The **event stream** for the selected agent — tool calls, prompts, task updates, errors — newest first. This is the raw feed of what the agent is doing.

### Medals

Your [achievements](achievements.md). Unlocked medals are shown in full; locked ones are dimmed, and secret ones stay hidden until earned. Tiered achievements show your current tier and progress to the next.

### Skills

The [skills](skills.md) Event Horizon has discovered on your system. From here you can:

- **Browse** skills, each with scope / agent-type / category badges
- **Create** a new skill with the guided wizard (the **+** button)
- **Organize** skills into category folders (the **Move** action on a skill card)

---

## Right — Control grid

A 4×3 grid of command buttons, SC2 command-card style. The buttons:

| Button | What it does |
|--------|--------------|
| **Pause** | Pause the visualization |
| **Isolate** | Focus the view on the selected agent, dimming the rest |
| **Center** | Re-center the camera on the selected agent |
| **Connect** | Open the [agent connection wizard](getting-started.md#3-connect-an-agent) |
| **Spawn** | Spawn a new agent (orchestrator workflows — see [Orchestration](orchestration.md)) |
| **Export** | Export session data to a file (see below) |
| **Screenshot** | Capture the current universe view as an image |
| **Marketplace** | Browse [skill marketplaces](skills.md#the-skill-marketplace) to find and install skills |
| **Demo** | Toggle the [demo simulation](getting-started.md#5-try-the-demo-optional) on/off |
| **Info** | Open contextual help |

!!! tip "LED indicators"
    The small dots at the inner corners of the side panels are status LEDs — a quick visual pulse that the Command Center is live and receiving events.

---

## Exporting data

The **Export** button (and the `Event Horizon: Export Data…` command) writes your session data — events, metrics, agent history — to a file at a location you choose. Nothing is sent anywhere; the file is yours. See [Privacy & Data](privacy.md#what-leaves-your-machine).

---

## Switching to the dashboard

The Command Center is the control surface for the *cosmic* view. For a denser, full-screen, tabbed presentation of the same data — Kanban board, timeline swimlanes, cost insights, the knowledge graph canvas — toggle to the [Operations Dashboard](operations-dashboard.md) with ++ctrl+shift+e++ ++o++.
