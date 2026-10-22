# Connecting OpenCode

OpenCode is a **first-class** Event Horizon agent — full support for hooks, MCP tools, file locking, spawning, and full token tracking.

---

## Connect

1. Open the Event Horizon panel (++ctrl+shift+e++ ++h++).
2. Click **Connect** in the [Command Center control grid](../command-center.md#right-control-grid).
3. Choose **OpenCode** and click **Install**.

!!! tip "Auto-detection"
    If `opencode` is on your `PATH` and not yet connected, Event Horizon offers one-click setup on activation. Disable with [`eventHorizon.autoDetect.enabled`](../configuration.md#eventhorizonautodetectenabled).

---

## What gets installed

| Item | Location |
|------|----------|
| An Event Horizon plugin | `~/.config/opencode/plugins/` |
| The MCP server registration | OpenCode's MCP config |

The plugin sends event payloads to `http://127.0.0.1:28765/opencode`. The wizard writes it for you. Hooks are re-checked and refreshed on every activation.

**OpenCode 1 and 2 need different plugins.** The installer runs `opencode --version` and writes the matching one: a plugin function for OpenCode 1, and an `{ id, setup }` definition for OpenCode 2. Nothing else is installed: Event Horizon never writes `~/.config/opencode/package.json` and adds no dependencies. If you upgrade OpenCode, the installed plugin is reported as out of date and **Connect** writes the right one. Restart OpenCode after installing.

**Finished workers leave on their own.** OpenCode reports the end of every turn, including in a session you are still typing into, so a turn ending alone does not remove an agent. A worker Event Horizon spawned is removed once its turn ends, it holds no claimed plan task and it stays quiet for 15 seconds. Sessions you started yourself are only removed when OpenCode exits.

---

## Capabilities

| Feature | Supported |
|---------|:---------:|
| Hooks (live event stream) | ✅ |
| MCP tools | ✅ |
| File locking | ✅ |
| Spawnable by an orchestrator | ✅ |
| Token tracking | ✅ Full |

An OpenCode agent can orchestrate or be a worker. A Claude Code orchestrator spawning OpenCode workers (and the reverse) is fully supported.

---

## Verify it's working

1. Start an OpenCode session inside your workspace.
2. Within a second or two, a **rocky planet** appears in the Universe.
3. Run a prompt — the planet shows a [pulsing ring](../the-universe.md#planet-state-indicators).

---

## Troubleshooting

??? failure "No planet appears when I start OpenCode"
    - Confirm the Event Horizon panel is open.
    - Confirm the plugin exists in `~/.config/opencode/plugins/`. If not, run **Connect** again.
    - If you changed [`eventHorizon.port`](../configuration.md#eventhorizonport), **reconnect** so the plugin points at the right port.

??? failure "OpenCode 2 says \"Plugin must export a default definition with an id and an effect or setup function\""
    That plugin was written for OpenCode 1. Run **Connect** again so Event Horizon writes the OpenCode 2 plugin, then restart OpenCode. Any other plugin in `~/.config/opencode/plugins/` written for OpenCode 1 shows the same error.

??? failure "`opencode plugin list` says \"No plugins found\""
    The first listing after OpenCode's background service starts can run before plugins finish loading. Run it again with `--print-logs`. A plugin OpenCode 2 rejected appears with `-` in the ID column; the Event Horizon plugin shows `event-horizon`.

??? failure "OpenCode agent shows \"/\" as its working directory"
    OpenCode can report the filesystem root as its `cwd` when the project path resolves oddly. Event Horizon treats root-only paths as missing and injects the primary VS Code workspace folder instead — so [cooperation detection](../the-universe.md#ships-data-transfers-between-agents) still works. If you see this and ships still aren't spawning, confirm the agent is actually running inside your workspace folder.

??? failure "Spawned OpenCode workers exit immediately"
    Earlier versions built the spawn command with the wrong CLI syntax. This is fixed in current releases — make sure the extension is up to date. Check the **Event Horizon — Agents** output channel for captured output.

---

## Disconnecting

Delete the Event Horizon plugin file from `~/.config/opencode/plugins/`. Removing the extension does not remove it automatically.
