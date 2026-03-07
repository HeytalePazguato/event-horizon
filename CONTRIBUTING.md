# Contributing to Event Horizon

Thanks for your interest in contributing! This guide covers everything you need to get started.

## Setting Up the Development Environment

### Prerequisites

- **Node.js** 18+
- **pnpm** — install via `npm install -g pnpm` or `corepack enable && corepack prepare pnpm@latest`

### First-Time Setup

```bash
git clone https://github.com/HeytalePazguato/event-horizon.git
cd event-horizon
pnpm install
pnpm build
```

### Running Locally

1. Open the repo in VS Code
2. Press **F5** to launch the Extension Development Host
3. Click the globe icon in the sidebar to open the universe
4. Click **Demo** in the Command Center to populate it with simulated agents

After making changes, rebuild with `pnpm build` and reload the Extension Development Host (**Ctrl+Shift+P** > **Developer: Reload Window**).

## Architecture Overview

The project is a pnpm + Turborepo monorepo. Build order matters:

```
core --> connectors, renderer, ui --> vscode
```

| Package | What it does |
|---------|-------------|
| `packages/core` | Pure TS — EventBus, AgentStateManager, MetricsEngine, shared types. No runtime deps. |
| `packages/connectors` | Adapters mapping raw agent payloads (Claude Code, OpenCode, Copilot) into `AgentEvent` |
| `packages/renderer` | PixiJS 8 universe — planets, moons, ships, singularity, stars. Exported as a React component. |
| `packages/ui` | React + Zustand — CommandCenter panels, Tooltip, Achievements, store |
| `apps/vscode` | VS Code extension host + webview. HTTP server on port 28765 receives events. |
| `tools/mock-server` | Standalone mock event emitter for development |

### Data Flow

1. Agent hooks send HTTP POST to `127.0.0.1:28765` (extension host)
2. Connector maps raw payload to `AgentEvent`
3. `EventBus.emit()` > `MetricsEngine.process()` + `AgentStateManager.apply()`
4. Event forwarded to webview via `postMessage`
5. Webview React state updates > `<Universe>` re-renders via PixiJS ticker

### Webview Constraints

The webview runs in a sandboxed browser context — no Node.js APIs. It's bundled separately from the extension host using esbuild (IIFE format).

## Common Tasks

### Adding a New Agent Connector

1. Create `packages/connectors/src/<name>.ts` with a mapper function returning `AgentEvent | null`
2. Export it from `packages/connectors/src/index.ts`
3. Add a route in `apps/vscode/src/eventServer.ts`

### Adding an Achievement

1. Add the definition to `ACHIEVEMENTS` in `packages/ui/src/Achievements.tsx`
2. Add a `Medal` SVG case for the new ID
3. Add detection logic in `apps/vscode/webview/index.tsx` (achievement detection section)
4. For tiered achievements, also add thresholds to `TIERED_THRESHOLDS` in `packages/ui/src/store.ts`

### Sending Test Events

```bash
curl -X POST http://127.0.0.1:28765/events \
  -H "Content-Type: application/json" \
  -d '{"id":"t1","agentId":"agent-1","agentName":"Test","agentType":"opencode","type":"agent.spawn","timestamp":'$(date +%s)'000,"payload":{}}'
```

## Pull Request Guidelines

- Keep PRs focused — one feature or fix per PR
- Make sure `pnpm build` passes before submitting
- Write a clear description of what changed and why
- If adding a visual feature, include a screenshot or short recording

## Code Style

- TypeScript throughout, strict mode
- React functional components with hooks
- PixiJS entities are plain functions returning `Container` (not React components)
- Zustand for UI state management
- No test framework is currently configured — manual testing via Demo mode and the Extension Development Host

## Questions?

Open an issue on GitHub. We're happy to help!
