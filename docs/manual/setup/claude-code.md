# Connecting Claude Code

Claude Code is a **first-class** Event Horizon agent — full support for every feature: hooks, MCP tools, file locking, spawning, and full token tracking.

---

## Connect

1. Open the Event Horizon panel (++ctrl+shift+e++ ++h++).
2. Click **Connect** in the [Command Center control grid](../command-center.md#right-control-grid).
3. Choose **Claude Code** and click **Install**.

That's it. You can also run **Event Horizon: Connect Claude Code** directly from the Command Palette.

!!! tip "Auto-detection"
    If `claude` is on your `PATH` and not yet connected, Event Horizon offers one-click setup on activation. Disable with [`eventHorizon.autoDetect.enabled`](../configuration.md#eventhorizonautodetectenabled).

---

## What gets installed

| Item | Location |
|------|----------|
| A hook entry that POSTs events to Event Horizon | `~/.claude/settings.json` |
| The ten [bundled skills](../skills.md#the-ten-bundled-skills) | `~/.claude/skills/` |
| The MCP server registration | Claude Code's MCP config |

The hook sends event payloads to `http://127.0.0.1:28765/claude`. The wizard writes all of this for you — you don't edit any files by hand.

Hooks are **re-checked and refreshed on every activation**, so once connected you stay current across extension updates.

---

## Capabilities

| Feature | Supported |
|---------|:---------:|
| Hooks (live event stream) | ✅ |
| MCP tools | ✅ |
| File locking | ✅ |
| Spawnable by an orchestrator | ✅ |
| Token tracking | ✅ Full |

A Claude Code agent can be an orchestrator, a worker, or both. Claude orchestrating OpenCode workers — or vice versa — is a fully supported workflow.

---

## Verify it's working

1. Start a Claude Code session in a terminal inside your workspace.
2. Within a second or two, a **gas-giant planet** appears in the Universe.
3. Run a prompt — the planet shows a [pulsing ring](../the-universe.md#planet-state-indicators).

If no planet appears, see [Troubleshooting](#troubleshooting).

---

## Troubleshooting

??? failure "No planet appears when I start Claude Code"
    - Confirm the Event Horizon panel is open (the extension activates on panel open).
    - Check the port — Event Horizon listens on `28765` by default. If you changed [`eventHorizon.port`](../configuration.md#eventhorizonport), the hook must match; **reconnect** to rewrite the hook.
    - Open `~/.claude/settings.json` and confirm a hook entry pointing at `127.0.0.1:<port>/claude` exists. If not, run **Connect** again.
    - See the general [Troubleshooting & FAQ](../troubleshooting.md).

??? failure "Spawned Claude workers exit immediately"
    - On expired OAuth tokens, batch-mode agents fail silently. Event Horizon detects this and shows a notification with an **Open Claude Terminal** button — re-authenticate there.
    - Check the **Event Horizon — Agents** output channel for the captured stdout/stderr.

??? failure "File locking isn't blocking anything"
    File locking is **off by default**. Enable [`eventHorizon.fileLockingEnabled`](../configuration.md#eventhorizonfilelockingenabled), then **reconnect** so the updated hook is installed.

---

## Disconnecting

Removing the extension does not remove the hook. To fully disconnect, edit `~/.claude/settings.json` and delete the Event Horizon hook entry. The skills in `~/.claude/skills/` can stay or go — they're inert without the extension running.
