# Connecting Cursor

Cursor connects to Event Horizon with strong support — hooks, MCP tools, spawning, and full token tracking. The one caveat is file locking.

---

## Connect

1. Open the Event Horizon panel (++ctrl+shift+e++ ++h++).
2. Click **Connect** in the [Command Center control grid](../command-center.md#right-control-grid).
3. Choose **Cursor** and click **Install**.

!!! tip "Auto-detection"
    If `cursor` is on your `PATH` and not yet connected, Event Horizon offers one-click setup on activation. Disable with [`eventHorizon.autoDetect.enabled`](../configuration.md#eventhorizonautodetectenabled).

!!! info "Running Event Horizon inside Cursor"
    Cursor is VS Code-compatible, so the Event Horizon extension itself installs and runs inside Cursor — via the [Open VSX registry](../getting-started.md#1-install-the-extension). You can both *run* Event Horizon in Cursor and *connect* Cursor's agent to it.

---

## What gets installed

| Item | Location |
|------|----------|
| Hook configuration | Cursor's configuration |
| The MCP server registration | Cursor's MCP config |

The hooks send event payloads to `http://127.0.0.1:28765/cursor`. Hooks are re-checked and refreshed on every activation.

---

## Capabilities

| Feature | Supported |
|---------|:---------:|
| Hooks (live event stream) | ✅ |
| MCP tools | ✅ |
| File locking | ⚠️ Not supported |
| Spawnable by an orchestrator | ✅ |
| Token tracking | ✅ Full |

Cursor agents can orchestrate and be spawned as workers. They **cannot hold file locks**, though — so if you run Cursor agents on a shared working tree alongside others, prefer [worktree isolation](../file-locking.md#worktree-isolation) to keep them from colliding.

Cursor appears as a **volcanic planet** in the Universe.

---

## Verify it's working

1. Start a Cursor agent session inside your workspace.
2. A **volcanic planet** appears in the Universe.
3. Run a prompt — the planet shows a [pulsing ring](../the-universe.md#planet-state-indicators).

---

## Troubleshooting

??? failure "No planet appears"
    - Confirm the Event Horizon panel is open.
    - If you changed [`eventHorizon.port`](../configuration.md#eventhorizonport), **reconnect** so the hook points at the right port.
    - Re-run **Connect** to rewrite the hook configuration.

??? failure "Spawned Cursor workers fail on Windows"
    Windows paths with spaces and `.cmd` shims have historically been a source of spawn failures. These are fixed in current releases — make sure the extension is up to date, and check the **Event Horizon — Agents** output channel for captured output.

??? failure "Cursor agents colliding on files with other agents"
    Cursor can't hold file locks, so [`eventHorizon.fileLockingEnabled`](../configuration.md#eventhorizonfilelockingenabled) won't protect Cursor agents. Turn on [`eventHorizon.worktreeIsolation`](../configuration.md#eventhorizonworktreeisolation) instead — each agent works in its own git worktree.

---

## Disconnecting

Remove the Event Horizon hook entry from Cursor's configuration. Re-running **Connect** rewrites it if you want to reconnect later.
