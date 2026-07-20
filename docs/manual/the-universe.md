# The Universe

The Universe view is Event Horizon's cosmic visualization. It is not decoration — **the metaphor encodes real information.** Once you learn to read it, a glance tells you which agents are working, which are stuck, and where they're colliding.

This page is the legend.

!!! note "📷 Screenshot needed"
    *A busy Universe view: four planets of different types, orbiting moons, ships in transit, a workspace asteroid belt, and the central black hole. Annotated.*

---

## Planets — agents

Every connected agent is a **planet**. The planet's *type* tells you the agent's *type* at a glance:

| Planet | Agent type | Look |
|--------|-----------|------|
| **Gas giant** | Claude Code | Large, banded, with a "Great Storm" oval and a ring arc |
| **Rocky planet** | OpenCode | Medium, cratered with raised rims |
| **Icy planet** | GitHub Copilot | Small and bright, polar ice caps, crystal facet lines |
| **Volcanic planet** | Cursor / unknown | Dark, lava cracks, hot glow spots |

Planet **size** also varies by type (gas giants are the biggest, icy planets the smallest). Both the **color** and the **size multiplier** for each agent type are configurable — see [`eventHorizon.agentColors.*`](configuration.md#agent-colors) and [`eventHorizon.agentSizes.*`](configuration.md#agent-sizes).

### Planet state indicators

The rings and glow around a planet tell you what the agent is doing *right now*:

| Indicator | Meaning |
|-----------|---------|
| **Pulsing ring** | The agent is thinking / processing |
| **Amber breathing ring** | The agent is waiting for your input |
| **Red glow** | The agent is in an error state |
| **Golden star with emission rays** | This agent is the [orchestrator](orchestration.md) of a plan |

!!! tip "Jump straight to a waiting agent"
    When an agent shows the amber breathing ring, run **Event Horizon: Focus Waiting Agent** from the Command Palette to jump to its terminal. Handy when you're running several agents and one needs you.

### Context fuel gauge

Each planet can show a **270° arc** around it — a fuel gauge for the agent's context window. It shifts colour as the window fills:

- **Cyan** — under 50% used
- **Amber** — 50–80% used
- **Red** — over 80% used (pulses above ~90%)

Toggle it with [`eventHorizon.contextGauge.enabled`](configuration.md#eventhorizoncontextgaugeenabled) and set the assumed window size with [`eventHorizon.contextGauge.windowSize`](configuration.md#eventhorizoncontextgaugewindowsize) (default 200,000 tokens).

### Skill orbit

A ring of small dots around a planet represents the **skills compatible with that agent**. A dot **pulses cyan** when its skill is actively executing. See [Agent Skills](skills.md).

---

## Moons — subagents

When an agent spawns a subagent, it appears as a **moon orbiting the parent planet**. Moons come and go as subagents start and finish.

---

## The black hole — the orchestrator / system center

The **singularity** at the center of the universe is the gravitational anchor of the system. It represents the orchestration core. Click it to see **cosmic statistics** — aggregate metrics across the whole universe.

When a plan has an orchestrator, that agent's planet is also marked with the golden star (see above) — the black hole is the *system*, the golden star is the *agent currently running the show*.

---

## Ships — data transfers between agents

**Ships** are small triangular craft that fly between planets. A ship means **two agents are cooperating** — they share a working directory, so Event Horizon spawns data-transfer events between them.

Cooperation is detected automatically by comparing each agent's `cwd`: exact path match, nested paths, or a shared VS Code workspace folder. It works across agent types — a Claude Code planet and an OpenCode planet sharing a repo will exchange ships.

---

## Lightning arcs — file collisions

A **cyan lightning arc** between two planets means **both agents touched the same file**. This is the visual you watch for: it's the early warning that two agents are about to clobber each other's work.

If you turn on [file locking](file-locking.md), the collision is *prevented* — the second agent is hard-blocked — but the arc still draws so you can see it happened.

---

## Asteroid belt — workspace groups

When several agents share a working directory, a faint **asteroid belt** is drawn around the group. It's the visual grouping for "these agents are all working the same project."

---

## Orbital debris — plan tasks

When a [plan](orchestration.md) is active, its tasks appear as **orbital debris**. The shape and colour of each piece encode the task's **status** — pending, claimed, in progress, done, failed — so the plan's progress is visible in the cosmic view without opening the dashboard.

---

## Wormholes — communication channels

A violet **wormhole** portal between two planets represents an inter-agent communication channel — agents exchanging messages via [`eh_send_message`](mcp-tools.md#messaging).

---

## Astronauts, UFOs, and the playful layer

Not everything in the universe is telemetry. Event Horizon has a small physics playground:

- **Click empty space** to spawn an **astronaut** that drifts through the universe, affected by the black hole's gravity.
- Astronauts can fire jetpacks, bounce off edges, graze the black hole, get pulled in, or land on planets.
- A **UFO** occasionally appears — click it to capture it.

These drive a good chunk of the [achievements](achievements.md). They have no effect on your agents — they're just there.

!!! note "📷 Screenshot needed"
    *Astronauts mid-flight near the black hole, one being pulled in, a UFO in the corner.*

---

## Interacting with the universe

| Action | Result |
|--------|--------|
| **Click a planet** | Select it — the [Command Center](command-center.md) fills with its metrics |
| **Click the black hole** | Show cosmic statistics for the whole system |
| **Click empty space** | Spawn an astronaut |
| **Click a UFO** | Capture it |
| **Drag a planet** | Reposition it — constellation lines and ships follow |
| **Center button** (control grid) | Re-center the view on the selected agent |

Animation speed across the whole view is controlled by [`eventHorizon.animationSpeed`](configuration.md#eventhorizonanimationspeed) — drop it to `0.25` for slow-mo, raise it to `3.0` to fast-forward.
