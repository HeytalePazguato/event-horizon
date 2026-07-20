# File Locking & Isolation

When multiple agents work the same project, the failure mode is obvious: two of them edit `server.ts`, one overwrites the other, nobody notices, the build breaks. Event Horizon offers **two mechanisms** to prevent this — pick based on how much isolation you want.

| Mechanism | What it does | Cost |
|-----------|--------------|------|
| **File locking** | Hard-blocks a conflicting write while another agent holds the file | None — agents share one working tree |
| **Worktree isolation** | Each agent gets its own git worktree; conflicts are impossible | Extra git branches/worktrees |

Both are **off by default**. Turn on whichever fits your workflow.

---

## File locking

Enable with [`eventHorizon.fileLockingEnabled`](configuration.md#eventhorizonfilelockingenabled).

!!! warning "Reinstall hooks after enabling"
    File locking changes what the agent hooks do. After toggling this setting, **reconnect your agents** (Command Center → Connect → Install) so the updated hooks are in place.

### How it works

When file locking is on, an agent must **acquire a lock** before writing a file. If another agent already holds that lock:

- The second agent's write tool call is **hard-blocked** — it does not execute. This isn't an advisory warning; the operation is stopped.
- Locks **refresh on writes** — an actively-working agent keeps its lock.
- Locks **release on agent termination** — a dead agent never holds a file hostage.

In the [Universe](the-universe.md#lightning-arcs-file-collisions), an attempted collision still draws a cyan lightning arc — so you see it happened even though it was prevented.

### The locking tools

Agents coordinate locks through [MCP tools](mcp-tools.md#locking-and-activity):

| Tool | Purpose |
|------|---------|
| `eh_check_lock` | Is this file locked, and by whom? |
| `eh_acquire_lock` | Take a lock on a file |
| `eh_release_lock` | Release a lock |
| `eh_wait_for_unlock` | Block until a file becomes free |
| `eh_file_activity` | What's been touched since a given time |

Well-behaved agents check before they write and wait when blocked. The hard block is the backstop for when they don't.

---

## Worktree isolation

Enable with [`eventHorizon.worktreeIsolation`](configuration.md#eventhorizonworktreeisolation).

This is the stronger option. Each spawned agent gets **its own git worktree** — a separate working copy of the repository on its own branch. Agents physically cannot touch each other's files because they're not working in the same directory.

- Works with **any git host** — GitHub, GitLab, Bitbucket, self-hosted.
- Changes are **auto-merged** on task completion.
- Agents manage their worktrees with the [`eh_create_worktree`](mcp-tools.md#heartbeat-and-worktrees) and `eh_remove_worktree` MCP tools.

The trade-off is extra branches and worktrees in your repo. If you don't want those, leave it off and use file locking instead.

!!! info "Requires git"
    Worktree isolation needs the workspace to be a git repository. File locking does not — it works in any folder.

---

## Which should I use?

```
Single agent, or agents that never touch the same files
    → neither; you don't need it

Multiple agents, shared working tree, you want a safety net
    → file locking

Multiple agents, you want them fully sandboxed from each other
    → worktree isolation
```

You *can* run both, but worktree isolation already makes conflicts impossible, so file locking on top of it is redundant in most setups.

---

## Seeing it work

- **[Universe](the-universe.md)** — lightning arcs flash when agents collide on a file.
- **[Operations Dashboard → File Activity](operations-dashboard.md#file-activity)** — a heatmap of which files are hot and who's touching them.
- **[Events tab](operations-dashboard.md#events-logs)** — search for `lock` to see acquire / release / blocked events in the stream.
