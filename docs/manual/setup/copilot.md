# Connecting GitHub Copilot

GitHub Copilot connects to Event Horizon for visualization and MCP coordination, but with **fewer capabilities** than Claude Code or OpenCode — Copilot's API surface is more limited.

---

## Connect

1. Open the Event Horizon panel (++ctrl+shift+e++ ++h++).
2. Click **Connect** in the [Command Center control grid](../command-center.md#right-control-grid).
3. Choose **GitHub Copilot** and click **Install**.

---

## What gets installed

| Item | Location |
|------|----------|
| Hook scripts | `.github/hooks/` in your workspace |
| The MCP server registration | Copilot's MCP config |

The hooks send event payloads to `http://127.0.0.1:28765/copilot`.

!!! info "Workspace-scoped, not global"
    Unlike Claude Code and OpenCode — whose hooks live in your home directory — Copilot's hooks are written into the **workspace** at `.github/hooks/`. Connect Copilot once per project. Consider whether you want `.github/hooks/` committed or git-ignored for your repo.

---

## Capabilities

| Feature | Supported |
|---------|:---------:|
| Hooks (live event stream) | ✅ |
| MCP tools | ✅ |
| File locking | ❌ Not supported |
| Spawnable by an orchestrator | ❌ Not supported |
| Token tracking | ⚠️ Partial |

What this means in practice:

- **Copilot can't be spawned** as a worker by an orchestrator. It can still participate in a plan — claim tasks, update status, read shared knowledge — when *you* drive it.
- **Copilot can't hold file locks.** If you run Copilot alongside other agents on a shared tree, it won't be hard-blocked and won't block others. Use [worktree isolation](../file-locking.md#worktree-isolation) if you need Copilot fully sandboxed.
- **Token tracking is partial** — cost figures for Copilot agents are estimates, not exact.

Copilot still appears as a planet (an **icy planet**), shows state, exchanges [ships](../the-universe.md#ships-data-transfers-between-agents) with cooperating agents, and has access to the [MCP tools](../mcp-tools.md).

---

## Verify it's working

1. Use Copilot in your workspace as you normally would.
2. An **icy planet** appears in the Universe.
3. Activity registers in the [event log](../command-center.md#logs).

---

## Troubleshooting

??? failure "No planet appears"
    - Confirm the Event Horizon panel is open.
    - Confirm `.github/hooks/` exists in the **current workspace** — Copilot hooks are per-project, so connecting in one repo doesn't connect another.
    - If you changed [`eventHorizon.port`](../configuration.md#eventhorizonport), reconnect.

??? failure "Copilot won't pick up spawned work"
    Expected — Copilot is **not spawnable**. An orchestrator can't launch a Copilot worker. Drive Copilot yourself; it can still claim and update plan tasks.

---

## Disconnecting

Delete the `.github/hooks/` directory from your workspace (or just the Event Horizon hook files within it).
