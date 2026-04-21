/**
 * Demo simulation — spawns fake agents with realistic state transitions.
 * Extracted from index.tsx (Phase D — Webview Decomposition).
 */

import { useState, useCallback, useRef, useEffect, type MutableRefObject } from 'react';
import type { ShipSpawn, SparkSpawn, SpawnBeam } from '@event-horizon/renderer';
import type { AgentState, AgentMetrics } from '@event-horizon/core';
import { useCommandCenterStore } from '@event-horizon/ui';
import type { PlanView, PlanSummary, PlanTaskView } from '@event-horizon/ui';

/** Max visible ships between a given ordered (from→to) pair at once. */
const MAX_SHIPS_PER_PAIR = 2;

/** Cap on retained trace spans — demo runs indefinitely, so drop oldest to bound memory. */
const TRACE_SPAN_CAP = 500;

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
  { id: '1.1', title: 'Create database schema', status: 'done', assignee: '[Demo] Claude', assigneeId: 'demo-claude', role: 'planner', blockedBy: [], notes: [{ agentId: 'demo-claude', agentName: '[Demo] Claude', text: 'Created users and sessions tables', ts: 0 }] },
  { id: '1.2', title: 'Add seed data migration', status: 'done', assignee: '[Demo] OpenCode', assigneeId: 'demo-opencode', role: 'implementer', blockedBy: ['1.1'], notes: [] },
  { id: '2.1', title: 'User CRUD endpoints', status: 'in_progress', assignee: '[Demo] Claude', assigneeId: 'demo-claude', role: 'implementer', blockedBy: ['1.1'], notes: [] },
  { id: '2.2', title: 'Auth middleware + JWT', status: 'in_progress', assignee: '[Demo] OpenCode', assigneeId: 'demo-opencode', role: 'implementer', retryCount: 1, blockedBy: ['1.1'], notes: [] },
  { id: '2.3', title: 'Rate limiting middleware', status: 'claimed', assignee: '[Demo] Copilot', assigneeId: 'demo-copilot', role: 'implementer', blockedBy: [], notes: [] },
  { id: '3.1', title: 'Integration tests for auth', status: 'pending', assignee: null, assigneeId: null, role: 'tester', blockedBy: ['2.1', '2.2'], notes: [] },
  { id: '3.2', title: 'Integration tests for CRUD', status: 'blocked', assignee: null, assigneeId: null, role: 'tester', blockedBy: ['2.1'], notes: [] },
  { id: '3.3', title: 'Load testing setup', status: 'pending', assignee: null, assigneeId: null, role: 'researcher', recommendedFor: 'opencode', blockedBy: [], notes: [] },
];

/** Role definitions for demo agents. */
const DEMO_ROLES = [
  { id: 'orchestrator', name: 'Orchestrator', description: 'Coordinates agent work and creates plans', skills: ['plan-create', 'task-assign'], instructions: 'Coordinate work across agents, create and manage plans.', builtIn: true },
  { id: 'implementer', name: 'Implementer', description: 'Writes production code and features', skills: ['code-review', 'refactor'], instructions: 'Implement features and write production code.', builtIn: true },
  { id: 'tester', name: 'Tester', description: 'Writes and runs tests', skills: ['run-tests'], instructions: 'Write integration and unit tests.', builtIn: true },
  { id: 'reviewer', name: 'Reviewer', description: 'Reviews code for quality and correctness', skills: ['code-review'], instructions: 'Review PRs and code changes.', builtIn: true },
  { id: 'researcher', name: 'Researcher', description: 'Researches approaches and evaluates options', skills: ['update-docs'], instructions: 'Research technical approaches and document findings.', builtIn: true },
  { id: 'planner', name: 'Planner', description: 'Creates task breakdowns and plans', skills: ['plan-create'], instructions: 'Break down work into manageable tasks.', builtIn: true },
];

/** Role assignments for demo agents. */
const DEMO_ROLE_ASSIGNMENTS = [
  { roleId: 'orchestrator', agentType: 'claude-code' as string | null, agentId: 'demo-claude' as string | null },
  { roleId: 'implementer', agentType: 'opencode' as string | null, agentId: 'demo-opencode' as string | null },
  { roleId: 'tester', agentType: 'copilot' as string | null, agentId: 'demo-copilot' as string | null },
  { roleId: 'reviewer', agentType: 'cursor' as string | null, agentId: 'demo-cursor' as string | null },
  { roleId: 'researcher', agentType: null, agentId: 'demo-gemini' as string | null },
];

/** Workspace knowledge entries (set once on demo start). */
const DEMO_KNOWLEDGE_WORKSPACE = [
  { key: 'tech-stack', value: 'TypeScript, Express, PostgreSQL, Vitest', scope: 'workspace' as const, author: 'user', authorId: 'user', createdAt: Date.now() - 60000, updatedAt: Date.now() - 60000 },
  { key: 'conventions', value: 'camelCase for variables, PascalCase for types, kebab-case for files', scope: 'workspace' as const, author: 'user', authorId: 'user', createdAt: Date.now() - 55000, updatedAt: Date.now() - 55000 },
];

/** Heartbeat statuses for demo agents. */
const DEMO_HEARTBEAT_STATUSES: Record<string, string> = {
  'demo-claude': 'alive',
  'demo-opencode': 'alive',
  'demo-copilot': 'alive',
  'demo-cursor': 'alive',
  'demo-gemini': 'alive',
  'demo-solo-1': 'alive',
  'demo-solo-2': 'stale',
  'demo-solo-3': 'lost',
};

/** MCP server data for demo agents. */
const DEMO_MCP_SERVERS: Record<string, Array<{ name: string; connected: boolean; toolCount: number }>> = {
  'demo-claude': [
    { name: 'event-horizon', connected: true, toolCount: 39 },
    { name: 'github', connected: true, toolCount: 12 },
  ],
  'demo-cursor': [
    { name: 'event-horizon', connected: true, toolCount: 39 },
  ],
};

/** Generate initial trace spans for the demo. */
function generateDemoTraceSpans(): Array<{ id: string; runId: string; spanType: string; name: string; agentId: string; parentSpanId?: string; startMs: number; endMs: number; durationMs: number; metadata: Record<string, unknown> }> {
  const now = Date.now();
  const spans: Array<{ id: string; runId: string; spanType: string; name: string; agentId: string; parentSpanId?: string; startMs: number; endMs: number; durationMs: number; metadata: Record<string, unknown> }> = [];
  const agents = ['demo-claude', 'demo-opencode', 'demo-copilot', 'demo-cursor'];
  const tools = ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob'];
  const taskNames = ['Create schema', 'Seed data', 'CRUD endpoints', 'Auth middleware', 'Rate limiting'];

  // Session spans (top level)
  for (let i = 0; i < agents.length; i++) {
    const sessionStart = now - 120000 + i * 5000;
    const sessionId = `demo-session-${i}`;
    spans.push({
      id: sessionId, runId: `demo-run-${i}`, spanType: 'session', name: `Session ${i + 1}`,
      agentId: agents[i], startMs: sessionStart, endMs: now, durationMs: now - sessionStart, metadata: {},
    });

    // Task spans under session
    const taskCount = 2 + Math.floor(Math.random() * 2);
    for (let t = 0; t < taskCount; t++) {
      const taskStart = sessionStart + t * 20000 + Math.floor(Math.random() * 5000);
      const taskDur = 8000 + Math.floor(Math.random() * 12000);
      const taskId = `demo-task-${i}-${t}`;
      spans.push({
        id: taskId, runId: `demo-run-${i}`, spanType: 'task', name: taskNames[t % taskNames.length],
        agentId: agents[i], parentSpanId: sessionId,
        startMs: taskStart, endMs: taskStart + taskDur, durationMs: taskDur, metadata: {},
      });

      // Tool call spans under task
      const callCount = 2 + Math.floor(Math.random() * 3);
      for (let c = 0; c < callCount; c++) {
        const callStart = taskStart + c * (taskDur / callCount);
        const callDur = 200 + Math.floor(Math.random() * 1500);
        spans.push({
          id: `demo-tool-${i}-${t}-${c}`, runId: `demo-run-${i}`, spanType: 'tool_call',
          name: tools[Math.floor(Math.random() * tools.length)],
          agentId: agents[i], parentSpanId: taskId,
          startMs: callStart, endMs: callStart + callDur, durationMs: callDur, metadata: {},
        });
      }
    }
  }
  return spans;
}

/** Generate trace aggregate from spans. */
function generateDemoTraceAggregate(spans: Array<{ spanType: string; durationMs: number }>): Record<string, number> {
  const agg: Record<string, number> = {};
  for (const s of spans) {
    agg[s.spanType] = (agg[s.spanType] ?? 0) + s.durationMs;
  }
  return agg;
}

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
  setRoles: React.Dispatch<React.SetStateAction<Array<{ id: string; name: string; description: string; skills: string[]; instructions: string; builtIn: boolean }>>>;
  setRoleAssignments: React.Dispatch<React.SetStateAction<Array<{ roleId: string; agentType: string | null; agentId: string | null }>>>;
  setKnowledgeWorkspace: React.Dispatch<React.SetStateAction<Array<{ key: string; value: string; scope: 'workspace' | 'plan'; author: string; authorId: string; createdAt: number; updatedAt: number }>>>;
  setKnowledgePlan: React.Dispatch<React.SetStateAction<Array<{ key: string; value: string; scope: 'workspace' | 'plan'; author: string; authorId: string; createdAt: number; updatedAt: number }>>>;
  setSpawnBeams: React.Dispatch<React.SetStateAction<SpawnBeam[]>>;
  setTraceSpans: React.Dispatch<React.SetStateAction<Array<{ id: string; runId: string; spanType: string; name: string; agentId: string; parentSpanId?: string; startMs: number; endMs: number; durationMs: number; metadata: Record<string, unknown> }>>>;
  setTraceAggregate: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  setHeartbeatStatuses: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setOrchestratorAgentIds: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setMcpServers: React.Dispatch<React.SetStateAction<Record<string, Array<{ name: string; connected: boolean; toolCount: number }>>>>;
  setWormholes: React.Dispatch<React.SetStateAction<Array<{ id: string; sourceAgentId: string; targetAgentId: string; strength: number }>>>;
}

export interface DemoSimResult {
  demoSimRunning: boolean;
}

export function useDemoSimulation(deps: DemoSimDeps): DemoSimResult {
  const {
    setAgents, setAgentMap, setMetricsMap, setShips, setSparks, setActiveSkillsView,
    agentLastSeenRef, shipTimerIdsRef, unlockAchievement, demoRequested,
    setPlan, setPlans,
    setRoles, setRoleAssignments,
    setKnowledgeWorkspace, setKnowledgePlan,
    setSpawnBeams,
    setTraceSpans, setTraceAggregate,
    setHeartbeatStatuses,
    setOrchestratorAgentIds,
    setMcpServers,
    setWormholes,
  } = deps;

  const [demoSimRunning, setDemoSimRunning] = useState(false);
  const demoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const demoDiagIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const demoAgentTypeMap = Object.fromEntries(DEMO_AGENTS.map((a) => [a.id, a.agentType]));

  const runDemoSimulation = useCallback(() => {
    const agentTimers: Record<string, { nextTransition: number; phase: 'idle' | 'thinking' | 'tool_use' | 'completing' }> = {};
    for (const a of DEMO_AGENTS) {
      agentTimers[a.id] = { nextTransition: Date.now() + 2000 + Math.random() * 8000, phase: 'idle' };
    }

    // Diagnostic heartbeat — logs state sizes every 2s so we catch even fast crashes.
    const diagStart = Date.now();
    if (__EH_DEV__) {
      console.log('[EH demo-diag] START — demo simulation initialized');
    }
    const writeDiag = () => {
      if (!__EH_DEV__) return;
      const state = useCommandCenterStore.getState();
      const perf = performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } };
      const usedMB = perf.memory ? (perf.memory.usedJSHeapSize / 1048576).toFixed(0) : '?';
      const totalMB = perf.memory ? (perf.memory.totalJSHeapSize / 1048576).toFixed(0) : '?';
      const limitMB = perf.memory ? (perf.memory.jsHeapSizeLimit / 1048576).toFixed(0) : '?';
      const sec = Math.floor((Date.now() - diagStart) / 1000);
      console.log(
        `[EH demo-diag] t=${sec}s heap=${usedMB}/${totalMB}/${limitMB}MB ` +
        `timeline=${state.timeline.length} ` +
        `fileActivity=${Object.keys(state.fileActivity).length} ` +
        `logs=${state.logs.length} ` +
        `skills=${state.skills.length} ` +
        `medals=${state.unlockedAchievements.length} ` +
        `pendingTimers=${shipTimerIdsRef.current.size}`
      );
    };
    // Fire immediately so we capture the baseline even if the demo crashes fast.
    writeDiag();
    if (demoDiagIntervalRef.current) clearInterval(demoDiagIntervalRef.current);
    demoDiagIntervalRef.current = setInterval(writeDiag, 2_000);

    // Set up roles, heartbeats, orchestrator, MCP servers, knowledge, traces on demo start
    setRoles(DEMO_ROLES);
    setRoleAssignments(DEMO_ROLE_ASSIGNMENTS);
    setHeartbeatStatuses(DEMO_HEARTBEAT_STATUSES);
    setOrchestratorAgentIds({ 'demo-claude': true });
    setMcpServers(DEMO_MCP_SERVERS);
    setKnowledgeWorkspace(DEMO_KNOWLEDGE_WORKSPACE);
    // Seed plan knowledge from multiple authors so the constellation has
    // visible activity right away — additional entries get appended as tasks
    // complete (see plan progression block below).
    const baseTs = Date.now() - 20000;
    setKnowledgePlan([
      { key: 'api-style', value: 'REST with JSON, snake_case fields', scope: 'plan', author: '[Demo] Claude', authorId: 'demo-claude', createdAt: baseTs, updatedAt: baseTs },
      { key: 'test-runner', value: 'Vitest with happy-dom', scope: 'plan', author: '[Demo] Copilot', authorId: 'demo-copilot', createdAt: baseTs + 1000, updatedAt: baseTs + 1000 },
      { key: 'lint-config', value: 'ESLint flat config, strict TS', scope: 'plan', author: '[Demo] Cursor', authorId: 'demo-cursor', createdAt: baseTs + 2000, updatedAt: baseTs + 2000 },
      { key: 'ci-target', value: 'Node 20, GitHub Actions', scope: 'plan', author: '[Demo] Gemini', authorId: 'demo-gemini', createdAt: baseTs + 3000, updatedAt: baseTs + 3000 },
    ]);

    // Seed wormholes between cooperating workspace pairs so the visual
    // appears immediately. Strength bumps over time as ships flow.
    setWormholes([
      { id: 'demo-wh-1', sourceAgentId: 'demo-claude', targetAgentId: 'demo-opencode', strength: 0.6 },
      { id: 'demo-wh-2', sourceAgentId: 'demo-copilot', targetAgentId: 'demo-cursor', strength: 0.5 },
      { id: 'demo-wh-3', sourceAgentId: 'demo-cursor', targetAgentId: 'demo-gemini', strength: 0.4 },
    ]);

    // Pre-populate trace spans
    const demoSpans = generateDemoTraceSpans();
    setTraceSpans(demoSpans);
    setTraceAggregate(generateDemoTraceAggregate(demoSpans));

    // Track which knowledge entries have been added (by task id)
    const addedPlanKnowledge = new Set<string>();

    // Sequential spawns with 2s between each agent.
    // Previously agents landed within a 0-5s window so up to 8 React/Pixi
    // rebuilds could overlap the same frame; that's the suspected freeze cause.
    // Spacing them 2000ms apart gives React + the PixiJS ticker time to settle
    // between each new planet, and logs exactly which agent index the crash
    // happens on (if it still crashes).
    const SPAWN_INTERVAL_MS = 2000;
    const shuffled = [...DEMO_AGENTS].sort(() => Math.random() - 0.5);
    shuffled.forEach((a, i) => {
      const delay = i * SPAWN_INTERVAL_MS;
      const timerId = setTimeout(() => {
        console.log(`[EH demo-spawn] #${i + 1}/${shuffled.length} spawning ${a.id} at t=${i * SPAWN_INTERVAL_MS}ms`);
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

        // Spawn beam from orchestrator (demo-claude) to each other agent
        if (a.id !== 'demo-claude') {
          const beam: SpawnBeam = {
            fromAgentId: 'demo-claude',
            toAgentId: a.id,
            color: a.agentType === 'opencode' ? 0x00aaff : a.agentType === 'copilot' ? 0x44cc88 : a.agentType === 'cursor' ? 0xffaa00 : 0x8888ff,
            startTime: Date.now(),
            createdAtMs: Date.now(),
          };
          setSpawnBeams((prev) => [...prev, beam]);
        }

        shipTimerIdsRef.current.delete(timerId);
      }, delay);
      shipTimerIdsRef.current.add(timerId);
    });

    // Initialize demo plan — merge with existing plans, don't replace
    const demoPlanTasks = DEMO_PLAN_TASKS.map((t) => ({ ...t, notes: [...t.notes] }));
    const demoPlan: PlanView = {
      loaded: true, id: DEMO_PLAN_ID, name: '[Demo] REST API with Auth',
      status: 'active', sourceFile: 'docs/API_PLAN.md',
      lastUpdatedAt: Date.now(), tasks: demoPlanTasks,
      strategy: 'capability-match', maxBudgetUsd: 5.00,
    };
    setPlan(demoPlan);
    setPlans((prev) => [...prev.filter((p) => p.id !== DEMO_PLAN_ID), {
      id: DEMO_PLAN_ID, name: '[Demo] REST API with Auth', status: 'active',
      totalTasks: demoPlanTasks.length,
      doneTasks: demoPlanTasks.filter((t) => t.status === 'done').length,
      lastUpdatedAt: Date.now(),
    }]);

    // Track plan progression timing
    let lastPlanTick = Date.now();

    if (demoIntervalRef.current) clearInterval(demoIntervalRef.current);
    let tickCount = 0;
    demoIntervalRef.current = setInterval(() => {
      tickCount++;
      const traceTick = tickCount <= 5; // Verbose logs for the first 5 ticks only.
      try {
      const now = Date.now();
      if (__EH_DEV__ && traceTick) console.log(`[EH demo-diag] tick#${tickCount} enter`);

      // Per-agent state transitions
      setAgentMap((prev) => {
        const next = { ...prev };
        let agentMapChanged = false;
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
          if (newState !== s.state || newTaskId !== s.currentTaskId) {
            next[a.id] = { ...s, state: newState, currentTaskId: newTaskId };
            agentMapChanged = true;
          }
        }
        return agentMapChanged ? next : prev;
      });

      if (__EH_DEV__ && traceTick) console.log(`[EH demo-diag] tick#${tickCount} after state transitions`);

      // Side effects to flush after the pure metrics updater runs.
      const storeOps: Array<{ norm: string; base: string; id: string; name: string; type: string; op: 'read' | 'write'; cwd?: string; tool: string }> = [];

      // Metrics
      setMetricsMap((prev) => {
        const next = { ...prev };
        let metricsMapChanged = false;
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
            storeOps.push({ norm: demoNorm, base: demoBase, id: a.id, name: a.name, type: a.agentType, op: demoOp, cwd: a.cwd, tool: t });
          }
          // Token and cost accumulation during thinking phases
          const isThinking = timer?.phase === 'thinking';
          const inputTokenInc = isThinking ? Math.floor(400 + Math.random() * 200) : 0;
          const outputTokenInc = isThinking ? Math.floor(150 + Math.random() * 100) : 0;
          const costInc = isThinking ? 0.003 + Math.random() * 0.004 : 0;
          const promptInc = (isThinking && Math.random() < 0.1) ? 1 : 0;
          const loadChanged = Math.abs(load - m.load) > 0.005;
          const discreteChanged = toolInc > 0 || promptInc > 0 || activeSubagents !== m.activeSubagents
            || inputTokenInc > 0 || outputTokenInc > 0 || costInc > 0;
          if (loadChanged || discreteChanged) {
            next[a.id] = {
              ...m, load, toolCalls: m.toolCalls + toolInc,
              promptsSubmitted: m.promptsSubmitted + promptInc,
              activeSubagents, toolBreakdown: tb, lastUpdated: now,
              inputTokens: m.inputTokens + inputTokenInc,
              outputTokens: m.outputTokens + outputTokenInc,
              estimatedCostUsd: m.estimatedCostUsd + costInc,
            };
            metricsMapChanged = true;
          }
        }
        return metricsMapChanged ? next : prev;
      });

      if (__EH_DEV__ && traceTick) console.log(`[EH demo-diag] tick#${tickCount} after metrics (${storeOps.length} storeOps)`);

      // Flush store ops outside the pure updater.
      if (storeOps.length > 0) {
        const store = useCommandCenterStore.getState();
        for (const op of storeOps) {
          store.recordFileOp(op.norm, op.base, op.id, op.name, op.type, op.op, op.cwd);
          store.addTimelineEntry({ ts: now, agentId: op.id, agentName: op.name, agentType: op.type, kind: 'tool', label: op.tool });
        }
      }
      if (__EH_DEV__ && traceTick) console.log(`[EH demo-diag] tick#${tickCount} after storeOps`);

      // Live trace spans — batch all new spans into ONE setState per tick
      // instead of 1-8 separate setState calls. Also skip the aggregate update
      // entirely most ticks; it's decorative and was thrashing renders.
      const newSpans: Array<{
        id: string; runId: string; spanType: string; name: string; agentId: string;
        startMs: number; endMs: number; durationMs: number; metadata: Record<string, unknown>;
      }> = [];
      let newSpanDurSum = 0;
      for (const a of DEMO_AGENTS) {
        const timer = agentTimers[a.id];
        if (timer?.phase === 'tool_use' && Math.random() < 0.3) {
          const toolNames = ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob'];
          const spanStart = now - Math.floor(200 + Math.random() * 1500);
          const spanDur = Math.floor(200 + Math.random() * 1200);
          newSpans.push({
            id: `demo-live-${now}-${a.id}-${Math.random().toString(36).slice(2, 6)}`,
            runId: `demo-run-live`, spanType: 'tool_call',
            name: toolNames[Math.floor(Math.random() * toolNames.length)],
            agentId: a.id, startMs: spanStart, endMs: spanStart + spanDur,
            durationMs: spanDur, metadata: {},
          });
          newSpanDurSum += spanDur;
        }
      }
      if (newSpans.length > 0) {
        setTraceSpans((prev) => {
          const next = prev.concat(newSpans);
          return next.length > TRACE_SPAN_CAP ? next.slice(next.length - TRACE_SPAN_CAP) : next;
        });
        setTraceAggregate((prev) => ({ ...prev, tool_call: (prev.tool_call ?? 0) + newSpanDurSum }));
      }

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
            // Add plan knowledge on specific task completions
            if (task.id === '1.1' && !addedPlanKnowledge.has('1.1')) {
              addedPlanKnowledge.add('1.1');
              setKnowledgePlan((prev) => [...prev, {
                key: 'db-schema', value: 'Users table with uuid PK, sessions table with TTL',
                scope: 'plan', author: '[Demo] Claude', authorId: 'demo-claude',
                createdAt: now, updatedAt: now,
              }]);
            }
            if (task.id === '2.2' && !addedPlanKnowledge.has('2.2')) {
              addedPlanKnowledge.add('2.2');
              setKnowledgePlan((prev) => [...prev, {
                key: 'auth-approach', value: 'JWT with RS256, refresh tokens in httpOnly cookies',
                scope: 'plan', author: '[Demo] OpenCode', authorId: 'demo-opencode',
                createdAt: now, updatedAt: now,
              }]);
            }
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
          setPlans((prev) => [
            ...prev.filter((p) => p.id !== DEMO_PLAN_ID),
            {
              id: DEMO_PLAN_ID, name: '[Demo] REST API with Auth',
              status: allDone ? 'completed' : 'active',
              totalTasks: demoPlanTasks.length, doneTasks,
              lastUpdatedAt: now,
            },
          ]);
        }
      }
      if (__EH_DEV__ && traceTick) console.log(`[EH demo-diag] tick#${tickCount} exit OK`);
      } catch (err) {
        if (__EH_DEV__) {
          console.error(`[EH demo-diag] TICK ${tickCount} THREW:`, err);
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
    if (demoDiagIntervalRef.current) {
      clearInterval(demoDiagIntervalRef.current);
      demoDiagIntervalRef.current = null;
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
    // Only remove the demo plan, preserve real plans
    setPlans((prev) => {
      const remaining = prev.filter((p) => p.id !== DEMO_PLAN_ID);
      return remaining;
    });
    // If the currently viewed plan was the demo plan, clear it
    setPlan((prev) => prev.id === DEMO_PLAN_ID ? { loaded: false } : prev);

    // Clean up Phase 1-5 demo data
    setRoles([]);
    setRoleAssignments([]);
    setKnowledgeWorkspace([]);
    setKnowledgePlan([]);
    setSpawnBeams([]);
    setTraceSpans([]);
    setTraceAggregate({});
    setHeartbeatStatuses({});
    setOrchestratorAgentIds({});
    setMcpServers({});
    setWormholes([]);

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

  useEffect(() => () => {
    if (demoIntervalRef.current) clearInterval(demoIntervalRef.current);
    if (demoDiagIntervalRef.current) clearInterval(demoDiagIntervalRef.current);
  }, []);

  return { demoSimRunning };
}
