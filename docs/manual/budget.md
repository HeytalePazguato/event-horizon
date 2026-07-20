# Budget & Cost Management

Multi-agent runs spend tokens fast. Event Horizon gives you per-plan spending limits, automatic model escalation, and a cost-analysis panel so a runaway orchestration doesn't quietly burn your budget.

---

## Per-plan budgets

Every [plan](orchestration.md) can carry a spending budget. As the team works:

- A **warning** fires when spending reaches [`eventHorizon.budgetWarningThreshold`](configuration.md#eventhorizonbudgetwarningthreshold) of the budget — `0.8` (80%) by default.
- A **hard stop** triggers at 100%. The run halts rather than overshooting.

Agents check and manage the budget through [MCP tools](mcp-tools.md#budget-traces-and-cost):

| Tool | Purpose |
|------|---------|
| `eh_get_budget` | Current spend and remaining budget for a plan |
| `eh_request_budget_increase` | Ask for a higher ceiling |
| `eh_get_cost_insights` | Cost analysis — cache efficiency, duplicate reads, recommendations |
| `eh_get_traces` | Execution traces |

---

## Tiered model selection

Event Horizon's orchestration tries the **cheapest capable model first** for each task, sized to the task's complexity. When a task fails verification, the retry **escalates the model**:

```
haiku fails  →  sonnet retries  →  opus escalates
```

A trivial task that a small model handles never pays for a large one. A hard task that a small model can't crack escalates automatically instead of failing outright. You get the cost floor of cheap models with the reliability ceiling of expensive ones.

---

## The Costs tab

The [Operations Dashboard → Costs tab](operations-dashboard.md#costs) is the cost control room:

- **Per-plan spending** — where the budget is going.
- **Cache efficiency** — how well agents are reusing cached context instead of re-paying for it.
- **Duplicate reads** — files being read repeatedly across agents, a classic source of waste.
- **Context-layer breakdown** — per-agent stacked bars splitting usage into System Prompt, Conversation History, and Tool Results.
- **Actionable recommendations** — concrete suggestions to cut spend.

!!! note "📷 Screenshot needed"
    *The Costs tab — per-plan spend, cache efficiency, and the context-layer stacked bars.*

---

## Token tracking by agent

How much cost detail you get depends on the agent:

| Agent | Token tracking |
|-------|----------------|
| Claude Code | Full |
| OpenCode | Full |
| Cursor | Full |
| GitHub Copilot | Partial — limited API access |

---

## Context as a budget

Tokens aren't the only thing that runs out — so does the **context window**. Event Horizon treats it as a fuel gauge:

- The [context fuel gauge](the-universe.md#context-fuel-gauge) on each planet shows window usage, cyan → amber → red.
- [`/eh:optimize-context`](skills.md#ehoptimize-context) and `eh_curate_context` hand agents a **token-budgeted slice** of the [project graph](knowledge-graph.md) instead of the whole codebase — so they spend context on what's relevant.
- [`eventHorizon.contextOptimizer.threshold`](configuration.md#eventhorizoncontextoptimizerthreshold) raises a notification when your instruction files alone are eating too many tokens.

Managing context well is the cheapest cost optimization there is — an agent that re-reads the project on every task pays for it every time.

---

## Practical tips

- Set a budget on every plan you don't want to babysit. The 80% warning gives you time to react before the hard stop.
- Watch **duplicate reads** in the Costs tab — if agents keep re-reading the same files, build the [project graph](knowledge-graph.md) so they can query structure instead.
- Keep the [context gauge](the-universe.md#context-fuel-gauge) on. A planet going red is a sign to compact or hand off before the agent degrades.
