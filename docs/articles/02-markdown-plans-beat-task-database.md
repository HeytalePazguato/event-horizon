---
title: Why markdown plans beat a task database for AI agents
published: false
description: Everyone reaches for Postgres when they need to coordinate a team of AI agents. Here's why a markdown file is usually the better answer.
tags: ai, vscode, productivity, opensource
canonical_url: https://github.com/HeytalePazguato/event-horizon
---

Event Horizon started with Claude itself describing how it saw other AI agents — planets in a cosmic system, tasks orbiting as moons, completed work collapsing into a black hole. I built the visual first. Then the agents had to actually coordinate on real work, and the pretty visualization forced a boring architectural choice: where does the shared task state live?

When you tell someone you're coordinating a team of AI coding agents, the first design they reach for is a task database. Postgres, an issues table, a REST API, a web dashboard. It's the obvious answer — tasks are structured, dependencies are relational, queries need to be fast, multiple workers need consistent views.

I reached for a **markdown file** instead. Here's why it keeps winning.

## What a task database gives you

Let's be fair to the database approach. You get:

- Structured queries ("show me all blocked tasks depending on task X")
- Atomic claims via row-level locking
- Audit history for free
- A dashboard you can point a stakeholder at

These are real. A database is the right tool when your coordination problem is big enough to need them.

## What a task database costs you

For a solo developer running 3–5 agents on their own machine, the costs dominate:

**Deployment tax.** Someone has to install Postgres, run migrations, bring the dashboard up, keep the service alive. You just wanted your agents to stop overwriting each other. Now you're running a server.

**Schema lock-in.** The moment you define a `tasks` table, you've shaped every future feature around it. Want to add a `retry_policy` column? Migration. Want to prototype a new field? Migration. The agents that write to it now have to know the schema version.

**Opaque to agents.** Agents can't reason about rows in a database the way they reason about text. Ask Claude to "split this task into two subtasks" and it has to call your API, which has to expose exactly the operations you anticipated. Ask Claude to "split this task in the plan" and it reads the file, edits the file, writes the file back. Done.

**Not git-friendly.** Your plan lives in one tool and your code in another. You can't tag a release "v2.0" and have the plan pinned to that version. You can't rollback with `git checkout`. You can't `grep` your plan history.

**Vendor-shaped.** Every task database has its own schema, its own API, its own auth. Plans written for tool A don't transfer to tool B. Your team's coordination becomes as portable as your ticket history — i.e. not.

## What markdown plans give you

**Portable.** It's a markdown file. Every editor in the world opens it. Every version control system diffs it. Every LLM reads it natively.

**Diffable.** `git diff` tells you what changed between plan versions. You can review a plan as a PR. You can revert it.

**Agent-native.** LLMs don't need a special tool to understand a markdown plan. They already speak markdown — it's part of their training data. An agent reading the plan and an agent editing the plan are the same operation: read the file, think, write the file.

**Human-readable.** The plan I'm looking at right now has dependencies, file maps, acceptance criteria, verify commands, complexity estimates, and model hints. I can read it top-to-bottom in 30 seconds. No query language. No permission prompts.

**Git-friendly.** The plan lives in the repo. It's tagged with the code. It's reviewed in PRs. It's archived when the work is done.

Here's a real plan shape from Event Horizon:

```markdown
# Auth overhaul

## File Map
| File | Action | Responsibility |
|------|--------|----------------|
| `src/auth/session.ts` | Create | Token rotation logic |

## Phase A — implementation

- [ ] 1.1 Session rotation [role: implementer]
  - **Files**: `src/auth/session.ts` (create)
  - **Do**: implement `rotateSession(userId, oldToken)`
  - **Accept**: returns new token, invalidates old, writes audit log
  - **Verify**: `pnpm test src/auth/session.test.ts`
  <!-- complexity: medium -->
  <!-- model: sonnet -->
```

An agent reads this and knows: what to build, where, how to verify, how much effort is expected, which model to use. No schema. No API. Just a contract, in text.

## What you give up

Real-time concurrency control. If two agents try to claim the same task from the same file, which one wins? In a database, row-level locks. In a markdown file, ambiguous.

The answer in Event Horizon is a ~60-line local HTTP server that wraps the file. Agents claim tasks via an MCP tool call (`eh_claim_task`) that atomically flips `[ ]` to `[-]` in the file, with a last-write-wins guard via content-hash comparison. The file stays the source of truth; the server only referees the writes. No Postgres. No migrations. No dashboard. ~60 lines.

That's the tradeoff: you give up the DB's structural guarantees, and you build back the specific guarantees you actually need as thin wrappers around the file. For a small team of agents, it's 10× less code.

## When to actually use a database

I'll name the conditions where markdown stops scaling:

- **More than ~20 agents on one plan** — file conflicts start dominating
- **Multiple machines** — you need a central source of truth, not a per-machine file
- **Stakeholders who won't read markdown** — you need a dashboard regardless
- **Task volumes in the thousands** — full-file rewrites get expensive

None of those are my problem. None of them are most developers' problems. Most developers are running 3–5 agents on one laptop and want those agents to stop destroying each other's work.

For that, a markdown file beats Postgres every time.

---

Event Horizon is the VS Code extension I built on this idea. Plans are markdown, locks are HTTP calls, knowledge is SQLite, visualization is a webview. Nothing leaves the machine. [Source on GitHub](https://github.com/HeytalePazguato/event-horizon). [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=HeytalePazguato.event-horizon-vscode). [Open VSX](https://open-vsx.org/extension/HeytalePazguato/event-horizon-vscode).
