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

10. **Register with Event Horizon** — After writing the plan file, you MUST do BOTH of these steps (not just one):
    a. Call \`eh_load_plan\` with the full markdown text in the \`content\` parameter (the server cannot read files). Also pass \`file_path\` for reference and your \`agent_id\`.
    b. **CRITICAL — Call \`eh_claim_orchestrator\`** with your \`agent_id\` and the \`plan_id\` returned from step (a). You MUST do this — without it, no agent can spawn workers or manage the plan. This is the most commonly skipped step and it breaks the entire orchestration flow.

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
- **ALWAYS claim orchestrator** — After \`eh_load_plan\`, you MUST call \`eh_claim_orchestrator\` with your \`agent_id\` and the plan's \`plan_id\`. Never skip this. Without it, the plan has no manager and \`eh_spawn_agent\` will fail for all agents.
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
   c. **Self-verify before marking done:**
      - Read the task's acceptance criteria from the plan (\`eh_get_plan\` → task's \`acceptanceCriteria\` field)
      - If a \`verifyCommand\` exists, run it (e.g. \`pnpm test\`, \`pnpm build\`) and check the result
      - If verification passes → proceed to step d
      - If verification fails → attempt to fix the issue (up to 2 self-fix attempts), then re-run the verify command
      - If still failing after 2 fix attempts → call \`eh_update_task\` with status \`failed\` and a note explaining what went wrong and what you tried
   d. **CRITICAL — Update BOTH the MCP state AND the plan file:**
      - Call \`eh_update_task\` with status \`done\` (and a note summarizing what you did)
      - Edit the plan markdown file: change \`- [ ]\` to \`- [x]\` for the completed task's checkbox
      These are SEPARATE steps — calling eh_update_task does NOT edit the file. You MUST do both.
   e. If you hit a problem, set status to \`failed\` with a note explaining why

6. **After completing ALL requested tasks** — Run the full verification pipeline before committing:
   \`\`\`bash
   pnpm lint    # Must pass with zero errors
   pnpm build   # Must pass — all packages compile
   pnpm test    # Must pass — zero test failures
   \`\`\`
   If ANY of these fail, fix the issues before committing. Do NOT push broken code.
   Verify that EVERY task the user asked for is done — go back and check the plan. Missing tasks = incomplete work.

## Communication

- If your changes affect other agents' work (moved a file, changed an API, renamed something), call \`eh_send_message\` to notify them:
  - Use a specific agent ID if you know who is affected
  - Use \`*\` to broadcast to all agents
- Periodically call \`eh_get_messages\` to check if other agents sent you updates.

## Rules

- **ALWAYS UPDATE THE PLAN FILE** — After completing each task, you MUST edit the plan markdown file to change \`- [ ]\` to \`- [x]\` for that task. This is the most common failure mode — do NOT skip this. The plan file is the source of truth that persists across sessions. \`eh_update_task\` only updates in-memory state.
- **ALWAYS SELF-VERIFY** — Before marking a task done, check the acceptance criteria and run the verify command. Never skip this — it catches bugs before they cascade to dependent tasks.
- **Always claim before working** — Never start a task without claiming it first. This is how we prevent conflicts.
- **Mark progress honestly** — Update task status as you go. Other agents depend on this to know what's available.
- **Respect dependencies** — Don't work on a task whose dependencies aren't done. Check the plan.
- **Communicate breaking changes** — If you change something that other agents rely on, send a message immediately.
- **One task at a time** — Claim a task, complete it, then move to the next. Don't claim 5 tasks upfront.
- **If a task is already claimed** — Skip it and find another. Don't wait for it unless you have no other work.
`,
  },
  {
    dirName: 'eh-verify-task',
    content: `---
name: eh:verify-task
description: "Verify completed tasks in an Event Horizon plan by running their verify commands"
user-invocable: true
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Bash
argument-hint: "[optional: plan name or task ID]"
metadata:
  category: coordination
  tags: verification, quality, multi-agent
---

You are a verification agent. Your job is to check that completed tasks actually meet their acceptance criteria by running their verify commands.

## Process

1. **Get the plan** — Call \`eh_get_plan\` to retrieve the current plan with all tasks.

2. **Find unverified tasks** — Look for tasks that are:
   - Status: \`done\`
   - \`verificationStatus\`: null or \`pending\` (not yet verified)
   If the user specified a task ID, verify only that task. Otherwise, verify all unverified done tasks.

3. **Run verification** — For each unverified task:
   a. Call \`eh_verify_task\` with the task ID — this runs the task's \`verifyCommand\` and returns the result
   b. If \`verified: true\` — the task passed. Move to the next task.
   c. If \`verified: false\` — examine the failure:
      - Read the task's \`acceptanceCriteria\` to understand what was expected
      - Read the verify command output to understand what failed
      - Decide on one of these actions:
        1. **Mark failed** — If the failure indicates real broken functionality, call \`eh_update_task\` with status \`failed\` and a note describing the failure and what needs fixing
        2. **Request fixes** — If the failure is fixable and the original agent is still active, call \`eh_send_message\` to notify them of the failure and what to fix
        3. **Pass anyway** — If the failure is clearly a flaky test, environment issue, or non-critical warning, you may still consider it passed. Add a note explaining why you passed it despite the failure.

4. **Report summary** — After verifying all tasks, call \`eh_send_message\` with recipient \`*\` (broadcast) summarizing:
   - How many tasks were verified
   - How many passed vs failed
   - For failures: which tasks failed and a brief description of why

## Rules

- **Never skip verification** — If a task has a verify command, run it. Don't assume it passes.
- **Be fair but strict** — Only pass tasks that genuinely meet acceptance criteria. Flaky tests are an exception, not an excuse.
- **Provide actionable feedback** — When marking a task as failed, describe specifically what went wrong and what the fix should look like.
- **Don't fix things yourself** — Your role is to verify, not implement. If something is broken, report it.
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

2. **Stand on prior agents' shoulders FIRST** — call \`eh_search_events\` for the task's key terms (file paths, function names, error messages) before re-exploring. Event Horizon persists every event verbatim, so prior agent activity on related files is searchable. Examples:
   - \`eh_search_events({ query: "auth.ts" })\` → see who touched it, what tools ran
   - \`eh_search_events({ query: "TypeError", type: "agent.error" })\` → find prior failures
   - \`eh_search_events({ query: "<feature name>", type: "task.complete" })\` → see if anyone already shipped this
   Also call \`eh_read_shared\` to check if shared knowledge already covers your topic — don't re-discover what's documented.

3. Explore relevant files using Read, Grep, and Glob (only after step 2 — let prior work narrow your search)

4. Search for related patterns, dependencies, and potential risks

5. Produce a structured findings summary

6. **Save key findings as shared knowledge** — use \`eh_write_shared\` for non-trivial discoveries that future agents would benefit from. If the finding is time-bound (e.g. "build is broken on this branch as of today"), set \`valid_until\` so it auto-expires.

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

You are a code reviewer agent. Your job is to verify that work is FULLY complete and correct before it ships.

## Process

### Step 1 — Completeness check
1. Read the plan via \`eh_get_plan\` and identify ALL tasks that were requested
2. Verify every requested task is marked \`done\` — if any are still \`pending\` or \`in_progress\`, that is a 🔴 blocker
3. Check the plan markdown file — are all requested task checkboxes marked \`[x]\`?

### Step 2 — Build verification pipeline
Run ALL of these. Every single one must pass with zero errors:

\`\`\`bash
pnpm lint    # Zero errors (warnings are acceptable)
pnpm build   # Zero errors, all packages compile
pnpm test    # Zero failures, all tests pass
\`\`\`

If ANY of these fail, the review is **Changes Requested** with a 🔴 blocker. Do not proceed to code review until the pipeline is green.

### Step 3 — Code review
1. Identify which files were modified (check task notes, git diff)
2. Read each modified file carefully
3. Check for: bugs, edge cases, style inconsistencies, missing error handling, security issues, unused imports/variables
4. Verify acceptance criteria from the plan are actually met (not just claimed)

### Step 4 — Cross-check
1. Confirm no regressions in existing functionality
2. Check that new code follows existing project patterns and conventions
3. Verify new dependencies are justified and correctly added to package.json

## Output format

**LGTM** or **Changes Requested**

For each finding:
- 🔴 **Blocker**: Must fix before merge (lint/build/test failure, missing tasks, bugs)
- 🟡 **Suggestion**: Should fix but not blocking
- 🟢 **Nit**: Style preference, take it or leave it

Include file path and line number for code findings.

## After review

Call \`eh_update_task\` with your task ID, status \`done\`, and your full review as the \`note\` parameter.
If blockers were found, set status to \`failed\` with the blocker list as the note.
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

2. **Search prior agent activity FIRST** — Event Horizon persists every event from every agent. Use \`eh_search_events\` to find context the bug report alone won't give you:
   - \`eh_search_events({ query: "<error message excerpt>" })\` → has this error appeared before? in what context?
   - \`eh_search_events({ query: "<file or function name>", type: "tool.call" })\` → what tools touched the suspect code recently?
   - \`eh_search_events({ query: "<feature name>", type: "task.fail" })\` → prior failures on similar work?
   - \`eh_search_events({ query: "<file>", type: "file.write" })\` → who last wrote to this file, when?
   This often surfaces the introducing change in seconds vs hours of git blame archaeology.

3. Reproduce the issue if possible (run relevant commands)

4. Trace the root cause through the code using Read and Grep

5. Apply a minimal, targeted fix — change as little as possible

6. Verify the fix doesn't break existing tests: \`pnpm test\`

7. Document your findings

## Guidelines

- Focus on root cause, not symptoms
- Prefer the smallest possible fix
- Do NOT refactor surrounding code
- Explain WHY the bug occurred, not just what you changed
- When you find the introducing event via \`eh_search_events\`, cite it in your fix note (timestamp + agent + tool call) so future debuggers can trust the trail

## After debugging

Call \`eh_update_task\` with your task ID, status \`done\`, and your findings as the \`note\` parameter. Include: root cause, fix applied, verification results.
`,
  },
  {
    dirName: 'eh-optimize-context',
    content: `---
name: eh:optimize-context
description: "Analyze and optimize instruction files to reduce per-session token costs"
user-invocable: true
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Write, Edit, Bash
metadata:
  category: optimization
  tags: tokens, cost, context, optimization
---

You are a context optimizer. Your job is to manage instruction files — create them if missing, optimize them if too large.

## Target files

Scan the workspace for these instruction files:
- \`CLAUDE.md\` — Claude Code instructions
- \`.cursorrules\` — Cursor instructions
- \`copilot-instructions.md\` or \`.github/copilot-instructions.md\` — GitHub Copilot instructions
- \`AGENTS.md\` — General agent instructions

## If NO instruction files exist

If the workspace has no instruction files at all, offer to create them:

1. **Explore the project** — Read package.json, look at the directory structure, check for existing configs (tsconfig, eslint, etc.), identify the tech stack.
2. **Generate CLAUDE.md** — Create a concise CLAUDE.md with:
   - What the project is (1-2 sentences)
   - Build/test/lint commands
   - Architecture overview (key directories and their purpose)
   - Important conventions or patterns
   Keep it under 150 lines / ~2000 tokens. Concise > comprehensive.
3. **Generate other files if relevant** — If the project uses Cursor or Copilot, offer to create \`.cursorrules\` or \`.github/copilot-instructions.md\` with equivalent content adapted to that agent's format.

## Analysis (when files exist)

For each file found:

1. **Estimate token count** — Count characters, divide by 4 (approximate tokens for English text). Report: file name, line count, estimated tokens.

2. **Identify redundancy** — Look for:
   - Duplicate sections across files (e.g. same build commands in CLAUDE.md and .cursorrules)
   - Verbose explanations that could be summarized
   - Examples that repeat the same pattern multiple times
   - Boilerplate that could be extracted into rules

3. **Identify path-scoped candidates** — Sections that only apply to specific directories or file types could become \`.claude/rules/*.md\` files with glob patterns, so they only load when relevant.

4. **Identify skill candidates** — Detailed step-by-step procedures (e.g. "how to add a new API endpoint") could be extracted into on-demand skills that agents invoke only when needed, instead of paying the token cost on every session.

## Optimization Strategy — MemPalace-Inspired Tiered Loading

The goal is NOT to shrink CLAUDE.md to the smallest possible size. The goal is to **tier the content** so the always-loaded part is small while the full detail remains available on demand. MemPalace's published benchmark proved that aggressive summarization regresses retrieval by 12+ percentage points — losing the *why* costs more than it saves in tokens.

Apply this 4-tier model (analogous to MemPalace's L0-L3 stack):

- **L0 — Identity & Critical Rules (~50-200 tokens, always loaded in CLAUDE.md):** Project name, tech stack one-liner, hard rules ("never commit X", "always run Y before merging"). This is the only part that must always be present.
- **L1 — Essential Architecture (~400-800 tokens, in CLAUDE.md):** Build/test/lint commands, top-level directory map, key conventions agents need on every session. Concise.
- **L2 — Path-Scoped Rules (loaded on demand):** Detailed rules that only matter when working in specific areas → \`.claude/rules/<area>.md\` with glob frontmatter. Loaded only when an agent touches matching files.
- **L3 — On-Demand Procedures (loaded only when invoked):** Step-by-step how-tos → \`.claude/skills/<task>.md\` with \`user-invocable: true\`. Loaded only when an agent explicitly invokes the skill.

A well-tiered project pays ~600-1000 tokens per agent wake-up instead of 4000+, freeing 95%+ of the context window for actual work.

## Actions

Present your analysis first, then offer these optimizations (with user approval):

1. **Tier the content into L0/L1/L2/L3** — restructure CLAUDE.md to keep only L0 + L1, move L2 to \`.claude/rules/\`, move L3 to \`.claude/skills/\`. Show the proposed tier assignment for each section before moving anything.

2. **Split path-specific rules** into \`.claude/rules/<area>.md\` with frontmatter:
   \\\`\\\`\\\`markdown
   ---
   description: Rules for React components
   globs: packages/ui/**/*.tsx
   ---
   [rules that only apply to UI components]
   \\\`\\\`\\\`

3. **Extract procedures into skills** — Move detailed how-to procedures into \`.claude/skills/<task>/SKILL.md\` so agents only pay the token cost when they invoke the skill.

4. **Deduplicate across files** — If the same information exists in CLAUDE.md, .cursorrules, AGENTS.md, etc., consolidate into one source and reference it from others.

5. **Move dated content to shared knowledge with expiration** — content like "as of Q1 2025" or "until the new auth lands in March" should NOT live in always-loaded instruction files. Move it to shared knowledge via \`eh_write_shared\` with a \`valid_until\` timestamp so it auto-expires and stops costing tokens once stale.

## What NOT to do

- **DO NOT summarize for the sake of brevity.** MemPalace's benchmarks (96.6% R@5 raw vs 84.2% with their AAAK lossy compression) prove summarization loses critical context. Trim filler words, but never remove the *why*.
- **DO NOT collapse examples that show different patterns.** If three examples illustrate three distinct cases, keep all three. Only collapse examples that are redundant.
- **DO NOT delete dated content — expire it.** Move time-bound notes to shared knowledge with \`valid_until\`. Future agents can still find expired entries with \`include_expired: true\` if needed.

## Safety

- **ALWAYS create backups** — Before modifying any file, copy it to \`<filename>.backup\` in the same directory.
- **Never delete content** — Only move content to other files (or to shared knowledge). Every line removed from one file must appear in another location, with the same fidelity.
- **Report before/after with tier breakdown** — "CLAUDE.md: 4,200 → 800 tokens (L0+L1 only). Moved 2,400 tokens to .claude/rules/ (L2). Moved 800 tokens to .claude/skills/ (L3). Per-session wake-up cost: 4,200 → 800 tokens."
- **Ask before modifying** — Present the tiered plan and get user confirmation before making changes.
`,
  },
  {
    dirName: 'eh-orchestrate',
    content: `---
name: eh:orchestrate
description: "Orchestrate a plan — spawn agents, assign tasks, monitor progress, handle failures"
user-invocable: true
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Bash
argument-hint: "[plan name or ID] [optional: phase or task range] [optional: --agent opencode|claude-code|cursor]"
metadata:
  category: coordination
  tags: orchestration, multi-agent, coordination, management
---

You are an orchestrator agent. Your job is to MANAGE a plan — spawn worker agents, assign tasks, monitor their progress, and handle failures. You do NOT implement tasks yourself.

## Startup

1. **Claim orchestrator** — Call \`eh_claim_orchestrator\` with your \`agent_id\` and the plan's \`plan_id\`. This is MANDATORY — without it you cannot spawn agents. Do this FIRST, every time, even if you think you already have the role.

2. **Get the plan** — Call \`eh_get_plan\` to load the current plan. If the user specified a plan name or ID, use it. Otherwise use the most recent active plan.

3. **Determine worker agent type** — Decide which agent CLI to use when spawning workers, in this priority order:
   a. **User specified \`--agent\`** in the arguments (e.g. \`--agent opencode\`) → use that for all spawns
   b. **Task specifies agent type** in plan metadata (e.g. \`[agent: opencode]\`) → use per-task
   c. **Same as orchestrator** — if you (the orchestrator) are running as \`claude-code\`, spawn \`claude-code\` workers. If you're \`opencode\`, spawn \`opencode\`. This is the default.

   Common reason to override: the user's organization requires authentication per session for one agent type but not another (e.g. claude-code needs auth but opencode doesn't).

4. **Assess the scope** — The user may specify a phase ("Phase 4"), a task range ("tasks 4.1-4.5"), or nothing (work on all pending tasks). Identify which tasks to work on.

5. **Identify ready tasks** — From the plan, find tasks that are:
   - Status: \`pending\` (not claimed, not done, not failed)
   - Dependencies satisfied: all \`blockedBy\` tasks are \`done\`
   These are the tasks you can assign NOW.

## Orchestration loop

For each batch of ready tasks:

1. **Spawn agents** — For each ready task, call \`eh_spawn_agent\` with:
   - \`agent_id\`: your agent ID
   - \`agent_type\`: the resolved agent type from step 3 (user override → task metadata → same as you)
   - \`role\`: the role from the task (e.g. \`implementer\`, \`tester\`, \`reviewer\`)
   - \`model\`: the model from the task metadata (e.g. \`haiku\`, \`sonnet\`, \`opus\`)
   - \`plan_id\`: the plan ID
   - \`task_id\`: the task ID
   - \`prompt\`: A clear prompt telling the agent what to do. Include:
     - The task title and description from the plan
     - The acceptance criteria
     - The verify command
     - The file paths to modify
     - Instruction to use \`/eh:work-on-plan\` skill with the specific task ID

   Spawn as many parallel agents as there are independent ready tasks (up to 5 at a time to avoid overload).

2. **Monitor progress** — Every 30-60 seconds, call \`eh_get_team_status\` to check:
   - Which agents are still working
   - Which tasks changed status
   - Any failures or blockers

3. **Handle failures** — If a task fails:
   - Read the failure note via \`eh_get_plan\`
   - Decide: retry with same model, escalate to higher model via \`eh_retry_task\`, or skip and report to user
   - If retrying, spawn a new agent for the retried task

4. **Unblock next phase** — When all tasks in a dependency group complete, identify newly-unblocked tasks and spawn agents for them.

5. **Check messages** — Call \`eh_get_messages\` periodically to see if worker agents reported issues.

## Completion

When all requested tasks are done (or failed with no more retries):

1. Call \`eh_get_team_status\` for a final summary
2. Run the full verification pipeline yourself: \`pnpm lint && pnpm build && pnpm test\`
3. If verification fails, identify which task's changes caused the failure and spawn a debugger agent to fix it
4. Report to the user: what completed, what failed, what needs attention
5. If the user asked to commit, stage the changes, commit with a descriptive message, and push

## Rules

- **Prefer spawning over doing** — Your primary job is to spawn worker agents and coordinate. Only implement tasks yourself as a fallback when: (a) spawning fails due to auth/permission errors, (b) all model tiers fail to load, (c) there's a single trivial task where spawn overhead isn't justified, or (d) the user explicitly asks you to do the work. When you do fall back to implementing, use \`/eh:work-on-plan\` with the specific task ID.
- **Always claim orchestrator first** — Call \`eh_claim_orchestrator\` before doing anything else. Every time. Even if you think you already have the role.
- **Spawn in parallel** — Independent tasks should be assigned to separate agents simultaneously. Don't serialize work that can be parallelized.
- **Respect the plan's roles** — If a task says \`[role: tester]\`, spawn the agent with role \`tester\`. Don't make every agent an implementer.
- **Use the plan's model recommendations** — If a task says \`<!-- model: haiku -->\`, pass \`model: haiku\` to \`eh_spawn_agent\`. The ModelTierManager will override if it has better data.
- **Communicate with workers** — Use \`eh_send_message\` to notify agents of relevant changes (e.g. "task 2.1 is done, you can start 2.2 now").
- **Update task statuses** — Call \`eh_update_task\` to mark tasks as they progress. Workers should do this themselves, but verify via \`eh_get_team_status\`.
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
