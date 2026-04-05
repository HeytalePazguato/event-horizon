# Changelog

All notable changes to the Event Horizon VS Code extension will be documented in this file.

## [1.2.0] — 2026-04-05

### Added — Phase 5: Universe Enhancements (Visual Polish)
- **Orchestrator task assignment beams**: when `eh_spawn_agent` fires, the orchestrator star shoots a colored beam to the target planet via the new `BeamSystem`. Beams animate from source to target and fade over ~2 seconds
- **Synthesis phase beams**: when a plan completes (all tasks done), all worker planets beam results back to the orchestrator star. Extension host detects plan completion transitions and posts `plan-completed` message with orchestrator + worker IDs
- **Task DAG dependency tethers**: thin lines drawn between orbiting debris particles that have `blockedBy` relationships. Tethers are cleared and redrawn each frame in `DebrisSystem` using a shared `Graphics` container
- **Critical path glow**: tasks on the critical path (most transitive dependents) glow brighter with gold tint. Brightness proportional to dependency count
- **Cascade failure zigzag chains**: when a debris has a cascade failure, a red lightning-like zigzag line is drawn between it and its failed dependency, pulsing in intensity
- **Completed chain stardust**: when both a task and its dependency are done, the tether slowly fades out over time
- **MCP station docking tubes**: thin connection lines drawn from each station to its parent planet. Color `#1a3020`, brighter for connected stations. Redrawn each frame in `StationSystem`
- **Shared knowledge constellations**: new `ConstellationSystem` draws lines between planets that share knowledge entries. Workspace links are dim and dotted; plan links are brighter and solid. User-authored entries have gold tint; agent-authored use agent-type colors. Line brightness proportional to shared entry count
- **Budget fuel gauge**: horizontal progress bar in the CommandCenter center panel showing plan budget spent/total. Color-coded: green (0-60%), yellow (60-80%), red (80%+). Flashing CSS animation at 80%+. Shows formatted "$X.XX / $Y.YY (Z%)"
- **Planet spawn animation**: new planets animate in from scale 0 with a semi-transparent nebula cloud in the agent's type color. Over ~2 seconds, the planet scales up while the nebula fades. Tracked via `__spawnProgress` in `PlanetAnimationSystem`
- **Orchestrator ID broadcast**: extension host now broadcasts active orchestrator agent IDs to the webview whenever plan state changes, enabling the golden star glow to update dynamically

### Added — Phase 1: Coordination Core
- **Cascade failure system**: when a task fails, all transitive dependents are automatically marked as failed with root cause messages. Configurable per-plan via `onDependencyFailure: cascade | block | ignore` metadata
- **Task retry with backoff**: new `eh_retry_task` MCP tool resets failed tasks to pending, increments retry count, and un-cascades dependents. Supports `maxRetries` per task
- **Dependency cycle detection**: plans are validated for circular dependencies on load using DFS coloring — cycles reported with full path
- **Task recommendations**: new `eh_recommend_task` MCP tool scores available tasks by role keyword match (40%), agent profiler success rate (30%), current load (20%), and dependency priority (10%)
- **Shared Knowledge Store**: layered knowledge base with workspace scope (persistent) and plan scope (contextual). Both humans and agents can contribute. New MCP tools: `eh_write_shared`, `eh_read_shared`, `eh_get_shared_summary`, `eh_delete_shared`
- **7 new Claude Code hook events**: `PermissionDenied`, `StopFailure`, `CwdChanged`, `FileChanged`, `TaskCreated`, `PostCompact`, `Elicitation`/`ElicitationResult` — enriched with payload data (token counts, denied tools, error messages, file paths)
- **6 new MCP tools**: `eh_retry_task`, `eh_recommend_task`, `eh_write_shared`, `eh_read_shared`, `eh_get_shared_summary`, `eh_delete_shared` — total: 25 MCP tools

### Improved
- **Plan task model**: tasks now track `retryCount`, `maxRetries`, and `failedReason` for richer status reporting
- **MCP server telemetry**: metrics engine now available to MCP tools for load-aware task recommendations
- **Auto-claim with recommendation**: `eh_claim_task` with no task_id auto-selects the best task for the calling agent using the 4-factor scoring algorithm
- **Retry badge on Kanban cards**: failed tasks with retries show orange "RETRY xN" badge
- **Failed reason on Kanban cards**: failed tasks show their failure reason in dim red below the status badge
- **Debris retry pulse**: retried tasks show alternating red/gold tint animation in Universe view
- **Debris cascade visual**: cascade-failed debris shows distinct rapid dim-red pulse (darker than root failure)
- **Knowledge Panel**: new Operations Dashboard tab with two collapsible sections (Workspace + Plan), inline add/edit/delete, relative timestamps, expandable values
- **Knowledge webview integration**: user can add/edit/delete knowledge entries from UI; changes broadcast to all agents in real-time via postMessage
- **Auto-retry per plan**: `<!-- maxAutoRetries: 2 -->` in plan metadata enables automatic retry of failed tasks up to N times before cascading failure
- **Task recommendation badges**: pending Kanban cards show "REC: [agent-type]" teal badge when a role assignment matches the task's role
- **Knowledge search/filter**: search input in Knowledge Panel filters entries by key, author, value, or exact scope match
- **Knowledge in CommandCenter**: AgentIdentity panel shows knowledge counts (W/P) and 3 most recent entries when an agent is selected
- **"Tell All" button**: new command in AgentControls grid — prompts for a message and broadcasts it as a workspace knowledge entry visible to all agents

### Added — Phase 4: Advanced Observability
- **Structured trace spans**: `TraceStore` records tool_call, task, agent_session, hook, and llm_call spans with timing, metadata, and parent-child nesting. Circular buffer of last 1000 spans. Start/end pairing via composite key lookup
- **Traces panel**: new "Traces" tab in Operations View with waterfall timeline visualization. Color-coded bars by span type (blue for tools, green for tasks, orange for sessions, purple for hooks). Filter by agent, span type, and time range (5m/15m/1h/all). Click to expand full metadata. Aggregate time distribution bar at bottom
- **MCP server status visualization**: Stations — hexagonal entities orbiting parent planets. Size proportional to toolCount, color reflects connected (green) vs disconnected (red) status. Pulse animation when tools are being called. StationSystem manages lifecycle and orbit animation
- **Context compaction visualization**: planets briefly shrink to 0.7x then re-inflate over 1.5s when a PostCompact event fires. Compaction events logged to the activity log and shown as vertical orange markers on the timeline
- **MCP server capture in Claude Code connector**: SessionStart hook now captures `mcp_servers` array from payload with name, status, and toolCount per server
- **New MCP tool**: `eh_get_traces` — query trace spans with optional agent/type filters and limit. Returns spans + aggregate time distribution. Total: 39 MCP tools
- **Periodic trace broadcast**: extension host sends trace updates to webview every 5 seconds (not per-event) to avoid chattiness
- **Compaction event forwarding**: PostCompact events immediately broadcast to webview with preTokens/postTokens for visual feedback

### Added — Phase 3: Scheduling, DAG, Isolation, Heartbeat, Telemetry, Budget
- **Scheduling strategies**: plans support `<!-- strategy: round-robin -->` metadata. Auto-assign uses the plan's configured strategy by default, with 4 strategies: `round-robin`, `least-busy`, `capability-match`, `dependency-first`. Strategy badge shown on plan header in Kanban view
- **Task DAG visualization**: new "Dependencies" tab in Operations View renders a directed acyclic graph of task dependencies using topological sort (Kahn's algorithm), highlights the critical path in red, and warns about dependency cycles
- **Git worktree isolation**: `WorktreeManager` creates per-agent per-task worktrees (`git worktree add .eh-worktrees/<agent>-<task>`). New MCP tools `eh_create_worktree` and `eh_remove_worktree` (orchestrator-only). SpawnRegistry supports `isolation: 'worktree'` option
- **Heartbeat system**: `HeartbeatManager` tracks agent liveness with configurable intervals. New `eh_heartbeat` MCP tool. Extension host checks status every 30s and forwards to webview. Planets show a pulsing ring — green for alive, amber for stale, grey for lost
- **Richer telemetry**: Claude Code Stop hook captures `duration_ms`, `duration_api_ms`, `num_turns`, `stop_reason`. PermissionDenied captures `permission_denials` array. All hooks capture `model` name. AgentState now includes `modelName` and `heartbeatStatus` fields. Model name shown in AgentIdentity panel
- **Budget controls**: `BudgetManager` tracks per-plan spending with per-agent breakdown. `<!-- maxBudgetUsd: 5.00 -->` metadata sets plan budget. Warning at configurable threshold (default 80%), auto-notification on exceed. New MCP tools `eh_get_budget` and `eh_request_budget_increase`. Budget state persisted in globalState
- **5 new MCP tools**: `eh_heartbeat`, `eh_create_worktree`, `eh_remove_worktree`, `eh_get_budget`, `eh_request_budget_increase` — total: 38 MCP tools
- **New VS Code setting**: `eventHorizon.budgetWarningThreshold` (default 0.8)

### Added — Phase 2: Agent Spawning Infrastructure
- **Orchestrator role**: 7th built-in role auto-promoted when an agent loads a plan via `eh_load_plan`. Decomposes goals, spawns workers, monitors team progress
- **SpawnRegistry**: pluggable backend system for spawning AI agents in VS Code terminals — ClaudeCodeSpawner, OpenCodeSpawner, CursorSpawner
- **Claude Code spawner**: `claude -p --output-format stream-json` with role injection, session resume via `--resume`
- **OpenCode spawner**: `opencode -p -f json -q` (or `crush` fallback)
- **Cursor spawner**: `cursor --cli -p` (learned from Paperclip's adapter)
- **8 new MCP tools**: `eh_claim_orchestrator`, `eh_spawn_agent`, `eh_stop_agent`, `eh_reassign_task`, `eh_get_team_status`, `eh_auto_assign`, `eh_get_session`, `eh_sync_skills` — total: 33 MCP tools
- **Session persistence**: SessionStore saves agent session IDs per task in globalState, enabling `--resume` on subsequent spawns
- **Skill syncing**: bundled EH skills auto-copied to agent's skill directory before spawning
- **Status bar click-to-terminal**: click when agents waiting → QuickPick to focus agent's terminal
- **Spawn terminal focus setting**: `eventHorizon.spawnTerminalFocus` — background, focus, or focus-on-interaction
- **Spawn UI**: SpawnModal with Quick Launch + With Prompt modes
- **Multi-plan orchestration**: `orchestratorAgentId` per plan, tools accept `plan_id`
- **Orchestrator star visual**: planets with orchestrator role rendered with golden glow + emission rays

## [1.1.0] — 2026-04-03

### Added
- **Agent roles system**: 6 built-in roles (researcher, planner, implementer, reviewer, tester, debugger) with customizable skill mappings and instructions. Agents receive role context automatically when claiming tasks. Users can define custom roles via `eventHorizon.roles.custom` setting
- **Agent profiling & recommendations**: historical task performance tracking per agent type per role — success rate, duration, token cost, error count. New `eh_recommend_agent` MCP tool ranks agent types by suitability for a given role based on real data
- **4 new MCP tools**: `eh_list_roles`, `eh_assign_role`, `eh_get_agent_profile`, `eh_recommend_agent` — total: 19 MCP tools
- **4 new bundled skills**: `eh:research` (codebase exploration), `eh:review` (code review), `eh:test` (test writing), `eh:debug` (bug diagnosis) — each tied to a role with structured output formats
- **Roles & Profiles panel**: new "Roles" tab in Operations View showing role definitions, agent assignments, performance profiles with success rate bars, and per-role breakdowns
- **Role tags in plan markdown**: tasks support `[role: researcher]` suffix syntax — parsed and displayed on kanban cards and orbital debris
- **Role badge in CommandCenter**: AgentIdentity panel shows the current role when an agent has a role-tagged task claimed
- **Role-colored debris glow**: orbital task debris shows a subtle glow ring in the assigned role's color, overlaying the existing status color
- **Role assignment persistence**: role assignments and agent profiles survive extension restarts via VS Code globalState
- **Role instructions on claim**: when an agent claims a task with a role, Event Horizon automatically sends role instructions and recommended skills via the messaging system
- **Role creation & editing UI**: create custom roles directly from the Roles panel ("+") with tag-based skill selector showing installed skills with autocomplete. Edit any role (including built-in) via pencil icon — edited role highlighted with orange border
- **Role-aware plan skill**: `eh:create-plan` now assigns `[role: X]` to every task in generated plans, matching tasks to the appropriate role
- **Font size accessibility setting**: `eventHorizon.fontSize` with 3 levels — Small (87%), Default, Large (115%) — applied via CSS zoom. Accessible from Settings panel and VS Code settings
- **Marketplace keywords**: added `multi-agent`, `agent-orchestration`, `orchestration`, `software-architecture`, `software-planning`, `ai-coding` for discoverability

### Improved
- **Scope label renamed**: skill scope badge "Personal" → "Global" — clearer that these skills are installed on the host machine and accessible by all agents across all projects
- **Custom tooltips on skill badges**: GLOBAL/Project/Plugin/Legacy scope badges and user-invocable/fork-context icons now show descriptive hover tooltips matching the app's tooltip style
- **Roles panel layout**: create/edit form stays fixed at top, roles grid scrolls below. Skill field uses tag-based autocomplete from installed skills instead of free text
- **Font standardization**: RolesPanel font sizes aligned with SkillsPanel hierarchy — role names 13px, descriptions 11px, form inputs 11px, using design token system

### Fixed
- **Default view override**: stale `viewMode` from globalState was overriding the VS Code `eventHorizon.defaultView` setting on every webview open. Now `readVscodeConfig()` is the single source of truth

### Security
- **Dependabot alerts resolved**: added pnpm overrides to upgrade transitive dependencies — `lodash` 4.17.23 → 4.18.1 (code injection & prototype pollution), `brace-expansion` 5.0.4 → 5.0.5 (process hang via zero-step sequences), `@xmldom/xmldom` 0.8.11 → 0.8.12 (XML injection via CDATA serialization)

## [1.0.2] — 2026-04-01

### Improved
- **OpenCode plugin cwd resolution**: plugin now tries `worktree`, `directory`, `project.path`, `project.directory`, `project.worktree`, and `process.cwd()` as fallback. Handles URL objects (file:// protocol) in addition to plain strings. OpenCode agents should now always show their workspace folder
- **OpenCode plugin sends file paths**: tool events now include `filePath` for file-touching tools, enabling file activity tracking and collision lightning in the Universe view
- **OpenCode config.json hook auth**: `~/.opencode/config.json` hook URLs are now updated with the current auth token on every activation, fixing silent 401 rejections for hooks-based setups

### Fixed
- **Sticky Kanban column headers**: column headers split into a fixed row above the scrollable task area — headers stay visible when scrolling through long task lists
- **Demo wiped real plans**: demo simulation now merges its plan with existing plans instead of replacing them. On stop, only the demo plan is removed. Demo plan prefixed with `[Demo]` for clarity
- **Demo ghost planets**: demo now cleans `agentMap` and `metricsMap` on stop (was leaving phantom planets)
- **View mode not persisted**: `eventHorizon.defaultView` setting correctly loads from VS Code settings on init instead of being overridden by stale globalState

## [1.0.1] — 2026-03-30

### Added
- **Multi-plan support**: load multiple plans simultaneously, keyed by slugified filename (e.g. `AUTH_PLAN.md` → `auth-plan`). Plans have lifecycle statuses: active, completed (auto when all tasks done), and archived
- **Plans sidebar tab**: Operations View sidebar now has Agents/Plans tabs. Plans tab shows plans grouped by status (Active/Completed/Archived) with collapsible sections, mini progress bars, and task counts. Click a plan to view its Kanban board
- **Plan management MCP tools**: `eh_list_plans` (view all plans with progress), `eh_archive_plan` (shelve a plan), `eh_delete_plan` (permanent removal). Total: 15 MCP tools
- **Plan ID on existing tools**: `eh_get_plan`, `eh_claim_task`, and `eh_update_task` now accept optional `plan_id` parameter. Defaults to the most recently loaded plan for backward compatibility
- **Copilot MCP registration**: Event Horizon MCP server auto-registered in `.vscode/mcp.json` when connecting Copilot hooks, giving Copilot agent mode access to all coordination tools
- **Copilot transcript parsing**: token usage (input/output) extracted from Copilot transcript JSON on session end for metrics display
- **Demo plan simulation**: demo mode now loads a sample plan ("REST API with Auth") with 8 tasks across 3 phases. Tasks progress live through the Kanban board — pending → claimed → in_progress → done. Dependencies unblock automatically.

### Improved
- **README rewrite**: both marketplace and GitHub READMEs restructured with value-first messaging — leads with the multi-agent coordination pitch, 3-step workflow, and feature tables instead of technical documentation
- **Sticky Kanban column headers**: column names stay visible when scrolling through long task lists
- **Kanban column toggle**: "All Columns" / "Active Only" button persisted in VS Code settings (`eventHorizon.planShowAllColumns`)
- **Plan checkbox sync**: completed tasks write `- [x]` back to the source markdown file automatically
- **View mode in settings**: `eventHorizon.defaultView` (universe/operations) now in VS Code Preferences
- **Skills panel full-size layout**: Operations View uses readable font sizes (13px names, 11px descriptions) with no height cap. Command Center retains compact sizing
- **Auto-update hooks on activation**: all installed hooks, plugins, and MCP configs refreshed on every activation — no manual reinstall needed on extension upgrade
- **Onboarding awareness**: "Connect Your First Agent" card skipped when hooks are already installed
- **Planet cleanup**: removed aggressive stale-agent timer — planets persist until explicit terminate event. Idle does not mean gone
- **Plan persistence migration**: old single-plan `planBoard` globalState auto-migrated to new `planBoards` array format

### Fixed
- **CodeQL alerts**: replaced regex backslash normalization with `split('\\').join('/')` and HTML comment regex with iterative `indexOf` loop
- **Demo ghost planets**: demo simulation now cleans `agentMap` and `metricsMap` on stop — previously left phantom planets
- **View mode not persisted**: `eventHorizon.defaultView` setting was overridden by stale globalState on init

## [1.0.0] — 2026-03-29

### Added
- **MCP Server**: JSON-RPC 2.0 endpoint at `/mcp` on the existing event server. 12 tools for agent-to-agent coordination — no external SDK required
- **File lock MCP tools**: `eh_check_lock`, `eh_acquire_lock`, `eh_release_lock`, `eh_wait_for_unlock` — agents can proactively check and acquire file locks instead of only learning about conflicts when blocked by hooks
- **Agent discovery tool**: `eh_list_agents` returns all connected agents with name, type, state, working directory, and active file locks
- **File activity tool**: `eh_file_activity` shows recent file reads/writes across all agents with optional file path filtering
- **Lock Manager extraction**: dedicated `LockManager` class with TTL-based expiration, FIFO wait queues, and path normalization. Extracted from the event server for testability and reuse
- **Transcript-based smart lock release**: locks are automatically released when an agent goes idle (`end_turn`) or writes to a different file. No manual release needed for typical workflows
- **Auto-register MCP server**: when connecting agent hooks, the MCP server entry is written to `~/.claude.json` (Claude Code) and `~/.config/opencode/opencode.json` (OpenCode) so agents discover coordination tools automatically
- **Plan Board — multi-agent task coordination**: agents can share, claim, and coordinate work through a plan loaded from any markdown checklist. In-memory board with atomic task claiming, dependency resolution, and automatic unblocking when dependencies complete
- **Plan markdown parser**: parses standard `- [ ]` / `- [x]` checklists with numbered task IDs (e.g. `1.1`, `3.2a`), `- depends: id1, id2` annotations, and `# Heading` plan titles. Supports any markdown file format
- **Plan MCP tools**: `eh_load_plan` (parse and register a plan), `eh_get_plan` (view all tasks with status/assignee), `eh_claim_task` (atomic, dependency-aware claiming), `eh_update_task` (mark progress/done/failed with notes)
- **Agent messaging**: `eh_send_message` sends targeted or broadcast (`*`) messages between agents. `eh_get_messages` retrieves unread messages with mark-as-read semantics. Per-recipient broadcast tracking
- **Plan Kanban board**: new "Plan" tab in Operations View showing tasks grouped by status (Blocked → Pending → Claimed → In Progress → Done → Failed) with progress bar, assignee badges, dependency annotations, agent notes, and toggleable empty columns
- **Plan orbital debris**: plan tasks rendered as orbital fragments around planets in the Universe view. Shape encodes status (diamonds for active, circles for done, X-crosses for failed). Color and animation match status (gold pulse for in-progress, red flash for failed, slow fade for done)
- **Plan persistence**: plan board persisted to VS Code `globalState` — survives window reloads. Restored on activation and hydrated to the webview on panel open. Completed tasks sync back to the source markdown file (checkboxes updated)
- **Plan auto-discovery**: newly spawned agents receive an automatic message notifying them about the active plan with task counts and how to get started
- **Bundled coordination skills**: three skills ship with the extension, installed to `~/.claude/skills/` on activation so all agents (Claude Code, OpenCode, Copilot) discover them automatically:
  - `/eh:create-plan` — generates a parallelism-optimized plan with scope check, file map, no-placeholders rule, self-review pass, and verify steps per task. Registers with Event Horizon via `eh_load_plan`
  - `/eh:work-on-plan [plan] [phase]` — claims tasks, marks progress, communicates breaking changes to other agents
  - `/eh:plan-status` — shows plan progress, active agents, blocked/available tasks
- **VS Code settings for view preferences**: `eventHorizon.defaultView` (universe/operations) and `eventHorizon.planShowAllColumns` now appear in Preferences > Settings and persist in `settings.json`
- **Shared formatters**: `formatTokens`, `formatCost`, `formatDuration`, `topTool`, `timeAgo` extracted from panels into `packages/ui/src/utils/formatters.ts`
- **Design tokens**: centralized colors, fonts, sizes in `packages/ui/src/styles/tokens.ts` with `agentColor()` and `stateColor()` helpers
- **Panel style objects**: reusable overlay, modal, grid, button, and table styles in `packages/ui/src/styles/panels.ts`
- **138 new tests**: MCP server (23), lock manager (17), plan board (46), message queue (23), physics (18), input handler (8), skill scanner (3). Total: 389 → 527+

### Improved
- **Webview decomposition**: 1,813-line `index.tsx` split into focused modules — `useWebviewMessages`, `useAchievementTriggers`, `useDemoSimulation`, `useSettingsPersistence` hooks + `ConnectModal`, `InfoOverlay`, `OnboardingCard` components. Index reduced to ~465 lines
- **Store split**: monolithic Zustand store split into domain stores (universe, settings, achievement, activity) with backward-compatible re-export
- **Universe ECS refactor**: 2,323-line renderer split into 8 extracted systems (AstronautSystem, ShipSystem, UFOSystem, ShootingStarSystem, MoonSystem, LightningSystem, PlanetAnimationSystem, InputHandler) + physics module. Universe reduced by 32% (734 lines extracted). All animation systems are pure functions operating on PixiJS containers
- **Entity base system**: `EntitySystem<T>` generic class for managing entity lifecycle (add/remove/update/destroyAll)
- **Auto-update hooks on activation**: all installed hooks, plugins, and MCP configs are refreshed on every extension activation — no manual uninstall/reinstall needed when the extension upgrades or the auth token rotates
- **Skills panel full-size layout**: Operations View skills tab now uses readable font sizes (13px names, 11px descriptions) and no height cap. Command Center retains compact sizing
- **Onboarding card awareness**: the "Connect Your First Agent" card no longer appears when agent hooks are already installed — it checks installed hook status at render time, not just live agent count

## [0.1.0] — 2026-03-21

### Added
- **Operations View**: full-screen dashboard alternative to the Universe. Toggle via the `$(layout)` button in the editor title bar, the `&#x2261;` button in the Command Center header, or `Ctrl+Shift+E O`. Same editor tab — the Universe is hidden (not destroyed) and the PixiJS ticker pauses to save CPU
- **Agent Sidebar**: left navigation panel (200px) in Operations view showing "All Agents" (singularity stats) + per-agent rows grouped by workspace with planet icons and state color dots. Click to select/filter
- **Overview tab**: full-width 4×3 metrics grid with 16px values, agent header (planet icon + name + type + state + cwd), horizontal tool breakdown bar chart. "All Agents" mode shows singularity stats + agent summary table with per-agent Load, Tools, Errors, Tokens, Cost columns
- **Files tab (expanded)**: sortable columns (File, Ops, Reads, Writes, Errors, Agents, Last Active) with click-to-sort arrows. Full Paths toggle, heat color legend, click-to-expand rows showing per-agent breakdown with colored dots and portal tooltips
- **Logs tab (expanded)**: full-height searchable event log with event type filter chips, auto-scroll toggle, click-to-copy entries, filtered by selected agent in sidebar
- **Timeline tab**: horizontal swimlane visualization — one row per agent, colored blocks for state changes (green), tool calls (amber), file ops (blue), and errors (red). Auto-scrolls to "now" line, hover tooltips with event details. Rolling buffer of 500 entries
- **Timeline event recording**: agent.spawn, agent.terminate, agent.error, tool.call, file.read, file.write events all feed the timeline buffer. Demo simulation also records timeline entries
- **View toggle command**: `eventHorizon.toggleView` registered as VS Code command with `$(layout)` icon in editor title bar and `Ctrl+Shift+E O` keybinding
- **Agent grouping utility**: `groupAgentsByWorkspace()` groups agents by working directory folder name, sorts alphabetically, puts "Solo" agents last. Reused by sidebar and available for future features
- **File locking — distributed lock manager for AI agents**: when enabled via `eventHorizon.fileLockingEnabled` setting (or the toggle in Settings modal / Operations status bar), agents must acquire a lock before accessing a file. If another agent holds the lock, **both reads and writes are hard-blocked** (exit code 2) — the tool does not execute and the agent sees a clear message: "BLOCKED: file is locked by Agent X. Work on other files first, retry in 30 seconds." Locks auto-expire after 30 seconds (TTL) and refresh on each write, so they persist across read-write cycles. Locks are released on agent termination. Lock check scripts are written to `~/.event-horizon/eh-lock-check.sh` (no inline bash quoting issues). New `/lock` API route on the event server (check/acquire/query/release). **Currently supported: Claude Code** (PreToolUse exit code 2 hard-blocks). OpenCode plugin has lock checking but blocking behavior is untested. Copilot hooks not yet implemented. Disabled by default — requires reinstalling hooks after enabling
- **15 new tests**: viewMode toggle (3), timeline buffer + cap (3), groupAgentsByWorkspace (6), folderName (3). Total: 254 → 269

### Improved

### Fixed

## [0.0.9] — 2026-03-21

### Added
- **Lightning arc filename label**: file collision lightning now shows the contested filename at the midpoint of the arc (9px cyan monospace text), so you can immediately see which file two agents are fighting over
- **Onboarding card (empty state)**: when no agents are running, the universe now shows a prominent welcome card with "Connect Your First Agent" and "Try Demo Mode" buttons instead of a dim hint. Includes a brief description and supported agents callout. The card disappears as soon as the first agent spawns, demo starts, or the user clicks Skip
- **Branded screenshots**: the Screenshot button now adds a footer bar to exported PNGs with the Event Horizon name, live session stats (agent count, tokens, cost, events), and a timestamp. Makes shared screenshots recognizable and informative
- **Guided tour**: 4-step walkthrough for first-time users — highlights Agent Identity, Metrics & Logs, Command Grid, and the Universe in sequence with a dimmed backdrop and green highlight ring. Auto-starts on first planet click, persisted so it never shows again. Restart anytime via the "?" button in the Command Center header
- **File Activity Heatmap**: new "Files" tab in the Command Center tracks every file read/write per agent. Shows a sorted list of most-active files with heat intensity bars, colored agent dots (matching planet colors), and operation counts. Files touched by multiple agents are highlighted amber ("contested"), files with errors show red. Sort by activity (Hot), multi-agent contention (Shared), or recency (New). Filter to show only the selected agent's files. Works with real agents and demo simulation. This is the foundation for future multi-agent coordination features — file locking, intent broadcasting, and conflict prevention
- **Native VS Code settings**: all settings now appear in `Preferences > Settings` under "Event Horizon" — port, animation speed, achievements toggle, and per-agent colors/sizes. Changes sync bidirectionally between the Settings UI, `settings.json`, and the in-app modal. The in-app Settings modal remains as a visual bonus

### Improved
- **Demo mode clarity**: demo agents are now labeled `[Demo] Claude`, `[Demo] OpenCode`, etc. — visible on planet labels and in the Command Center identity panel. An amber "DEMO 0:00" timer in the header bar shows elapsed time, and a "Clear" button lets you stop the demo instantly without hunting for the grid button
- **Extension description**: marketplace search description now emphasizes utility ("Real-time visual monitoring for Claude Code, OpenCode & Copilot") instead of aesthetics
- **Keywords**: replaced `cosmic` and `cursor` with `claude-code`, `opencode`, and `monitoring` for better marketplace discoverability

### Fixed
- **False collision lightning on startup**: CLAUDE.md, .clauderc, .cursorrules, .copilot-instructions.md, and files under `.claude/` / `.opencode/` directories are now excluded from file collision detection — these config files are read by every agent on init and were causing spurious lightning arcs between co-located Claude Code planets
- **Stars vibration in small windows**: resizing the panel no longer causes the starfield to visibly flicker. The resize observer is debounced (100ms) and stars are only recreated when the canvas size changes by more than 20px — small adjustments just reposition the existing layer
- **Tooltip/toast positioning when minimized**: command tooltips and achievement toasts now move down proportionally when the Command Center is minimized, maintaining the same relative gap instead of floating far above the collapsed header
- **Demo simulation type error**: demo agents assigned `'tool_use'` to the runtime state, which only accepts `'idle' | 'thinking' | 'error' | 'waiting'`. Tool-use phase now correctly maps to `'thinking'`

## [0.0.8] — 2026-03-16

### Added
- **Per-agent token & cost tracking**: displays cumulative token usage (input + output + cache) and estimated USD cost per agent in the Command Center Info tab. Totals shown in the singularity view. Cost estimated using Claude's per-token rates
- **Transcript watcher (Claude Code)**: tails the Claude Code JSONL transcript file in real time for richer, more accurate events than hooks alone. Provides precise waiting ring timing from `AskUserQuestion` tool use, per-turn token accumulation, and full tool metadata. Hooks remain as fallback if the transcript file is inaccessible
- **Astronaut mass variation**: astronauts now spawn with random mass (0.5–2.0). Light astronauts drift faster, curve dramatically near planets, and get flung around by gravity. Heavy astronauts move slowly, resist gravitational pull, and maintain straighter paths. Heavier astronauts appear slightly larger
- **OpenCode subagent tracking**: subagents spawned via the Task tool now appear as moons orbiting the parent OpenCode planet. Detection uses `session.created` events with `parentID` field from OpenCode's plugin hooks — no SSE connection required
- **OpenCode token & cost tracking**: OpenCode agents now display cumulative token usage and estimated cost in the Command Center Info tab, matching Claude Code's functionality. Token data is extracted from `message.updated` events and accumulated per session
- **OpenCode session discovery**: OpenCode plugin now sends heartbeat announcements every 30 seconds continuously. Event Horizon will detect running OpenCode agents within 30 seconds of starting, even if OpenCode was started hours earlier. Requires reinstalling hooks and restarting OpenCode
- **Editor-area universe panel**: the full universe now opens as an editor tab in the main working area instead of the narrow sidebar. Click the rocket icon in the editor title bar or run `Event Horizon: Open Universe` from the command palette. Keybinding: `Ctrl+Shift+E H`
- **Status bar agent counter**: a persistent rocket indicator in the bottom status bar showing the active agent count. Clicking it opens the universe. When an agent is waiting for user input, the bar blinks amber with a bell icon showing which agent needs attention

### Improved
- **Planet gravity**: planets now have a localized gravity field (3× radius). Astronauts passing nearby curve their trajectory; only those very close get captured into orbit. Exponential falloff (t⁶) keeps the edge gentle and the core strong. Larger planets pull stronger (proportional to rendered radius, including settings size override). Jetpack can escape the pull
- **Demo mode realism**: agents now spawn one by one over 3–5 seconds in random order. Each agent runs an independent state machine (idle → thinking → tool_use → completing) with randomized timing, so no two planets change state in lockstep. Agents cycle through realistic multi-tool work bursts, occasionally error, spawn/despawn subagent moons, activate skills (code-review, run-tests, etc.), and trigger file collision lightning between workspace-sharing agents

### Fixed
- **Ghost skill indicator**: the active skill dot no longer appears for built-in CLI commands (e.g. `/commit`) that are not actual installed skills
- **Planet click-to-select broken after drag feature**: clicking a planet no longer triggers the Command Center — drag handler was intercepting all clicks. Fixed by tracking whether the pointer actually moved before suppressing the click event
- **Cooperation ship spam with many agents**: when 5+ agents share a workspace, overlapping ship arcs would obscure the planets. Capped visible ships to 2 per directed pair, removed burst convoys, scaled spawn intervals by pair count so large groups don't flood the universe, and increased ship travel speed for faster visual turnover
- **Move Skill created broken paths**: the Move Skill feature allowed moving skills into category subfolders (e.g. `skills/documentation/my-skill/`), which breaks agent discovery — Claude Code, OpenCode, and Copilot only scan one level deep. Replaced the category combobox with a "Move to Root" button that only appears for skills already in subfolders, with a warning explaining the issue. Skills in subfolders now show an amber warning in the skill card. Added `metadata.category` and `metadata.tags` parsing from SKILL.md frontmatter as the correct way to categorize skills without affecting file layout
- **Marketplace search timeout**: API searches now have an 8-second timeout. Shows "Search timed out." or "Search failed." with a Retry button instead of spinning forever

## [0.0.7] — 2026-03-15

### Added
- **Sidebar badge**: VS Code activity bar icon now shows a numeric badge with the count of active agents. Updates in real time as agents connect and disconnect
- **Welcome walkthrough**: VS Code native Getting Started guide with 5 steps — open the universe, connect an agent, explore the visualization, use the Command Center, and manage skills
- **Settings modal**: gear button (&#x2699;) in the CommandCenter header opens a full settings modal with live planet previews. Customize agent colors and planet size multipliers per agent type with color pickers and size sliders (0.4–2.0×). Each agent row shows a mini SVG planet that updates in real time as you adjust settings. Colored aura ring around planets makes color changes immediately visible in the universe. Additional settings: animation speed (0.25–3×), achievements on/off toggle, event server port configuration. Includes "Reset to Defaults" button. All settings persist across VS Code restarts via `globalState`. 10 new tests (5 store, 5 renderer)
- **Auto-detect running agents** (best-effort): on activation, Event Horizon nudges agent config files so already-running sessions announce themselves. Planets appear immediately for detected sessions; any remaining sessions appear as soon as you interact with them
- **Drag to rearrange planets**: click and drag any planet to reposition it independently. Planets can't overlap each other (enforces minimum distance) or be placed on the singularity. Drag the asteroid belt to move the entire workspace group together. Asteroid belts redraw in real time to match new positions. New planets joining a moved group spawn near the group's current location. Moons, ships, and lightning arcs follow. Reset Layout button reverts everything to auto-layout. Custom positions persist for the session

### Improved
- **Skill search debounce**: search input in the Skills tab now debounces by 150ms to prevent jank with large skill collections
- **Skill agent filters**: agent type buttons are now multi-select toggles (all ON by default). Toggle off to hide skills for that agent. Renamed "OC" to "OpenCode"
- **Medal tooltip**: hovering a medal now shows a portal-based tooltip (same style and position as the command grid tooltip) with name, tier, progress count, and description
- **Header button tooltips**: Settings (gear) and Minimize/Expand buttons in the Command Center header now show tooltips on hover, matching the command grid tooltip style
- **Wider tooltips**: all portal tooltips (commands, medals, header buttons) widened from 172px to 190px to align with the right panel crest

### Security
- **flatted DoS vulnerability**: upgraded transitive dependency `flatted` from 3.3.4 to 3.4.1 via pnpm override to fix unbounded recursion DoS in `parse()` ([dependabot #9](https://github.com/nicolo-ribaudo/flatted/issues/88))

### Fixed
- **Plugin Collector achievement**: fixed double-counting on webview reload — now uses absolute count recalibration (`recalibrateTieredAchievement`) that corrects inflated persisted tiers downward
- **Medal layout overflow**: medals now display without a scrollbar for 3 rows; scrollbar only appears if more rows are needed. Command Center panels increased by 1px (133→134) with tooltip/toast positions adjusted accordingly

## [0.0.6] — 2026-03-14

### Added
- **Skills integration**: full lifecycle management for [Agent Skills](https://agentskills.io) — discover, browse, create, duplicate, move, and organize skills directly from Event Horizon
- **Skill Discovery**: scans `~/.claude/skills/`, `.claude/skills/`, `~/.claude/commands/`, `~/.config/opencode/skills/`, `~/.copilot/skills/`, and plugin directories. Live file watcher detects changes instantly. Supports both flat (`skills/<name>/`) and categorized (`skills/<category>/<name>/`) layouts
- **Skills tab** in Command Center: searchable, filterable skill list with scope badges (Personal/Project/Plugin/Legacy), agent type badges (Claude/OC/Copilot), category badges, and a "Universal" gold badge for cross-agent skills. Arrow key navigation, expand to see details, Open in Editor / Move / Duplicate actions
- **Skill orbit ring**: each planet shows a faint dotted ring with one dot per installed skill. When a skill is actively executing, the corresponding dot pulses bright cyan with a floating `/skill-name` label
- **Skill fork probe**: when a fork-context skill spawns a subagent, a cyan diamond "probe" ship launches from the planet with a matching cyan trail
- **Create Skill wizard**: 3-step guided flow (template → configure → preview) with proper SKILL.md frontmatter generation. Templates: Blank, Code Review, Test Runner, Documentation. Category folder combobox with existing categories dropdown + free text for new ones
- **Duplicate skill**: copy any skill with a new name — the SKILL.md content is cloned with the `name:` field updated
- **Move skill**: reorganize skills into category folders via inline combobox on skill cards. Empty source folders are auto-cleaned
- **Skills Marketplace browser**: hybrid approach with 4 pre-populated sources (SkillHub, SkillsMP, Anthropic Official, MCP Market). API marketplaces (SkillHub) support inline search; others open in browser. Add/remove custom marketplace URLs. Marketplace button in command grid
- **Skill activity in Logs tab**: skill invocations highlighted in cyan with `/skill-name` labels
- **"Skill Master" achievement**: tiered [1, 5, 10, 25, 50] — tracks unique skills invoked across all agents
- **"Plugin Collector" achievement**: tiered [1, 5, 10, 25, 50, 100] — tracks unique skills discovered on disk
- **30 new tests**: SKILL.md generation (14), scope deduplication (8), legacy command parsing (7), path construction (4). Total test count: 143 → 173

### Changed
- **Claude Code hooks switched to silent `command` wrapper**: hooks now use `type: "command"` with `curl ... || true` so they exit 0 even when Event Horizon is not running — eliminates `Stop hook error: ECONNREFUSED` and similar messages. The `--connect-timeout 2` flag prevents hanging. Stale hooks (including previous `http` type) are auto-detected and replaced on extension activation
- Event server returns empty 200 body on `/claude` route to avoid Claude Code misinterpreting response JSON as hook output

### Fixed
- **Workspace group overlap**: when demo simulation agents shared a workspace name with real agents, the two groups could visually stack on top of each other. Added a group-level repulsion pass in `computePlanetPositions` that detects overlapping cluster centroids and pushes entire groups apart before individual planet repulsion runs

## [0.0.5] — 2026-03-12

### Added
- **Full OpenCode event integration**: all 17 OpenCode plugin events now mapped — added `permission.asked` → waiting ring, `permission.replied`, `session.compacted`, `session.updated`, `command.executed`, `lsp.client.diagnostics`, `todo.updated`, `server.connected`, and more. OpenCode agents now show the amber waiting ring on permission dialogs
- **Visual Effect column** in README hook matrix — every lifecycle event now documents its corresponding animation (e.g. "Planet appears + pulse wave", "Amber pulsing ring", "Blue tool-use glow")
- **Workspace grouping**: agents working in the same folder/workspace are now clustered together visually. An irregular asteroid belt ring (scattered rocks with glowing highlights) surrounds each group, making workspace relationships immediately visible
- **File collision lightning**: when 2+ agents edit the same file simultaneously, a continuous lightning stream arcs between their planets. Multiple jagged bolts (cyan, white, pale blue) with glow and endpoint sparks persist as long as both agents are actively touching the same file (10-second sliding window). File paths are extracted securely from connector payloads — only the path string, never file content
- **Medals gallery**: medals tab now shows all 26 achievements — unearned ones appear as dark silhouettes with a subtle green border. Hovering an unearned medal reveals its name and how to earn it (secret medals show "Figure this one out yourself…"). Tab counter shows earned/total (e.g. `3/26`)
- **Renderer test coverage**: 45 unit tests for collision math, bezier curves, ship arc avoidance, planet placement/overlap resolution, workspace grouping, belt contour generation. Pure math extracted to `packages/renderer/src/math.ts` for testability. Total test count: 112 → 164
- **Export Stats button**: new command grid button (Row 2) downloads session metrics as a timestamped JSON file — includes agent list, per-agent metrics (load, tools, uptime, tool breakdown), singularity stats, and achievement progress
- **Screenshot button**: new command grid button (Row 2) captures the full view (WebGL universe + HTML Command Center) as a PNG image download using `html2canvas` with WebGL frame injection

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
- **Solo planet belt overlap**: solo planets (not part of a workspace group) no longer spawn inside another group's asteroid belt. A post-placement pass computes each belt's radial extent and pushes solo planets outward until they fully clear the belt contour
- **Tooltip/toast positioning**: command tooltip and achievement toasts moved up 5px to avoid overlapping the Command Center top edge

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
