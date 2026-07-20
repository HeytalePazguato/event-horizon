# Privacy & Data

Event Horizon is designed to run entirely on your machine. This page explains exactly what it does, what it stores, and what it never does.

---

## The short version

- **100% local.** The event server binds to `127.0.0.1` — the loopback interface. Nothing is sent to any remote server.
- **No accounts.** There is no sign-up, no login, no license key.
- **No API keys.** Event Horizon never makes model calls. It does not need — and never asks for — an Anthropic, OpenAI, or any other API key.
- **No telemetry.** No analytics, no crash reporting, no usage tracking, no phone-home.
- **Zero agent overhead.** If Event Horizon is closed, your agents run identically. The hooks fail silently when nothing is listening.

---

## What runs on your machine

| Component | What it is | Network exposure |
|-----------|-----------|------------------|
| Event server | An HTTP server that receives agent hook payloads | `127.0.0.1:28765` only (loopback) |
| WebSocket endpoint | Optional `/ws` for external tools to subscribe to events | `127.0.0.1:<port>/ws` only, [toggleable](configuration.md#eventhorizonwebsocketenabled) |
| MCP server | Exposes the [50 coordination tools](mcp-tools.md) to agents | Local, registered with the agent CLI |
| SQLite database | Persists events, knowledge, achievements, profiles | A local file, never transmitted |

The server binds to the loopback interface, so it is not reachable from your local network or the internet — only processes on the same machine can reach it.

---

## What gets stored, and where

When [persistence](configuration.md#eventhorizonpersistenceenabled) is enabled (the default), Event Horizon keeps a local SQLite database containing:

- **Events** — the agent activity stream (tool calls, prompts, task updates)
- **Shared knowledge** — entries written by you or your agents
- **Achievements** — which ones you've unlocked and their tier progress
- **Agent profiles** — success rate, speed, and cost stats per agent type per role

Events are **auto-pruned** after [`eventHorizon.persistence.retentionDays`](configuration.md#eventhorizonpersistenceretentiondays) days (30 by default), on startup.

The **project knowledge graph** is stored separately, per workspace, in `<workspace>/.eh/graph.db`. It is built only when you run [`/eh:optimize-context`](skills.md#ehoptimize-context) or call `eh_build_graph` — never in the background. Add `.eh/` to your `.gitignore` so you don't commit it.

To run without any persistence, set `eventHorizon.persistence.enabled` to `false` — events then live only in memory and are lost on reload.

---

## What leaves your machine

Nothing, by default.

The two ways data *could* leave are both things **you** initiate:

1. **Export Data** (`Event Horizon: Export Data…`) writes a file to a location you choose. What happens to that file afterward is up to you.
2. **Agent LLM extraction.** If you keep [`eventHorizon.projectGraph.allowAgentLLMExtraction`](configuration.md#eventhorizonprojectgraphallowagentllmextraction) enabled, an agent can call `eh_extract_concepts` to add inferred nodes to the graph. That call runs through *the agent's* model — Event Horizon itself still makes no outbound calls, but the agent does. Disable the setting if you want the graph to stay strictly local-only.

---

## Agent hooks

Connecting an agent writes a hook into that agent's configuration (see [Agent Setup](setup/claude-code.md)). The hook is a small piece of config that tells the agent CLI to `POST` event payloads to `127.0.0.1:28765`.

- The hook only ever talks to localhost.
- If Event Horizon isn't running, the `POST` fails instantly and the agent continues normally — no hang, no error surfaced to you.
- Removing the extension does not remove the hooks automatically. To fully disconnect, see the **Disconnecting** section in each [agent setup guide](setup/claude-code.md).

---

## Open source

Event Horizon is MIT licensed. The full source — extension host, webview, connectors, renderer — is on [GitHub](https://github.com/HeytalePazguato/event-horizon). You can audit exactly what it does.
