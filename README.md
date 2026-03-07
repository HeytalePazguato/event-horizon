# Event Horizon

Event Horizon is a VS Code extension that visualizes AI coding agents as a living cosmic system. Instead of viewing logs, terminals, or raw agent output, developers observe agent behavior in real time through an interactive universe.

## The Metaphor

> *"How would you visualize AI agents working together?"*

Imagine being asked this question. The answer: **the interaction between celestial bodies in a universe is an excellent way to showcase it.** Each agent is a planet — a massive entity that consumes energy, emits output, and exerts gravitational influence on its surroundings. Tasks orbit agents like moons. Data flows between agents as spaceships traversing curved arcs through space. And at the center of it all, a black hole — the singularity where completed work collapses, pulling everything toward it.

This metaphor works because it scales naturally. One agent is a lonely planet. Five agents become a solar system. The visual language — size, color, orbital speed, surface type — encodes real information without requiring labels or dashboards.

### Celestial Bodies

- **Planets** — Each AI agent appears as a planet. The visual style encodes the agent type:
  - **Gas giants** (Claude Code) — Large planets with visible ring systems and storm bands. Slow, massive, deliberate. Their breathing pulse is barely perceptible — they move with weight.
  - **Icy worlds** (Copilot) — Bright, reactive planets with a quick shimmer. Their fast pulse reflects the autocomplete nature — rapid-fire suggestions.
  - **Rocky planets** (OpenCode) — Solid, steady worlds with an even rhythm. Deterministic tool-based agents with predictable output.
  - **Volcanic planets** (Cursor, others) — Hot, restless surfaces that never fully settle. An irregular pulse that reflects unpredictable behavior.
  - Planet **size** scales with agent load — busier agents grow larger. Brightness increases with activity.

- **Moons** — Active subagents orbit their parent planet as small blue moons. Each subagent spawn creates a new moon at a different orbital distance and speed. When the subagent completes, the moon disappears. Up to 6 moons can orbit a single planet.

- **Spaceships** — Data transfers between agents are visualized as triangle ships flying curved bezier arcs between planets. Each ship leaves a colored trail (blue for Claude, purple for Copilot, green for OpenCode, gold for others). The arcs are computed to avoid the central black hole — even anti-podal routes curve safely around it.

- **Black Hole** — The singularity at the center of the universe. A layered disc (dark core, glowing accretion rings, outer halo) that exerts gravitational pull on nearby objects. Astronauts that drift too close are captured and spiral inward, shrinking and fading as they cross the event horizon.

- **Astronauts** — Small figures drifting through the universe, affected by gravity from both planets and the black hole. Click anywhere in empty space to spawn one. They bounce off the viewport edges and get consumed if they spiral too close to the singularity.

- **UFO** — Appears periodically, flies to a random planet, beams up a cow, then flies away in a random direction. Pure flavor.

### Command Center

A StarCraft 2 Terran-inspired control panel at the bottom of the viewport with chamfered corners and LED indicators. Three sections:
- **Agent Identity** (left) — Selected agent name, type icon, and state
- **Metrics** (center) — 5x2 grid showing Load, Tools, Prompts, Errors, Success%, Subagents, Tasks, Top Tool, Uptime, Last Active. Tabs for Info/Logs/Medals.
- **Controls** (right) — Command buttons: Pause, Isolate, Center, Connect, Spawn, Demo, Info

## Supported Agent Ecosystems

- **Claude Code** — Full hook integration (install via Connect wizard)
- **OpenCode** — Connector ready, hook support coming soon
- **GitHub Copilot** — Connector ready, integration coming soon
- **Cursor** — Connector ready, integration coming soon

## Project Structure

pnpm + Turborepo monorepo:

```
packages/
  core/        - Event model, bus, metrics engine, agent state (pure TS, no deps)
  connectors/  - Agent adapters (Claude Code, OpenCode, Copilot, mock)
  renderer/    - PixiJS 8 universe (planets, moons, ships, singularity, stars, UFO)
  ui/          - React + Zustand Command Center overlay
apps/
  vscode/      - VS Code extension host + webview
tools/
  mock-server/ - Standalone mock event emitter for development
docs/          - Documentation and development plan
```

## Prerequisites

- **Node.js** 18+
- **pnpm** (or use `npx pnpm`)
  - Install: `npm install -g pnpm`
  - Or Corepack: `corepack enable` then `corepack prepare pnpm@latest`

## Getting Started

```bash
pnpm install
pnpm build
```

## Testing the VS Code Extension

1. **Build** (from repo root): `pnpm build`

2. **Run:** Press **F5**. If prompted, click **Continue**. A second window opens (Extension Development Host).

3. **Open the view:** Click the **globe icon** in the sidebar, or **Ctrl+Shift+P** then **Event Horizon: Open Universe**.

4. **Connect an agent:** Click **Connect** in the Command Center, choose **Claude Code**, click **Install**. This adds curl hooks to `~/.claude/settings.json`. Start a Claude Code session and the planet appears automatically.

5. **Spawn an agent:** Click **Spawn** to open a new terminal running the selected agent CLI (Claude Code, OpenCode, or Aider).

6. **Demo mode:** Click **Demo** to see the universe populated with simulated agents.

**Send test events manually:**

PowerShell:
```powershell
$body = '{"id":"t1","agentId":"agent-1","agentName":"Test Agent","agentType":"opencode","type":"agent.spawn","timestamp":' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + ',"payload":{}}'
Invoke-RestMethod -Uri http://127.0.0.1:28765/events -Method Post -Body $body -ContentType "application/json"
```

Bash:
```bash
curl -X POST http://127.0.0.1:28765/events \
  -H "Content-Type: application/json" \
  -d "{\"id\":\"t1\",\"agentId\":\"agent-1\",\"agentName\":\"Test Agent\",\"agentType\":\"opencode\",\"type\":\"agent.spawn\",\"timestamp\":$(date +%s)000,\"payload\":{}}"
```

**Install from .vsix:** `cd apps/vscode && pnpm run package:vsix`, then **Extensions** > **...** > **Install from VSIX...** and reload.

### Seeing Changes After Edits

1. Rebuild: `pnpm build`
2. In the Extension Development Host: **Ctrl+Shift+P** > **Developer: Reload Window**

See [docs/e2e-testing.md](docs/e2e-testing.md) for more event sources (Claude Code hooks, OpenCode plugin).

## License

Private repository.
