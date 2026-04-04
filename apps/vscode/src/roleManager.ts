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
    description: 'Reviews code changes, checks for bugs, suggests improvements, validates against requirements.',
    skills: ['eh-review'],
    instructions: 'You are acting as a reviewer. Read the code changes for the assigned task, check for correctness, edge cases, and adherence to project conventions. Report findings as a task note.',
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
