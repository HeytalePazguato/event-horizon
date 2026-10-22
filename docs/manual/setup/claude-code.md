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
| Hook entries that POST events to Event Horizon | `~/.claude/settings.json` (`hooks`) |
| OpenTelemetry settings, so Claude Code reports its own cost | `~/.claude/settings.json` (`env`) |
| A statusLine bridge, only if you already have a statusLine | `~/.claude/settings.json` (`statusLine`) |
| Hook and bridge scripts, and backups of anything replaced | `~/.event-horizon/` |
| The ten [bundled skills](../skills.md#the-ten-bundled-skills) | `~/.claude/skills/` |
| The MCP server registration | Claude Code's MCP config |

The hook sends event payloads to `http://127.0.0.1:28765/claude`. The wizard writes all of this for you — you don't edit any files by hand.

Hooks are **re-checked and refreshed on every activation**, so once connected you stay current across extension updates.

**On Windows**, Claude Code runs hook commands through Git Bash when it is installed and through PowerShell otherwise. Event Horizon follows the same rule: with Git Bash (and on macOS and Linux) the hooks are short `curl` commands and the file-lock check runs with `sh`; without Git Bash every hook runs a PowerShell script from `~/.event-horizon/`. Bash is never required.

### Measured cost (OpenTelemetry)

Claude Code does not write cost into its transcripts, so Event Horizon turns on Claude Code's own OpenTelemetry export and receives it on `http://127.0.0.1:28765/otlp/v1/metrics` and `/otlp/v1/logs`. These variables are merged into the `env` block of `~/.claude/settings.json` (Claude Code ignores them in a project's `.claude/settings.json`):

| Variable | Value |
|----------|-------|
| `CLAUDE_CODE_ENABLE_TELEMETRY` | `1` |
| `OTEL_METRICS_EXPORTER`, `OTEL_LOGS_EXPORTER` | `otlp` |
| `OTEL_EXPORTER_OTLP_METRICS_PROTOCOL`, `OTEL_EXPORTER_OTLP_LOGS_PROTOCOL` | `http/json` |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`, `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | Event Horizon's local endpoints |
| `OTEL_EXPORTER_OTLP_METRICS_HEADERS`, `OTEL_EXPORTER_OTLP_LOGS_HEADERS` | Event Horizon's local auth token |
| `OTEL_METRIC_EXPORT_INTERVAL` | `10000` |
| `OTEL_LOG_USER_PROMPTS`, `OTEL_LOG_ASSISTANT_RESPONSES`, `OTEL_LOG_TOOL_CONTENT`, `OTEL_LOG_RAW_API_BODIES`, `OTEL_LOG_TOOL_DETAILS` | `0`, unless you had already set them |

- Only the per-signal `METRICS` and `LOGS` variables are written. The general `OTEL_EXPORTER_OTLP_*` variables are left alone because they may also serve your trace pipeline.
- Prompts, responses and tool contents are not captured. Event Horizon also drops your email and account ids on arrival.
- If Claude Code was already exporting OTLP to a collector of yours, Event Horizon forwards each payload there unchanged. A collector set to `grpc` or `http/protobuf` cannot be forwarded to; you get a one-time warning.
- If you set `CLAUDE_CODE_ENABLE_TELEMETRY=0`, or use a non-OTLP exporter, nothing is changed.
- The previous value of every variable is saved to `~/.event-horizon/telemetry-env-backup.json`. Turning off `eventHorizon.claudeTelemetry.enabled` or disconnecting restores them exactly.
- Telemetry is stored in its own `telemetry.sqlite` and kept for `eventHorizon.telemetry.retentionDays` days (default 7). **Event Horizon: Delete Stored Claude Code Telemetry** removes it all.

The variables apply to Claude Code sessions started after they are written.

### statusLine bridge

Claude Code's statusLine input carries its own session cost, the prompt-cache hit ratio and context usage. If you already have a statusLine, Event Horizon wraps it: your command still runs with the same input, through the same shell Claude Code would use, and prints exactly what it printed before. Your original statusLine is saved to `~/.event-horizon/statusline-original.json`.

If you have no statusLine, nothing is installed by default, because a custom statusLine hides Claude Code's footer keyboard hints. Set `eventHorizon.claudeStatusLine.mode` to `always` for a compact `[model] ctx % · $cost` line, or to `off` to remove the bridge and restore your original.

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

??? failure "Claude cost shows ~ in front of it"
    `~` means the figure is an estimate from transcript token counts. It switches to measured cost once Claude Code's telemetry arrives, which needs a session started after the OTel settings were written. Check that `env` in `~/.claude/settings.json` has `CLAUDE_CODE_ENABLE_TELEMETRY` set to `1`.

??? failure "File locking isn't blocking anything"
    File locking is **off by default**. Enable [`eventHorizon.fileLockingEnabled`](../configuration.md#eventhorizonfilelockingenabled), then **reconnect** so the updated hook is installed.

---

## Disconnecting

Use **Remove** for Claude Code in the Connect panel. It deletes the Event Horizon hooks, restores the `env` variables and statusLine Event Horizon changed from their saved backups, and deletes the bridge files.

Removing the extension alone does not do this. Without the extension, edit `~/.claude/settings.json` by hand: delete the Event Horizon hook entries, restore the `env` values from `~/.event-horizon/telemetry-env-backup.json`, and restore `statusLine` from `~/.event-horizon/statusline-original.json` (or delete it if that file's `original` is `null`). The skills in `~/.claude/skills/` can stay or go; they do nothing without the extension running.
