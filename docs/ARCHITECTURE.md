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

## Agent Cooperation Detection

When multiple agents connect to Event Horizon, the extension host checks whether they are working in related directories and, if so, spawns cooperation ships between them.

### How `cwd` is captured

- **Claude Code** — The connector extracts `cwd` from the hook payload (top-level or nested). Claude Code includes `cwd` in every hook invocation.
- **OpenCode** — The generated plugin (`event-horizon.ts`) captures `directory` and `worktree` from the plugin context and sends them as `cwd` on every event.
- **Fallback** — If an agent doesn't report a `cwd`, the extension host injects the primary `vscode.workspace.workspaceFolders[0]` path.

The `cwd` is stored on `AgentState.cwd` and persisted in the webview's agent map.

### Cooperation matching (`extension.ts`)

The `areAgentsCooperating(cwdA, cwdB)` function returns true if:

1. **Exact match** — Both paths are identical (case-insensitive, normalized slashes).
2. **Nested** — One path is a prefix of the other (e.g. `/project` and `/project/packages/core`).
3. **Same workspace folder** — Both paths fall under the same entry in `vscode.workspace.workspaceFolders` (covers multi-root workspaces).

### Ship spawning

A recursive timer (3–10 second random delay) runs in the extension host:

1. Gets all agents with a known `cwd` from `AgentStateManager`.
2. Finds cooperating pairs using the matching logic above.
3. Picks one random pair, randomizes direction, and sends a `data.transfer` event directly to the webview.
4. The webview renders the ship like any other data transfer — curved arc, colored trail, auto-cleanup.

This works across agent types: a Claude Code agent and an OpenCode agent in the same folder will exchange ships.

## Persistence

- **Agent state and metrics** — In-memory only. Accumulated in the extension host (`AgentStateManager`, `MetricsEngine`) and hydrated to the webview on open via `init-state` message.
- **Achievements** — Persisted to VS Code `globalState` (survives restarts and updates). Webview sends `persist-medals` on changes; extension host sends `init-medals` on webview open.
- **Hook/plugin installation state** — Detected by checking filesystem (hook files exist or not).

## Agent Integration Patterns

### Claude Code

Claude Code supports hook scripts in `~/.claude/settings.json`. Event Horizon registers curl-based hooks that POST to `127.0.0.1:28765/claude` on lifecycle events (session start/stop, tool call/result, task events).

### OpenCode

OpenCode auto-loads TypeScript plugins from `~/.config/opencode/plugins/`. Event Horizon writes `event-horizon.ts` which:
- Captures `directory` and `worktree` from the plugin context for cooperation detection
- Sends `session.created` (with `cwd`) on plugin init
- Forwards all events via the catch-all `event` hook
- Registers `process.on('beforeExit'/'SIGINT'/'SIGTERM')` handlers to send `session.deleted` on exit
- Uses dedicated `tool.execute.before/after` hooks for tool-specific data

## Branching and Release Strategy

The project uses a 3-tier branch model with automated CI/CD via GitHub Actions:

```
develop ──────────── Dev builds (artifacts only)
    │
    └── release/X.Y.Z ── Pre-releases (GitHub Releases, pre-release flag)
            │
            └── master ── Stable releases (GitHub Releases, git tags)
```

### Branches

| Branch | Purpose | Output |
|--------|---------|--------|
| `develop` | Active development. All feature work merges here. | Dev `.vsix` artifact (not a Release). Named `0.0.0.{N}-dev`. Latest 3 kept. |
| `release/X.Y.Z` | Release candidates. Created from `develop` when preparing a release. | GitHub Pre-release with `.vsix`. Tagged `vX.Y.Z-{stage}.{N}`. Latest 5 kept. |
| `master` | Stable releases only. Merged from `release/*` when ready. | GitHub Release with `.vsix`. Tagged `vX.Y.Z`. Kept forever. |

### Versioning

VS Code extensions require strict **3-digit SemVer** (`X.Y.Z`) internally — 4-digit versions are rejected by `vsce package`. The strategy handles this:

- **Dev builds**: Internal version is `0.0.{RUN_NUMBER}` (valid for vsce). Artifact name includes 4-digit display version `0.0.0.{N}-dev` for human readability.
- **Pre-releases**: Internal version is `X.Y.Z` (from the branch name). The pre-release stage and number are in the git tag and GitHub Release name only (e.g. `v0.1.0-alpha.3`).
- **Stable releases**: Version is read from `apps/vscode/package.json` as-is.

### Pre-release Stages

Pre-release stage is determined by commit message tags:

| Tag in commit message | Stage | Example tag |
|----------------------|-------|-------------|
| (default / `[alpha]`) | alpha | `v0.1.0-alpha.1` |
| `[beta]` | beta | `v0.1.0-beta.2` |
| `[rc]` | rc | `v0.1.0-rc.1` |

Stage numbers auto-increment by counting existing tags of that stage for the version.

### Cleanup

- **Dev artifacts**: Latest 3 kept, older ones auto-deleted after each dev build.
- **Pre-releases**: Latest 5 kept (both the GitHub Release and its git tag are deleted).
- **Stable releases**: Never deleted.

## Adding a New Agent Connector

1. Create `packages/connectors/src/<name>.ts` with a mapper: `(raw: unknown) => AgentEvent | null`
2. Export from `packages/connectors/src/index.ts`
3. Add a route in `apps/vscode/src/eventServer.ts`
4. Add setup/remove logic in `apps/vscode/src/setup<Name>Hooks.ts`
5. Register in `webviewProvider.ts` message handler and `getConnectedAgentTypes()`
6. Add to the Connect dropdown in `webview/index.tsx`
