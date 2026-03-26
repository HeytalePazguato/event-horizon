/**
 * Bundled skills — shipped with the Event Horizon extension.
 * Written to ~/.agents/skills/event-horizon/ on activation so ALL agents
 * (Claude Code, OpenCode, Copilot) discover them automatically.
 */

import * as os from 'os';
import * as path from 'path';
import * as fsp from 'fs/promises';

const SKILLS_DIR = path.join(os.homedir(), '.agents', 'skills', 'event-horizon');

interface BundledSkill {
  /** Directory name under event-horizon/. */
  dirName: string;
  /** SKILL.md content. */
  content: string;
}

// ── Skill definitions ───────────────────────────────────────────────────────

const skills: BundledSkill[] = [
  {
    dirName: 'eh-create-plan',
    content: `---
name: eh:create-plan
description: "Create a multi-agent coordination plan and register it with Event Horizon"
user-invocable: true
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Write, Edit
argument-hint: "[feature or goal description]"
metadata:
  category: coordination
  tags: planning, multi-agent, coordination
---

You are a software architect creating a plan for multi-agent parallel execution. The user will describe a feature, change, or goal. Your job is to produce an implementation plan optimized for 2-5 agents working in parallel.

## Process

1. **Understand the request** — Read the argument carefully. If it references existing code, explore the codebase to understand current architecture, patterns, and conventions.

2. **Identify parallelism** — Determine which work streams can run independently (e.g. frontend, backend, database, tests). These become phases or tracks that different agents can claim.

3. **Design the plan** — Break the work into tasks with clear dependencies. Tasks within the same phase should be parallelizable. Tasks across phases should have explicit \`depends:\` annotations.

4. **Write the plan** — Output a Markdown document following the structure below.

5. **Register with Event Horizon** — After writing the plan file, call the \`eh_load_plan\` MCP tool with the plan's markdown content so agents can discover and claim tasks.

## Output format

The plan MUST use this checklist structure in its completion section, as this is what Event Horizon parses:

\`\`\`markdown
# [Plan Name]

## Overview
[2-3 sentences explaining what this plan achieves.]

## Phases

### Phase A — [Name] (parallel track: [track name])
- [ ] 1.1 [Task title — self-contained description]
- [ ] 1.2 [Task title]
  - depends: 1.1

### Phase B — [Name]
- [ ] 2.1 [Task title]
  - depends: 1.1, 1.2
- [ ] 2.2 [Task title — can run parallel to 2.1]
\`\`\`

## Rules

- **Optimize for parallelism** — Group independent tasks so multiple agents can work simultaneously. Mark dependencies explicitly with \`- depends: id1, id2\` lines.
- **Every task must be self-contained** — An agent reading just that task should know exactly what to build, which files to touch, and what the expected behavior is.
- **Use numbered IDs** (1.1, 1.2, 2.1) — These become the task IDs agents use to claim work.
- **Include file paths** — Always specify which files each task modifies or creates.
- **Mark completed work** — Use \`- [x]\` for tasks that are already done.
- **Write the plan to docs/** — Save as \`docs/[PLAN_NAME]_PLAN.md\`.
- **Register the plan** — After writing the file, call \`eh_load_plan\` with the markdown content. This is critical — it makes the plan visible to all agents in Event Horizon.
`,
  },
  {
    dirName: 'eh-work-on-plan',
    content: `---
name: eh:work-on-plan
description: "Claim and execute tasks from an Event Horizon coordination plan"
user-invocable: true
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Write, Edit, Bash
argument-hint: "[plan name] [phase or task]"
metadata:
  category: coordination
  tags: execution, multi-agent, coordination
---

You are an implementation agent assigned to work on a shared plan coordinated through Event Horizon.

## Startup sequence

1. **Check messages** — Call \`eh_get_messages\` to see if Event Horizon sent you any notifications about active plans.

2. **Get the plan** — Call \`eh_get_plan\` to see the current shared plan with all tasks, their statuses, and who is working on what.

3. **Parse the argument** — The user specified which part of the plan to work on. This could be:
   - A plan name and phase: "Backend Plan Phase 2"
   - A specific task ID: "task 2.3"
   - A general area: "work on the API endpoints"
   Match this to the tasks in the plan.

4. **Claim your tasks** — Call \`eh_claim_task\` for each task you will work on. This prevents other agents from picking the same work. If a task is blocked by dependencies, check if those are done first.

5. **Start working** — For each claimed task:
   a. Call \`eh_update_task\` with status \`in_progress\`
   b. Implement the task
   c. Call \`eh_update_task\` with status \`done\` (and a note summarizing what you did)
   d. If you hit a problem, set status to \`failed\` with a note explaining why

## Communication

- If your changes affect other agents' work (moved a file, changed an API, renamed something), call \`eh_send_message\` to notify them:
  - Use a specific agent ID if you know who is affected
  - Use \`*\` to broadcast to all agents
- Periodically call \`eh_get_messages\` to check if other agents sent you updates.

## Rules

- **Always claim before working** — Never start a task without claiming it first. This is how we prevent conflicts.
- **Mark progress honestly** — Update task status as you go. Other agents depend on this to know what's available.
- **Respect dependencies** — Don't work on a task whose dependencies aren't done. Check the plan.
- **Communicate breaking changes** — If you change something that other agents rely on, send a message immediately.
- **One task at a time** — Claim a task, complete it, then move to the next. Don't claim 5 tasks upfront.
- **If a task is already claimed** — Skip it and find another. Don't wait for it unless you have no other work.
`,
  },
  {
    dirName: 'eh-plan-status',
    content: `---
name: eh:plan-status
description: "Show the status of all active Event Horizon coordination plans"
user-invocable: true
disable-model-invocation: true
metadata:
  category: coordination
  tags: status, multi-agent, coordination
---

Show the current status of the active coordination plan in Event Horizon.

## Process

1. Call \`eh_get_plan\` to retrieve the current plan.

2. If no plan is loaded, tell the user: "No plan is currently active. Use /eh:create-plan to create one."

3. If a plan exists, present a clear summary:

   **[Plan Name]**
   Source: \`[source file]\`
   Last updated: [time ago]

   Progress: [done]/[total] tasks ([percentage]%)

   | Status      | Count |
   |-------------|-------|
   | Done        | N     |
   | In Progress | N     |
   | Claimed     | N     |
   | Pending     | N     |
   | Blocked     | N     |
   | Failed      | N     |

   **Active agents:**
   - [Agent name]: working on [task id] — [task title]
   - [Agent name]: working on [task id] — [task title]

   **Blocked tasks** (waiting on dependencies):
   - [task id] [title] — blocked by: [dep ids]

   **Available tasks** (pending, ready to claim):
   - [task id] [title]

4. Also call \`eh_list_agents\` to show which agents are currently connected.

5. Call \`eh_get_messages\` to check if there are any unread messages for context.
`,
  },
];

// ── Installer ───────────────────────────────────────────────────────────────

/**
 * Write bundled skills to ~/.agents/skills/event-horizon/.
 * Overwrites existing files (they're auto-generated, not user-edited).
 */
export async function ensureBundledSkills(): Promise<void> {
  for (const skill of skills) {
    const dir = path.join(SKILLS_DIR, skill.dirName);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, 'SKILL.md'), skill.content, 'utf8');
  }
}
