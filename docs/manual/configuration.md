# Configuration Reference

Every Event Horizon setting, grouped by area. Settings live under the **Event Horizon** section of VS Code Settings (++ctrl+comma++ → search "Event Horizon"), or you can edit `settings.json` directly.

!!! tip "Workspace vs. user settings"
    Most settings work at either the user level (all projects) or the workspace level (one project). Port and file-locking changes need an extension restart or a hook reinstall — noted per setting.

---

## Connection

### eventHorizon.port

**Type:** number &middot; **Default:** `28765` &middot; **Range:** 1024–65535

Port for the local event server that receives agent hooks. The server binds to `127.0.0.1` only.

**Requires an extension restart.** If you change this, you must also **reconnect every agent** so their hooks point at the new port.

Change it if `28765` is already in use on your machine — see [Troubleshooting](troubleshooting.md#port-already-in-use).

---

## File management & isolation

### eventHorizon.fileLockingEnabled

**Type:** boolean &middot; **Default:** `false`

Hard-block conflicting writes — an agent must acquire a lock before writing a file, and a second agent's write is stopped while the lock is held. **Requires reinstalling hooks** (reconnect your agents after toggling). See [File Locking](file-locking.md#file-locking).

### eventHorizon.worktreeIsolation

**Type:** boolean &middot; **Default:** `false`

Give each spawned agent its own git worktree — a separate working copy of the repo on its own branch. Eliminates file conflicts entirely. Works with any git host. Disable if you don't want the extra branches. See [File Locking → Worktree isolation](file-locking.md#worktree-isolation).

---

## Appearance

### eventHorizon.animationSpeed

**Type:** number &middot; **Default:** `1` &middot; **Range:** 0.25–3.0

Animation speed multiplier for the whole Universe view. `0.25` is slow-mo, `3.0` is fast-forward.

### eventHorizon.fontSize

**Type:** string &middot; **Default:** `default` &middot; **Options:** `small` (87%), `default`, `large` (115%)

UI font size for the Event Horizon panel — affects all text in both views.

### eventHorizon.defaultView

**Type:** string &middot; **Default:** `universe` &middot; **Options:** `universe`, `operations`

Which view opens when you open Event Horizon — the cosmic [Universe](the-universe.md) or the [Operations dashboard](operations-dashboard.md).

### eventHorizon.planShowAllColumns

**Type:** boolean &middot; **Default:** `false`

Show all Kanban columns in the [Plan tab](operations-dashboard.md#plans-kanban), including empty ones.

### eventHorizon.achievementsEnabled

**Type:** boolean &middot; **Default:** `true`

Enable [achievement](achievements.md) medals and toast notifications.

---

## Agent colors

Per-agent-type planet colour. Each takes a hex colour string.

| Setting | Default | Agent type |
|---------|---------|-----------|
| `eventHorizon.agentColors.claudeCode` | `#88aaff` | Claude Code |
| `eventHorizon.agentColors.copilot` | `#cc88ff` | GitHub Copilot |
| `eventHorizon.agentColors.opencode` | `#88ffaa` | OpenCode |
| `eventHorizon.agentColors.cursor` | `#44ddcc` | Cursor |
| `eventHorizon.agentColors.unknown` | `#aaccff` | Unrecognized agents |

---

## Agent sizes

Per-agent-type planet size multiplier. **Range:** 0.4–2.0.

| Setting | Default | Agent type |
|---------|---------|-----------|
| `eventHorizon.agentSizes.claudeCode` | `1.35` | Claude Code |
| `eventHorizon.agentSizes.copilot` | `0.72` | GitHub Copilot |
| `eventHorizon.agentSizes.opencode` | `1.0` | OpenCode |
| `eventHorizon.agentSizes.cursor` | `0.92` | Cursor |
| `eventHorizon.agentSizes.unknown` | `1.12` | Unrecognized agents |

---

## Orchestration

### eventHorizon.spawnTerminalFocus

**Type:** string &middot; **Default:** `focus-on-interaction` &middot; **Options:** `background`, `focus`, `focus-on-interaction`

When an orchestrator [spawns a worker](orchestration.md#spawning-workers), how to handle the new terminal:

- `background` — leave it in the background
- `focus` — focus it immediately
- `focus-on-interaction` — focus it only when the worker needs your input

### eventHorizon.roles.custom

**Type:** array &middot; **Default:** `[]`

Define [custom roles](orchestration.md#custom-roles) beyond the six built-in ones. Each entry needs an `id`, `name`, and `description`, and may also carry a `skills` array and a markdown `instructions` block sent to the agent when it takes the role.

### eventHorizon.roles.assignments

**Type:** object &middot; **Default:** `{}`

Map role IDs to default agent types, e.g. `{ "researcher": "claude-code", "reviewer": "copilot" }`.

### eventHorizon.watchdog.timeoutMinutes

**Type:** number &middot; **Default:** `10` &middot; **Range:** 0–120

Auto-fail spawned workers that haven't emitted any event for this many minutes — likely stuck on a permission prompt or hung. The orchestrator is notified via the message queue. Set to `0` to disable. Interactive-mode workers are always excluded.

---

## Budget & context

### eventHorizon.budgetWarningThreshold

**Type:** number &middot; **Default:** `0.8` &middot; **Range:** 0.1–1.0

Show a [budget](budget.md) warning when plan spending reaches this fraction of the budget. `0.8` = 80%.

### eventHorizon.contextOptimizer.threshold

**Type:** number &middot; **Default:** `3000` &middot; **Range:** 500–20000

Token threshold for context-optimization suggestions. A notification appears when your instruction files (`CLAUDE.md`, `.cursorrules`, etc.) exceed this estimated token count.

### eventHorizon.contextGauge.enabled

**Type:** boolean &middot; **Default:** `true`

Show the [context fuel gauge](the-universe.md#context-fuel-gauge) — a 270° arc on each planet — shifting cyan → amber → red as the agent's context window fills.

### eventHorizon.contextGauge.windowSize

**Type:** number &middot; **Default:** `200000` &middot; **Range:** 1000–2000000

Estimated context window size in tokens, used to compute the fuel gauge. Default is 200,000 (Claude Sonnet/Opus).

---

## Knowledge

### eventHorizon.knowledge.autoDiscover

**Type:** boolean &middot; **Default:** `true`

Scan workspace instruction files (`CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `copilot-instructions.md`, `.claude/rules/*.md`) on activation and on change, and surface them in the [Knowledge tab](knowledge-graph.md#auto-discovered-knowledge) tagged `source: auto`. Auto entries get a tier (L1 for root instructions, L2 for rules) and never overwrite user- or agent-authored entries.

---

## Persistence

### eventHorizon.persistence.enabled

**Type:** boolean &middot; **Default:** `true`

Enable SQLite persistence for events and knowledge. Disable to run ephemerally — events are lost on reload. See [Privacy & Data](privacy.md#what-gets-stored-and-where).

### eventHorizon.persistence.retentionDays

**Type:** number &middot; **Default:** `30` &middot; **Range:** 1–365

How many days to retain persisted events before auto-pruning on startup.

---

## WebSocket

### eventHorizon.websocket.enabled

**Type:** boolean &middot; **Default:** `true`

Enable the WebSocket endpoint at `/ws` for bidirectional agent communication. External tools can connect to `ws://127.0.0.1:<port>/ws` and receive debounced event broadcasts. Loopback only.

---

## Auto-detection

### eventHorizon.autoDetect.enabled

**Type:** boolean &middot; **Default:** `true`

On activation, scan `PATH` for installed agent CLIs (`claude`, `opencode`, `cursor`) and offer one-click hook setup for any found without configured hooks.

---

## Project graph

See [Shared Knowledge & Project Graph](knowledge-graph.md#tuning-the-scan) for context.

### eventHorizon.projectGraph.enabled

**Type:** boolean &middot; **Default:** `true`

Master switch for the workspace [project graph](knowledge-graph.md#the-project-graph). The graph is built only on user invocation — nothing runs in the background.

### eventHorizon.projectGraph.maxFiles

**Type:** number &middot; **Default:** `5000` &middot; **Range:** 100–100000

Cap on file count for a workspace scan. Workspaces over this size require manual confirmation.

### eventHorizon.projectGraph.includeMarkdown

**Type:** boolean &middot; **Default:** `true`

Extract concepts (headings, links, identifier references) from markdown files.

### eventHorizon.projectGraph.allowAgentLLMExtraction

**Type:** boolean &middot; **Default:** `true`

Allow agents to add `INFERRED` nodes via the `eh_extract_concepts` MCP tool. Event Horizon itself never makes outbound model calls — but the agent does, on its own tokens. Disable to keep the graph strictly local-only.

### eventHorizon.projectGraph.maxFileSizeKb

**Type:** number &middot; **Default:** `256` &middot; **Range:** 16–8192

Skip files larger than this (KB) during scans. 256 KB comfortably fits hand-written source while excluding inline-bundled vendor scripts.

### eventHorizon.projectGraph.canvasMaxNodes

**Type:** number &middot; **Default:** `5000` &middot; **Range:** 200–50000

Max nodes rendered on the [Project Graph canvas](knowledge-graph.md#the-project-graph-canvas) at once. The canvas uses a Barnes-Hut layout with viewport culling, so thousands stay responsive — but 50k+ node monorepos can saturate the renderer. Lower this if pan/zoom feels sluggish; raise it to see the full graph.
