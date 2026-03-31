/**
 * Demo simulation — spawns fake agents with realistic state transitions.
 * Extracted from index.tsx (Phase D — Webview Decomposition).
 */

import { useState, useCallback, useRef, useEffect, type MutableRefObject } from 'react';
import type { ShipSpawn, SparkSpawn } from '@event-horizon/renderer';
import type { AgentState, AgentMetrics } from '@event-horizon/core';
import { useCommandCenterStore } from '@event-horizon/ui';
import type { PlanView, PlanSummary, PlanTaskView } from '@event-horizon/ui';

/** Max visible ships between a given ordered (from→to) pair at once. */
const MAX_SHIPS_PER_PAIR = 2;

const DEMO_AGENTS = [
  { id: 'demo-claude',   name: '[Demo] Claude',   agentType: 'claude-code', cwd: '/home/user/projects/event-horizon' },
  { id: 'demo-opencode', name: '[Demo] OpenCode', agentType: 'opencode',    cwd: '/home/user/projects/event-horizon' },
  { id: 'demo-copilot',  name: '[Demo] Copilot',  agentType: 'copilot',     cwd: '/home/user/projects/backend-api' },
  { id: 'demo-cursor',   name: '[Demo] Cursor',   agentType: 'cursor',      cwd: '/home/user/projects/backend-api' },
  { id: 'demo-gemini',   name: '[Demo] Gemini',   agentType: 'unknown',     cwd: '/home/user/projects/backend-api' },
  { id: 'demo-solo-1',   name: '[Demo] Windsurf', agentType: 'unknown' },
  { id: 'demo-solo-2',   name: '[Demo] Aider',    agentType: 'unknown' },
  { id: 'demo-solo-3',   name: '[Demo] Devin',    agentType: 'unknown' },
] as const;

const DEMO_WS_GROUPS = [
  ['demo-claude', 'demo-opencode'],
  ['demo-copilot', 'demo-cursor', 'demo-gemini'],
];

const DEMO_FILES = ['src/index.ts', 'src/utils.ts', 'package.json', 'README.md', 'src/app.tsx', 'src/components/App.tsx', 'tsconfig.json'];
const DEMO_SKILLS = ['code-review', 'run-tests', 'update-docs', 'refactor'];

const DEMO_PLAN_ID = 'demo-api-plan';
const DEMO_PLAN_TASKS: PlanTaskView[] = [
  { id: '1.1', title: 'Create database schema', status: 'done', assignee: '[Demo] Claude', assigneeId: 'demo-claude', blockedBy: [], notes: [{ agentId: 'demo-claude', agentName: '[Demo] Claude', text: 'Created users and sessions tables', ts: 0 }] },
  { id: '1.2', title: 'Add seed data migration', status: 'done', assignee: '[Demo] OpenCode', assigneeId: 'demo-opencode', blockedBy: ['1.1'], notes: [] },
  { id: '2.1', title: 'User CRUD endpoints', status: 'in_progress', assignee: '[Demo] Claude', assigneeId: 'demo-claude', blockedBy: ['1.1'], notes: [] },
  { id: '2.2', title: 'Auth middleware + JWT', status: 'in_progress', assignee: '[Demo] OpenCode', assigneeId: 'demo-opencode', blockedBy: ['1.1'], notes: [] },
  { id: '2.3', title: 'Rate limiting middleware', status: 'claimed', assignee: '[Demo] Copilot', assigneeId: 'demo-copilot', blockedBy: [], notes: [] },
  { id: '3.1', title: 'Integration tests for auth', status: 'pending', assignee: null, assigneeId: null, blockedBy: ['2.1', '2.2'], notes: [] },
  { id: '3.2', title: 'Integration tests for CRUD', status: 'blocked', assignee: null, assigneeId: null, blockedBy: ['2.1'], notes: [] },
  { id: '3.3', title: 'Load testing setup', status: 'pending', assignee: null, assigneeId: null, blockedBy: [], notes: [] },
];

interface DemoSimDeps {
  setAgents: React.Dispatch<React.SetStateAction<Array<{ id: string; name: string; agentType?: string; cwd?: string }>>>;
  setAgentMap: React.Dispatch<React.SetStateAction<Record<string, AgentState>>>;
  setMetricsMap: React.Dispatch<React.SetStateAction<Record<string, AgentMetrics>>>;
  setShips: React.Dispatch<React.SetStateAction<ShipSpawn[]>>;
  setSparks: React.Dispatch<React.SetStateAction<SparkSpawn[]>>;
  setActiveSkillsView: React.Dispatch<React.SetStateAction<Record<string, { name: string; index: number }>>>;
  agentLastSeenRef: MutableRefObject<Record<string, number>>;
  shipTimerIdsRef: MutableRefObject<Set<ReturnType<typeof setTimeout>>>;
  unlockAchievement: (id: string) => void;
  demoRequested: boolean;
  setPlan: React.Dispatch<React.SetStateAction<PlanView>>;
  setPlans: React.Dispatch<React.SetStateAction<PlanSummary[]>>;
}

export interface DemoSimResult {
  demoSimRunning: boolean;
}

export function useDemoSimulation(deps: DemoSimDeps): DemoSimResult {
  const {
    setAgents, setAgentMap, setMetricsMap, setShips, setSparks, setActiveSkillsView,
    agentLastSeenRef, shipTimerIdsRef, unlockAchievement, demoRequested,
    setPlan, setPlans,
  } = deps;

  const [demoSimRunning, setDemoSimRunning] = useState(false);
  const demoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const demoAgentTypeMap = Object.fromEntries(DEMO_AGENTS.map((a) => [a.id, a.agentType]));

  const runDemoSimulation = useCallback(() => {
    const agentTimers: Record<string, { nextTransition: number; phase: 'idle' | 'thinking' | 'tool_use' | 'completing' }> = {};
    for (const a of DEMO_AGENTS) {
      agentTimers[a.id] = { nextTransition: Date.now() + 2000 + Math.random() * 8000, phase: 'idle' };
    }

    // Staggered spawns
    const shuffled = [...DEMO_AGENTS].sort(() => Math.random() - 0.5);
    shuffled.forEach((a, i) => {
      const delay = (i / shuffled.length) * (3000 + Math.random() * 2000);
      const timerId = setTimeout(() => {
        setAgents((prev) => {
          if (prev.some((p) => p.id === a.id)) return prev;
          return [...prev, { id: a.id, name: a.name, agentType: a.agentType, cwd: a.cwd }];
        });
        setAgentMap((m) => ({
          ...m,
          [a.id]: { id: a.id, name: a.name, type: a.agentType, state: 'idle', currentTaskId: null, cwd: a.cwd },
        }));
        setMetricsMap((m) => ({
          ...m,
          [a.id]: {
            agentId: a.id, load: 0.2 + Math.random() * 0.3,
            toolCalls: 0, toolFailures: 0, promptsSubmitted: 0, subagentSpawns: 0,
            activeSubagents: 0, activeTasks: 0, errorCount: 0,
            sessionStartedAt: Date.now(), toolBreakdown: {},
            inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, lastUpdated: Date.now(),
          },
        }));
        shipTimerIdsRef.current.delete(timerId);
      }, delay);
      shipTimerIdsRef.current.add(timerId);
    });

    // Initialize demo plan
    const demoPlanTasks = DEMO_PLAN_TASKS.map((t) => ({ ...t, notes: [...t.notes] }));
    const demoPlan: PlanView = {
      loaded: true, id: DEMO_PLAN_ID, name: 'REST API with Auth',
      status: 'active', sourceFile: 'docs/API_PLAN.md',
      lastUpdatedAt: Date.now(), tasks: demoPlanTasks,
    };
    setPlan(demoPlan);
    setPlans([{
      id: DEMO_PLAN_ID, name: 'REST API with Auth', status: 'active',
      totalTasks: demoPlanTasks.length,
      doneTasks: demoPlanTasks.filter((t) => t.status === 'done').length,
      lastUpdatedAt: Date.now(),
    }]);

    // Track plan progression timing
    let lastPlanTick = Date.now();

    if (demoIntervalRef.current) clearInterval(demoIntervalRef.current);
    demoIntervalRef.current = setInterval(() => {
      const now = Date.now();

      // Per-agent state transitions
      setAgentMap((prev) => {
        const next = { ...prev };
        for (const a of DEMO_AGENTS) {
          const s = next[a.id];
          if (!s) continue;
          const timer = agentTimers[a.id];
          if (!timer || now < timer.nextTransition) continue;

          let newState = s.state;
          let newTaskId = s.currentTaskId;
          switch (timer.phase) {
            case 'idle':
              newState = 'thinking';
              newTaskId = `task-${now}-${a.id}`;
              timer.phase = 'thinking';
              timer.nextTransition = now + 1500 + Math.random() * 3000;
              break;
            case 'thinking': {
              const roll = Math.random();
              if (roll < 0.7) {
                newState = 'thinking';
                timer.phase = 'tool_use';
                timer.nextTransition = now + 800 + Math.random() * 2000;
              } else if (roll < 0.8) {
                newState = 'error';
                timer.phase = 'completing';
                timer.nextTransition = now + 2000 + Math.random() * 3000;
              } else {
                newState = 'idle';
                newTaskId = null;
                timer.phase = 'idle';
                timer.nextTransition = now + 3000 + Math.random() * 8000;
              }
              break;
            }
            case 'tool_use':
              if (Math.random() < 0.6) {
                newState = 'thinking';
                timer.phase = 'thinking';
                timer.nextTransition = now + 1000 + Math.random() * 2500;
              } else {
                newState = 'idle';
                newTaskId = null;
                timer.phase = 'idle';
                timer.nextTransition = now + 2000 + Math.random() * 6000;
              }
              break;
            case 'completing':
              newState = 'idle';
              newTaskId = null;
              timer.phase = 'idle';
              timer.nextTransition = now + 3000 + Math.random() * 5000;
              break;
          }
          next[a.id] = { ...s, state: newState, currentTaskId: newTaskId };
        }
        return next;
      });

      // Metrics
      setMetricsMap((prev) => {
        const next = { ...prev };
        for (const a of DEMO_AGENTS) {
          const m = prev[a.id];
          if (!m) continue;
          const timer = agentTimers[a.id];
          const isWorking = timer && (timer.phase === 'thinking' || timer.phase === 'tool_use');
          const loadTarget = isWorking ? 0.6 + Math.random() * 0.3 : 0.15 + Math.random() * 0.15;
          const load = m.load * 0.85 + loadTarget * 0.15;
          let { activeSubagents } = m;
          if (isWorking && Math.random() < 0.08) activeSubagents = Math.min(3, activeSubagents + 1);
          if (activeSubagents > 0 && Math.random() < 0.05) activeSubagents -= 1;
          const toolInc = (timer?.phase === 'tool_use') ? 1 : 0;
          const tools = ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob'];
          const tb = { ...m.toolBreakdown };
          if (toolInc) {
            const t = tools[Math.floor(Math.random() * tools.length)];
            tb[t] = (tb[t] ?? 0) + 1;
            const demoFile = DEMO_FILES[Math.floor(Math.random() * DEMO_FILES.length)];
            const demoNorm = demoFile.toLowerCase();
            const demoBase = demoFile.split('/').pop() ?? demoFile;
            const demoOp = (t === 'Write' || t === 'Edit') ? 'write' : 'read';
            useCommandCenterStore.getState().recordFileOp(demoNorm, demoBase, a.id, a.name, a.agentType, demoOp, a.cwd);
            useCommandCenterStore.getState().addTimelineEntry({ ts: Date.now(), agentId: a.id, agentName: a.name, agentType: a.agentType, kind: 'tool', label: t });
          }
          next[a.id] = {
            ...m, load, toolCalls: m.toolCalls + toolInc,
            promptsSubmitted: m.promptsSubmitted + (timer?.phase === 'thinking' && Math.random() < 0.1 ? 1 : 0),
            activeSubagents, toolBreakdown: tb, lastUpdated: now,
          };
        }
        return next;
      });

      // Skill activation
      if (Math.random() < 0.06) {
        const thinkingAgents = DEMO_AGENTS.filter((a) => agentTimers[a.id]?.phase === 'tool_use');
        if (thinkingAgents.length > 0) {
          const agent = thinkingAgents[Math.floor(Math.random() * thinkingAgents.length)];
          const skillName = DEMO_SKILLS[Math.floor(Math.random() * DEMO_SKILLS.length)];
          setActiveSkillsView((prev) => ({ ...prev, [agent.id]: { name: skillName, index: Math.floor(Math.random() * 4) } }));
          const timerId = setTimeout(() => {
            setActiveSkillsView((prev) => { const n = { ...prev }; delete n[agent.id]; return n; });
            shipTimerIdsRef.current.delete(timerId);
          }, 2000 + Math.random() * 4000);
          shipTimerIdsRef.current.add(timerId);
        }
      }

      // Ships
      if (Math.random() < 0.25 && DEMO_WS_GROUPS.length > 0) {
        const group = DEMO_WS_GROUPS[Math.floor(Math.random() * DEMO_WS_GROUPS.length)];
        if (group.length >= 2) {
          const fromIdx = Math.floor(Math.random() * group.length);
          let toIdx = Math.floor(Math.random() * (group.length - 1));
          if (toIdx >= fromIdx) toIdx++;
          const shipId = `demo-ship-${now}-${Math.random().toString(36).slice(2, 6)}`;
          const demoFrom = group[fromIdx], demoTo = group[toIdx];
          setShips((prev) => {
            const pairCount = prev.filter((s) => s.fromAgentId === demoFrom && s.toAgentId === demoTo).length;
            if (pairCount >= MAX_SHIPS_PER_PAIR) return prev;
            return [...prev, { id: shipId, fromAgentId: demoFrom, toAgentId: demoTo, payloadSize: Math.floor(Math.random() * 10) + 1, fromAgentType: demoAgentTypeMap[demoFrom] }];
          });
          const timerId = setTimeout(() => {
            setShips((prev) => prev.filter((s) => s.id !== shipId));
            shipTimerIdsRef.current.delete(timerId);
          }, 20000);
          shipTimerIdsRef.current.add(timerId);
        }
      }

      // Sparks
      if (Math.random() < 0.18 && DEMO_WS_GROUPS.length > 0) {
        const group = DEMO_WS_GROUPS[Math.floor(Math.random() * DEMO_WS_GROUPS.length)];
        if (group.length >= 2) {
          const fromIdx = Math.floor(Math.random() * group.length);
          let toIdx = Math.floor(Math.random() * (group.length - 1));
          if (toIdx >= fromIdx) toIdx++;
          const pairKey = [group[fromIdx], group[toIdx]].sort().join('::');
          const file = DEMO_FILES[Math.floor(Math.random() * DEMO_FILES.length)];
          const sparkId = `demo-spark-${pairKey}`;
          setSparks((prev) => {
            if (prev.some((s) => s.id === sparkId)) return prev;
            return [...prev, { id: sparkId, agentIds: [group[fromIdx], group[toIdx]], filePath: file }];
          });
          const duration = 3000 + Math.random() * 5000;
          const timerId = setTimeout(() => {
            setSparks((prev) => prev.filter((s) => s.id !== sparkId));
            shipTimerIdsRef.current.delete(timerId);
          }, duration);
          shipTimerIdsRef.current.add(timerId);
        }
      }

      // Plan task progression — advance one task every 8-15 seconds
      if (now - lastPlanTick > 8000 + Math.random() * 7000) {
        lastPlanTick = now;
        let changed = false;

        for (const task of demoPlanTasks) {
          if (task.status === 'in_progress') {
            // Complete in-progress tasks
            task.status = 'done';
            task.notes.push({ agentId: task.assigneeId ?? '', agentName: task.assignee ?? '', text: 'Completed', ts: now });
            changed = true;
            // Unblock dependents
            for (const dep of demoPlanTasks) {
              if (dep.status === 'blocked' && dep.blockedBy.includes(task.id)) {
                const allDone = dep.blockedBy.every((b) => demoPlanTasks.find((t) => t.id === b)?.status === 'done');
                if (allDone) dep.status = 'pending';
              }
            }
            break;
          }
        }

        if (!changed) {
          // Claim a pending task for a random active agent
          const pendingTask = demoPlanTasks.find((t) => t.status === 'pending');
          const claimedTask = demoPlanTasks.find((t) => t.status === 'claimed');
          const targetTask = claimedTask ?? pendingTask;
          if (targetTask) {
            const agents = ['demo-claude', 'demo-opencode', 'demo-copilot'];
            const agentNames = { 'demo-claude': '[Demo] Claude', 'demo-opencode': '[Demo] OpenCode', 'demo-copilot': '[Demo] Copilot' } as Record<string, string>;
            const agentId = agents[Math.floor(Math.random() * agents.length)];
            if (targetTask.status === 'claimed') {
              targetTask.status = 'in_progress';
            } else {
              targetTask.status = 'claimed';
              targetTask.assignee = agentNames[agentId] ?? agentId;
              targetTask.assigneeId = agentId;
            }
            changed = true;
          }
        }

        if (changed) {
          const doneTasks = demoPlanTasks.filter((t) => t.status === 'done').length;
          const allDone = doneTasks === demoPlanTasks.length;
          const updatedPlan: PlanView = {
            ...demoPlan,
            status: allDone ? 'completed' : 'active',
            lastUpdatedAt: now,
            tasks: demoPlanTasks.map((t) => ({ ...t, notes: [...t.notes] })),
          };
          setPlan(updatedPlan);
          setPlans([{
            id: DEMO_PLAN_ID, name: 'REST API with Auth',
            status: allDone ? 'completed' : 'active',
            totalTasks: demoPlanTasks.length, doneTasks,
            lastUpdatedAt: now,
          }]);
        }
      }
    }, 800);
    setDemoSimRunning(true);
  }, []);

  const stopDemoSimulation = useCallback(() => {
    if (demoIntervalRef.current) {
      clearInterval(demoIntervalRef.current);
      demoIntervalRef.current = null;
    }
    setDemoSimRunning(false);
    setAgents((prev) => prev.filter((a) => !a.id.startsWith('demo-')));
    setAgentMap((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) { if (k.startsWith('demo-')) delete next[k]; }
      return next;
    });
    setMetricsMap((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) { if (k.startsWith('demo-')) delete next[k]; }
      return next;
    });
    setShips((prev) => prev.filter((s) => !s.id.startsWith('demo-ship-')));
    setSparks((prev) => prev.filter((s) => !s.id.startsWith('demo-spark-')));
    setActiveSkillsView((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) { if (k.startsWith('demo-')) delete next[k]; }
      return next;
    });
    for (const id of Object.keys(agentLastSeenRef.current)) {
      if (id.startsWith('demo-')) delete agentLastSeenRef.current[id];
    }
    setPlan({ loaded: false });
    setPlans([]);
    useCommandCenterStore.getState().clearFileActivity();
    useCommandCenterStore.getState().clearTimeline();
  }, []);

  // Sync with store flag
  useEffect(() => {
    if (demoRequested && !demoSimRunning) {
      unlockAchievement('demo_activated');
      useCommandCenterStore.getState().setDemoMode(true);
      runDemoSimulation();
    } else if (!demoRequested && demoSimRunning) {
      stopDemoSimulation();
      useCommandCenterStore.getState().setDemoMode(false);
    }
  }, [demoRequested, demoSimRunning, runDemoSimulation, stopDemoSimulation, unlockAchievement]);

  useEffect(() => () => { if (demoIntervalRef.current) clearInterval(demoIntervalRef.current); }, []);

  return { demoSimRunning };
}
