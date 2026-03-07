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

## Prerequisites

- **Node.js** 18+
- **pnpm** (or use `npx pnpm` for each command)
  - Install: `npm install -g pnpm`
  - Or use Corepack: `corepack enable` then `corepack prepare pnpm@latest`

## Getting Started

```bash
pnpm install
pnpm build
```

If `pnpm` is not in your PATH, use `npx pnpm` instead (e.g. `npx pnpm install`, `npx pnpm run build`).

## Testing the VS Code extension

1. **Build** (from repo root): `pnpm run build --filter=event-horizon-vscode`

2. **Run:** Press **F5**. If a dialog appears, click **Continue**. A second window opens (Extension Development Host).

3. **Open the view:** In that second window, click the **globe icon** in the left sidebar, or **Ctrl+Shift+P** → **Event Horizon: Open Universe**.

4. **Connect an agent:** Click the **Connect** button in the Command Center to open the Connect Agent wizard. Choose **Claude Code** and click **Install** — this adds curl hooks to `~/.claude/settings.json`. Start a Claude Code session and the planet will appear automatically.

5. **Demo mode:** Click **Demo** in the Command Center to see the universe populated with simulated agents without a live connection.

**Send test events manually:**

   **PowerShell (Windows):**
   ```powershell
   $body = ‘{“id”:”t1”,”agentId”:”agent-1”,”agentName”:”Test Agent”,”agentType”:”opencode”,”type”:”agent.spawn”,”timestamp”:’ + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + ‘,”payload”:{}}’
   Invoke-RestMethod -Uri http://127.0.0.1:28765/events -Method Post -Body $body -ContentType “application/json”
   ```

   **Bash (macOS/Linux):**
   ```bash
   curl -X POST http://127.0.0.1:28765/events -H “Content-Type: application/json” -d “{\”id\”:\”t1\”,\”agentId\”:\”agent-1\”,\”agentName\”:\”Test Agent\”,\”agentType\”:\”opencode\”,\”type\”:\”agent.spawn\”,\”timestamp\”:$(date +%s)000,\”payload\”:{}}”
   ```

**If F5 doesn’t open a second window:** install from .vsix instead — run `cd apps/vscode && pnpm run package:vsix`, then **Extensions** → **...** → **Install from VSIX...** and reload.

**If the panel stays on "Loading universe…", shows a black screen, or content flashes and disappears:** Rebuild, then **fully close the Extension Development Host window** (close the window, don’t just reload), and press **F5** again in your project window so a new host starts with a fresh webview. If it still fails, in the new Extension Development Host open **Help → Toggle Developer Tools** and check the Console for errors.

### Seeing changes after you edit the extension

After you change extension or webview code, do this:

1. **Rebuild** (in the window where your project is open, not the Extension Development Host):
   ```bash
   pnpm run build --filter=event-horizon-vscode
   ```
2. **Reload the Extension Development Host** so it loads the new build. Use either:
   - **Option A — Reload (recommended):** In the **Extension Development Host** window, press **Ctrl+Shift+P** (or **Cmd+Shift+P** on Mac), type **Developer: Reload Window**, run it. The same window reloads with the updated extension.
   - **Option B — Restart:** Close the **Extension Development Host** window, then in your main project window press **F5** again to launch a new instance.

You do **not** need to close the Extension Development Host window to see changes; a reload is enough.

**Console messages:** When debugging (F5), many console lines are from VS Code or other extensions (e.g. "Extension Host", "Unrecognized feature", "401" for Copilot). You can ignore those; only messages mentioning "Event Horizon" or "main.js" are from this extension.

See [docs/e2e-testing.md](docs/e2e-testing.md) for more ways to send events (Claude Code hooks, OpenCode plugin).

See [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md) for the full implementation plan and task checklist.

## License

Private repository.
