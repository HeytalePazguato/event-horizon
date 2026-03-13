# Changelog

All notable changes to the Event Horizon VS Code extension will be documented in this file.

## [0.0.5] — 2026-03-12

### Added
- **Full OpenCode event integration**: all 17 OpenCode plugin events now mapped — added `permission.asked` → waiting ring, `permission.replied`, `session.compacted`, `session.updated`, `command.executed`, `lsp.client.diagnostics`, `todo.updated`, `server.connected`, and more. OpenCode agents now show the amber waiting ring on permission dialogs
- **Visual Effect column** in README hook matrix — every lifecycle event now documents its corresponding animation (e.g. "Planet appears + pulse wave", "Amber pulsing ring", "Blue tool-use glow")
- **Workspace grouping**: agents working in the same folder/workspace are now clustered together visually. An irregular asteroid belt ring (scattered rocks with glowing highlights) surrounds each group, making workspace relationships immediately visible
- **File collision lightning**: when 2+ agents edit the same file simultaneously, a continuous lightning stream arcs between their planets. Multiple jagged bolts (cyan, white, pale blue) with glow and endpoint sparks persist as long as both agents are actively touching the same file (10-second sliding window). File paths are extracted securely from connector payloads — only the path string, never file content
- **Medals gallery**: medals tab now shows all 26 achievements — unearned ones appear as dark silhouettes with a subtle green border. Hovering an unearned medal reveals its name and how to earn it (secret medals show "Figure this one out yourself…"). Tab counter shows earned/total (e.g. `3/26`)
- **Renderer test coverage**: 45 unit tests for collision math, bezier curves, ship arc avoidance, planet placement/overlap resolution, workspace grouping, belt contour generation. Pure math extracted to `packages/renderer/src/math.ts` for testability. Total test count: 112 → 164
- **Export Stats button**: new command grid button (Row 2) downloads session metrics as a timestamped JSON file — includes agent list, per-agent metrics (load, tools, uptime, tool breakdown), singularity stats, and achievement progress
- **Screenshot button**: new command grid button (Row 2) captures the PixiJS universe canvas as a PNG image download

### Changed
- **Webview bundle size reduced 78%**: selective PixiJS 8 imports via custom esbuild plugin (`pixi-lite`). Only loads app, rendering, graphics, text, events, and DOM modules — skips accessibility, spritesheet, filters, compressed-textures, mesh, and advanced-blend-modes. Dev: 4.1MB → 2.8MB; Prod: 4.1MB → 922KB
- Webview build migrated from esbuild CLI to `esbuild.mjs` config file to support the pixi-lite plugin and React production mode (`process.env.NODE_ENV = "production"`)
- **Demo mode overhauled**: 8 simulated agents — 1 cluster of 2, 1 cluster of 3, and 3 solo planets. Ships now only travel between planets in the same workspace. Demo collision lightning fires between workspace-sharing agents with 4–8s persistence

### Fixed
- **Achievement toast stacking**: multiple simultaneous unlocks no longer pile up infinitely. Toasts are now capped at 3 visible at a time with a 350ms stagger between entrances; overflow toasts queue automatically and a "+N more" indicator appears above the stack
- **CodeQL ReDoS**: replaced polynomial regex `/\/+$/` with iterative `while(endsWith('/'))` loop in 3 files (Universe.tsx, Tooltip.tsx, AgentIdentity.tsx)
- **Missing waiting state color**: added `waiting: '#d4944a'` to AgentIdentity state color map so waiting agents show amber instead of defaulting to white
- **Memory leak**: subagent-to-parent mapping now cleaned up on `agent.terminate`
- **Ship arc curvature**: ships flying between adjacent planets no longer have flat arcs — curve offset now scales with distance (min 30px, up to 120px at 20% of distance) for visually consistent arcs at any range
- **PixiJS memory leaks**: active ships (container + trail + route Graphics), moons, and astronauts are now explicitly destroyed on unmount instead of relying solely on `app.destroy()`. Prevents texture accumulation during long sessions with frequent panel reloads
- **Debug logging removed**: stripped verbose hook field logging from eventServer and state transition logging from webview
- **Duplicated `folderName` utility**: extracted shared helper to `packages/ui/src/utils.ts`
- **Planet-singularity overlap**: planets and asteroid belts no longer overlap the central black hole. Minimum planet distance increased to 180px, orbital bands pushed outward, and singularity avoidance enforced during repulsion passes

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
