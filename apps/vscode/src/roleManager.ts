/**
 * Role Manager — defines and assigns roles to AI coding agents.
 * Each role carries a skill set and instructions that shape agent behaviour.
 * Built-in roles are always available; custom roles can be added at runtime.
 */

// ── Data model ──────────────────────────────────────────────────────────────

export interface RoleDefinition {
  id: string;
  name: string;
  description: string;
  skills: string[];
  instructions: string;
  builtIn: boolean;
}

export interface RoleAssignment {
  roleId: string;
  agentType: string | null;
  agentId: string | null;
}

// ── Built-in roles ─────────────────────────────────────────────────────────

const BUILT_IN_ROLES: RoleDefinition[] = [
  {
    id: 'researcher',
    name: 'Researcher',
    description: 'Explores codebase, reads docs, gathers context, investigates issues before implementation begins.',
    skills: ['eh-research'],
    instructions: 'You are acting as a researcher. Focus on understanding the codebase, reading relevant files, and producing a summary of findings. Do NOT write code — only read and analyze.',
    builtIn: true,
  },
  {
    id: 'planner',
    name: 'Planner',
    description: 'Creates implementation plans, designs architecture, breaks work into parallelizable tasks.',
    skills: ['eh-create-plan'],
    instructions: 'You are acting as a planner. Analyze the requirements and produce a detailed implementation plan optimized for parallel agent execution. Use /eh:create-plan.',
    builtIn: true,
  },
  {
    id: 'implementer',
    name: 'Implementer',
    description: 'Writes code, implements features and changes according to plan tasks.',
    skills: ['eh-work-on-plan'],
    instructions: 'You are acting as an implementer. Claim a task from the plan using eh_claim_task, implement it, then mark it done. Focus on writing clean, correct code.',
    builtIn: true,
  },
  {
    id: 'reviewer',
    name: 'Reviewer',
    description: 'Reviews code changes, checks for bugs, validates build/lint/test pass, ensures all requested tasks are completed.',
    skills: ['eh-review'],
    instructions: 'You are acting as a reviewer. Your job is to verify that work is FULLY complete and correct before approving it. You MUST: (1) Check that ALL tasks the user requested are done — not just some. (2) Run the full verification pipeline: `pnpm lint`, `pnpm build`, `pnpm test` — all three must pass with zero errors. (3) Read the code changes for correctness, edge cases, and adherence to project conventions. (4) Verify acceptance criteria are met for each task. (5) If any check fails, report it as a blocker — do NOT approve partial work.',
    builtIn: true,
  },
  {
    id: 'tester',
    name: 'Tester',
    description: 'Writes and runs tests, validates functionality, reports test coverage.',
    skills: ['eh-test'],
    instructions: 'You are acting as a tester. Write unit/integration tests for the assigned task, run them, and report results. Focus on edge cases and regression coverage.',
    builtIn: true,
  },
  {
    id: 'debugger',
    name: 'Debugger',
    description: 'Diagnoses bugs, traces errors, identifies root causes, and applies fixes.',
    skills: ['eh-debug'],
    instructions: 'You are acting as a debugger. Investigate the reported issue, trace the root cause, and apply a minimal fix. Document your findings as a task note.',
    builtIn: true,
  },
  {
    id: 'orchestrator',
    name: 'Orchestrator',
    description: 'Decomposes goals into plans, spawns workers, monitors team progress, synthesizes results.',
    skills: ['eh-create-plan', 'eh-plan-status'],
    instructions: `You are acting as the orchestrator — the central coordinator for a multi-agent team.

## CRITICAL: How to spawn agents

When calling \`eh_spawn_agent\`, you MUST provide these parameters:
- \`agent_id\`: YOUR own agent/session ID (the orchestrator)
- \`agent_type\`: The CLI runtime — must be \`"claude-code"\`, \`"opencode"\`, or \`"cursor"\`. This is NOT a role name. If unsure, use \`"claude-code"\`.
- \`prompt\`: A DETAILED instruction string telling the agent what to do. Example:
  \`"You are assigned task 1.1 (Build auth module). Run /eh:work-on-plan to claim and implement it. The plan is already loaded in Event Horizon."\`
- \`role\`: The agent's role — e.g. \`"implementer"\`, \`"tester"\`, \`"reviewer"\`
- \`task_id\`: The task ID from the plan (e.g. \`"1.1"\`)
- \`plan_id\`: The plan ID (optional if only one plan is loaded)

Do NOT try to use the Skill tool or /eh:work-on-plan yourself — those are for worker agents. You use MCP tools directly.

## Duties

1. **Decompose goals into plans** — Use /eh:create-plan to break work into parallelizable tasks with clear dependencies. Every task must have acceptance criteria, a verify command, complexity estimate, and model tier recommendation.
2. **Spawn worker agents** — Use eh_spawn_agent (see above). Each spawned agent runs in its own VS Code terminal with the prompt you provide.
3. **Use tiered models** — When spawning agents for tasks, use the model recommended by eh_recommend_task (pass \`agent_type: "claude-code"\` not a role name). For \`low\` complexity tasks, cheaper models (haiku) are tried first.
4. **Auto-assign tasks** — Use eh_auto_assign to distribute pending tasks across connected agents.
5. **Verify completed work** — When tasks are marked done, use eh_verify_task to run their verify commands.
6. **Handle verification failures** — Use eh_retry_task. The system automatically escalates to the next model tier.
7. **Monitor progress** — Use eh_get_team_status to see all agents, their current tasks, load, cost, and plan progress.
8. **Reassign work** — Use eh_reassign_task to move tasks between agents when one is stuck or overloaded.
9. **Stop agents** — Use eh_stop_agent to terminate agents that are no longer needed.
10. **Synthesize results** — When all tasks are done, review the work, resolve conflicts, and produce a final summary.

## React to worker failures

Failure notifications are pushed to your message queue by Event Horizon — you do NOT have to poll \`eh_get_team_status\` to find them. Call \`eh_get_messages\` periodically (at least every 60s during orchestration) to receive:

- **⚠️ Worker X reported an error on task Y** — a worker fired \`agent.error\`
- **⚠️ Worker X failed a task Y** — a worker marked a task as failed

When you receive one of these, decide:
1. **Retry** with \`eh_retry_task\` — the system automatically escalates the model tier (haiku → sonnet → opus)
2. **Reassign** with \`eh_reassign_task\` — move the task to a different agent
3. **Take over** yourself if all retries have been exhausted

Do NOT ignore these messages — silent worker failures are the #1 way multi-agent runs stall.

## Tools (orchestrator-only)

- \`eh_spawn_agent\` — Launch a new agent (agent_type is "claude-code"/"opencode"/"cursor", NOT a role)
- \`eh_stop_agent\` — Terminate a spawned agent
- \`eh_reassign_task\` — Move a task to a different agent
- \`eh_get_team_status\` — Overview of all agents and plan progress
- \`eh_auto_assign\` — Bulk-assign pending tasks to agents
- \`eh_verify_task\` — Run a task's verify command and check results

You become orchestrator automatically when you load a plan with eh_load_plan.`,
    builtIn: true,
  },
  {
    id: 'context-optimizer',
    name: 'Context Optimizer',
    description: 'Analyzes and optimizes instruction files (CLAUDE.md, .cursorrules, copilot-instructions.md) to reduce per-session token costs.',
    skills: ['eh-optimize-context'],
    instructions: 'You optimize context files to reduce token consumption. Analyze instruction files, identify redundancy, split large files into conditional rules, and extract detailed procedures into on-demand skills. Always create backups before modifying. Never delete content — only move it.',
    builtIn: true,
  },
];

// ── RoleManager ────────────────────────────────────────────────────────────

export class RoleManager {
  private roles = new Map<string, RoleDefinition>();
  private assignments = new Map<string, RoleAssignment>();
  private listeners: Array<() => void> = [];

  constructor() {
    for (const role of BUILT_IN_ROLES) {
      this.roles.set(role.id, role);
    }
  }

  getRole(roleId: string): RoleDefinition | null {
    return this.roles.get(roleId) ?? null;
  }

  getAllRoles(): RoleDefinition[] {
    return [...this.roles.values()];
  }

  addCustomRole(role: Omit<RoleDefinition, 'builtIn'>): void {
    const existing = this.roles.get(role.id);
    if (existing?.builtIn) {
      throw new Error(`Cannot overwrite built-in role "${role.id}"`);
    }
    this.roles.set(role.id, { ...role, builtIn: false });
    this.notifyListeners();
  }

  editRole(roleId: string, updates: Partial<Omit<RoleDefinition, 'id' | 'builtIn'>>): void {
    const existing = this.roles.get(roleId);
    if (!existing) throw new Error(`Role "${roleId}" does not exist`);
    this.roles.set(roleId, {
      ...existing,
      name: updates.name ?? existing.name,
      description: updates.description ?? existing.description,
      skills: updates.skills ?? existing.skills,
      instructions: updates.instructions ?? existing.instructions,
    });
    this.notifyListeners();
  }

  removeCustomRole(roleId: string): boolean {
    const existing = this.roles.get(roleId);
    if (!existing || existing.builtIn) return false;
    this.roles.delete(roleId);
    this.assignments.delete(roleId);
    this.notifyListeners();
    return true;
  }

  assignRole(roleId: string, agentType: string | null, agentId: string | null): void {
    if (!this.roles.has(roleId)) {
      throw new Error(`Role "${roleId}" does not exist`);
    }
    this.assignments.set(roleId, { roleId, agentType, agentId });
    this.notifyListeners();
  }

  getAssignment(roleId: string): RoleAssignment | null {
    return this.assignments.get(roleId) ?? null;
  }

  getAllAssignments(): RoleAssignment[] {
    return [...this.assignments.values()];
  }

  getSkillsForRole(roleId: string): string[] {
    return this.roles.get(roleId)?.skills ?? [];
  }

  getRolesForAgentType(agentType: string): RoleDefinition[] {
    const result: RoleDefinition[] = [];
    for (const assignment of this.assignments.values()) {
      if (assignment.agentType === agentType) {
        const role = this.roles.get(assignment.roleId);
        if (role) result.push(role);
      }
    }
    return result;
  }

  getInstructionsForRole(roleId: string): string | null {
    return this.roles.get(roleId)?.instructions ?? null;
  }

  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  serialize(): { customRoles: RoleDefinition[]; assignments: RoleAssignment[] } {
    const customRoles = [...this.roles.values()].filter((r) => !r.builtIn);
    const assignments = [...this.assignments.values()];
    return { customRoles, assignments };
  }

  restore(data: { customRoles: RoleDefinition[]; assignments: RoleAssignment[] }): void {
    for (const role of data.customRoles) {
      this.roles.set(role.id, { ...role, builtIn: false });
    }
    for (const assignment of data.assignments) {
      if (this.roles.has(assignment.roleId)) {
        this.assignments.set(assignment.roleId, assignment);
      }
    }
  }

  private notifyListeners(): void {
    for (const fn of this.listeners) fn();
  }
}
