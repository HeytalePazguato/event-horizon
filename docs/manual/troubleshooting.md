# Troubleshooting & FAQ

Common problems and their fixes. If your issue isn't here, check the [GitHub issues](https://github.com/HeytalePazguato/event-horizon/issues).

---

## Connection problems

### No planet appears when I start an agent

Work through these in order:

1. **Is the panel open?** The extension activates when you open the Event Horizon panel. Open it (++ctrl+shift+e++ ++h++) and start the agent again.
2. **Is the agent connected?** Open the [connection wizard](getting-started.md#3-connect-an-agent) (Command Center → Connect) and re-install for your agent type.
3. **Is the agent running inside your workspace?** Agents are matched to the universe by their working directory.
4. **Did you change the port?** If [`eventHorizon.port`](configuration.md#eventhorizonport) isn't `28765`, the agent's hook must point at the new port — **reconnect** to rewrite it.
5. **Check the hook exists.** See the per-agent setup guide for where the hook lives ([Claude Code](setup/claude-code.md), [OpenCode](setup/opencode.md), [Copilot](setup/copilot.md), [Cursor](setup/cursor.md)).

### Port already in use

If something else on your machine is using `28765`, the event server can't bind.

1. Pick a free port and set [`eventHorizon.port`](configuration.md#eventhorizonport) to it.
2. **Restart the extension** (or VS Code) — the port change needs a restart.
3. **Reconnect every agent** so their hooks point at the new port.

### My agent connected, then went gray

A gray status dot means **lost** — no heartbeat for over five minutes. Usually the agent's process ended without a clean shutdown (terminal killed, crash).

- If the agent is genuinely done, run **Event Horizon: Clear Stale Agents** to remove it.
- If it should still be alive, check the agent's terminal — it may have hit a permission prompt or crashed.

---

## Agent spawning problems

### Spawned workers exit immediately

- Check the **Event Horizon — Agents** output channel — Event Horizon captures the last several KB of a failed spawn's output there.
- For **Claude Code**: expired OAuth tokens cause silent exit-1. Event Horizon shows a notification with an **Open Claude Terminal** button — re-authenticate there.
- For **Windows**: paths with spaces and `.cmd` shims were a historical failure source — make sure the extension is up to date.

### Spawned workers get stuck

The [watchdog](orchestration.md#the-watchdog) auto-fails workers silent for [`eventHorizon.watchdog.timeoutMinutes`](configuration.md#eventhorizonwatchdogtimeoutminutes) minutes and notifies the orchestrator. If workers get stuck often, they're probably hitting permission prompts — adjust the agent's permission settings, or use [`eventHorizon.spawnTerminalFocus`](configuration.md#eventhorizonspawnterminalfocus) set to `focus-on-interaction` so you see them.

### Copilot won't pick up spawned work

Expected — [GitHub Copilot is not spawnable](setup/copilot.md#capabilities). An orchestrator can't launch a Copilot worker. Drive Copilot yourself; it can still claim and update plan tasks.

---

## Visualization problems

### File-collision lightning never shows

Lightning arcs only draw when two agents touch the **same file**. If you expect collisions and see none, confirm both agents are actually working in the same directory (check the [File Activity](operations-dashboard.md#file-activity) heatmap).

### The view feels sluggish

- Lower [`eventHorizon.animationSpeed`](configuration.md#eventhorizonanimationspeed) — or raise it; either way it re-tunes the ticker load.
- For a slow [Project Graph canvas](knowledge-graph.md#the-project-graph-canvas), lower [`eventHorizon.projectGraph.canvasMaxNodes`](configuration.md#eventhorizonprojectgraphcanvasmaxnodes).

### Ships never appear between agents

Ships mean two agents are [cooperating](the-universe.md#ships-data-transfers-between-agents) — they must share a working directory. If two agents are in the same project but no ships fly, confirm both report a real `cwd` (not the filesystem root). OpenCode occasionally reports `/`; Event Horizon corrects this by injecting the workspace folder, but the agent still needs to be running inside the workspace.

---

## Knowledge graph problems

### "No project graph yet"

The graph is **never built automatically**. Run [`/eh:optimize-context`](skills.md#ehoptimize-context) in any connected agent to build it.

### The graph has stale or missing files

`/eh:optimize-context` always rebuilds from scratch, so re-running it fixes stale rows. If specific files are missing, they may be over [`eventHorizon.projectGraph.maxFileSizeKb`](configuration.md#eventhorizonprojectgraphmaxfilesizekb), or in a skipped vendor/generated directory.

### "Open a folder in VS Code" message

The project graph is stored per workspace at `<workspace>/.eh/graph.db`. With no folder open, there's nowhere to put it — open your project folder first.

---

## FAQ

??? question "Does Event Horizon slow my agents down?"
    No. The hooks fire-and-forget a POST to localhost. If Event Horizon is closed, the POST fails instantly and the agent continues — zero overhead, no hang.

??? question "Does it need an API key or account?"
    No. Event Horizon never makes model calls and has no accounts. See [Privacy & Data](privacy.md).

??? question "Does it send my code anywhere?"
    No. Everything runs on `127.0.0.1`. The only ways data leaves are things you initiate — see [What leaves your machine](privacy.md#what-leaves-your-machine).

??? question "Can I use it without git?"
    Yes. Only [worktree isolation](file-locking.md#worktree-isolation) needs git. File locking, visualization, orchestration, and the knowledge graph all work in any folder.

??? question "Can different agent types work together?"
    Yes — it's a first-class workflow. A Claude Code orchestrator can spawn OpenCode workers, agents of different types exchange [ships](the-universe.md#ships-data-transfers-between-agents) and [messages](mcp-tools.md#messaging), and they all share one plan and knowledge base.

??? question "Where is my data stored?"
    Events, knowledge, achievements, and profiles go in a local SQLite database in the extension's storage path. The project graph goes in `<workspace>/.eh/graph.db`. Nothing is transmitted. See [Privacy & Data](privacy.md#what-gets-stored-and-where).

??? question "How do I fully remove it?"
    Uninstall the extension, then remove the hooks from each connected agent (the per-agent [setup guides](setup/claude-code.md#disconnecting) cover this) and optionally delete the `.eh/` folder from your workspaces.

??? question "It works in VS Code — does it work in Cursor / VSCodium / Windsurf?"
    Yes. Event Horizon is published to [Open VSX](getting-started.md#1-install-the-extension) for VS Code-compatible editors. See the [Cursor setup guide](setup/cursor.md) for the one editor that's both a host and a connectable agent.

---

## Getting more help

- **Output channels** — `Event Horizon — Agents` captures spawn diagnostics.
- **Events tab** — the [searchable event log](operations-dashboard.md#events-logs) is the source of truth for what actually happened.
- **GitHub** — [report an issue](https://github.com/HeytalePazguato/event-horizon/issues) with the relevant output-channel text attached.
