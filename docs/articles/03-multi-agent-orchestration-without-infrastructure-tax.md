---
title: Multi-agent orchestration without the infrastructure tax
published: false
description: Most multi-agent tools ship with Docker, Postgres, and a dashboard. None of that is actually required. Here's the design that replaces each piece with one local primitive.
tags: ai, architecture, vscode, opensource
canonical_url: https://github.com/HeytalePazguato/event-horizon
---

Every popular multi-agent coordination tool I looked at shipped with the same stack:

- Docker to run the services
- Postgres for tasks and state
- A web dashboard for visibility
- Some kind of account or auth layer
- Usually a worker queue (Redis, RabbitMQ, or similar)

I'll call this the **infrastructure tax**. It's the cost of buying into multi-agent orchestration before you can coordinate a single agent. For a solo developer wanting three Claude instances to stop overwriting each other, the tax is larger than the problem.

I think we're defaulting to this pattern because we imported it from SaaS team software. Multi-player tools need multi-player infrastructure. But multi-*agent* coordination on one machine is a fundamentally different problem, and almost every primitive can be swapped for something local. This post walks through the swap, piece by piece, from the design of [Event Horizon](https://github.com/HeytalePazguato/event-horizon) — a VS Code extension that orchestrates 3–5 AI coding agents with zero server infrastructure.

## The primitives, and their local replacements

### Task state → a markdown file

The default instinct is "tasks need to be queryable, relational, and atomic, so they belong in a database."

The local replacement is a markdown file with a structured shape. Plans look like:

```markdown
- [ ] 1.1 Session rotation [role: implementer]
  - **Files**: `src/auth/session.ts` (create)
  - **Accept**: returns new token, invalidates old
  - **Verify**: `pnpm test src/auth/session.test.ts`
```

Atomic claims happen via an MCP tool call (`eh_claim_task`) that flips `[ ]` to `[-]` with a content-hash guard for last-write-wins semantics. No schema migrations. No query language. Agents read the file natively. Humans read the file natively. Git diffs it. PR reviews it.

You give up structured queries. You buy back portability, diffability, and zero deployment cost.

### Collision prevention → an HTTP call

The default instinct is "distributed locks need a coordination service — etcd, Zookeeper, Redis."

The local replacement is a local HTTP server on `127.0.0.1:28765` with an in-memory `Map<filePath, Lock>`. Agents acquire locks before writing. The call returns in <1ms. Locks expire after 5 minutes so crashed agents don't block forever. If you need full isolation, the extension can alternately spawn each agent in its own git worktree and merge on completion.

```ts
// The core of it
function acquireLock(agentId: string, filePath: string) {
  const existing = locks.get(filePath);
  if (existing && existing.agentId !== agentId && !isExpired(existing)) {
    return { ok: false, heldBy: existing.agentId };
  }
  locks.set(filePath, { agentId, acquiredAt: Date.now() });
  return { ok: true };
}
```

You give up cross-machine locking. You don't need cross-machine locking on a laptop.

### Agent-to-agent messages → an in-memory queue

The default instinct is "message passing needs RabbitMQ, NATS, or at minimum Redis pub/sub."

The local replacement is a typed in-memory message queue. Producer agents call `eh_send_message(targetId, body)`. Consumer agents call `eh_get_messages()` between steps. Both are MCP tool calls that hit the same local HTTP server. Delivery is delivered-once because producer and consumer are on the same machine.

No broker process. No network. No serialization layer beyond JSON.

### Shared knowledge → one SQLite file

The default instinct is "shared state needs Redis or Postgres depending on durability."

The local replacement is a single SQLite database (running via sql.js as WASM — no native build, no binary dependency) in the extension's global storage directory. The knowledge API exposes `eh_write_shared(key, value, valid_until)` and `eh_read_shared(key)`. Entries carry optional expiration timestamps so stale facts purge themselves.

The whole "knowledge base" is one file. Back it up with `cp`. Inspect it with `sqlite3`. Version it with `git` if you want.

### Agent spawning → `child_process.spawn`

The default instinct is "worker agents need a scheduler — Nomad, Kubernetes, or at least a supervisor daemon."

The local replacement is `vscode.window.createTerminal({ shellPath, shellArgs })`. The orchestrator agent calls `eh_spawn_agent(agent_type, prompt, cwd)`. A VS Code terminal opens running `claude -p ...` or `opencode ...` or `cursor ...`. The terminal is visible. You can see what the agent is doing. You can kill it with Ctrl+C. The child process is tracked by PID so the extension can SIGTERM it cleanly on shutdown.

Visible terminals were a deliberate design choice. Hidden worker processes are cleaner but psychologically worse: users don't trust what they can't see. Every Event Horizon agent is a terminal you can stare at.

### Visibility → a webview

The default instinct is "you need a real-time dashboard, so set up a WebSocket server and a React SPA."

The local replacement is a VS Code webview (which is just an iframe) that subscribes to events from the extension host via `webview.postMessage`. React + PixiJS renders every agent as a planet, every data transfer as a ship, every file collision as a lightning arc. Zero external hosting. Zero auth layer. Zero telemetry.

The visualization was supposed to be the decorative part of the product. It turned out to be the most useful debugging tool I've ever built. The first time two agents got into a lock-contention loop, I saw it in the universe view before I saw it in any log — lightning arcs firing every two seconds between two planets.

### Persistence → SQLite + JSON

The default instinct is "durable event logs need Kafka, or at minimum Postgres with WAL."

The local replacement is SQLite with FTS5 for full-text search over event payloads. 30 days of agent history lives in one file. Want longer retention? Change a setting. Want to export? `eh_search_events` returns JSON, or there's a "Export Data..." command that produces CSV or JSON dumps.

## The shape that emerges

When you replace each primitive with a local equivalent, the whole orchestration tool collapses into:

- One VS Code extension (TypeScript)
- One local HTTP server (port 28765)
- One MCP server exposing 30+ tools to agents
- One SQLite file
- One webview for visualization

You install it by installing a VS Code extension. Thirty seconds, including Claude Code hook setup. No Docker. No Postgres. No accounts. No telemetry.

## When infrastructure actually matters

I want to be honest about where this design stops working:

- **Multi-machine teams.** If five humans want to share one agent team across five laptops, you need a server. There's no way around it.
- **Very large agent counts.** 3–5 agents on one plan is the sweet spot. At 20+ agents, file-lock contention starts dominating and you need something smarter than an in-memory map.
- **Stakeholders who need a web dashboard.** If the people who care about progress don't live in VS Code, you need to surface state somewhere else — a Slack bot, an HTML report, a dashboard. Event Horizon doesn't do that.
- **Audit / compliance requirements.** A single local SQLite file on a dev laptop is not an audit log. If you need one, you need a centralized store and an immutability guarantee that local files can't provide.

Every one of these is a valid reason to pay the infrastructure tax. Most solo-developer-with-three-agents cases aren't.

## The lesson I keep coming back to

Infrastructure isn't free. Every server adds a failure mode, a deployment step, an auth layer, a backup strategy, a cost line. You pay those costs as operational overhead in perpetuity.

When you're designing for small scope — one developer, one machine, a handful of agents — the right instinct is to ask: **does this primitive need to exist as a service, or can it exist as a function call?** Most of them, it turns out, can.

This isn't a general-purpose argument. Infrastructure is worth it when you need what it provides. But for the specific case of a single developer who wants their AI agents to stop destroying each other's work, the zero-infrastructure design is 10× less code, 0× deployment complexity, and subjectively more fun to use.

---

Event Horizon ships this design as a VS Code / Cursor / VSCodium / Windsurf extension. [Source on GitHub](https://github.com/HeytalePazguato/event-horizon). Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=HeytalePazguato.event-horizon-vscode) or [Open VSX](https://open-vsx.org/extension/HeytalePazguato/event-horizon-vscode). Feedback welcome.
