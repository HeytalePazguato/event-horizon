# Changelog

All notable changes to the Event Horizon VS Code extension will be documented in this file.

## [3.0.0] — TBD

### Added
- **Project knowledge graph**: a queryable map of code structure, docs, agent activity, and shared knowledge, stored locally in EventHorizonDB. User-triggered only — nothing runs in the background.
- **Project graph foundation**: SQLite tables (`graph_nodes`, `graph_edges`, `graph_file_state`) plus FTS5 full-text search inside the existing EventHorizonDB. Shrink-guard refuses extractor regressions that would delete more than 50% of a file's prior nodes.

### Changed
_(filled in as phases ship)_

## [2.1.1] — 2026-04-22

### Fixed
- **OpenCode agents exit code 1 immediately on spawn (P0)**: `OpenCodeSpawner.spawn()` was building the argv with Claude Code's CLI syntax (`['-p', prompt, '-f', 'json', '-q']`). In OpenCode those flags mean `--password`, `--file`, and nothing, so the process aborted before producing any output. Now emits the correct OpenCode form `['run', '--format', 'json', prompt]` (prompt is positional after the `run` subcommand)
- **`eh_spawn_agent` rejected OpenCode orchestrators with "agent_type could not be resolved"**: the server relied on `AgentStateManager` knowing the orchestrator's runtime type, but OpenCode sessions often reach `eh_spawn_agent` before any `agent.spawn` event has registered one, leaving the type as `undefined` or `"unknown"`. Added an agent-id-prefix fallback (`opencode` / `claude` / `cursor`) that fires only when the primary lookup returns nothing — the existing explicit-override and registered-type paths are unchanged
- **`eh:orchestrate` skill instructions**: rewritten the "Determine worker agent type" step to tell orchestrators to **always pass** `agent_type` explicitly (their own runtime as the default) rather than omitting it and relying on server inference. Server inference is now framed as a fallback, not a contract

## [2.1.0] — 2026-04-20

### Fixed
- **Demo gray-screen freeze (P0)**: clicking Demo spawned all 8 fake agents within a 0–5s burst, overlapping React + PixiJS subsystem rebuilds and crossing the Chromium watchdog threshold — the renderer process was killed without emitting a JS error. Demo spawns are now sequential with a 2s gap between each agent (`SPAWN_INTERVAL_MS` in `useDemoSimulation.ts`), and an unconditional `[EH demo-spawn]` log marks each addition. Real-agent flows never hit this because real spawns are seconds-to-minutes apart, which is why the bug only ever reproduced under the demo
- **File-collision lightning never rendered**: `sparksRef.current` was initialized once on mount with the empty initial `sparks` array and never resynced. The renderer ticker called `updateLightning(sparksRef.current, …)` with a permanently-empty array, so cyan arcs and labels for shared-file collisions never drew. Added the missing `sparksRef.current = sparks` sync next to the other prop→ref assignments
- **Spawn beams drawing to garbage endpoints + never expiring**: `BeamSystem.update` was passed the PixiJS ticker `tickTime` (accumulated seconds since page load) but compared it to `beam.startTime` which was wall-clock ms — `elapsed` came out as roughly `−1.7×10¹²`, so beams never aged past `BEAM_DURATION` and `headProgress` produced wildly off-screen `lineTo` endpoints. `BeamSystem` now uses `Date.now()` internally; all three beam-creation call sites (`useDemoSimulation`, `plan-completed` synthesis, live-event `agent.spawn`) standardised on `Date.now()` for `startTime`
- **Constellation linked author to every agent in the universe**: a knowledge entry authored by a demo agent created links to every other planet on screen — including unrelated real-agent planets that had nothing to do with the demo plan. Rewrote `knowledgeLinksComputed` to be scope-aware: plan knowledge links only among assignees of the active plan; workspace knowledge links only among agents that share a `cwd`; user-authored workspace entries get the gold tint and link all members within each workspace
- **Constellation lines didn't follow dragged planets**: `ConstellationSystem.update` was wired to a `useEffect` with `[knowledgeLinks]` deps, so it only redrew on knowledge changes — never on planet movement. Now redraws every ticker frame so lines track drags
- **Wormholes wiped every 15 seconds**: the extension host's periodic `wormhole-update` broadcast called `setWormholes(ws)` with a full-replace, deleting any wormholes seeded by the demo. The webview handler now preserves entries whose `id` starts with `demo-` and only replaces the non-demo entries
- **Wormhole portals invisible**: the wormholes container was added before the planets container, so the violet spirals rendered behind the planet sprite. Moved the container above planets/moons in `Universe.tsx`, and offset each portal 24px along the connection line so the spiral sits at the planet edge instead of dead-center
- **History replay flooded the webview on init**: `webviewProvider.hydrateWebview` queried 24 hours of session history (uncapped) and 500 historical events, replaying every row onto the React main thread. Reduced to a 10-minute window with 200-event and 50-session caps — large enough to resurrect agents that might still be alive, small enough to not blow the postMessage boundary
- **Phantom agents resurrected on reload**: the session replay treated every row in `agent_sessions` as a live agent, so workers that died without sending `agent.terminate` (terminal killed, crash) reappeared as planets every reload — building up dozens of phantoms over time. The replay now skips sessions with `sessionEnd` set or `sessionStart` older than 10 minutes
- **`pnpm build:webview -- --dev` silently dropped the `--dev` flag**: pnpm's `--` separator handling stripped the arg before it reached the esbuild script, so dev-mode builds always produced production bundles with `__EH_DEV__ = false` and diagnostic logs disabled. Added a dedicated `pnpm build:webview:dev` script that invokes `node webview/esbuild.mjs --dev` directly

### Performance
- **Eliminated O(N²) renderer rebuild cascade on agent spawn**: the planet-rebuild useEffect ran fully on every `agents` change, rebuilding asteroid belts, debris fields, planet positions, and station overlays from scratch each time. Added content-fingerprint caches (`knowledgeLinksComputed`, `planDebris`, `planTasksRec`), referential-stability for `agentStates`/`contextUsage`/`achievementCallbacks`, and wrapped `Universe` in `React.memo`. Agent additions now do incremental updates instead of full rebuilds
- **DebrisSystem cache keyed on content fingerprint**: previously rebuilt the entire debris field on every prop identity change. Now keyed on `(taskCount, lastUpdated)` with persistent `Maps` for incremental updates
- **Asteroid belt diff instead of full rebuild**: `Universe.tsx:1097-1135` now hashes member positions per workspace group and only rebuilds belts whose contour actually changed
- **Pixi ticker hot path cleanup**: ring buffer for ship trail points (replaces shift+push), persistent `planetInfos` and `astroCallbacks` refs (no more per-tick allocation), short-circuit wormhole redraw when endpoints unchanged, conditional tether redraw with persistent `Maps` in `DebrisSystem`, throttled lightning bolt count with cached non-random geometry, and a generic `GraphicsPool` backing object pools for jet spray and shooting stars
- **Stores given hard caps**: ring buffers for `timeline` and `logs` slices in `activitySlice`, O(1) LRU prune for `fileActivity`, debounced `setSingularityStats` (1s), `React.startTransition` for non-urgent state updates
- **Visibility-pause cleanup**: hidden→visible transitions now clear `activeShipsRef` and `spawnedShipIdsRef` so a long hide doesn't dump a stampede of accumulated work onto the first visible frame
- **Extension-host work bounded**: indexed `WHERE agent_id=? AND session_end IS NULL` with in-memory open-session cache, batched SQLite inserts via 250ms flush window with `BEGIN/COMMIT`, coalesced webview `postMessage` into 50–100ms `events-batch` packets, dirty-flag DB save (only writes on actual mutations), and hash-based skip when trace/insights/heartbeat/wormhole payloads are unchanged
- **Trace-span batching**: demo simulation per-tick spans collapse into a single `setTraceSpans` call instead of one per agent; demo trace cap at 500 spans

### Added
- **Demo now showcases every visualization**: seeded plan knowledge from four authors (Claude, Copilot, Cursor, Gemini) so the constellation lights up with multiple plan + workspace lines from the moment all 8 agents spawn; seeded three wormholes between cooperating workspace pairs (`claude↔opencode`, `copilot↔cursor`, `cursor↔gemini`) so the violet portals and flowing particles are visible without needing real cross-agent file correlation
- **`eh_stop_all_workers` MCP tool + `/eh:abort-plan` skill**: kills every spawned worker for a plan in one call. Backs the orchestrator-side need to abort a runaway multi-agent run without picking off agents one-by-one
- **`pnpm build:webview:dev` script**: builds the webview bundle with `__EH_DEV__ = true` so `[EH demo-diag]`/`[EH pixi-tick]` instrumentation logs fire in the webview devtools
- **`window.error` and `unhandledrejection` listeners in the webview entry**: catch any sync exception or unhandled promise rejection that previously died silently before `[EH boot]` logged

### Changed
- **`spawnRegistry` linked-session resolution**: heartbeats and task claims now backfill the spawn registry's session map so `eh_stop_agent` can resolve agents by either spawn ID or session ID (fixed a class of "agent shows in UI but `eh_stop_agent` says not found" bugs)
- **Webview `event-history` replay window**: 24h → 10min, events 500 → 200, sessions uncapped → capped 50
- **Demo-only wormholes preserved across `wormhole-update` broadcasts**: handler now merges instead of replaces

## [2.0.3] — 2026-04-19

### Fixed
- **OpenCode spawn crash on Windows paths with spaces**: `cmd.exe /s /c` strips outer quotes from the command string, breaking paths like `C:\Program Files\nodejs\opencode.cmd`. `buildFinalArgs()` now wraps the full command in an outer quote layer with `windowsVerbatimArguments: true`, matching the canonical `cross-spawn` pattern. Error was `'C:\Program' is not recognized as an internal or external command`
- **Claude Code "no stdin data" warning on spawn**: batch-mode agents (`-p`) receive their prompt via argv, not stdin. The open stdin pipe caused Claude Code to wait 3 seconds printing a noisy warning before proceeding. `child.stdin.end()` now closes it immediately
- **Claude Code silent exit code 1 on expired auth**: batch mode cannot do interactive re-authentication. When OAuth tokens expire (e.g. 12-hour corporate rotations), spawned agents fail silently with exit code 1. `parseStreamJsonFailure()` now detects `authentication_failed` / `api_error_status: 401` from stream-json stdout and shows a VS Code notification with an "Open Claude Terminal" button for re-auth
- **Stale agents persist in UI indefinitely (P0)**: agents whose processes ended without sending `agent.terminate` (terminal killed, crash, VS Code restart) were reconstructed as "alive" from SQLite event history. Two fixes: (1) `spawnRegistry.onAgentExit()` callback injects synthetic `agent.terminate` events through the full pipeline (AgentStateManager → SQLite → webview) when a process exits or terminal closes; (2) the 30-second heartbeat check auto-evicts agents with `lost` status (>5 min silence) that aren't in the spawn registry
- **Session table row explosion**: `agent_sessions` table created ~965 rows per agent instead of 1 because each `agent.spawn` event used a new timestamp as part of the `(agent_id, session_start)` primary key. Now checks for an existing open session before inserting
- **Green status dots on dead agents**: the Agents sidebar showed green for all idle agents regardless of heartbeat status. Now uses heartbeat data: green (alive), amber (stale), gray (lost)
- **API/UI agent list inconsistency**: `eh_list_agents` (in-memory) and the UI (SQLite replay) returned different agent counts after restarts. Addressed by heartbeat auto-eviction and spawn-exit terminate events keeping both in sync
- **Orchestrator role badge never showing (4th report)**: hook-connected agents (not spawned by EH) don't know their own `session_id`. When calling MCP tools like `eh_claim_orchestrator`, the AI model guesses an `agent_id` (e.g. `"claude-code"`) that doesn't match the `session_id` from hook events (e.g. `"a1b2c3d4-e5f6-..."`). Added `resolveAgentId()` to the MCP server that fuzzy-matches against known agents by ID prefix, type, or heartbeat status. Applied to `eh_claim_orchestrator`, `eh_spawn_agent`, `eh_stop_agent`, and `eh_reassign_task`

### Added
- **`Event Horizon: Clear Stale Agents` command**: command palette action that purges all stale/lost agents with no running process. Emits synthetic terminate events so cleanup propagates to SQLite and webview
- **`eh_purge_stale_agents` MCP tool**: agents can programmatically purge stale agents from the dashboard
- **Stdout capture on spawn failure**: last 8 KB of stdout is buffered and dumped to the "Event Horizon — Agents" output channel on non-zero exit. No more silent failures from stream-json CLIs
- **Error notifications on spawn failure**: all spawners (Claude, OpenCode, Cursor) now show VS Code error notifications when agents exit non-zero, directing users to the output channel for details

## [2.0.2] — 2026-04-15

### Fixed
- **Agent spawn ENOENT on Windows for npm-installed CLIs**: `resolveCommand()` used `where` to locate binaries, but on Windows `where opencode` returns both the extensionless Unix shell script (`C:\Program Files\nodejs\opencode`) and the `.cmd` shim (`C:\Program Files\nodejs\opencode.cmd`). The function picked the first result — the extensionless file — which Node cannot execute with `shell: false`, causing `spawn ENOENT`. Now prefers entries with Windows-executable extensions (`.cmd`, `.bat`, `.exe`, `.ps1`) over extensionless files, so the `.cmd` shim is selected and properly wrapped via `cmd.exe /d /s /c`. Affects all agent spawners (Claude Code, OpenCode, Cursor)
- **Orchestrator role and role badges not showing in UI**: when an agent claimed the orchestrator role via `eh_claim_orchestrator`, the role assignment was stored in `RoleManager` with an `agentId`, but the `agentRoleMap` broadcast to the webview was built exclusively from `spawnRegistry.getAgentRoleMap()` — which only knows about agents spawned through the spawn registry. Hook-connected agents (the common case) were invisible. The role map is now built from both sources. The Roles panel's Agent Assignments section also only matched roles by `agentType`, skipping `agentId`-based assignments entirely — now checks both
- **OpenCode agents showing "/" as working directory**: OpenCode's VS Code extension plugin can send `cwd="/"` when the project path resolves to the filesystem root (e.g. `URL.pathname` from `file:///`). This truthy value bypassed the workspace folder fallback injection. Root-only paths (`/`, `C:\`) are now treated as missing, so the primary workspace folder is injected instead
- **Knowledge tab Plan section showing stale entries from old plans**: all knowledge broadcasts used `getAllEntries()` without a plan ID, so plan-scoped entries were always read from the `_default` bucket — entries from whichever plan happened to not pass a `plan_id` to `eh_write_shared`. Now tracks the webview's selected plan ID and passes it through to all knowledge queries. Switching plans in the sidebar immediately refreshes the Plan knowledge section. Plan changes (load, task update, completion) also trigger a knowledge re-broadcast

### Dependencies
- `react` 19.2.4 → 19.2.5
- `react-dom` 19.2.4 → 19.2.5
- `vitest` 4.1.2 → 4.1.4
- `@types/node` 25.5.2 → 25.6.0
- `globals` 17.4.0 → 17.5.0

## [2.0.1] — 2026-04-14

### Fixed
- **Extension crash on activation: `ENOENT ... out/sql-wasm.wasm`**: the shipped 2.0.0 VSIX was missing sql.js's WASM binary. `esbuild --bundle` inlines JavaScript but cannot embed binary assets, and `vsce package --no-dependencies` strips `node_modules/` — so the WASM had nowhere to live at install time. Added `scripts/copy-sql-wasm.mjs` that copies `node_modules/sql.js/dist/sql-wasm.wasm` into `out/` as part of every build path (tsc dev, esbuild prod, VSIX packaging). `persistence.ts` now passes an explicit `locateFile` callback to `initSqlJs` that resolves via `__dirname` in prod and falls back to `require.resolve('sql.js/dist/sql-wasm.wasm')` for tests, so the WASM is always found regardless of how the extension was installed
- **Agent spawn failing with "terminal process terminated with exit code 1" on Windows**: spawners built a single shell command string using PowerShell-only syntax (`[System.IO.File]::ReadAllText(...)`) and then passed it to `cp.spawn({ shell: true })`, which on Windows defaults to `cmd.exe` via `COMSPEC`. `cmd.exe` could not parse the PowerShell syntax and exited 1 before the CLI ever ran — no output, no logs, no recourse. Rewrote every spawn path to argv-style `cp.spawn(bin, [...args], { shell: false })`: no shell between us and the CLI, no escaping, no temp files. Windows shim files (`.cmd` / `.bat` / `.ps1`) are detected and wrapped correctly. Interactive mode now uses `createTerminal({ shellPath, shellArgs })` so VS Code runs the CLI directly as the terminal's root process
- **Silent spawn failures**: added an `Event Horizon — Agents` output channel that logs every spawn (resolved path, args with prompts redacted, cwd) and mirrors stderr — so the next time a child process dies the user actually has something to read
- **OpenCode orchestrator spawning Claude workers (and vice-versa)**: `eh_spawn_agent` required `agent_type` and did nothing server-side when it was omitted, so worker runtime was entirely at the mercy of the orchestrator LLM remembering (and correctly stating) its own type. The server now defaults worker `agent_type` to the orchestrator's registered runtime — OpenCode orchestrator → OpenCode workers, Claude orchestrator → Claude workers — without the LLM having to pass anything. `agent_type` is now optional in the tool schema; explicit values still override (for `--agent` flags and `[agent: X]` task metadata). Orchestrate skill updated to instruct agents to omit the param unless overriding
- **Knowledge tab empty on extension open**: the auto-seed pass for workspace instruction files fired before the webview existed, so its `knowledge-update` broadcast was dropped and the tab stayed empty forever. `hydrateWebview` now re-broadcasts current knowledge when the webview signals `ready`, so entries show up whether they were written before or after the panel mounted
- **Kanban task cards overflowing their columns**: long auto-generated task IDs pushed cards past their grid cell width on narrow panels. Grid cells and `TaskCard` now have `minWidth: 0` + `overflowWrap: anywhere`, and the ID span no longer refuses to shrink

### Added
- **Workspace instruction file auto-discovery**: the extension now globs `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `copilot-instructions.md`, `.github/copilot-instructions.md`, and `.claude/rules/**/*.md` across every workspace folder via `vscode.workspace.findFiles`. Each file becomes its own workspace knowledge entry (no more 20-section merge) with a stable `auto:<relPath>` key, tier assignment (root instructions → L1, `.claude/rules/*` → L2), and `source: auto` tag
- **Live sync via `FileSystemWatcher`**: creating, editing, or deleting an instruction file updates the corresponding Knowledge entry within ~1s without a VS Code reload. Workspace folder add/remove triggers a full re-scan
- **`source` field on `KnowledgeEntry`**: `auto` (scanned), `user` (typed in the UI), or `agent` (written via `eh_write_shared`). `writeIfNotUserAuthored` helper ensures re-scans never overwrite user- or agent-authored entries
- **Tier grouping + auto pill in Knowledge tab**: the Workspace section now groups entries by tier with L0 / L1 / L2 sub-headers and counts. Auto-discovered entries show a dashed "auto" pill with a tooltip explaining they came from an instruction file
- **`eventHorizon.knowledge.autoDiscover` setting** (boolean, default `true`): disable to opt out of auto-scanning instruction files — useful if you only want knowledge that was explicitly written by agents or via the UI

## [2.0.0] — 2026-04-13

### Added
- **SQLite event persistence**: all agent events stored verbatim in a local SQLite database (sql.js WASM) at the extension's global storage path. Events survive VS Code reloads and restarts. Configurable via `eventHorizon.persistence.enabled` and `eventHorizon.persistence.retentionDays` (default 30 days). Auto-pruning removes events older than the retention period on activation
- **Event replay on reload**: on webview hydration, last 24 hours of historical events and agent sessions are sent to the UI. Logs tab shows previous session events, agents from recent sessions appear in the agent list
- **Full-text event search**: FTS5-indexed events searchable by payload content (tool names, file paths, agent names). Falls back to LIKE-based search when FTS5 is unavailable
- **Agent session tracking**: spawn/terminate events create session records with token usage, cost, and event count aggregates
- **WebSocket endpoint**: bidirectional WebSocket server at `/ws` path with auth token verification, debounced broadcasts (100ms batching), and ping/pong health checks. Configurable via `eventHorizon.websocket.enabled`
- **EventBus batch debouncing**: new `onBatch(prefix, handler, windowMs)` method accumulates rapid events by type prefix and delivers them as a single array after the window. Existing synchronous listeners unchanged
- **Hierarchical event metadata**: `AgentEvent` now carries optional `workspace` and `category` fields for structured filtering. `deriveEventCategory()` helper extracts category from event type prefix
- **Context layer classification**: TokenAnalyzer classifies token usage per agent into 4 layers — System Prompt (estimated from first cache creation), Conversation History, Tool Results, and Cached Tokens. Tracks usage ratio against configurable context window size (default 200k)
- **Context fuel gauge on planets**: 270-degree arc around each planet showing context window usage. Color shifts from cyan (<50%) to amber (50-80%) to red (>80%). Critical usage (>90%) triggers pulse animation. Configurable via `eventHorizon.contextGauge.enabled` and `eventHorizon.contextGauge.windowSize`
- **Context Layers panel section** in the Costs tab: per-agent stacked horizontal bars with System (blue), Conversation (teal), and Tool Results (amber) breakdown. Shows usage as "124k / 200k (62%)" with color-coded percentage
- **Temporal validity on shared knowledge**: `validFrom`/`validUntil` fields. Agents can set expiration via `eh_write_shared` (`valid_until` parameter). `eh_read_shared` excludes expired entries by default (`include_expired: true` to see them)
- **Knowledge tab temporal-validity UI**: stats header showing active / never-expire / expiring-within-24h / expired counts; "Show expired entries" toggle (default off); "Expires after" dropdown (Never / 1h / 6h / 24h / 7d / 30d) in Add and Edit forms; +24h "Extend" button on expired entries for one-click resurrection; expired entries shown dimmed with strikethrough and red "EXPIRED" badge
- **Knowledge tab 4-tier loading model**: collapsible info banner explaining how knowledge loads into agents. Tier badges (L0/L1/L2) on every entry row and section header. Tier picker in Add/Edit forms for workspace entries (L0 = critical identity, L1 = essentials). L3 explainer card directs users to Activity → Logs search or `eh_search_events` for deep search over persisted event history. New `tier` field on `KnowledgeEntry` (optional, defaults workspace→L1, plan→L2)
- **Event search engine with query sanitization**: `EventSearchEngine` wraps SQLite FTS queries with a 4-stage sanitization pipeline — short queries pass through, long queries extract last question, fall back to last meaningful sentence, then truncate to last 500 chars. Prevents 89× retrieval degradation from system-prompt contamination
- **`eh_search_events` MCP tool**: agents can full-text search persisted events. Supports filters by agent ID, type, and time range
- **Search bar in Logs panel**: press Enter to trigger persistence-backed DB search. Results replace live feed; "Clear search" button returns to live mode. Currently-selected agent and type filter are passed as search constraints
- **Cross-agent file correlation**: `CrossAgentCorrelator` tracks which files multiple agents touched within a 10-minute window. Builds wormhole connections between agent pairs that share files. Strength scales with shared file count (capped at 1.0). Prunes correlations older than 30 minutes. Broadcasts active wormholes to webview every 15s
- **Wormhole visuals on planets**: purple swirling portals at correlated agents' planets, connected by a flowing-particle line. Stronger correlations are more opaque. Portals spin in opposite directions; particles flow along the connection
- **Execution replay drill-down**: done/failed plan tasks have a "▶ View Execution" button. Opens a modal showing all events during that task's execution window — tool calls, file reads/writes, results
- **Agent CLI auto-detection**: on extension activation, scans PATH for installed agent CLIs (`claude`, `opencode`, `cursor`) and checks for the GitHub Copilot extension. When any agent is installed but missing EH hooks, shows a notification with a "Configure" button → multi-select QuickPick → runs hook setup. Toggleable via `eventHorizon.autoDetect.enabled`
- **Data export command** ("Event Horizon: Export Data..."): 3-step UI for exporting Events (JSON/CSV) or Agent Sessions (JSON) filtered by date range (24h / 7d / 30d / all). CSV escapes payload as JSON string
- **6 new settings** under `eventHorizon.*`: `persistence.enabled`, `persistence.retentionDays`, `websocket.enabled`, `contextGauge.enabled`, `contextGauge.windowSize`, `autoDetect.enabled`
- **`eh:orchestrate` skill**: new bundled skill for managing plans as an orchestrator — spawns worker agents, assigns tasks by role, monitors progress, handles failures with model escalation. Falls back to self-implementation when spawning fails. Supports `--agent` flag to override worker agent type. Agent type resolution: user override → task metadata → same as orchestrator
- **`tier` parameter on `eh_write_shared` MCP tool**: agents can self-tier their knowledge entries (L0/L1/L2). Returned in `eh_read_shared` results so agents know the tier of each entry
- **Orchestrator and role badges in Agents sidebar**: orchestrator agents show a gold `★ ORCH` badge; agents with an assigned role show a colored role badge (implementer / reviewer / tester / researcher / planner / debugger). Both badges have tooltips. Maps hydrate on webview load and rebroadcast on plan changes and agent spawn/stop
- **Worker failure notifications pushed to orchestrator**: when a worker fires `agent.error` or `task.fail`, Event Horizon now sends a message to every active plan's orchestrator describing the failure and suggesting `eh_retry_task` / `eh_reassign_task`. Self-notifications are suppressed so the orchestrator's own errors don't loop. `eh:orchestrate` skill and the Orchestrator role instructions both include the "check messages before status" pattern
- **Optional interactive spawn mode**: `eh_spawn_agent` accepts a new `interactive: true` parameter. When set, spawns Claude without `-p` so the user can type follow-up prompts in the terminal and the agent responds. Default behavior (batch `-p` mode) is unchanged — still correct for orchestrated work
- **Worker silence watchdog**: spawned workers that emit no events for 10 minutes (configurable via `eventHorizon.watchdog.timeoutMinutes`, set 0 to disable) are auto-failed. A synthetic `task.fail` fires so the orchestrator gets a notification and the child process is killed, freeing up tokens. Only workers with a claimed / in-progress task are checked; interactive workers are always excluded so they can legitimately wait for user input
- **Open VSX publishing**: stable releases (`master`) now publish to the Open VSX Registry in addition to the VS Code Marketplace. A single publish reaches Cursor, VSCodium, Windsurf, Gitpod, Eclipse Theia, Coder / code-server, and every other VS Code fork. Driven by a new `OVSX_PAT` repo secret and `ovsx` devDependency; the CI step is `continue-on-error: true` so a missing/expired token never blocks the VS Code Marketplace publish. Pre-release branches (`release/*`) do **not** publish to Open VSX — they'd collide with the eventual stable `X.Y.Z` publish since both use the same version string. Test pre-releases by downloading the VSIX from the GitHub pre-release page and installing it manually
- **Per-editor install docs**: README gains Open VSX version + downloads badges and a new `## Install` section with per-editor instructions (VS Code, Cursor, VSCodium, Windsurf, Gitpod, Eclipse Theia, Coder). New `docs/PUBLISHING.md` runbook covers token generation, namespace claim, manual publish fallback, and verification. New `docs/MARKETPLACES.md` is the canonical editor → marketplace coverage matrix and explains why Visual Studio IDE is not a target. `CONTRIBUTING.md` cross-links the publishing runbook
- **Broader editor compatibility**: `engines.vscode` lowered from `^1.110.0` to `^1.100.0` so Cursor (currently tracking VS Code 1.105.x) and other forks on slightly older VS Code bases can install the extension. No 1.110-specific APIs were in use

### Improved
- **`eh:research` skill** now instructs researchers to call `eh_search_events` and `eh_read_shared` BEFORE re-exploring the codebase. Also saves non-trivial findings via `eh_write_shared` with `valid_until` for time-bound facts
- **`eh:debug` skill** has explicit guidance to use `eh_search_events` for error recurrence, tool-call history on suspect files, prior task failures, and recent file writers. Often surfaces the introducing change in seconds vs hours of git blame
- **`eh:optimize-context` skill** rewritten around the 4-tier loading model. Goal shifts from "shrink CLAUDE.md" to "tier the content so wake-up cost is small while full detail stays available on demand". Suggests moving dated content to shared knowledge with `valid_until` instead of deleting
- **`eh:create-plan` skill** reinforces `eh_claim_orchestrator` as CRITICAL mandatory step — added to both step 10 and Rules section
- **`eh:review` skill** expanded from 5-step to 4-phase process — completeness check, build verification pipeline, code review, cross-check. Blocker/suggestion/nit severity system
- **`eh:work-on-plan` skill** added mandatory `pnpm lint && pnpm build && pnpm test` verification step after completing all tasks
- **Reviewer role** requires full verification pipeline (lint + build + test must all pass) and completeness check (all requested tasks must be done) before approving work
- **`eh_get_team_status` MCP tool** includes `contextUsageRatio`, `contextTokensUsed`, and `contextWindowSize` per agent. Orchestrators can avoid assigning new tasks to agents near their context limit

### Fixed
- **`eh_stop_agent` now actually terminates the spawned process**: previously it only disposed the VS Code terminal, but the underlying `claude -p` / `opencode` / `cursor` process kept running and burned tokens. Spawned agents are now wired to a `vscode.Pseudoterminal` backed by a real `child_process.ChildProcess`, tracked by PID. Stop performs a graceful SIGTERM and escalates to SIGKILL if the process hasn't exited within 3 seconds. User-closing the terminal also kills the process
- **Spawned agents couldn't call EH MCP tools**: `--allowedTools` only listed built-in tools (Edit, Write, Read, etc.) but not MCP tools, so spawned workers got "permission denied" errors. Now includes `mcp__event-horizon__*` and `Skill` tool patterns
- **Spawned agents had wrong working directory**: when no `cwd` was passed to `eh_spawn_agent`, it fell back to `vscode.workspace.workspaceFolders[0]` which could be empty or wrong. Now falls back to the orchestrator's `cwd` from agent state before the workspace folder
- **Demo mode crash**: OperationsView was calling `setTimeout → setState` during render body, creating an infinite re-render loop. Moved elapsed-time calculation into a proper `useEffect`
- **first_contact / ground_control achievements fired on every reload**: race condition — the agents useEffect fired before `init-medals` restored the unlocked list. Added `medalsHydrated` gate; unlocks suppressed until state is restored
- **Default-view flash**: viewMode defaulted to 'universe' and only got overwritten when `init-settings` arrived, so users who configured 'operations' as default briefly saw universe first. Added `settingsHydrated` flag; both views hidden until user preference applied
- **Phantom planets/ships when switching from Operations → Universe**: agents that terminated while Universe was hidden got queued into the spiral-out animation; on return, dozens flew to the singularity at once. Now the spiral queue + ship container are drained when becoming hidden
- **"View Execution" always empty**: was filtering events by agentId, but the plan's `assigneeId` never matches the Claude session UUID in persisted events. Removed the agentId filter; widened time window by 5 min on each side
- **Costs tab stuck at 0% forever**: agents were included in `cacheHitByAgent` even with zero token data, causing the empty-state check to fail and show all-zero metrics. Now excludes agents with no token activity
- **Costs tab showing "No Cost Data Yet" forever for Claude Code sessions**: the transcript watcher (Claude Code's richer event source) bypassed the event bus and never reached TokenAnalyzer, while simultaneously stripping the per-turn `*Delta` fields from its events. Net result: the analyzer saw zero tokens regardless of how long you worked. Transcript events now feed TokenAnalyzer directly, deltas are preserved in the payload, and TokenAnalyzer accumulates per-turn deltas in addition to cumulative totals. Cache hit ratios, context layers, and duplicate-read detection now populate as soon as the first turn completes
- **`eh_get_shared_summary` MCP tool** respects temporal validity. Expired entries are excluded by default. New optional `include_expired` parameter to opt in
- **Knowledge tab font sizes** standardized to match LogsPanel/OverviewPanel conventions — md (12) for primary content, sm (11) for metadata and controls

## [1.3.1] — 2026-04-08

### Fixed
- **Kanban column alignment (final fix)**: replaced dual-flex layout with CSS Grid — headers and cards now share the exact same grid column tracks, so they cannot diverge when the sidebar opens/closes or the panel resizes
- **Knowledge tab missing copilot-instructions.md**: the "no headings" fallback for non-markdown files only triggered when no sections had been found globally, so once CLAUDE.md populated sections, all subsequent files without markdown headings (copilot-instructions.md, .cursorrules) were silently skipped. Now tracks per-file
- **Context optimizer fired per project in multi-root workspaces**: 8 projects produced 8 separate notifications. Now collects all large instruction files first and shows ONE summary notification per session
- **Orchestrator role not claimed after creating a plan**: `eh:create-plan` now explicitly calls `eh_claim_orchestrator` after loading the plan so the orchestrator role persists across MCP calls
- **Auth token rotated on every extension restart**: hooks and MCP configs became stale after every VS Code reload. Token is now persisted in globalState and only generated once on first install
- **Stale project-level MCP server entries**: project-level `.claude.json` files with old tokens caused "SDK auth failed" errors. Now cleaned up automatically — MCP server is registered globally only
- **Spawned agents couldn't use Edit/Write tools**: agents spawned with `-p` (print mode) lacked tool permissions. Now passes `--allowedTools Edit,Write,Read,Grep,Glob,Bash,NotebookEdit` to spawn and resume commands
- **Agent profiler showed "UNKNOWN" type and "$-1.00" cost**: agents interacting only via MCP weren't in the state manager. Now infers agent type from ID pattern and defaults costs to 0. Stale profiler data in globalState is migrated on restore
- **Orchestrator spawn failures ("Only the orchestrator can spawn agents")**: `isOrchestrator()` now auto-promotes the calling agent if no orchestrator is set on the plan. Diagnostic error messages show the ID mismatch
- **Costs tab showed 0% with no data**: cache efficiency section rendered even when no agents had sent token data. Now shows "No Cost Data Yet" empty state when there's nothing meaningful to display
- **MCP tool descriptions confused the orchestrator**: `eh_spawn_agent` agent_type was confused with role names, prompt was omitted. Descriptions now include explicit examples and warnings

### Improved
- **`eh:optimize-context` skill**: now offers to create CLAUDE.md and other instruction files if none exist in the workspace (explores project, generates concise context)
- **`eh:create-plan` skill**: explicitly claims orchestrator role after loading the plan
- **Cursor token tracking**: captures input/output tokens, cache read/creation, cost, and num_turns from stop, sessionEnd, afterAgentResponse, and subagentStop hooks
- **Knowledge auto-seed recursive scan**: discovers instruction files up to 4 levels deep in nested monorepo structures
- **Orchestrator role instructions**: clearer spawn examples with all required parameters, warns against using Skill tool directly

### Security
- **Vite 7.3.1 → 7.3.2**: fixes 3 CVEs — arbitrary file read via WebSocket, path traversal in optimized deps, server.fs.deny bypass

## [1.3.0] — 2026-04-07

### Added — Token Optimization & Quality Assurance
- **Acceptance criteria in plans**: tasks now support `**Accept**:` (criteria), `**Verify**:` (command), `<!-- complexity: low|medium|high -->`, and `<!-- model: haiku|sonnet|opus -->` metadata. Parsed automatically from plan markdown and stored in PlanTask
- **Kanban complexity badges**: colored dots on task cards — green (low), amber (medium), red (high) — plus model tier label, verification status icon (checkmark/X/dash), and collapsible acceptance criteria section
- **`eh_verify_task` MCP tool**: executes a task's verify command with 60s timeout, updates verificationStatus (passed/failed), returns exit code and truncated output. Auto-passes tasks without verify commands
- **`eh:verify-task` skill**: batch-verifies all completed tasks, handles pass/fail/flaky decisions, broadcasts summary to all agents
- **ModelTierManager**: tiered model selection that recommends the cheapest viable model per task complexity + role. Tracks first-attempt success rates, drops underperformers below threshold (default 30%), persists stats across sessions
- **Model escalation on retry**: `eh_retry_task` auto-escalates to the next model tier (haiku → sonnet → opus) on verification failure. Success/failure stats feed back into recommendations
- **Self-verification in `eh:work-on-plan`**: agents must check acceptance criteria and run verify commands before marking tasks done, with up to 2 self-fix attempts on failure
- **TokenAnalyzer**: processes agent events to produce cost insights — cache hit ratios, compaction frequency, duplicate file reads, cost anomalies, and actionable recommendations. Insights forwarded to webview every 30 seconds
- **`eh_get_cost_insights` MCP tool**: returns cache efficiency, compaction pressure, duplicate reads, anomalies, model efficiency stats, and text recommendations. Orchestrators can use this for cost-aware decisions
- **Cost Insights panel**: new "Costs" tab in Operations view with 6 sections — Recommendations, Cache Efficiency (per-agent bar charts), Context Pressure (compaction frequency), Duplicate Reads (expandable with "Add to Shared Knowledge" button), Cost Anomalies, and Model Efficiency (success rate + avg cost grid). Updates live every 30 seconds
- **Context Optimizer role**: 8th built-in role with `eh:optimize-context` skill. Analyzes instruction files (CLAUDE.md, .cursorrules, copilot-instructions.md), identifies redundancy, extracts path-scoped rules and on-demand skills, reports before/after token savings. Always creates backups
- **Context optimization trigger**: on activation and file save, scans instruction files and shows a notification when they exceed the configurable token threshold (default 3000 tokens). "Optimize" button launches the context optimizer in a terminal. New `eventHorizon.contextOptimizer.threshold` setting

### Improved
- **`eh:create-plan` skill**: now requires Accept, Verify, complexity, and model metadata per task. Includes acceptance criteria clarification step and scope heuristic (low <50 lines, medium 50-200, high 200+)
- **`eh:work-on-plan` skill**: agents must update BOTH the MCP state AND the plan markdown file when completing tasks. Added "ALWAYS UPDATE THE PLAN FILE" and "ALWAYS SELF-VERIFY" rules
- **Orchestrator role instructions**: updated with tiered model workflow — use recommended models, verify completed work, handle verification failures with auto-escalation

## [1.2.1] — 2026-04-06

### Fixed
- **Cursor connect button**: the "Install" button was disabled with a "Soon" label even though the full Cursor connector (hooks, MCP registration, agent definitions) was already implemented. Now shows "Install" like the other agents
- **Kanban "All Columns" setting not persisting**: `useSettingsPersistence` fired on initial render with the Zustand default (`false`), overwriting the saved VS Code config before `init-settings` could restore it. Added a first-render skip so the saved preference is respected
- **Orchestrator role not visible in Roles tab**: `eh_load_plan` and `eh_claim_orchestrator` set the plan's orchestrator ID but never called `roleManager.assignRole()`, so the role assignment didn't appear in the UI. Both now auto-assign the `orchestrator` role
- **Spawn command fails on Windows (PowerShell)**: prompts containing double quotes, negative numbers (`-93.7474`), or special characters broke because `shellEscape()` used bash conventions (`\"`) that PowerShell doesn't recognize. Replaced inline escaping with a temp-file approach — prompt is written to `os.tmpdir()` and read via `[System.IO.File]::ReadAllText()` (PowerShell) or `$(cat ...)` (bash). Temp file auto-deleted after command runs
- **Spawn command missing `--verbose` flag**: Claude CLI requires `--verbose` when combining `-p` with `--output-format stream-json`. Added to all Claude Code spawn and resume commands
- **Kanban role tags misaligned**: role labels were crammed inline with the task ID and title, overflowing and clipping outside the card. Moved to their own row below the title, styled as rounded pills with tinted background
- **Demo crash "Cannot read properties of null (reading 'remove')"**: PixiJS app cleanup accessed `app.canvas` without null-checking `app`, which could be null if initialization failed. Added optional chaining (`app?.canvas`, `app?.destroy()`)

### Improved
- **Knowledge auto-seed expanded**: added `copilot-instructions.md` and `.copilot-instructions.md` to the instruction file scan, alongside the existing `.github/copilot-instructions.md`

## [1.2.0] — 2026-04-05

### Added — Orchestration Engine
- **Orchestrator role**: 7th built-in role, auto-promoted when an agent loads a plan via `eh_load_plan`. Any agent type can be orchestrator
- **SpawnRegistry**: pluggable backend for spawning agents in VS Code terminals — ClaudeCodeSpawner, OpenCodeSpawner, CursorSpawner. Session resume via `--resume`, role injection, model selection
- **Scheduling strategies**: `<!-- strategy: round-robin|least-busy|capability-match|dependency-first -->` in plan metadata. `eh_auto_assign` dispatches tasks automatically
- **Cascade failure + retry**: failed tasks cascade-fail dependents (`onDependencyFailure: cascade|block|ignore`). `eh_retry_task` resets and un-cascades. `<!-- maxAutoRetries: 2 -->` for auto-retry
- **Task recommendations**: `eh_recommend_task` scores tasks by role match (40%), profiler (30%), load (20%), dependency priority (10%). Auto-select on empty `eh_claim_task`
- **Shared Knowledge Store**: workspace (persistent) + plan (contextual) scopes. Both humans and agents contribute. Auto-seeded from CLAUDE.md, .cursorrules, AGENTS.md. 4 MCP tools: `eh_write_shared`, `eh_read_shared`, `eh_get_shared_summary`, `eh_delete_shared`
- **Git worktree isolation**: per-agent workspaces via `git worktree`. Toggle in Settings + Operations status bar. `eh_create_worktree` / `eh_remove_worktree` MCP tools
- **Heartbeat system**: `eh_heartbeat` MCP tool, 30s check interval, alive/stale/lost status with planet pulse animation
- **Budget controls**: per-plan spending limits (`<!-- maxBudgetUsd: 5.00 -->`), per-agent breakdown, fuel gauge in CommandCenter, warning at 80%, `eh_get_budget` / `eh_request_budget_increase` MCP tools
- **Session persistence**: SessionStore saves per-agent per-task session IDs for `--resume` on re-spawn
- **Multi-plan orchestration**: multiple active plans with independent orchestrators, budgets, and task assignments

### Added — Agent Coverage
- **Full Cursor integration**: all 20 Cursor hook events mapped (sessionStart, sessionEnd, preToolUse, postToolUse, postToolUseFailure, subagentStart, subagentStop, preCompact, + shell/file/MCP/agent/tab hooks). MCP server registered in `~/.cursor/mcp.json`. Skills synced to `~/.cursor/skills/`. Custom subagent definition at `~/.cursor/agents/event-horizon-worker.md`. One-click setup, auto-update on activation
- **Copilot expanded to 13 hooks**: added PostToolUseFailure, PermissionRequest, Notification, TeammateIdle, TaskCompleted. Richer telemetry: modelName, transcriptPath, mcpServers, duration, numTurns, stopReason
- **Claude Code expanded to 26 hooks**: added PermissionDenied, StopFailure, CwdChanged, FileChanged, TaskCreated, PostCompact, Elicitation/ElicitationResult with enriched payloads
- **Skill sync from bundled definitions**: works for all agent types without requiring Claude Code installed

### Added — Observability
- **Structured trace spans**: TraceStore with 1000-span buffer, start/end pairing, agent/type filters. `eh_get_traces` MCP tool
- **Activity tab**: merged Logs + Timeline + Traces into one tab with sub-toggle (Timeline / Traces / Logs). Traces waterfall with compact/proportional modes
- **MCP server stations**: hexagonal entities orbiting planets, green/red by connection status, pulse on tool calls, docking tubes to parent planet
- **Context compaction visualization**: planet shrink→re-inflate animation on PostCompact, orange timeline markers
- **Dependency DAG**: integrated into Plan tab as Kanban/Dependencies toggle. Topological sort layout, critical path highlighting, cycle detection warnings

### Added — Universe Visual Polish
- **Orchestrator star**: golden glow + emission rays on orchestrator planets
- **Spawn beams**: colored beams from orchestrator to workers on `eh_spawn_agent`
- **Synthesis beams**: all workers beam back to orchestrator on plan completion
- **Dependency tethers**: lines between debris with blockedBy relationships, critical path gold glow, cascade failure zigzag chains, completed chain fade-out
- **Knowledge constellations**: lines between knowledge-sharing planets (workspace=dim dotted, plan=bright solid, user=gold, agent=type-colored)
- **Budget fuel gauge**: green→yellow→red progress bar with flash at 80%+
- **Spawn animation**: nebula condensation → planet formation over ~2s
- **Heartbeat pulse**: green ring (alive), amber (stale), grey (lost)

### Added — UI & UX
- **Knowledge Panel**: Operations Dashboard tab with workspace + plan sections, add/edit/delete, search/filter, real-time updates
- **"Tell All" button**: broadcasts workspace knowledge to all agents (Universe + Operations views)
- **Retry badges**: orange "RETRY xN" on Kanban cards + debris red/gold pulse
- **Recommendation badges**: "REC: [agent-type]" teal badge on pending tasks
- **Roles panel improvements**: orchestrator pinned top-left, agent role summary section, sticky header
- **Skills panel sticky header**: search + agent filter rows fixed on scroll
- **Settings modal sticky header**: SETTINGS + X always visible
- **Worktree isolation toggle**: in Settings modal + Operations status bar
- **Status bar click-to-terminal**: QuickPick when agents need interaction
- **Spawn UI**: Quick Launch + With Prompt modes in SpawnModal
- **Enhanced demo**: showcases all features — roles, knowledge, beams, traces, budget, heartbeat, orchestrator, MCP stations, spawn animation

### Improved
- **Operations tabs consolidated**: 9 → 7 tabs (Overview, Activity, Files, Skills, Plan, Roles, Knowledge)
- **Plan tab**: Kanban + Dependencies toggle (was separate tabs)
- **39 total MCP tools** (was 19 in v1.1.0)
- **Port retry on conflict**: tries ports 28765–28770, auto-updates hooks on fallback
- **Traces uses sidebar agent selection** instead of redundant dropdown
- **Knowledge auto-seed**: scans all workspace folders + subdirectories for CLAUDE.md, .cursorrules, AGENTS.md, .github/copilot-instructions.md

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
