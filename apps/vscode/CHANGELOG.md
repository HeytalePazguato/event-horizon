# Changelog

All notable changes to the Event Horizon VS Code extension will be documented in this file.

## [0.0.4] — 2026-03-12

### Added
- **GitHub Copilot integration**: hook-based connector with one-click setup via Connect wizard. Maps all supported Copilot hook events (`SessionStart`, `Stop`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `SubagentStart`, `SubagentStop`, `PreCompact`). Subagent events are remapped to the parent agent so subagents appear as moons, not separate planets. Uses `curl.exe` with PowerShell-safe quoting for Windows compatibility
- **Waiting ring**: amber pulsing ring appears around a planet when the agent is waiting for user input (permission dialogs, AskUserQuestion prompts). The ring breathes in and out and clears automatically when the agent resumes work after user input. Triggered by `PermissionRequest` and `Notification(elicitation_dialog)` hooks
- **All 18 Claude Code hooks registered**: `InstructionsLoaded`, `ConfigChange`, `PreCompact`, `WorktreeCreate`, and `WorktreeRemove` now forwarded to the event server alongside the original 13 hooks
- **Workspace folder display**: the agent's working directory folder name is shown in three places — as a second line under the planet label, in the hover tooltip, and in the Command Center's Agent Identity panel
- **M-shaped Command Center**: the top border of the Command Center now follows a StarCraft-style stepped profile — side panels (Agent Identity and Commands) sit taller than the center metrics panel, with angled transitions creating a cockpit silhouette
- **Hook & Event Support Matrix** in README documenting all lifecycle events per agent and their `AgentEvent` mappings

### Fixed
- Shooting stars no longer burst-fire after the panel has been hidden — tick delta is capped and stale stars are flushed on resume
- `Notification(permission_prompt)` no longer triggers a false waiting ring on the parent planet when a subagent requests permission (GitHub [#23983](https://github.com/anthropics/claude-code/issues/23983), [#33473](https://github.com/anthropics/claude-code/issues/33473))
- Subagent `agent.waiting` events are dropped in the extension host so subagent permission requests don't affect the parent planet's ring

### Changed
- Agent Identity panel font sizes increased for readability (name: 9→11px, state: 8→9px, type: 7→8px)
- Command Center layout padding adjusted — top spacing now matches bottom spacing

### Known Limitations
- **Claude Code**: no hook fires when the user grants or denies a permission — only `PostToolUse` fires when the tool finishes executing. The waiting ring stays visible during tool execution, not just the approval prompt ([#33473](https://github.com/anthropics/claude-code/issues/33473))
- **OpenCode**: no `SubagentStart`/`SubagentStop` events — subagent moons cannot be rendered ([#16627](https://github.com/anomalyco/opencode/issues/16627))
- **GitHub Copilot**: `SessionEnd` never fires — Copilot planets persist until extension reload. `Stop` fires per-turn, not per-session

## [0.0.3] — 2026-03-09

### Added
- **Grazing Shot** achievement (tiered): astronaut flies dangerously close to the black hole without entering the gravity well
- **Conqueror** achievements: one medal per agent type when an astronaut lands on that planet (Claude Code, OpenCode, Copilot, Unknown)
- **Star Catcher** achievement (tiered): click on a shooting star as it streaks across the sky
- GitHub community health files: issue templates (bug report, feature request), PR template, Dependabot config, FUNDING.yml, `.gitattributes` for LF normalization

### Fixed
- Shooting star burst on resume: all scheduled shooting stars fired simultaneously after the panel was hidden for a while. Now caps tick delta and flushes stale stars on resume
- Removed sourcemap reference from production webview build to eliminate CSP console warning
- Workspace folder cooperation check now uses path boundary (`/project` no longer matches `/project-other`)
- Cooperation ship emitter no longer crashes if webview is disposed between async callbacks
- OpenCode connector no longer mutates the caller's input payload object
- Achievements now persist correctly when the panel is moved (e.g., sidebar to bottom panel). Hydration messages are deferred until the webview signals readiness

## [0.0.2] — 2026-03-09

### Fixed
- **Extension failed to activate** from marketplace install: workspace packages (`@event-horizon/core`, `connectors`) were not bundled into the VSIX. Extension host is now bundled with esbuild so all dependencies are inlined
- README now appears on the marketplace listing page
- LICENSE included in VSIX package
- Source maps excluded from VSIX, reducing package size from 2.4MB to ~1MB
- Stale artifacts (`%localappdata%/`, `vitest.config.*`) excluded from VSIX

## [0.0.1] — 2026-03-09

### Added
- Live universe visualization: AI coding agents appear as planets with type-specific styles (gas giant, rocky, icy, volcanic)
- Central black hole with gravitational pull on astronauts
- Data transfers rendered as ships flying curved bezier arcs between planets
- Astronauts spawned on click, affected by black hole gravity
- Subagents shown as orbiting moons with stable animation
- Command Center panel with agent identity, live metrics, event logs, and medals tabs
- StarCraft-inspired control grid with hover tooltips
- Connect wizard: one-click Claude Code hook installation
- Connect wizard: one-click OpenCode plugin installation
- 20 achievements with tiered medals and toast notifications (persisted across sessions)
- Demo simulation mode
- Camera pan/zoom with Center button
- Agent state transitions (idle, thinking, tool_use, working, error)
- Stale-agent cleanup for agents that exit without sending termination events
- UFO fly-bys with cow abductions and singularity capture
- Shooting stars, colored background stars, astronaut jetpack
- Workspace-aware agent cooperation (auto-detect agents in same workspace)
- HTTP event server on localhost:28765 with auth token, rate limiting, payload validation
- CI/CD: 3-tier release pipeline (dev → pre-release → stable) with auto-publish to VS Code Marketplace
- SECURITY.md with vulnerability disclosure policy
- 100 unit tests across core, connectors, UI store, and event server
