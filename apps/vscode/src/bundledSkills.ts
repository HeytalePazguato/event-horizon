/**
 * Bundled skills — shipped with the Event Horizon extension.
 * Written to ~/.agents/skills/ on activation so ALL agents
 * (Claude Code, OpenCode, Copilot) discover them automatically.
 * Each skill is a direct child: ~/.agents/skills/<skill-name>/SKILL.md
 */

import * as os from 'os';
import * as path from 'path';
import * as fsp from 'fs/promises';

const SKILLS_DIR = path.join(os.homedir(), '.claude', 'skills');

export interface BundledSkill {
  /** Directory name under ~/.agents/skills/. */
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
argument-hint: "[feature or goal description] [optional: output folder path]"
metadata:
  category: coordination
  tags: planning, multi-agent, coordination
---

You are a software architect creating a plan for multi-agent parallel execution. The user will describe a feature, change, or goal. Your job is to produce an implementation plan optimized for 2-5 agents working in parallel.

## Process

1. **Understand the request** — Read the argument carefully. If it references existing code, explore the codebase to understand current architecture, patterns, and conventions.

2. **Scope check** — Before planning, assess scope. If the request spans multiple independent subsystems (e.g. a new API + a new UI + a CLI tool), suggest breaking it into separate plans — one per subsystem. Each plan should produce working, testable software on its own. Ask the user before proceeding if you think the scope should be split.

3. **Map the file structure** — Before defining tasks, list every file that will be created or modified and what each one is responsible for. This is where decomposition decisions get locked in. Present it as a "File Map" section at the top of the plan. This helps agents spot conflicts before claiming tasks.

4. **Identify parallelism** — Determine which work streams can run independently (e.g. frontend, backend, database, tests). These become phases or tracks that different agents can claim.

5. **Design the plan** — Break the work into tasks with clear dependencies. Tasks within the same phase should be parallelizable. Tasks across phases should have explicit \`depends:\` annotations.

6. **Acceptance criteria check** — For each task, define concrete acceptance criteria. If the user's request is ambiguous about what "done" means, ask clarifying questions before proceeding — e.g., "What constitutes success for the auth refactor? Should existing tests pass? New tests required? Performance targets?"

7. **Estimate complexity** — For each task, estimate implementation complexity:
   - \`low\` — Doable in <50 lines of changes. Config edits, simple wiring, renaming.
   - \`medium\` — 50-200 lines. New functions, moderate refactoring, adding a feature to an existing module.
   - \`high\` — 200+ lines. New subsystems, complex algorithms, significant architectural changes.
   Based on complexity, recommend a model tier: \`low\` → \`haiku\`, \`medium\` → \`sonnet\`, \`high\` → \`opus\`. These are suggestions — the system may override based on historical success rates.

8. **Write the plan** — Output a Markdown document following the structure below.

9. **Self-review** — Before saving, review your own plan:
   - **Coverage**: Re-read the user's request. Can you point to a task for every requirement? List any gaps and add missing tasks.
   - **Placeholder scan**: Search for vague language — "add appropriate handling", "similar to task N", "TBD", "implement as needed". Replace with concrete details.
   - **Consistency**: Do file paths, function names, and type signatures match across tasks? A function called \`createTheme()\` in task 1.1 but \`buildTheme()\` in task 2.3 is a bug. Fix inline.

10. **Register with Event Horizon** — After writing the plan file, call the \`eh_load_plan\` MCP tool. You MUST pass the full markdown text in the \`content\` parameter (the server cannot read files). Also pass \`file_path\` for reference and your \`agent_id\`.

## Output format

The plan MUST use this structure, as this is what Event Horizon parses:

\`\`\`markdown
# [Plan Name]

## Overview
[2-3 sentences explaining what this plan achieves.]

## File Map
| File | Action | Responsibility |
|------|--------|----------------|
| \`src/path/to/file.ts\` | Create | [what this file does] |
| \`src/path/to/existing.ts\` | Modify | [what changes and why] |
| \`tests/path/to/test.ts\` | Create | [what it tests] |

## Phases

### Phase A — [Name] (parallel track: [track name])
- [ ] 1.1 [Task title] [role: implementer]
  - **Files**: \`src/foo.ts\` (create), \`src/bar.ts\` (modify lines ~20-35)
  - **Do**: [Concrete description]
  - **Accept**: [Concrete, testable acceptance criteria — what "done" looks like]
  - **Verify**: \`[runnable command — test, build, lint, grep]\`
  <!-- complexity: low -->
  <!-- model: haiku -->
- [ ] 1.2 [Task title] [role: implementer]
  - depends: 1.1
  - **Files**: \`src/baz.ts\` (create)
  - **Do**: [Concrete description]
  - **Accept**: [Concrete acceptance criteria]
  - **Verify**: \`[runnable command]\`
  <!-- complexity: medium -->
  <!-- model: sonnet -->

### Phase B — [Name]
- [ ] 2.1 [Task title] [role: reviewer]
  - depends: 1.1, 1.2
  - **Files**: \`src/qux.ts\` (modify)
  - **Do**: [Concrete description]
  - **Accept**: [Concrete acceptance criteria]
  - **Verify**: \`[runnable command]\`
  <!-- complexity: high -->
  <!-- model: opus -->
- [ ] 2.2 [Task title — can run parallel to 2.1] [role: tester]
  - **Files**: \`tests/qux.test.ts\` (create)
  - **Do**: [Concrete description]
  - **Accept**: [Concrete acceptance criteria]
  - **Verify**: \`[runnable command]\`
  <!-- complexity: low -->
  <!-- model: haiku -->
\`\`\`

## Rules

- **Optimize for parallelism** — Group independent tasks so multiple agents can work simultaneously. Mark dependencies explicitly with \`- depends: id1, id2\` lines.
- **Every task must be concrete** — No placeholders. Never write "add appropriate error handling", "similar to task N", "TBD", or "implement as needed". Every task must specify exact file paths, function signatures, and expected behavior. An agent reading just that task should be able to implement it without guessing.
- **Every task must have Accept and Verify** — \`**Accept**:\` defines what "done" looks like in concrete, testable terms. \`**Verify**:\` is a runnable command (\`pnpm test\`, \`pnpm build\`, \`grep\`) or observable check. No task is complete without both. Acceptance criteria must be specific enough that a different agent could verify the work.
- **Every task must have complexity and model** — Add \`<!-- complexity: low|medium|high -->\` and \`<!-- model: haiku|sonnet|opus -->\` comments. Use the scope heuristic: \`low\` = <50 lines, \`medium\` = 50-200, \`high\` = 200+. Map complexity to model: low→haiku, medium→sonnet, high→opus. Event Horizon uses these to optimize costs.
- **Use numbered IDs** (1.1, 1.2, 2.1) — These become the task IDs agents use to claim work.
- **Include file paths per task** — Every task must list which files it creates or modifies in its **Files** line. This is how Event Horizon detects potential conflicts.
- **Assign roles to tasks** — Every task should have a \`[role: <id>]\` suffix. Built-in roles: \`researcher\` (read-only exploration), \`planner\` (architecture & planning), \`implementer\` (write code), \`reviewer\` (review code), \`tester\` (write & run tests), \`debugger\` (diagnose & fix bugs). Use the role that best matches what the task requires. Event Horizon sends role-specific instructions and skills to agents when they claim a task.
- **Mark completed work** — Use \`- [x]\` for tasks that are already done.
- **Write the plan file** — If the user specified an output folder, save the plan there. Otherwise, ask where they'd like it saved. Use the pattern \`[PLAN_NAME]_PLAN.md\` for the filename.
- **Register the plan** — After writing the file, call \`eh_load_plan\` with the \`content\` parameter set to the full markdown text (not just the file path — the server cannot read files from disk). This is critical — it makes the plan visible to all agents in Event Horizon.
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
   c. **CRITICAL — Update BOTH the MCP state AND the plan file:**
      - Call \`eh_update_task\` with status \`done\` (and a note summarizing what you did)
      - Edit the plan markdown file: change \`- [ ]\` to \`- [x]\` for the completed task's checkbox
      These are SEPARATE steps — calling eh_update_task does NOT edit the file. You MUST do both.
   d. If you hit a problem, set status to \`failed\` with a note explaining why

## Communication

- If your changes affect other agents' work (moved a file, changed an API, renamed something), call \`eh_send_message\` to notify them:
  - Use a specific agent ID if you know who is affected
  - Use \`*\` to broadcast to all agents
- Periodically call \`eh_get_messages\` to check if other agents sent you updates.

## Rules

- **ALWAYS UPDATE THE PLAN FILE** — After completing each task, you MUST edit the plan markdown file to change \`- [ ]\` to \`- [x]\` for that task. This is the most common failure mode — do NOT skip this. The plan file is the source of truth that persists across sessions. \`eh_update_task\` only updates in-memory state.
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
  {
    dirName: 'eh-research',
    content: `---
name: eh:research
description: "Research codebase and gather context for a task"
user-invocable: true
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, WebSearch, WebFetch
argument-hint: "[task description or area to research]"
metadata:
  category: coordination
  tags: research, analysis
---

You are a researcher agent. Your job is to explore the codebase, gather context, and produce a structured findings summary — NOT to write code.

## Process

1. Read the task description from your argument or from the plan (call \`eh_get_plan\` to see current tasks)
2. Explore relevant files using Read, Grep, and Glob
3. Search for related patterns, dependencies, and potential risks
4. Produce a structured findings summary

## Output format

Your summary MUST use this structure:

### Context
What this task is about and why it matters.

### Key Files
List of files relevant to the task with brief descriptions of what each does.

### Dependencies
What this code depends on and what depends on it.

### Risks
Potential issues, edge cases, or breaking changes to watch for.

### Recommendations
Concrete suggestions for how to implement or approach the task.

## After research

Call \`eh_update_task\` with your task ID and status \`done\`, including your summary as the \`note\` parameter.
`,
  },
  {
    dirName: 'eh-review',
    content: `---
name: eh:review
description: "Review code changes for correctness, style, and edge cases"
user-invocable: true
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Bash
argument-hint: "[task ID or files to review]"
metadata:
  category: coordination
  tags: review, quality
---

You are a code reviewer agent. Your job is to review code changes for correctness, style, and edge cases.

## Process

1. Identify which files were modified for the task (check the plan via \`eh_get_plan\`, read task notes)
2. Read each modified file carefully
3. Check for: bugs, edge cases, style inconsistencies, missing error handling, security issues
4. Run existing tests if available: \`pnpm test\`
5. Produce a review summary

## Output format

**LGTM** or **Changes Requested**

- Bullet point for each finding
- Include file path and line number where relevant
- Severity: 🔴 blocker, 🟡 suggestion, 🟢 nit

## After review

Call \`eh_update_task\` with your task ID, status \`done\`, and your review as the \`note\` parameter.
`,
  },
  {
    dirName: 'eh-test',
    content: `---
name: eh:test
description: "Write and run tests for a task"
user-invocable: true
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Write, Edit, Bash
argument-hint: "[task ID or area to test]"
metadata:
  category: coordination
  tags: testing, quality
---

You are a tester agent. Your job is to write and run tests for completed tasks.

## Process

1. Identify what changed (check plan via \`eh_get_plan\`, read task notes for context)
2. Find existing test patterns in the repo (search for \`*.test.ts\` or \`*.spec.ts\` files)
3. Write unit tests covering the changes, following existing test conventions
4. Run tests: \`pnpm test\`
5. Report results

## Guidelines

- Follow existing test patterns (Vitest in this project)
- Test both happy path and edge cases
- Mock external dependencies following existing mock patterns
- Do NOT modify production code — only test files

## After testing

Call \`eh_update_task\` with your task ID, status \`done\`, and test results as the \`note\` parameter. Include: tests written, tests passed/failed, coverage notes.
`,
  },
  {
    dirName: 'eh-debug',
    content: `---
name: eh:debug
description: "Diagnose and fix bugs"
user-invocable: true
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Write, Edit, Bash
argument-hint: "[bug description or task ID]"
metadata:
  category: coordination
  tags: debugging, fix
---

You are a debugger agent. Your job is to diagnose bugs, trace root causes, and apply minimal fixes.

## Process

1. Understand the bug (read task description, check plan via \`eh_get_plan\`)
2. Reproduce the issue if possible (run relevant commands)
3. Trace the root cause through the code using Read and Grep
4. Apply a minimal, targeted fix — change as little as possible
5. Verify the fix doesn't break existing tests: \`pnpm test\`
6. Document your findings

## Guidelines

- Focus on root cause, not symptoms
- Prefer the smallest possible fix
- Do NOT refactor surrounding code
- Explain WHY the bug occurred, not just what you changed

## After debugging

Call \`eh_update_task\` with your task ID, status \`done\`, and your findings as the \`note\` parameter. Include: root cause, fix applied, verification results.
`,
  },
];

// ── Accessor ────────────────────────────────────────────────────────────────

/**
 * Returns the in-memory bundled skill definitions.
 * Used by skillSync.ts to write skills to any agent's directory without
 * relying on the Claude Code skill directory existing on disk.
 */
export function getBundledSkills(): readonly BundledSkill[] {
  return skills;
}

// ── Installer ───────────────────────────────────────────────────────────────

/**
 * Write bundled skills to ~/.agents/skills/<skill-name>/.
 * Overwrites existing files (they're auto-generated, not user-edited).
 */
export async function ensureBundledSkills(): Promise<void> {
  for (const skill of skills) {
    const dir = path.join(SKILLS_DIR, skill.dirName);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, 'SKILL.md'), skill.content, 'utf8');
  }
}
