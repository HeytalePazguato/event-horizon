---
title: I built multi-agent orchestration into a VS Code extension because I didn't want to run Postgres to coordinate three Claude instances
published: false
description: Three AI coding agents, same repo, two of them overwriting the third's work. The fix didn't need a server — just a local HTTP port and a rethink of what "orchestration" actually means.
tags: ai, vscode, productivity, opensource
cover_image: https://raw.githubusercontent.com/HeytalePazguato/event-horizon/master/assets/demo2.gif
canonical_url: https://github.com/HeytalePazguato/event-horizon
---

## The question that started it

A few months ago I asked Claude a genuinely idle question: if it could pick a visual for itself — for how it works, how it thinks, how it collaborates with other AI agents — what would it choose?

Its answer:

> *Each agent is a planet — a massive entity that consumes energy, emits output, and exerts gravitational influence. Tasks orbit as moons. Data flows as ships. At the center, a black hole where completed work collapses. One agent is a lonely planet. Five agents become a solar system.*

So I built it. A VS Code extension that rendered every AI coding agent as a planet, data transfers as ships, completed work spiraling into a black hole. It was pretty. It was cosmetic. It did not save me from the thing that happened next.

## The moment it broke

Three Claude Code sessions, same repo. One was building the REST API, one was writing tests, one was updating docs. I was pleased with myself — look at me, parallelizing AI.

Twenty minutes in, the build broke. I opened `server.ts` and saw that session #2 had overwritten session #1's middleware. Neither of them knew. The tests had been written against the old shape; the docs were describing something that no longer existed. I untangled the mess, lost the work, and started over.

Then I did it again two days later with a different combination of agents.

That's when I went looking for a multi-agent coordination tool. What I found was:

- Tools that required Docker + Postgres + a dashboard account
- Tools tied to one agent vendor's cloud
- Handwritten scripts that used git worktrees and prayer

None of them fit the real shape of the problem, which was small: I had three agents running on my own machine, they needed to not step on each other, and I needed to see what was happening. That's it.

So I built **Event Horizon** — a VS Code extension that does multi-agent orchestration without any of the infrastructure tax.

## What "orchestration" actually requires

When I sat down to list the primitives, it was shorter than I expected:

1. **A shared source of truth** — so agents know what's planned and what's done.
2. **A way to prevent collisions** — so two agents don't write the same file at the same time.
3. **A way to communicate** — so an agent can tell the next one "I finished, here's what you need to know."
4. **Visibility** — so the human can see what the team is doing.
5. **A way to spawn new agents** — so one agent can delegate.

A database would give me (1). A message queue would give me (3). A scheduler would give me (5). None of that was actually necessary. I'll show you what I did instead.

### (1) Shared source of truth — a markdown file

Event Horizon's plans are just markdown. Here's a real one:

```markdown
# Auth overhaul

## File Map
| File | Action | Responsibility |
|------|--------|----------------|
| `src/auth/session.ts` | Create | Token rotation logic |
| `src/auth/middleware.ts` | Modify | Wire in session.ts |
| `tests/auth/session.test.ts` | Create | Unit tests |

## Phase A — implementation

- [ ] 1.1 Session rotation [role: implementer]
  - **Files**: `src/auth/session.ts` (create)
  - **Do**: implement `rotateSession(userId, oldToken)`
  - **Accept**: returns new token, invalidates old, writes audit log
  - **Verify**: `pnpm test src/auth/session.test.ts`
  <!-- complexity: medium -->
  <!-- model: sonnet -->

- [ ] 1.2 Middleware wiring [role: implementer]
  - depends: 1.1
  - **Files**: `src/auth/middleware.ts` (modify lines ~40-80)
  ...
```

Agents claim tasks by making an MCP tool call (`eh_claim_task`). The file lives in the repo. You diff it. You merge it. You rollback. It survives VS Code restarts because it's a file on disk, and it survives company migrations because it's 80 lines of plain text.

A task database would give me structured queries. I don't need structured queries — I need a thing a human can read at 2am without opening a dashboard.

### (2) Collision prevention — a local HTTP call

Agents acquire locks on files before they write. The MCP tool call is `eh_acquire_lock`. The implementation is about 60 lines of TypeScript, runs in a local HTTP server on port 28765, and returns in under 1ms.

```ts
// Pseudocode of the core
function acquireLock(agentId: string, filePath: string) {
  const existing = locks.get(filePath);
  if (existing && existing.agentId !== agentId && !isExpired(existing)) {
    return { ok: false, heldBy: existing.agentId };
  }
  locks.set(filePath, { agentId, acquiredAt: Date.now() });
  return { ok: true };
}
```

If the orchestrator can't get a lock, the task gets queued. If an agent terminates without releasing, the lock expires after 5 minutes. If you want full isolation, the extension will optionally spawn each agent in its own git worktree instead, and merge on completion.

A distributed lock service would give me high availability across data centers. I don't have data centers. I have a laptop.

### (3) Communication — a queue, in RAM

Agents send each other messages via `eh_send_message`. Messages sit in a typed queue in memory. Each agent polls its inbox via `eh_get_messages` when it's between steps. Delivered-once semantics, because the producer and consumer are on the same machine.

There's also shared knowledge — a key/value store with temporal validity (`validUntil` timestamps) so stale context automatically expires. Backed by SQLite. Runs in the extension host. Never leaves the machine.

### (4) Visibility — a webview

This is the part where I deviated from the "no infrastructure" pattern, but only a little. The extension ships a React + PixiJS webview that renders every agent as a planet in a cosmic system. Ships fly between cooperating agents when they share work. Lightning arcs appear between two planets when they've both tried to write to the same file.

I thought the visualization was going to be the cute part. It turned out to be the **most useful debugging tool I've ever built**. The first time two of my agents got into a lock contention loop, I could see it immediately — lightning arcs firing every two seconds. Without the visualization I would have stared at logs for half an hour.

### (5) Spawning — `child_process.spawn`

When a plan is loaded, the agent that loaded it auto-becomes the orchestrator. It gets an elevated MCP tool: `eh_spawn_agent`. The tool takes an agent type, a task assignment, and a working directory. Under the hood:

```ts
const term = vscode.window.createTerminal({
  name: `agent-${id}`,
  shellPath: resolvedBin,  // claude, opencode, cursor
  shellArgs: [...prompts, ...flags],
});
```

The new agent runs in a visible VS Code terminal. You can watch what it's doing. You can ⌘+C it. You can type follow-ups if the orchestrator span it in interactive mode. There's no "hidden worker process" — every agent is a terminal you can see.

This was a deliberate design choice. Early prototypes spawned agents as background processes and piped their output to a panel. It was technically cleaner but psychologically worse: users didn't trust agents they couldn't see. Visible terminals + planet visualizations + file-lock lightning = the team becomes legible.

## The orchestrator flow, in practice

Here's what actually happens when you use it:

```
/eh:create-plan Build a REST API with auth, database layer, and tests
```

Your current Claude session reads the prompt, scopes the work, writes a markdown plan, calls `eh_load_plan`, and calls `eh_claim_orchestrator`. It is now the orchestrator.

Then it reads the plan, groups tasks by dependencies, and decides it needs three workers — an implementer, a tester, and a reviewer. It calls `eh_spawn_agent` three times. Three new terminals open. Three planets appear next to the orchestrator star.

Each worker calls `eh_claim_task` with a task ID, claims a lock on the files it'll touch, does the work, marks the task done, sends a message back to the orchestrator. If a task fails verification (the `**Verify:**` command in the plan), the extension auto-retries with a more expensive model (haiku → sonnet → opus). If it still fails, the orchestrator gets a notification and decides what to do.

Meanwhile a **budget gauge** fills up as tokens are spent. A **context fuel gauge** on each planet shows how close that agent is to its context window limit. A **Cost Insights** panel shows cache-hit ratios, duplicate reads, and where the money is going.

When the plan is done, you see a Kanban board with everything green, a cost total, and the commit history of each worker. The terminals are still there. You can inspect, kill, or keep working.

## What I didn't build

I want to be honest about the limits, because the pitch so far sounds too good.

**Not built:** cross-machine coordination. Event Horizon only works inside one VS Code window. If you want a team of humans sharing an agent team, you need something else. That's the legitimate use case for a server.

**Not built:** formal verification that the lock/queue/knowledge primitives are race-free at scale. They work well for 3–5 agents. I haven't tried 50. The design is local-machine-first, and I suspect you'd hit limits.

**Not built:** the visualization isn't free on CPU. Running it with 20 planets + heavy traffic uses a few percent CPU. Fine on a laptop. Might annoy a battery-paranoid user.

## Stack + licensing

- **Core**: TypeScript, zero runtime deps
- **Renderer**: PixiJS v8
- **UI**: React + Zustand
- **Persistence**: sql.js (SQLite as WASM) — everything local, no native build
- **IPC**: local HTTP (port 28765) + MCP over stdio
- **Editors supported**: VS Code, Cursor, VSCodium, Windsurf, Gitpod, Eclipse Theia, Coder (one Open VSX publish reaches all of them)

MIT licensed. Code at [github.com/HeytalePazguato/event-horizon](https://github.com/HeytalePazguato/event-horizon).

## The takeaway I keep coming back to

The infrastructure tax — Docker, Postgres, accounts, dashboards — wasn't there because multi-agent coordination is hard. It was there because the tools were designed for multi-team environments where those pieces had to exist anyway. When you solve for a single developer on a single machine, 90% of the "infrastructure" folds into a local HTTP server, a markdown file, and an MCP tool schema.

I didn't want to run Postgres to coordinate three Claude instances. Turns out I didn't have to.

---

**Try it:** Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=HeytalePazguato.event-horizon-vscode) or [Open VSX](https://open-vsx.org/extension/HeytalePazguato/event-horizon-vscode). Ships with hooks for Claude Code, OpenCode, GitHub Copilot, and Cursor — mix and match freely.

If this resonates, **[star the repo](https://github.com/HeytalePazguato/event-horizon)** so others can find it. I publish the weekly build log as tweets; feedback always welcome.
