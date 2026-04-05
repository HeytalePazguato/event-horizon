/**
 * Webview message handler — processes all messages from the extension host.
 * Extracted from index.tsx (Phase D — Webview Decomposition).
 */

import { useEffect, useRef, type MutableRefObject } from 'react';
import type { ShipSpawn, SparkSpawn } from '@event-horizon/renderer';
import { useCommandCenterStore, clearAllBoostTimers } from '@event-horizon/ui';
import type { AgentState, AgentRuntimeState, AgentMetrics } from '@event-horizon/core';
import type { SkillInfo, MarketplaceSkillResult, PlanView, PlanSummary } from '@event-horizon/ui';

/** Max visible ships between a given ordered (from→to) pair at once. */
const MAX_SHIPS_PER_PAIR = 2;

interface EventPayload {
  type: string;
  payload?: unknown;
}

export interface WebviewMessageDeps {
  vscodeApi: { postMessage: (msg: unknown) => void } | null;
  setAgents: React.Dispatch<React.SetStateAction<Array<{ id: string; name: string; agentType?: string; cwd?: string }>>>;
  setConnectedAgentTypes: React.Dispatch<React.SetStateAction<string[]>>;
  setAgentMap: React.Dispatch<React.SetStateAction<Record<string, AgentState>>>;
  setMetricsMap: React.Dispatch<React.SetStateAction<Record<string, AgentMetrics>>>;
  setShips: React.Dispatch<React.SetStateAction<ShipSpawn[]>>;
  setSparks: React.Dispatch<React.SetStateAction<SparkSpawn[]>>;
  setActiveSkillsView: React.Dispatch<React.SetStateAction<Record<string, { name: string; index: number }>>>;
  setMarketplaceSearchResults: React.Dispatch<React.SetStateAction<MarketplaceSkillResult[]>>;
  setMarketplaceSearchLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setMarketplaceSearchSource: React.Dispatch<React.SetStateAction<string>>;
  setMarketplaceSearchError: React.Dispatch<React.SetStateAction<'timeout' | 'error' | null>>;
  agentMapRef: MutableRefObject<Record<string, AgentState>>;
  metricsMapRef: MutableRefObject<Record<string, AgentMetrics>>;
  agentLastSeenRef: MutableRefObject<Record<string, number>>;
  activeFilesRef: MutableRefObject<Map<string, Array<{ agentId: string; ts: number }>>>;
  recentSparkPairsRef: MutableRefObject<Map<string, number>>;
  activeSkillsRef: MutableRefObject<Map<string, string>>;
  invokedSkillNamesRef: MutableRefObject<Set<string>>;
  shipTimerIdsRef: MutableRefObject<Set<ReturnType<typeof setTimeout>>>;
  addLog: (log: { id: string; ts: string; agentId: string; agentName: string; type: string; skillName?: string }) => void;
  incrementTiered: (id: string) => void;
  setPlan: React.Dispatch<React.SetStateAction<PlanView>>;
  setPlans: React.Dispatch<React.SetStateAction<PlanSummary[]>>;
  setRoles: React.Dispatch<React.SetStateAction<Array<{ id: string; name: string; description: string; skills: string[]; instructions: string; builtIn: boolean }>>>;
  setRoleAssignments: React.Dispatch<React.SetStateAction<Array<{ roleId: string; agentType: string | null; agentId: string | null }>>>;
  setAgentProfiles: React.Dispatch<React.SetStateAction<Array<{ agentType: string; totalTasks: number; completedTasks: number; failedTasks: number; overallSuccessRate: number; avgDurationMs: number; avgCostUsd: number; byRole: Record<string, { total: number; completed: number; failed: number; avgDurationMs: number; avgCostUsd: number; avgTokens: number; successRate: number }>; lastUpdated: number }>>>;
  setKnowledgeWorkspace: React.Dispatch<React.SetStateAction<Array<{ key: string; value: string; scope: 'workspace' | 'plan'; author: string; authorId: string; createdAt: number; updatedAt: number }>>>;
  setKnowledgePlan: React.Dispatch<React.SetStateAction<Array<{ key: string; value: string; scope: 'workspace' | 'plan'; author: string; authorId: string; createdAt: number; updatedAt: number }>>>;
  setHeartbeatStatuses?: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setTraceSpans?: React.Dispatch<React.SetStateAction<Array<{ id: string; runId: string; spanType: string; name: string; agentId: string; parentSpanId?: string; startMs: number; endMs: number; durationMs: number; metadata: Record<string, unknown> }>>>;
  setTraceAggregate?: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  setMcpServers?: React.Dispatch<React.SetStateAction<Record<string, Array<{ name: string; connected: boolean; toolCount: number }>>>>;
  setCompactingAgentIds?: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setSpawnBeams?: React.Dispatch<React.SetStateAction<Array<{ fromAgentId: string; toAgentId: string; color: number; startTime: number }>>>;
  setOrchestratorAgentIds?: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}

export function useWebviewMessages(deps: WebviewMessageDeps): void {
  const {
    vscodeApi,
    setAgents, setConnectedAgentTypes, setAgentMap, setMetricsMap,
    setShips, setSparks, setActiveSkillsView,
    setMarketplaceSearchResults, setMarketplaceSearchLoading, setMarketplaceSearchSource, setMarketplaceSearchError,
    agentMapRef, metricsMapRef, agentLastSeenRef,
    activeFilesRef, recentSparkPairsRef, activeSkillsRef, invokedSkillNamesRef,
    shipTimerIdsRef, addLog, incrementTiered,
  } = deps;

  // Refs to avoid stale closures — these are updated on every render in index.tsx
  const depsRef = useRef(deps);
  depsRef.current = deps;

  useEffect(() => {
    const handler = (e: MessageEvent<EventPayload>) => {
      const msg = e.data;

      // ── Dispatch map for non-event messages ──
      if (msg?.type === 'toggle-view') {
        useCommandCenterStore.getState().toggleViewMode();
        return;
      }
      if (msg?.type === 'connected-agents') {
        setConnectedAgentTypes((msg as unknown as { agentTypes: string[] }).agentTypes ?? []);
        return;
      }
      if (msg?.type === 'init-state') {
        clearAllBoostTimers();
        const init = msg as unknown as { agents: AgentState[]; metrics: AgentMetrics[] };
        setAgents(init.agents.map((a) => ({ id: a.id, name: a.name, agentType: a.type, cwd: a.cwd })));
        setAgentMap(Object.fromEntries(init.agents.map((a) => [a.id, a])));
        setMetricsMap(Object.fromEntries(init.metrics.map((m) => [m.agentId, m])));
        return;
      }
      if (msg?.type === 'init-medals') {
        const data = msg as unknown as { unlockedAchievements: string[]; achievementTiers: Record<string, number>; achievementCounts: Record<string, number> };
        if (data.unlockedAchievements?.length > 0) {
          useCommandCenterStore.setState({
            unlockedAchievements: data.unlockedAchievements,
            achievementTiers: data.achievementTiers ?? {},
            achievementCounts: data.achievementCounts ?? {},
          });
        }
        return;
      }
      if (msg?.type === 'init-singularity') {
        const data = msg as unknown as { stats: Record<string, unknown> };
        if (data.stats) {
          const current = useCommandCenterStore.getState().singularityStats;
          useCommandCenterStore.getState().setSingularityStats({ ...current, ...data.stats } as typeof current);
        }
        return;
      }
      if (msg?.type === 'init-settings') {
        const data = msg as unknown as {
          settings?: import('@event-horizon/ui').VisualSettings;
          achievementsEnabled?: boolean;
          animationSpeed?: number;
          eventServerPort?: number;
          tourCompleted?: boolean;
          viewMode?: 'universe' | 'operations';
          fileLockingEnabled?: boolean;
          planShowAllColumns?: boolean;
          fontSize?: 'small' | 'default' | 'large';
        };
        const store = useCommandCenterStore.getState();
        if (data.settings) store.setVisualSettings(data.settings);
        if (data.achievementsEnabled !== undefined) store.setAchievementsEnabled(data.achievementsEnabled);
        if (data.animationSpeed !== undefined) store.setAnimationSpeed(data.animationSpeed);
        if (data.eventServerPort !== undefined) store.setEventServerPort(data.eventServerPort);
        if (data.tourCompleted !== undefined) store.setTourCompleted(data.tourCompleted);
        if (data.viewMode) store.setViewMode(data.viewMode);
        if (data.fileLockingEnabled !== undefined) store.setFileLockingEnabled(data.fileLockingEnabled);
        if (data.planShowAllColumns !== undefined) store.setPlanShowAllColumns(data.planShowAllColumns);
        if (data.fontSize) store.setFontSize(data.fontSize);
        return;
      }
      if (msg?.type === 'plan-update') {
        const data = msg as unknown as { plan: PlanView };
        if (data.plan) depsRef.current.setPlan(data.plan);
        return;
      }
      if (msg?.type === 'plan-completed') {
        // Synthesis beams: all workers beam results back to orchestrator
        const data = msg as unknown as { orchestratorAgentId: string; workerAgentIds: string[] };
        if (data.orchestratorAgentId && data.workerAgentIds && depsRef.current.setSpawnBeams) {
          const now = performance.now() / 1000; // approximate tick time
          const beams = data.workerAgentIds.map((wId: string) => ({
            fromAgentId: wId,
            toAgentId: data.orchestratorAgentId,
            color: 0x40a060, // green for synthesis
            startTime: now,
          }));
          depsRef.current.setSpawnBeams((prev) => [...prev, ...beams]);
        }
        return;
      }
      if (msg?.type === 'orchestrator-update') {
        const data = msg as unknown as { orchestratorAgentIds: Record<string, boolean> };
        if (data.orchestratorAgentIds && depsRef.current.setOrchestratorAgentIds) {
          depsRef.current.setOrchestratorAgentIds(data.orchestratorAgentIds);
        }
        return;
      }
      if (msg?.type === 'plans-update') {
        const data = msg as unknown as { plans: PlanSummary[]; activePlan?: PlanView };
        if (data.plans) depsRef.current.setPlans(data.plans);
        if (data.activePlan) depsRef.current.setPlan(data.activePlan);
        return;
      }
      if (msg?.type === 'roles-update') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = msg as any;
        if (data.roles) depsRef.current.setRoles(data.roles);
        if (data.assignments) depsRef.current.setRoleAssignments(data.assignments);
        if (data.profiles) depsRef.current.setAgentProfiles(data.profiles);
        return;
      }
      if (msg?.type === 'heartbeat-update') {
        const data = msg as unknown as { heartbeats: Record<string, string> };
        if (data.heartbeats && depsRef.current.setHeartbeatStatuses) {
          depsRef.current.setHeartbeatStatuses(data.heartbeats);
        }
        return;
      }
      if (msg?.type === 'knowledge-update') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = msg as any;
        if (data.workspace) depsRef.current.setKnowledgeWorkspace(data.workspace);
        if (data.plan) depsRef.current.setKnowledgePlan(data.plan);
        return;
      }
      if (msg?.type === 'traces-update') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = msg as any;
        if (data.spans && depsRef.current.setTraceSpans) {
          depsRef.current.setTraceSpans(data.spans);
        }
        if (data.aggregate && depsRef.current.setTraceAggregate) {
          depsRef.current.setTraceAggregate(data.aggregate);
        }
        return;
      }
      if (msg?.type === 'mcp-servers-update') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = msg as any;
        if (data.agentId && data.servers && depsRef.current.setMcpServers) {
          depsRef.current.setMcpServers((prev: Record<string, Array<{ name: string; connected: boolean; toolCount: number }>>) => ({
            ...prev,
            [data.agentId]: (data.servers as Array<{ name: string; status?: string; connected?: boolean; toolCount?: number }>).map((s: { name: string; status?: string; connected?: boolean; toolCount?: number }) => ({
              name: s.name,
              connected: s.connected ?? s.status === 'connected',
              toolCount: s.toolCount ?? 0,
            })),
          }));
        }
        return;
      }
      if (msg?.type === 'compaction-event') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = msg as any;
        const agentId = data.agentId as string;
        const preTokens = data.preTokens as number | undefined;
        const postTokens = data.postTokens as number | undefined;

        // Add compaction log entry
        const store = useCommandCenterStore.getState();
        store.addLog({
          id: `compaction-${Date.now()}-${agentId}`,
          ts: new Date().toLocaleTimeString(),
          agentId,
          agentName: agentId.slice(0, 12),
          type: 'compaction',
        });

        // Add compaction timeline entry
        const agentState = depsRef.current.agentMapRef.current[agentId];
        store.addTimelineEntry({
          ts: Date.now(),
          agentId,
          agentName: agentState?.name ?? agentId,
          agentType: agentState?.type ?? 'unknown',
          kind: 'compaction',
          label: preTokens && postTokens
            ? `Context compacted: ${preTokens} -> ${postTokens} tokens`
            : 'Context compacted',
        });

        // Trigger compaction visual on planet
        if (depsRef.current.setCompactingAgentIds) {
          depsRef.current.setCompactingAgentIds((prev: Record<string, boolean>) => ({ ...prev, [agentId]: true }));
          // Clear after animation duration (1.5s)
          setTimeout(() => {
            depsRef.current.setCompactingAgentIds?.((prev: Record<string, boolean>) => {
              const next = { ...prev };
              delete next[agentId];
              return next;
            });
          }, 1600);
        }
        return;
      }
      if (msg?.type === 'skills-update') {
        const data = msg as unknown as { skills: SkillInfo[] };
        const newSkills = data.skills ?? [];
        useCommandCenterStore.getState().setSkills(newSkills);
        useCommandCenterStore.getState().recalibrateTieredAchievement('plugin_collector', newSkills.length);
        return;
      }
      if (msg?.type === 'marketplace-search-results') {
        const data = msg as unknown as { results: MarketplaceSkillResult[]; source: string };
        setMarketplaceSearchResults(data.results ?? []);
        setMarketplaceSearchLoading(false);
        setMarketplaceSearchSource(data.source ?? '');
        return;
      }
      if (msg?.type === 'marketplace-search-error') {
        const data = msg as unknown as { reason?: string; source?: string };
        setMarketplaceSearchResults([]);
        setMarketplaceSearchLoading(false);
        setMarketplaceSearchError((data.reason === 'timeout' ? 'timeout' : 'error') as 'timeout' | 'error');
        setMarketplaceSearchSource(data.source ?? '');
        return;
      }

      if (msg?.type !== 'event' || !msg.payload) return;

      // ── Agent event processing ──
      const raw = msg.payload as {
        agentId?: string;
        agentName?: string;
        agentType?: string;
        type?: string;
        payload?: Record<string, unknown>;
      };
      const agentId = raw.agentId ?? 'unknown';
      const agentName = raw.agentName ?? agentId;
      const agentType = raw.agentType ?? 'unknown';
      const type = raw.type ?? 'agent.spawn';

      const logSkillName = raw.payload?.isSkill ? (raw.payload.skillName as string | undefined) : undefined;
      addLog({ id: `${Date.now()}-${agentId}`, ts: new Date().toLocaleTimeString(), agentId, agentName, type, skillName: logSkillName });

      // ── Singularity stats tracking ──
      const store = useCommandCenterStore.getState();
      if (!store.singularityStats.firstEventAt) store.incrementSingularityStat('firstEventAt');
      store.incrementSingularityStat('eventsWitnessed');
      if (type === 'agent.error') {
        store.incrementSingularityStat('errorsWitnessed');
        const errFilePath = raw.payload?.filePath as string | undefined;
        if (errFilePath) {
          const errNorm = errFilePath.replace(/\\/g, '/').toLowerCase();
          const errBase = errFilePath.split(/[/\\]/).pop() ?? errFilePath;
          const errCwd = agentMapRef.current[agentId]?.cwd;
          store.recordFileOp(errNorm, errBase, agentId, agentName, agentType, 'error', errCwd);
        }
      }

      // ── Timeline recording ──
      const tlBase = { ts: Date.now(), agentId, agentName, agentType };
      if (type === 'agent.spawn') store.addTimelineEntry({ ...tlBase, kind: 'state', label: 'spawned' });
      else if (type === 'agent.terminate') store.addTimelineEntry({ ...tlBase, kind: 'state', label: 'terminated' });
      else if (type === 'agent.error') store.addTimelineEntry({ ...tlBase, kind: 'error', label: (raw.payload?.message as string)?.slice(0, 60) ?? 'error' });
      else if (type === 'tool.call') {
        const toolName = (raw.payload?.toolName as string) ?? 'unknown';
        store.addTimelineEntry({ ...tlBase, kind: 'tool', label: toolName });
      } else if (type === 'file.read' || type === 'file.write') {
        const fp = (raw.payload?.filePath as string) ?? '';
        const fn = fp.split(/[/\\]/).pop() ?? fp;
        store.addTimelineEntry({ ...tlBase, kind: 'file', label: `${type === 'file.write' ? 'W' : 'R'} ${fn}` });
      }

      // Spawn beam: when an agent spawns with a spawner (orchestrator context), fire a beam
      if (type === 'agent.spawn' && raw.payload?.spawnedBy && depsRef.current.setSpawnBeams) {
        const spawnerId = raw.payload.spawnedBy as string;
        const AGENT_TYPE_BEAM_COLORS: Record<string, number> = {
          'claude-code': 0x88aaff,
          'copilot': 0xcc88ff,
          'opencode': 0x88ffaa,
          'cursor': 0x44ddcc,
        };
        const beamColor = AGENT_TYPE_BEAM_COLORS[agentType] ?? 0xffcc44;
        const now = performance.now() / 1000;
        depsRef.current.setSpawnBeams((prev) => [...prev, {
          fromAgentId: spawnerId,
          toAgentId: agentId,
          color: beamColor,
          startTime: now,
        }]);
      }

      // agent.terminate: clean up all state for this agent
      if (type === 'agent.terminate') {
        store.incrementSingularityStat('planetsSwallowed');
        setAgents((prev) => prev.filter((a) => a.id !== agentId));
        setAgentMap((prev) => { const n = { ...prev }; delete n[agentId]; return n; });
        setMetricsMap((prev) => { const n = { ...prev }; delete n[agentId]; return n; });
        delete agentLastSeenRef.current[agentId];
        activeSkillsRef.current.delete(agentId);
        setActiveSkillsView((prev) => { const next = { ...prev }; delete next[agentId]; return next; });
        return;
      }

      if (type === 'data.transfer') {
        const toAgentId = raw.payload?.toAgentId as string | undefined;
        if (toAgentId) {
          const shipId = `ship-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          const payloadSize = (raw.payload?.payloadSize as number | undefined) ?? 1;
          setShips((prev) => {
            const pairCount = prev.filter((s) => s.fromAgentId === agentId && s.toAgentId === toAgentId).length;
            if (pairCount >= MAX_SHIPS_PER_PAIR) return prev;
            return [...prev, { id: shipId, fromAgentId: agentId, toAgentId, payloadSize, fromAgentType: agentType }];
          });
          store.incrementSingularityStat('shipsObserved');
          const timerId = setTimeout(() => {
            setShips((prev) => prev.filter((s) => s.id !== shipId));
            shipTimerIdsRef.current.delete(timerId);
          }, 20000);
          shipTimerIdsRef.current.add(timerId);
        }
        return;
      }

      // Upsert agent
      const eventCwd = raw.payload?.cwd as string | undefined;
      setAgents((prev) => {
        const existing = prev.find((a) => a.id === agentId);
        if (existing) {
          if (eventCwd && !existing.cwd) {
            return prev.map((a) => a.id === agentId ? { ...a, cwd: eventCwd } : a);
          }
          return prev;
        }
        store.incrementTieredAchievement('agent_connected');
        store.incrementSingularityStat('agentsSeen');
        return [...prev, { id: agentId, name: agentName, agentType, cwd: eventCwd }];
      });
      setAgentMap((prev) => {
        const prevAgent = prev[agentId];
        let state: AgentRuntimeState;
        if (type === 'agent.error') state = 'error';
        else if (type === 'agent.waiting') state = 'waiting';
        else if (type === 'task.start') state = 'thinking';
        else if (type === 'tool.call') state = 'thinking';
        else if (type === 'task.progress') state = 'thinking';
        else if (type === 'tool.result') state = 'thinking';
        else if (type === 'task.complete' || type === 'task.fail') state = 'idle';
        else if (type === 'agent.spawn') state = prevAgent?.state ?? 'idle';
        else state = prevAgent?.state ?? 'idle';
        const cwd = (raw.payload?.cwd as string | undefined) ?? prevAgent?.cwd;
        return {
          ...prev,
          [agentId]: { id: agentId, name: agentName, type: agentType, state, currentTaskId: (raw.payload?.taskId as string | null) ?? prevAgent?.currentTaskId ?? null, cwd },
        };
      });

      // Update metrics
      const isHighLoad = type === 'task.progress' || type === 'tool.call' || type === 'tool.result';
      const loadTarget = isHighLoad ? 0.7 : 0.3;
      const isSubagent = !!(raw.payload?.isSubagent);
      const isToolFailure = !!(raw.payload?.isToolFailure);
      const toolName = (raw.payload?.toolName as string) ?? undefined;
      agentLastSeenRef.current[agentId] = Date.now();
      setMetricsMap((prev) => {
        const m = prev[agentId];
        const isTaskStart = type === 'task.start' && !isSubagent;
        const isTaskEnd = (type === 'task.complete' || type === 'task.fail') && !isSubagent;
        const activeTasks = isTaskStart ? (m?.activeTasks ?? 0) + 1 : isTaskEnd ? Math.max(0, (m?.activeTasks ?? 0) - 1) : (m?.activeTasks ?? 0);
        const activeSubagents = (type === 'task.start' && isSubagent)
          ? (m?.activeSubagents ?? 0) + 1
          : ((type === 'task.complete' || type === 'task.fail') && isSubagent)
            ? Math.max(0, (m?.activeSubagents ?? 0) - 1)
            : (m?.activeSubagents ?? 0);
        const tb = { ...(m?.toolBreakdown ?? {}) };
        if (type === 'tool.call' && toolName) tb[toolName] = (tb[toolName] ?? 0) + 1;
        const inputTokens = typeof raw.payload?.inputTokens === 'number' ? raw.payload.inputTokens as number : (m?.inputTokens ?? -1);
        const outputTokens = typeof raw.payload?.outputTokens === 'number' ? raw.payload.outputTokens as number : (m?.outputTokens ?? -1);
        const estimatedCostUsd = typeof raw.payload?.costUsd === 'number' ? raw.payload.costUsd as number : (m?.estimatedCostUsd ?? -1);
        return {
          ...prev,
          [agentId]: {
            agentId, load: (m?.load ?? 0.3) * 0.9 + loadTarget * 0.1,
            toolCalls: (m?.toolCalls ?? 0) + (type === 'tool.call' ? 1 : 0),
            toolFailures: (m?.toolFailures ?? 0) + (isToolFailure ? 1 : 0),
            promptsSubmitted: (m?.promptsSubmitted ?? 0) + (isTaskStart ? 1 : 0),
            subagentSpawns: (m?.subagentSpawns ?? 0) + (type === 'task.start' && isSubagent ? 1 : 0),
            activeSubagents, activeTasks,
            errorCount: type === 'agent.error' ? (m?.errorCount ?? 0) + 1 : (m?.errorCount ?? 0),
            sessionStartedAt: m?.sessionStartedAt ?? Date.now(),
            toolBreakdown: tb, inputTokens, outputTokens, estimatedCostUsd, lastUpdated: Date.now(),
          },
        };
      });

      // Singularity token/cost totals
      if (typeof raw.payload?.inputTokens === 'number' || typeof raw.payload?.outputTokens === 'number' || typeof raw.payload?.costUsd === 'number') {
        queueMicrotask(() => {
          const currentMetrics = Object.values(metricsMapRef.current);
          let totalTokens = 0;
          let totalCost = 0;
          let hasTokenData = false;
          let hasCostData = false;
          for (const am of currentMetrics) {
            const input = am.inputTokens ?? -1;
            const output = am.outputTokens ?? -1;
            const cost = am.estimatedCostUsd ?? -1;
            if (input >= 0) { totalTokens += input; hasTokenData = true; }
            if (output >= 0) { totalTokens += output; hasTokenData = true; }
            if (cost >= 0) { totalCost += cost; hasCostData = true; }
          }
          if (!hasTokenData) totalTokens = -1;
          if (!hasCostData) totalCost = -1;
          const s = useCommandCenterStore.getState();
          s.setSingularityStats({ ...s.singularityStats, totalTokens, totalCostUsd: totalCost });
        });
      }

      // Active skill tracking
      if (raw.payload?.isSkill) {
        const skillName = raw.payload.skillName as string | undefined;
        if (type === 'tool.call' && skillName) {
          const currentSkills = useCommandCenterStore.getState().skills;
          const idx = currentSkills.findIndex((s) => s.name === skillName);
          if (idx >= 0) {
            activeSkillsRef.current.set(agentId, skillName);
            if (!invokedSkillNamesRef.current.has(skillName)) {
              invokedSkillNamesRef.current.add(skillName);
              incrementTiered('skill_master');
            }
            setActiveSkillsView((prev) => ({ ...prev, [agentId]: { name: skillName, index: idx } }));
            const matchedSkill = currentSkills[idx];
            if (matchedSkill?.context === 'fork' || raw.payload?.isSubagent) {
              const probeId = `skill-probe-${agentId}-${Date.now()}`;
              setShips((prev) => [...prev, { id: probeId, fromAgentId: agentId, toAgentId: agentId, payloadSize: 1, isSkillProbe: true }]);
              const probeTimerId = setTimeout(() => {
                setShips((prev) => prev.filter((s) => s.id !== probeId));
                shipTimerIdsRef.current.delete(probeTimerId);
              }, 15000);
              shipTimerIdsRef.current.add(probeTimerId);
            }
          }
        } else if (type === 'tool.result') {
          activeSkillsRef.current.delete(agentId);
          setActiveSkillsView((prev) => { const next = { ...prev }; delete next[agentId]; return next; });
        }
      }

      // File activity heatmap + collision lightning
      const filePath = raw.payload?.filePath as string | undefined;
      if (filePath && (type === 'tool.call' || type === 'tool.result' || type === 'file.write' || type === 'file.read')) {
        const normalized = filePath.replace(/\\/g, '/').toLowerCase();
        const fileBasename = filePath.split(/[/\\]/).pop() ?? filePath;
        const fileOp = (type === 'file.write' || type === 'tool.call') ? 'write' : 'read';
        const fileCwd = agentMapRef.current[agentId]?.cwd ?? eventCwd;
        useCommandCenterStore.getState().recordFileOp(normalized, fileBasename, agentId, agentName, agentType, fileOp, fileCwd);

        const collisionBasename = normalized.split('/').pop() ?? '';
        const IGNORED_FILES = ['claude.md', '.clauderc', '.cursorrules', '.copilot-instructions.md'];
        const isIgnored = IGNORED_FILES.includes(collisionBasename)
          || normalized.includes('/.claude/') || normalized.includes('/.opencode/');

        if (!isIgnored) {
          const now = Date.now();
          const FILE_WINDOW_MS = 10_000;
          let entries = activeFilesRef.current.get(normalized);
          if (!entries) { entries = []; activeFilesRef.current.set(normalized, entries); }
          const fresh = entries.filter((e) => now - e.ts < FILE_WINDOW_MS);
          fresh.push({ agentId, ts: now });
          activeFilesRef.current.set(normalized, fresh);

          const others = [...new Set(fresh.filter((e) => e.agentId !== agentId).map((e) => e.agentId))];
          for (const otherId of others) {
            const pairKey = [agentId, otherId].sort().join('::');
            const sparkId = `collision-${pairKey}`;
            const sparkLabel = filePath.split(/[/\\]/).pop() ?? filePath;
            setSparks((prev) => {
              const existing = prev.find((s) => s.id === sparkId);
              if (existing) return prev;
              return [...prev, { id: sparkId, agentIds: [agentId, otherId], filePath: sparkLabel }];
            });
            const existingTimer = recentSparkPairsRef.current.get(pairKey);
            if (existingTimer) { clearTimeout(existingTimer); shipTimerIdsRef.current.delete(existingTimer); }
            const timerId = setTimeout(() => {
              setSparks((prev) => prev.filter((s) => s.id !== sparkId));
              recentSparkPairsRef.current.delete(pairKey);
              shipTimerIdsRef.current.delete(timerId);
            }, FILE_WINDOW_MS);
            recentSparkPairsRef.current.set(pairKey, timerId as unknown as number);
            shipTimerIdsRef.current.add(timerId);
          }
        }
      }
    };
    window.addEventListener('message', handler);
    vscodeApi?.postMessage({ type: 'ready' });
    vscodeApi?.postMessage({ type: 'request-roles' });
    return () => window.removeEventListener('message', handler);
  }, [addLog]);
}
