/**
 * Agent, task, and ship state management.
 * @event-horizon/core
 */

import type { AgentEvent } from './events.js';

export type AgentRuntimeState = 'idle' | 'thinking' | 'error' | 'waiting';

export interface AgentState {
  id: string;
  name: string;
  type: string;
  state: AgentRuntimeState;
  currentTaskId: string | null;
  /** Working directory reported by the agent — used for cooperation detection. */
  cwd?: string;
}

export interface TaskState {
  id: string;
  agentId: string;
  progress: number;
  complexity: number;
  startedAt: number;
}

export class AgentStateManager {
  private agents = new Map<string, AgentState>();
  private tasks = new Map<string, TaskState>();
  private taskIdCounter = 0;

  private nextTaskId(): string {
    return `task-${++this.taskIdCounter}`;
  }

  /** Ensure the agent exists — auto-create on first event if missed agent.spawn (e.g. after extension reload). */
  private ensureAgent(agentId: string, agentName: string, agentType: string, cwd?: string): AgentState {
    let agent = this.agents.get(agentId);
    if (!agent) {
      agent = { id: agentId, name: agentName, type: agentType, state: 'idle', currentTaskId: null, cwd };
      this.agents.set(agentId, agent);
    }
    return agent;
  }

  apply(event: AgentEvent): void {
    const { agentId, agentName, agentType, type, timestamp, payload } = event;

    switch (type) {
      case 'agent.spawn': {
        this.agents.set(agentId, {
          id: agentId,
          name: agentName,
          type: agentType,
          state: 'idle',
          currentTaskId: null,
          cwd: (payload?.cwd as string) ?? undefined,
        });
        break;
      }
      case 'agent.idle': {
        const a = this.ensureAgent(agentId, agentName, agentType, payload?.cwd as string | undefined);
        this.agents.set(agentId, { ...a, state: 'idle', currentTaskId: null });
        break;
      }
      case 'agent.error': {
        const a = this.ensureAgent(agentId, agentName, agentType, payload?.cwd as string | undefined);
        this.agents.set(agentId, { ...a, state: 'error' });
        break;
      }
      case 'agent.waiting': {
        const a = this.ensureAgent(agentId, agentName, agentType, payload?.cwd as string | undefined);
        this.agents.set(agentId, { ...a, state: 'waiting' });
        break;
      }
      case 'agent.terminate': {
        this.agents.delete(agentId);
        // Clean up orphaned tasks for terminated agent
        for (const [taskId, task] of this.tasks) {
          if (task.agentId === agentId) this.tasks.delete(taskId);
        }
        break;
      }
      case 'task.start': {
        const taskId = (payload?.taskId as string) ?? this.nextTaskId();
        const complexity = (payload?.complexity as number) ?? 1;
        this.tasks.set(taskId, {
          id: taskId,
          agentId,
          progress: 0,
          complexity,
          startedAt: timestamp,
        });
        const agent = this.ensureAgent(agentId, agentName, agentType, payload?.cwd as string | undefined);
        this.agents.set(agentId, { ...agent, state: 'thinking', currentTaskId: taskId });
        break;
      }
      case 'task.progress': {
        this.ensureAgent(agentId, agentName, agentType, payload?.cwd as string | undefined);
        const taskId = payload?.taskId as string | undefined;
        const progress = (payload?.progress as number) ?? 0;
        if (taskId) {
          const t = this.tasks.get(taskId);
          if (t) this.tasks.set(taskId, { ...t, progress });
        }
        break;
      }
      case 'task.complete':
      case 'task.fail': {
        const taskId = payload?.taskId as string | undefined;
        if (taskId) {
          this.tasks.delete(taskId);
          const agent = this.ensureAgent(agentId, agentName, agentType, payload?.cwd as string | undefined);
          if (agent.currentTaskId === taskId) {
            this.agents.set(agentId, { ...agent, state: 'idle', currentTaskId: null });
          }
        } else {
          // No taskId — complete the agent's current task (if any)
          const agent = this.ensureAgent(agentId, agentName, agentType, payload?.cwd as string | undefined);
          if (agent.currentTaskId) this.tasks.delete(agent.currentTaskId);
          this.agents.set(agentId, { ...agent, state: 'idle', currentTaskId: null });
        }
        break;
      }
      case 'data.transfer':
        // Ships are tracked exclusively in the webview (with timeout cleanup); no-op here.
        break;
      default: {
        // tool.call, tool.result, file.read, file.write, message.send, message.receive
        const a = this.ensureAgent(agentId, agentName, agentType, payload?.cwd as string | undefined);
        // Resume from waiting when agent becomes active again (tool use = user approved)
        if (a.state === 'waiting' && (type === 'tool.call' || type === 'tool.result')) {
          this.agents.set(agentId, { ...a, state: 'thinking' });
        }
        break;
      }
    }

    // Update cwd on any event if the agent exists and payload includes it
    if (payload?.cwd && type !== 'agent.spawn' && type !== 'agent.terminate') {
      const a = this.agents.get(agentId);
      if (a && !a.cwd) {
        this.agents.set(agentId, { ...a, cwd: payload.cwd as string });
      }
    }
  }

  getAgent(agentId: string): AgentState | undefined {
    return this.agents.get(agentId);
  }

  getAllAgents(): AgentState[] {
    return Array.from(this.agents.values());
  }

  getTask(taskId: string): TaskState | undefined {
    return this.tasks.get(taskId);
  }

  getTasksForAgent(agentId: string): TaskState[] {
    return Array.from(this.tasks.values()).filter((t) => t.agentId === agentId);
  }

  getAllTasks(): TaskState[] {
    return Array.from(this.tasks.values());
  }

}
