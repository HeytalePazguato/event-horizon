# Event Horizon

Event Horizon is a developer tool that visualizes AI coding agents as a living cosmic system. Instead of viewing logs, terminals, or raw agent output, developers observe the behavior of AI agents in real time through an interactive universe visualization.

- **Agents** → Planets  
- **Tasks** → Moons  
- **Data transfers** → Spaceships  
- **Completed tasks** → Central singularity

The system works as a visual debugging, monitoring, and orchestration interface for AI-driven development.

## Supported Agent Ecosystems

- OpenCode  
- Claude Code  
- GitHub Copilot  

## Targets

- **MVP:** VS Code extension (also runs in Cursor)
- **Planned:** CLI, standalone desktop UI, browser dashboard, headless monitoring server

## Project Structure

This is a pnpm + Turborepo monorepo:

- `packages/core` — Event model, event bus, metrics engine
- `packages/connectors` — Agent adapters (OpenCode, Claude Code, Copilot) and mock data
- `packages/renderer` — PixiJS 2D universe visualization
- `packages/ui` — Command Center overlay (React)
- `apps/vscode` — VS Code extension host
- `tools/mock-server` — Standalone mock event server for development
- `docs` — Documentation and development plan

## Getting Started

```bash
pnpm install
pnpm build
```

See [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md) for the full implementation plan and task checklist.

## License

Private repository.
