# Architecture

Event Horizon is a **pnpm monorepo** managed with Turborepo. The build graph enforces dependency order: core builds first, then connectors/renderer/ui in parallel, then the VS Code extension last.

## Package Structure

```
packages/
  core/          Pure TS, no runtime deps
  connectors/    Agent payload adapters
  renderer/      PixiJS 8 visualization
  ui/            React + Zustand UI overlay
apps/
  vscode/        VS Code extension (host + webview)
tools/
  mock-server/   Development event emitter
```

### packages/core

The foundation layer. Exports:

- **`EventBus`** — Pub/sub for `AgentEvent` objects. Single `emit()` / `on()` API.
- **`AgentStateManager`** — Maintains current state (idle, thinking, tool_use, working, error) for each agent. Updated by applying events.
- **`MetricsEngine`** — Accumulates per-agent metrics (tool calls, errors, load, uptime). Processes each event to update counters.
- **`AgentEvent`** — The unified event type. All agent data flows through this shape:
  ```ts
  interface AgentEvent {
    id: string;
    agentId: string;
    agentName: string;
    agentType: 'claude-code' | 'opencode' | 'copilot' | 'cursor' | 'unknown';
    type: AgentEventType;  // 'agent.spawn' | 'tool.call' | 'task.start' | ...
    timestamp: number;
    payload: Record<string, unknown>;
  }
  ```

### packages/connectors

Adapter functions that normalize raw agent payloads into `AgentEvent`:

- **`mapClaudeHookToEvent()`** — Maps Claude Code hook POST bodies (`/claude` endpoint)
- **`mapOpenCodeToEvent()`** — Maps OpenCode plugin POST bodies (`/opencode` endpoint). Handles deduplication of `message.updated` events by message ID and role, extracts tool names from nested event structures, and maps `session.status` to task lifecycle events.
- **`mapCopilotToEvent()`** — Maps Copilot output channel text
- **`createMockEvent()`** — Generates random events for demo/testing

### packages/renderer

PixiJS 8 rendering layer, exported as a single React component `<Universe>`.

**Entities** (plain functions returning `Container`):
- `createPlanet()` — Layered circles with type-specific colors, ring systems, storm bands
- `createMoon()` — Small orbiting bodies for subagents
- `createShip()` — Triangle ships with colored trails for data transfers
- `createSingularity()` — Central black hole with accretion disc and glow
- `createStars()` — Background starfield with parallax drift
- `createAstronaut()` — 7 visual variants, affected by black hole gravity

**Effects**: `PulseWave`, `SolarFlare`, `TrafficRoute`

The Universe component manages a PixiJS `Application` with pan/zoom controls, a ticker for animation (moon orbits, ship paths, astronaut physics), and prop-driven updates for agents/metrics/ships.

### packages/ui

React + Zustand UI overlay rendered on top of the PixiJS canvas:

- **`CommandCenter`** — The main panel with three sections (AgentIdentity, MetricsPanel, AgentControls)
- **`useCommandCenterStore`** — Zustand store for selected agent, logs, achievements, UI state
- **`Achievements`** — Medal definitions, tiered thresholds, toast notifications
- **`Tooltip`** — Hover info for planets

### apps/vscode

The VS Code extension. Two separate build targets:

1. **Extension host** (`src/`) — Node.js context. Compiled with `tsc` to `out/`.
   - `extension.ts` — Activation, service wiring, commands
   - `eventServer.ts` — HTTP server on port `28765` (localhost only). Routes: `/claude`, `/opencode`, `/events`
   - `setupHooks.ts` — Writes Claude Code curl hooks to `~/.claude/settings.json`
   - `setupOpenCodeHooks.ts` — Writes OpenCode plugin to `~/.config/opencode/plugins/event-horizon.ts`
   - `webviewProvider.ts` — Creates the webview, handles messages (setup/remove agents, persist medals), hydrates state on open
   - `copilotChannel.ts` — Monitors Copilot output channel for events

2. **Webview** (`webview/`) — Browser context. Bundled with esbuild (IIFE) to `webview-dist/main.js`.
   - `index.tsx` — Mounts `<Universe>` + `<CommandCenter>`, manages agent/metrics state, handles events from the extension host, achievement detection, demo simulation, stale-agent cleanup

The webview **cannot use Node.js APIs**. Communication with the extension host is via `postMessage` / `onDidReceiveMessage`.

## Data Flow

```
Agent CLI (Claude Code / OpenCode)
  │
  │  HTTP POST to 127.0.0.1:28765
  ▼
Extension Host (eventServer.ts)
  │
  │  Connector maps raw payload → AgentEvent
  ▼
EventBus.emit()
  │
  ├── MetricsEngine.process(event)
  ├── AgentStateManager.apply(event)
  │
  │  webview.postMessage({ type: 'event', payload: event })
  ▼
Webview (index.tsx)
  │
  ├── React state updates (agents, metrics, ships)
  ├── Achievement detection
  │
  │  Props passed to components
  ▼
<Universe> (PixiJS)  +  <CommandCenter> (React)
```

## Persistence

- **Agent state and metrics** — In-memory only. Accumulated in the extension host (`AgentStateManager`, `MetricsEngine`) and hydrated to the webview on open via `init-state` message.
- **Achievements** — Persisted to VS Code `globalState` (survives restarts and updates). Webview sends `persist-medals` on changes; extension host sends `init-medals` on webview open.
- **Hook/plugin installation state** — Detected by checking filesystem (hook files exist or not).

## Agent Integration Patterns

### Claude Code

Claude Code supports hook scripts in `~/.claude/settings.json`. Event Horizon registers curl-based hooks that POST to `127.0.0.1:28765/claude` on lifecycle events (session start/stop, tool call/result, task events).

### OpenCode

OpenCode auto-loads TypeScript plugins from `~/.config/opencode/plugins/`. Event Horizon writes `event-horizon.ts` which:
- Sends `session.created` on plugin init
- Forwards all events via the catch-all `event` hook
- Registers `process.on('beforeExit'/'SIGINT'/'SIGTERM')` handlers to send `session.deleted` on exit
- Uses dedicated `tool.execute.before/after` hooks for tool-specific data

## Adding a New Agent Connector

1. Create `packages/connectors/src/<name>.ts` with a mapper: `(raw: unknown) => AgentEvent | null`
2. Export from `packages/connectors/src/index.ts`
3. Add a route in `apps/vscode/src/eventServer.ts`
4. Add setup/remove logic in `apps/vscode/src/setup<Name>Hooks.ts`
5. Register in `webviewProvider.ts` message handler and `getConnectedAgentTypes()`
6. Add to the Connect dropdown in `webview/index.tsx`
