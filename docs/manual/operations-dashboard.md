# Operations Dashboard

The **Operations Dashboard** is the second of Event Horizon's two views. Where the [Universe](the-universe.md) is ambient and spatial, the dashboard is dense and tabular — a full-screen, tabbed control room for drilling into the details.

Toggle between the two views with ++ctrl+shift+e++ ++o++, or run **Event Horizon: Toggle Operations View**. Set which one opens by default with [`eventHorizon.defaultView`](configuration.md#eventhorizondefaultview).

!!! note "📷 Screenshot needed"
    *The Operations Dashboard with the Plan/Kanban tab active — sidebar on the left, Kanban columns filling the main area.*

---

## Layout

- **Sidebar** — a list of agents and plans. Select one to scope the tabs to it.
- **Tab strip** — the views below.
- **Main area** — the selected tab's content.

---

## The tabs

### Agents

Every connected agent with a live status dot:

- **Green** — alive (recent heartbeat)
- **Amber** — stale (gone quiet)
- **Gray** — lost (no heartbeat for over five minutes)

Lost agents that have no running process can be cleared with the **Clear Stale Agents** command or the [`eh_purge_stale_agents`](mcp-tools.md#orchestration) MCP tool.

### Plans (Kanban)

The [plan](orchestration.md) board — tasks as cards in status columns, with a **dependency DAG** showing which tasks block which. By default empty columns are hidden; show them all with [`eventHorizon.planShowAllColumns`](configuration.md#eventhorizonplanshowallcolumns).

### Metrics

An overview of aggregate metrics across all agents and plans — throughput, tool usage, error rates.

### File Activity

A heatmap of which files agents are touching, and how often. This is where file collisions show up as data rather than [lightning arcs](the-universe.md#lightning-arcs-file-collisions).

### Events / Logs

The full event stream, **searchable**. Backed by FTS5 full-text search over event payloads — search by tool name, file path, agent name, or any text in the payload.

### Timeline

Swimlane view — one lane per agent, events laid out on a time axis. Good for seeing what happened in parallel and where the bottlenecks were.

### Roles

[Role](orchestration.md#roles) assignments and the **performance profiler** — success rate, speed, and cost for each agent type in each role. This is the data behind smart task recommendations.

### Costs

[Budget and cost insights](budget.md) — per-plan spending, cache efficiency, duplicate-read detection, context-layer breakdown, and actionable recommendations.

### Knowledge

The [shared knowledge](knowledge-graph.md#shared-knowledge) panel **and** the [Project Graph canvas](knowledge-graph.md#the-project-graph-canvas) — a visual, navigable rendering of your codebase's knowledge graph. Click any node to see its neighbours; search to dim everything unrelated.

---

## Which view should I use?

| Use the **Universe** when… | Use the **Dashboard** when… |
|----------------------------|------------------------------|
| You want ambient awareness while you work | You're actively managing a plan |
| You're watching for collisions and stuck agents | You need to search the event log |
| You want the system at a glance | You're analysing cost or performance |
| You're showing someone what your agents are doing | You're navigating the knowledge graph |

They're the same data. Switch freely.
