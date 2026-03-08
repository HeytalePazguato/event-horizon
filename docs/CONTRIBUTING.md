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

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full system design, data flow, and package structure.

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

- **Target the `develop` branch** — never PR directly to `master`. See [ARCHITECTURE.md](ARCHITECTURE.md) for the full branching and release strategy.
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
