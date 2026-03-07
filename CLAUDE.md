# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

**Event Horizon** is a VS Code extension that visualizes AI coding agents (Claude Code, OpenCode, GitHub Copilot) as a living cosmic system — agents become planets, tasks become orbital events, data transfers become ships.

## Commands

All commands run from the repo root using pnpm + Turborepo:

```bash
pnpm build          # build all packages (respects dependency order: core → connectors/renderer/ui → vscode)
pnpm dev            # watch mode for all packages
pnpm clean          # clean all dist/out dirs and node_modules
```

To build or develop a single package:

```bash
cd packages/core && pnpm build
cd apps/vscode && pnpm build          # compiles extension TS + bundles webview with esbuild
cd apps/vscode && pnpm build:webview  # bundle only the React webview
cd apps/vscode && pnpm package:vsix   # produce a .vsix for manual install
cd tools/mock-server && pnpm start    # run the standalone mock event emitter
```

There are no test or lint commands currently configured.

## Architecture

The project is a **pnpm monorepo** managed with Turborepo (`turbo.json`). Build order is enforced by `dependsOn: ["^build"]`.

```
packages/
  core/        – pure TS, no runtime deps. EventBus, AgentStateManager, MetricsEngine, shared types (AgentEvent, AgentState, etc.)
  connectors/  – adapters that map raw payloads from Claude Code hooks, OpenCode, Copilot, or mock data into AgentEvent
  renderer/    – PixiJS v8 rendering layer. Universe component + entity/effect factories (Planet, Moon, Ship, Singularity, Stars, PulseWave, SolarFlare, TrafficRoute). Exported as React component.
  ui/          – React + Zustand UI layer. CommandCenter panel, Tooltip, useCommandCenterStore (selected agent, center-map requests).
apps/
  vscode/      – VS Code extension. Extension host (extension.ts) owns EventBus/MetricsEngine/AgentStateManager instances and starts an HTTP server. Webview (webview/index.tsx) renders Universe + UI.
tools/
  mock-server/ – Standalone script using tsx, calls createMockEvent() for development without a real agent.
```

### Data flow

1. **Event ingestion**: The extension host runs a local HTTP server on port `28765` (`apps/vscode/src/eventServer.ts`). It accepts POST requests at:
   - `/claude` – Claude Code hook payloads → `mapClaudeHookToEvent`
   - `/opencode` – OpenCode payloads → `mapOpenCodeToEvent`
   - `/events` – raw `AgentEvent` JSON passthrough

2. **Extension host processing**: Each `AgentEvent` goes through `EventBus.emit()` → `MetricsEngine.process()` + `AgentStateManager.apply()`, then is forwarded to the webview via `webview.postMessage`.

3. **Webview rendering**: `apps/vscode/webview/index.tsx` listens to `window.message`, maintains local React state for agents/metrics, and passes it to the `<Universe>` renderer component. Clicking a planet updates the Zustand store which drives the `<CommandCenter>` side panel.

### VS Code webview build

The webview is bundled separately from the extension host:
- Extension host: TypeScript → `out/` via `tsc`
- Webview: `webview/index.tsx` → `webview-dist/main.js` via `esbuild` (IIFE, browser platform, JSX automatic)

The webview cannot use Node.js APIs — it runs in a sandboxed browser context inside VS Code.

### Adding a new agent connector

1. Add a mapper in `packages/connectors/src/<name>.ts` that returns `AgentEvent | null`
2. Export it from `packages/connectors/src/index.ts`
3. Register the route in `apps/vscode/src/eventServer.ts`

### AgentEvent type

Defined in `packages/core/src/events.ts`. The `type` field uses dot-namespaced strings (`agent.spawn`, `task.start`, `tool.call`, etc.) — see `AGENT_EVENT_TYPES` for the full list. `AgentType` is `'opencode' | 'claude-code' | 'copilot' | 'unknown'`.
