# Shared Knowledge & Project Graph

Event Horizon has two related knowledge systems:

- **Shared knowledge** — a live context base that humans and agents both write to.
- **The project graph** — a queryable map of your codebase's structure, built on demand.

Both live in the [Operations Dashboard → Knowledge tab](operations-dashboard.md#knowledge).

---

## Shared knowledge

A shared knowledge base where humans and agents contribute context in real time. Agents write to it with [`eh_write_shared`](mcp-tools.md#shared-knowledge) and read it with `eh_read_shared`; you can type entries directly in the Knowledge tab.

### Scope

| Scope | Lifetime |
|-------|----------|
| **Workspace knowledge** | Persists across sessions — it's about the project |
| **Plan knowledge** | Lives with the plan — archived or deleted alongside it |

### Source

Every entry is tagged with where it came from:

- **`user`** — typed into the UI by you
- **`agent`** — written by an agent via `eh_write_shared`
- **`auto`** — auto-discovered from an instruction file (see below)

Re-scans never overwrite `user`- or `agent`-authored entries.

### Auto-discovered knowledge

With [`eventHorizon.knowledge.autoDiscover`](configuration.md#eventhorizonknowledgeautodiscover) on (the default), Event Horizon scans your workspace for instruction files and surfaces them in the Knowledge tab:

- `CLAUDE.md`, `AGENTS.md`
- `.cursorrules`
- `copilot-instructions.md`, `.github/copilot-instructions.md`
- `.claude/rules/**/*.md`

Each file becomes its own entry, tagged `source: auto`, assigned a **tier** (root instructions → L1, rules files → L2). A file watcher keeps them in sync — create, edit, or delete an instruction file and the entry updates within about a second.

---

## The project graph

The project graph is a **queryable map of your codebase** — functions, classes, imports, calls, doc sections, and the rationale comments tying them together. Agents query it for high-signal context instead of re-reading the whole project on every task.

!!! info "Built only when you ask"
    The graph is **never** built in the background. Opening a folder does not create it. It is built only when you run [`/eh:optimize-context`](skills.md#ehoptimize-context) or an agent calls `eh_build_graph`. The scan runs **locally** — no model calls, no telemetry.

### What's in it

| Extracted from | What lands in the graph |
|----------------|-------------------------|
| **Code** (TS, JS, TSX, PHP, Python, C#) | Functions, classes, methods, interfaces, imports, calls, extends/implements — via tree-sitter |
| **Markdown** | Headings, links to source files, backticked identifier references |
| **Code comments** | `// WHY:`, TODO, FIXME markers and JSDoc/TSDoc tags, attached to the function or class they describe |
| **Agent activity** | `task.complete` events become activity nodes linked to the files they touched |
| **Shared knowledge** | Knowledge entries become graph nodes with references to the code they mention |

Inferred edges carry a **provenance tag** — `EXTRACTED`, `INFERRED`, or `AMBIGUOUS` — and a confidence score, so you can tell hard facts from guesses.

### Where it lives

The graph is stored **per workspace** at `<workspace>/.eh/graph.db`. The graph file's location *is* the project — if no folder is open, the graph tools tell you to open one rather than guessing.

Add `.eh/` to your `.gitignore`. (Event Horizon's own repo already does — never commit the graph DB.)

### Building it

Run [`/eh:optimize-context`](skills.md#ehoptimize-context) in any connected agent. The skill:

1. Builds or rebuilds the project graph (always from scratch — no stale rows for deleted files).
2. Tiers your instruction files into L0/L1/L2/L3.
3. If you pass a task description, hands the agent a curated, token-budgeted slice of the graph for that task.

As of 3.0.4, the build is **async** — `eh_build_graph` returns a scan ID immediately and the skill polls `eh_scan_status` for progress, so a large scan doesn't block the agent.

### Tuning the scan

| Setting | Controls |
|---------|----------|
| [`projectGraph.enabled`](configuration.md#eventhorizonprojectgraphenabled) | Master switch |
| [`projectGraph.maxFiles`](configuration.md#eventhorizonprojectgraphmaxfiles) | File-count cap; bigger workspaces need manual confirmation |
| [`projectGraph.maxFileSizeKb`](configuration.md#eventhorizonprojectgraphmaxfilesizekb) | Skip files larger than this |
| [`projectGraph.includeMarkdown`](configuration.md#eventhorizonprojectgraphincludemarkdown) | Extract concepts from markdown |
| [`projectGraph.allowAgentLLMExtraction`](configuration.md#eventhorizonprojectgraphallowagentllmextraction) | Let agents add `INFERRED` nodes via `eh_extract_concepts` |
| [`projectGraph.canvasMaxNodes`](configuration.md#eventhorizonprojectgraphcanvasmaxnodes) | Max nodes rendered on the canvas at once |

Vendor and generated files (`vendor/`, `__pycache__/`, `bin/`, `obj/`, `*.min.js`, `*.generated.cs`, …) are skipped automatically.

---

## The Project Graph canvas

The Knowledge tab renders the graph as a **visual canvas** — rounded-square nodes colour-coded by type, edges connecting them, on a dark blueprint grid.

!!! note "📷 Screenshot needed"
    *The Project Graph canvas with a node selected, its 1/2/3-hop neighbours highlighted by distance, and the detail drawer open.*

- **Click a node** → a detail drawer opens with callers, callees, references, rationale, recent agent activity, and a **Reveal in editor** button.
- **Click a node** → its 1-, 2-, and 3-hop neighbours are highlighted, coloured by distance.
- **Search** → unrelated nodes dim so you can navigate huge graphs at a glance.
- **Filter pills** → narrow by node type or tag.
- **Pan** with mouse drag, **zoom** with the wheel.

The canvas uses a Barnes-Hut layout with viewport culling, so thousands of nodes stay responsive. If pan/zoom feels sluggish on an enormous monorepo, lower `canvasMaxNodes`.

---

## Querying the graph

Agents query the graph with the [graph MCP tools](mcp-tools.md#project-graph):

| Tool | Purpose |
|------|---------|
| `eh_query_graph` | Search, find callers/callees/neighbours, shortest path, explain, recent activity |
| `eh_curate_context` | Get a task-aware, token-budgeted slice of the graph |
| `eh_extract_concepts` | Agent-driven LLM extraction of inferred concepts (opt-in) |
| `eh_rescan_files` | Re-extract specific files only |
| `eh_build_graph` / `eh_scan_status` | Start a scan / poll its progress |

The `eh:research` and `eh:debug` skills query the graph before falling back to grep — so a built graph makes those workflows sharper, and they degrade gracefully when no graph exists.
