# Release Notes

This page summarizes the highlights of each major version. For the complete, itemized history — every fix, every dependency bump — see the [full CHANGELOG on GitHub](https://github.com/HeytalePazguato/event-horizon/blob/master/apps/vscode/CHANGELOG.md).

The current release is **3.2.0**.

---

## 3.x — The knowledge graph era

The 3.0 line added a queryable map of your codebase and the tooling to use it.

**Highlights:**

- **[Project knowledge graph](knowledge-graph.md)** — a local, queryable map of code structure, docs, agent activity, and shared knowledge. Built only when you ask (`/eh:optimize-context` or `eh_build_graph`), never in the background.
- **Multi-language extraction** — tree-sitter extractors for TypeScript, JavaScript, TSX, PHP, Python, and C#, plus markdown headings and code-comment rationale (`// WHY:`, TODO, FIXME).
- **Six graph MCP tools** — `eh_build_graph`, `eh_scan_status`, `eh_query_graph`, `eh_curate_context`, `eh_extract_concepts`, `eh_rescan_files`.
- **Project Graph canvas** in the Knowledge tab — a visual, navigable view of the graph with neighbour highlighting and search.
- **Per-workspace storage** — the graph lives at `<workspace>/.eh/graph.db`, so it travels with the project that owns it.
- **Async graph builds** (3.0.4) — `eh_build_graph` returns a scan ID immediately; skills poll `eh_scan_status` for progress instead of blocking.
- **[Cost-aware orchestration](budget.md)** (3.1.0) — a shared file-read cache across agents, plan budgets that can halt spawning, and task routing that accounts for both complexity and cost.
- **`eh:architect` skill** (3.1.0) — a pre-planning discovery interview that produces an architecture brief, then chains into `eh:create-plan`.

---

## 3.2 — Agents that can find and reach each other

Messaging worked, but not at scale. One real peer message could sit buried under hundreds of automatic notices, and the only reliable address was an opaque session ID that died with the session.

**Highlights:**

- **[Readable, permanent addresses](mcp-tools.md#addressing-an-agent)** — every agent is assigned an alias like `event-horizon-claude-143022` on arrival. Assigned once, persisted, never rotated; an idle agent keeps it for as long as it lives.
- **[Claimable handles](mcp-tools.md#addressing-an-agent)** — `eh_claim_handle` takes a short name that survives even the agent restarting. Agents claiming a plan task get one automatically, like `reviewer-2.1`.
- **Cross-project messaging** — addresses resolve across workspaces, so an agent in one repo can reach one in another by name.
- **[Filtered inboxes](mcp-tools.md#two-kinds-of-message)** — `eh_get_messages` gained `kind`, `from_agent_id`, `exclude_from` and `limit`. Peer messages come first, only what is returned is marked read, and whatever is held back is reported rather than silently dropped.
- **Quieter by default** — plan notices became edge-triggered, routine tool failures stopped escalating to orchestrators, and repeated failures are suppressed. One reported inbox held 485 messages, 484 of them noise.
- **[Prompt-submit inbox notice](mcp-tools.md#getting-told-about-new-mail)** — a dormant session is told it has mail the next time you type, instead of finding out only when it happens to poll.
- **Accurate OpenCode cost** — session spend is backfilled from the OpenCode server on first sight, rather than counted only from when Event Horizon attached.

---

## 2.x — Persistence, reliability, and the operations dashboard

The 2.0 line made Event Horizon durable and added the full-screen dashboard.

**Highlights:**

- **[SQLite persistence](privacy.md#what-gets-stored-and-where)** — events, knowledge, achievements, and agent profiles survive VS Code reloads. Auto-pruned after a configurable retention window.
- **Full-text event search** — FTS5-indexed search over all event payloads.
- **[Operations dashboard](operations-dashboard.md)** — a full-screen, tabbed view alongside the cosmic Universe view.
- **[Context fuel gauge](the-universe.md#context-fuel-gauge)** — a 270° arc on each planet showing context-window usage, shifting cyan → amber → red.
- **[Workspace instruction auto-discovery](knowledge-graph.md#auto-discovered-knowledge)** — `CLAUDE.md`, `.cursorrules`, `copilot-instructions.md`, and `.claude/rules/**` are scanned and surfaced in the Knowledge tab.
- **Reliability overhaul** — stale-agent eviction, synthetic terminate events on process exit, Windows spawn fixes, and OpenCode/Cursor spawn correctness.
- **WebSocket endpoint** — optional `/ws` for external tools to subscribe to the event stream.

---

## 1.x — Multi-agent coordination

The 1.0 line turned a visualizer into a coordination layer.

**Highlights:**

- **Shared plans** with atomic task claiming and dependency resolution.
- **File locking** — hard-block conflicting writes between agents.
- **Inter-agent messaging** and **roles** with performance profiling.
- **Budget controls** — per-plan spending limits with warning and hard-stop thresholds.
- **The MCP server** and the first bundled skills.

---

## 0.x — The visualization

The earliest releases established the cosmic metaphor: agents as planets, tasks as orbital debris, data transfers as ships, the orchestrator as the central black hole. As the project's [versioning convention](https://github.com/HeytalePazguato/event-horizon) goes, every project's first public release is `v0.0.1` regardless of how mature the code already is.

---

!!! tip "Staying current"
    Event Horizon re-checks and updates agent hooks on every activation, so keeping the extension updated keeps your agent connections current automatically. VS Code updates extensions in the background by default.
