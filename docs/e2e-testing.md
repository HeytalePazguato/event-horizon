# End-to-end testing

## Event server

With the Event Horizon extension active, a local HTTP server runs on **127.0.0.1:28765**.

- **POST /events** — raw `AgentEvent` JSON body
- **POST /opencode** — OpenCode plugin payload (mapped to `AgentEvent`)
- **POST /claude** — Claude Code hook payload (mapped to `AgentEvent`)

## Manual test with mock events

1. Open VS Code/Cursor and run the Event Horizon extension (F5 or Install from repo).
2. Open the Event Horizon view (Activity Bar → Event Horizon → Universe).
3. From a terminal, send a test event:

```bash
curl -X POST http://127.0.0.1:28765/events -H "Content-Type: application/json" -d "{\"id\":\"test-1\",\"agentId\":\"agent-1\",\"agentName\":\"Test Agent\",\"agentType\":\"opencode\",\"type\":\"task.start\",\"timestamp\":$(date +%s000),\"payload\":{}}"
```

4. Confirm the universe view updates (or that the extension receives the event without error).

## Claude Code hooks

Configure Claude Code to POST to Event Horizon:

- In `.claude/settings.json` (user or project), add an HTTP hook for the desired events (e.g. `PostToolUse`, `TaskCompleted`).
- Set the URL to `http://127.0.0.1:28765/claude`.
- Event Horizon will map the payload and display activity in the universe.

## OpenCode plugin

Use an OpenCode plugin that forwards events to Event Horizon by POSTing to `http://127.0.0.1:28765/opencode` with the plugin event payload. Map plugin event names to the supported set (e.g. `session.created`, `tool.execute.after`).
