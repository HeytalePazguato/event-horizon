/**
 * Webview entry — thin shell that composes hooks and components.
 * Logic is delegated to extracted hooks (Phase D — Webview Decomposition).
 */

import { createRoot } from 'react-dom/client';
import { useState, useEffect, useCallback, useRef, useMemo, Component, type ReactNode } from 'react';
import { Universe } from '@event-horizon/renderer';
import type { ShipSpawn, SparkSpawn, SpawnBeam, KnowledgeLink } from '@event-horizon/renderer';
import { CommandCenter, Tooltip, AchievementToasts, CreateSkillWizard, MarketplacePanel, SettingsModal, OperationsView, useCommandCenterStore } from '@event-horizon/ui';
import type { CreateSkillRequest, MarketplaceSkillResult, CostInsightsData } from '@event-horizon/ui';
import type { AgentState, AgentMetrics } from '@event-horizon/core';

import { useWebviewMessages } from './hooks/useWebviewMessages';
import { useAchievementTriggers } from './hooks/useAchievementTriggers';
import { useDemoSimulation } from './hooks/useDemoSimulation';
import { useSettingsPersistence } from './hooks/useSettingsPersistence';
import { OnboardingCard } from './components/OnboardingCard';
import { InfoOverlay } from './components/InfoOverlay';
import { ConnectModal } from './components/ConnectModal';
import { SpawnModal } from './components/SpawnModal';

// acquireVsCodeApi() may only be called once per webview lifetime
const vscodeApi = ((): { postMessage: (msg: unknown) => void } | null => {
  const w = window as unknown as Record<string, unknown>;
  if (typeof w['acquireVsCodeApi'] === 'function') {
    return (w['acquireVsCodeApi'] as () => { postMessage: (msg: unknown) => void })();
  }
  return null;
})();

function usePanelSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 640, height: 400 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const update = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const w = el.clientWidth || 640;
        const h = el.clientHeight || 400;
        if (w > 0 && h > 0) setSize((prev) => {
          if (prev.width === w && prev.height === h) return prev;
          return { width: w, height: h };
        });
      }, 100);
    };
    const w = el.clientWidth || 640;
    const h = el.clientHeight || 400;
    if (w > 0 && h > 0) setSize({ width: w, height: h });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => { ro.disconnect(); if (timer) clearTimeout(timer); };
  }, []);
  return { ref, ...size };
}

function useRandomStars(count: number) {
  const [stars] = useState(() =>
    Array.from({ length: count }, () => ({
      x: Math.random() * 100,
      y: Math.random() * 100,
      r: 0.3 + Math.random() * 1.2,
      opacity: 0.2 + Math.random() * 0.8,
    }))
  );
  return stars;
}

function RandomStarfield() {
  const stars = useRandomStars(180);
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0, overflow: 'hidden' }} aria-hidden>
      {stars.map((s, i) => (
        <div
          key={i}
          style={{
            position: 'absolute', left: `${s.x}%`, top: `${s.y}%`,
            width: s.r * 4, height: s.r * 4, borderRadius: '50%',
            background: `rgba(255,255,255,${s.opacity})`,
            boxShadow: s.r > 1 ? `0 0 ${s.r * 2}px rgba(255,255,255,${s.opacity * 0.5})` : undefined,
          }}
        />
      ))}
    </div>
  );
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 16, color: '#e88', fontFamily: 'system-ui', fontSize: 13, background: '#1a0a0a' }}>
          <strong>Event Horizon error</strong>: {this.state.error}
          <br />
          <button type="button" onClick={() => this.setState({ error: null })}
            style={{ marginTop: 10, padding: '4px 12px', background: '#2a1a1a', border: '1px solid #c66', color: '#e88', cursor: 'pointer', fontSize: 12 }}>
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  // ── Core state ──
  const [agents, setAgents] = useState<Array<{ id: string; name: string; agentType?: string; cwd?: string }>>([]);
  const [connectedAgentTypes, setConnectedAgentTypes] = useState<string[]>(() => {
    try {
      const el = document.getElementById('root');
      const raw = el?.dataset['ehInit'];
      if (raw) return (JSON.parse(raw) as { connectedAgents: string[] }).connectedAgents ?? [];
    } catch { /* ignore */ }
    return [];
  });
  const [extensionVersion] = useState<string>(() => {
    try {
      const el = document.getElementById('root');
      const raw = el?.dataset['ehInit'];
      if (raw) return (JSON.parse(raw) as { version?: string }).version ?? '';
    } catch { /* ignore */ }
    return '';
  });
  const [agentMap, setAgentMap] = useState<Record<string, AgentState>>({});
  const [metricsMap, setMetricsMap] = useState<Record<string, AgentMetrics>>({});
  const [ships, setShips] = useState<ShipSpawn[]>([]);
  const [sparks, setSparks] = useState<SparkSpawn[]>([]);
  const [hoveredAgentId, setHoveredAgentId] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [activeSkillsView, setActiveSkillsView] = useState<Record<string, { name: string; index: number }>>({});
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const [marketplaceSearchResults, setMarketplaceSearchResults] = useState<MarketplaceSkillResult[]>([]);
  const [marketplaceSearchLoading, setMarketplaceSearchLoading] = useState(false);
  const [marketplaceSearchSource, setMarketplaceSearchSource] = useState<string>('');
  const [marketplaceSearchError, setMarketplaceSearchError] = useState<'timeout' | 'error' | null>(null);
  const [plan, setPlan] = useState<import('@event-horizon/ui').PlanView>({ loaded: false });
  const [plans, setPlans] = useState<import('@event-horizon/ui').PlanSummary[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [roles, setRoles] = useState<Array<{ id: string; name: string; description: string; skills: string[]; instructions: string; builtIn: boolean }>>([]);
  const [roleAssignments, setRoleAssignments] = useState<Array<{ roleId: string; agentType: string | null; agentId: string | null }>>([]);
  const [agentProfiles, setAgentProfiles] = useState<Array<{ agentType: string; totalTasks: number; completedTasks: number; failedTasks: number; overallSuccessRate: number; avgDurationMs: number; avgCostUsd: number; byRole: Record<string, { total: number; completed: number; failed: number; avgDurationMs: number; avgCostUsd: number; avgTokens: number; successRate: number }>; lastUpdated: number }>>([]);
  const [knowledgeWorkspace, setKnowledgeWorkspace] = useState<Array<{ key: string; value: string; scope: 'workspace' | 'plan'; author: string; authorId: string; createdAt: number; updatedAt: number }>>([]);
  const [knowledgePlan, setKnowledgePlan] = useState<Array<{ key: string; value: string; scope: 'workspace' | 'plan'; author: string; authorId: string; createdAt: number; updatedAt: number }>>([]);
  const [heartbeatStatuses, setHeartbeatStatuses] = useState<Record<string, string>>({});
  const [traceSpans, setTraceSpans] = useState<Array<{ id: string; runId: string; spanType: string; name: string; agentId: string; parentSpanId?: string; startMs: number; endMs: number; durationMs: number; metadata: Record<string, unknown> }>>([]);
  const [traceAggregate, setTraceAggregate] = useState<Record<string, number>>({});
  const [mcpServers, setMcpServers] = useState<Record<string, Array<{ name: string; connected: boolean; toolCount: number }>>>({});
  const [compactingAgentIds, setCompactingAgentIds] = useState<Record<string, boolean>>({});
  const [costInsights, setCostInsights] = useState<unknown>(null);
  const [costRecommendations, setCostRecommendations] = useState<string[]>([]);
  const [contextLayers, setContextLayers] = useState<Record<string, unknown> | null>(null);
  const [spawnBeams, setSpawnBeams] = useState<SpawnBeam[]>([]);
  const [orchestratorAgentIds, setOrchestratorAgentIds] = useState<Record<string, boolean>>({});
  const [persistedSearchResults, setPersistedSearchResults] = useState<import('@event-horizon/ui').PersistedSearchResult[] | null>(null);
  const [taskExecutionEvents, setTaskExecutionEvents] = useState<{ taskId: string; events: import('@event-horizon/ui').PersistedSearchResult[] } | null>(null);
  const [wormholes, setWormholes] = useState<Array<{ id: string; sourceAgentId: string; targetAgentId: string; strength: number }>>([]);

  // ── Store selectors ──
  const setSelectedAgentData = useCommandCenterStore((s) => s.setSelectedAgentData);
  const addLog               = useCommandCenterStore((s) => s.addLog);
  const pausedAgentIds       = useCommandCenterStore((s) => s.pausedAgentIds);
  const isolatedAgentId      = useCommandCenterStore((s) => s.isolatedAgentId);
  const boostedAgentIds      = useCommandCenterStore((s) => s.boostedAgentIds);
  const visualSettings       = useCommandCenterStore((s) => s.visualSettings);
  const animationSpeed       = useCommandCenterStore((s) => s.animationSpeed);
  const demoRequested        = useCommandCenterStore((s) => s.demoRequested);
  const infoOpen             = useCommandCenterStore((s) => s.infoOpen);
  const toggleInfo           = useCommandCenterStore((s) => s.toggleInfo);
  const unlockAchievement    = useCommandCenterStore((s) => s.unlockAchievement);
  const incrementTiered      = useCommandCenterStore((s) => s.incrementTieredAchievement);
  const selectedAgentId      = useCommandCenterStore((s) => s.selectedAgentId);
  const centerRequestedAt    = useCommandCenterStore((s) => s.centerRequestedAt);
  const resetLayoutRequestedAt = useCommandCenterStore((s) => s.resetLayoutRequestedAt);
  const connectOpen          = useCommandCenterStore((s) => s.connectOpen);
  const toggleConnect        = useCommandCenterStore((s) => s.toggleConnect);
  const spawnOpen            = useCommandCenterStore((s) => s.spawnOpen);
  const toggleSpawn          = useCommandCenterStore((s) => s.toggleSpawn);
  const createSkillOpen      = useCommandCenterStore((s) => s.createSkillOpen);
  const toggleCreateSkill    = useCommandCenterStore((s) => s.toggleCreateSkill);
  const marketplaceOpen      = useCommandCenterStore((s) => s.marketplaceOpen);
  const toggleMarketplace    = useCommandCenterStore((s) => s.toggleMarketplace);
  const selectSingularity    = useCommandCenterStore((s) => s.selectSingularity);
  const incrementStat        = useCommandCenterStore((s) => s.incrementSingularityStat);
  const _singularityStats    = useCommandCenterStore((s) => s.singularityStats);
  const exportRequestedAt    = useCommandCenterStore((s) => s.exportRequestedAt);
  const screenshotRequestedAt = useCommandCenterStore((s) => s.screenshotRequestedAt);
  const viewMode             = useCommandCenterStore((s) => s.viewMode);
  const settingsHydrated     = useCommandCenterStore((s) => s.settingsHydrated);
  const fontSize             = useCommandCenterStore((s) => s.fontSize);

  // ── Refs ──
  const agentMapRef = useRef(agentMap);
  agentMapRef.current = agentMap;
  const metricsMapRef = useRef(metricsMap);
  metricsMapRef.current = metricsMap;
  const agentLastSeenRef = useRef<Record<string, number>>({});
  const shipTimerIdsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const activeFilesRef = useRef<Map<string, Array<{ agentId: string; ts: number }>>>(new Map());
  const recentSparkPairsRef = useRef<Map<string, number>>(new Map());
  const activeSkillsRef = useRef<Map<string, string>>(new Map());
  const invokedSkillNamesRef = useRef<Set<string>>(new Set());

  // ── Extracted hooks ──
  useWebviewMessages({
    vscodeApi, setAgents, setConnectedAgentTypes, setAgentMap, setMetricsMap,
    setShips, setSparks, setActiveSkillsView,
    setMarketplaceSearchResults, setMarketplaceSearchLoading, setMarketplaceSearchSource, setMarketplaceSearchError,
    agentMapRef, metricsMapRef, agentLastSeenRef,
    activeFilesRef, recentSparkPairsRef, activeSkillsRef, invokedSkillNamesRef,
    shipTimerIdsRef, addLog, incrementTiered, setPlan, setPlans,
    setRoles, setRoleAssignments, setAgentProfiles,
    setKnowledgeWorkspace, setKnowledgePlan,
    setHeartbeatStatuses,
    setTraceSpans, setTraceAggregate,
    setMcpServers, setCompactingAgentIds,
    setSpawnBeams, setOrchestratorAgentIds,
    setCostInsights, setCostRecommendations,
    setContextLayers,
    setPersistedSearchResults,
    setTaskExecutionEvents,
    setWormholes,
  });

  const achievementCallbacks = useAchievementTriggers({
    agents, agentMap, ships, selectedAgentId,
    unlockAchievement, incrementTiered, incrementStat, selectSingularity,
  });

  const { demoSimRunning } = useDemoSimulation({
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
  });

  useSettingsPersistence(vscodeApi);

  // ── Sync selected agent data ──
  useEffect(() => {
    if (!selectedAgentId) return;
    const agent = agentMap[selectedAgentId];
    const metric = metricsMap[selectedAgentId];
    if (agent || metric) setSelectedAgentData(agent ?? null, metric ?? null);
  }, [selectedAgentId, agentMap, metricsMap, setSelectedAgentData]);

  // Planets are only removed by explicit agent.terminate events.
  // No automatic stale-agent cleanup — idle agents stay visible indefinitely.

  // ── Clean up ship timers on unmount ──
  useEffect(() => () => { for (const id of shipTimerIdsRef.current) clearTimeout(id); }, []);

  // ── Skill actions ──
  const handleOpenSkill = useCallback((filePath: string) => { vscodeApi?.postMessage({ type: 'open-skill-file', filePath }); }, []);
  const handleCreateSkill = useCallback((req: CreateSkillRequest) => { vscodeApi?.postMessage({ type: 'create-skill', ...req }); toggleCreateSkill(); }, [toggleCreateSkill]);
  const handleMoveSkill = useCallback((filePath: string, newCategory: string) => { vscodeApi?.postMessage({ type: 'move-skill', filePath, newCategory }); }, []);
  const handleDuplicateSkill = useCallback((filePath: string, newName: string) => { vscodeApi?.postMessage({ type: 'duplicate-skill', filePath, newName }); }, []);

  // ── Role actions ──
  const handleAssignRole = useCallback((roleId: string, agentType: string) => { vscodeApi?.postMessage({ type: 'assign-role', roleId, agentType }); }, []);
  const handleCreateRole = useCallback((role: { id: string; name: string; description: string; skills: string[]; instructions: string }) => { vscodeApi?.postMessage({ type: 'create-role', role }); }, []);
  const handleEditRole = useCallback((role: { id: string; name: string; description: string; skills: string[]; instructions: string }) => { vscodeApi?.postMessage({ type: 'edit-role', role }); }, []);
  const handleDeleteRole = useCallback((roleId: string) => { vscodeApi?.postMessage({ type: 'delete-role', roleId }); }, []);

  // ── Marketplace actions ──
  const handleMarketplaceBrowse = useCallback((url: string) => { vscodeApi?.postMessage({ type: 'open-marketplace-url', url }); }, []);
  const handleMarketplaceSearch = useCallback((marketplaceUrl: string, query: string) => {
    setMarketplaceSearchLoading(true); setMarketplaceSearchSource(marketplaceUrl);
    setMarketplaceSearchResults([]); setMarketplaceSearchError(null);
    vscodeApi?.postMessage({ type: 'marketplace-search', marketplaceUrl, query });
  }, []);
  const handleInstallSkill = useCallback((result: MarketplaceSkillResult) => { vscodeApi?.postMessage({ type: 'install-skill-from-url', ...result }); }, []);

  // ── Planet hover / click ──
  useEffect(() => {
    let rafId = 0;
    const onMove = (e: MouseEvent) => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => { setMousePos({ x: e.clientX, y: e.clientY }); rafId = 0; });
    };
    window.addEventListener('mousemove', onMove);
    return () => { window.removeEventListener('mousemove', onMove); if (rafId) cancelAnimationFrame(rafId); };
  }, []);

  const handlePlanetHover = useCallback((agentId: string | null) => { setHoveredAgentId(agentId); }, []);
  const handlePlanetClick = useCallback((agentId: string) => {
    const agent = agentMap[agentId]; const metric = metricsMap[agentId];
    setSelectedAgentData(agent ?? null, metric ?? null);
  }, [agentMap, metricsMap, setSelectedAgentData]);

  // ── Export session ──
  useEffect(() => {
    if (!exportRequestedAt) return;
    const agentArray = Object.values(agentMap);
    const metricsArray = Object.fromEntries(
      Object.entries(metricsMap).map(([id, m]) => [id, {
        load: m.load, toolCalls: m.toolCalls, toolFailures: m.toolFailures,
        promptsSubmitted: m.promptsSubmitted, errorCount: m.errorCount,
        subagentSpawns: m.subagentSpawns, activeSubagents: m.activeSubagents,
        activeTasks: m.activeTasks, uptime: Date.now() - m.sessionStartedAt, toolBreakdown: m.toolBreakdown,
      }]),
    );
    const store = useCommandCenterStore.getState();
    const exportData = {
      exportedAt: new Date().toISOString(),
      agents: agentArray.map((a) => ({ id: a.id, name: a.name, type: a.type, state: a.state, cwd: a.cwd })),
      metrics: metricsArray,
      singularity: store.singularityStats,
      achievements: { unlocked: store.unlockedAchievements, tiers: store.achievementTiers, counts: store.achievementCounts },
    };
    const json = JSON.stringify(exportData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `event-horizon-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
    a.click(); URL.revokeObjectURL(url);
  }, [exportRequestedAt]);

  // ── Screenshot ──
  useEffect(() => {
    if (!screenshotRequestedAt) return;
    void (async () => {
      try {
        const html2canvas = (await import('html2canvas')).default;
        const glCanvas = document.querySelector('canvas') as HTMLCanvasElement | null;
        const frameDataUrl = glCanvas ? glCanvas.toDataURL('image/png') : null;
        const result = await html2canvas(document.documentElement, {
          backgroundColor: '#0a0a12', useCORS: true, scale: window.devicePixelRatio || 1,
          onclone: (clonedDoc) => {
            if (!frameDataUrl) return;
            const clonedCanvas = clonedDoc.querySelector('canvas');
            if (!clonedCanvas) return;
            const img = clonedDoc.createElement('img');
            img.src = frameDataUrl;
            img.style.cssText = clonedCanvas.style.cssText;
            img.style.width = clonedCanvas.style.width || `${clonedCanvas.clientWidth}px`;
            img.style.height = clonedCanvas.style.height || `${clonedCanvas.clientHeight}px`;
            clonedCanvas.parentNode?.replaceChild(img, clonedCanvas);
          },
        });
        const stats = useCommandCenterStore.getState().singularityStats;
        const agentCount = agents.length;
        const dpr = window.devicePixelRatio || 1;
        const footerH = Math.round(32 * dpr);
        const final = document.createElement('canvas');
        final.width = result.width; final.height = result.height + footerH;
        const ctx = final.getContext('2d')!;
        ctx.drawImage(result, 0, 0);
        ctx.fillStyle = '#060a08'; ctx.fillRect(0, result.height, result.width, footerH);
        ctx.fillStyle = 'rgba(50,120,70,0.4)'; ctx.fillRect(0, result.height, result.width, Math.round(1 * dpr));
        const fontSize = Math.round(10 * dpr); const smallFontSize = Math.round(8.5 * dpr);
        ctx.textBaseline = 'middle'; const centerY = result.height + footerH / 2; const pad = Math.round(12 * dpr);
        ctx.font = `600 ${fontSize}px Consolas, monospace`; ctx.fillStyle = '#78b890'; ctx.fillText('EVENT HORIZON', pad, centerY);
        const brandW = ctx.measureText('EVENT HORIZON').width;
        ctx.font = `${smallFontSize}px Consolas, monospace`; ctx.fillStyle = '#3a6a4a'; const sep = Math.round(8 * dpr);
        ctx.fillText('|', pad + brandW + sep, centerY); const pipeW = ctx.measureText('|').width;
        const statsItems: string[] = [];
        if (agentCount > 0) statsItems.push(`${agentCount} agent${agentCount !== 1 ? 's' : ''}`);
        if (stats.totalTokens > 0) statsItems.push(`${(stats.totalTokens / 1000).toFixed(0)}k tokens`);
        if (stats.totalCostUsd > 0) statsItems.push(`$${stats.totalCostUsd.toFixed(2)}`);
        if (stats.eventsWitnessed > 0) statsItems.push(`${stats.eventsWitnessed} events`);
        const statsText = statsItems.length > 0 ? statsItems.join('  ·  ') : 'AI agent monitor for VS Code';
        ctx.fillStyle = '#4a7a5a'; ctx.fillText(statsText, pad + brandW + sep + pipeW + sep, centerY);
        const now = new Date(); const rightText = `${now.toISOString().slice(0, 10)}  ${now.toTimeString().slice(0, 5)}`;
        ctx.fillStyle = '#2a5040'; const rightW = ctx.measureText(rightText).width;
        ctx.fillText(rightText, result.width - pad - rightW, centerY);
        const dataUrl = final.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = dataUrl; a.download = `event-horizon-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.png`; a.click();
      } catch { /* capture failed */ }
    })();
  }, [screenshotRequestedAt, agents.length]);

  // ── Derived state ──
  const hasAgents = agents.length > 0;
  const hasInstalledHooks = connectedAgentTypes.length > 0;
  const showOnboarding = !hasAgents && !hasInstalledHooks && !onboardingDismissed && !demoSimRunning;
  const agentStates = Object.fromEntries(Object.entries(agentMap).map(([k, v]) => [k, v.state ?? 'idle']));
  const metricsView = useMemo(() => Object.fromEntries(Object.entries(metricsMap).map(([k, v]) => [k, { load: v.load }])), [metricsMap]);
  const activeSubagentsView = useMemo(() => Object.fromEntries(Object.entries(metricsMap).map(([k, v]) => [k, v.activeSubagents ?? 0])), [metricsMap]);
  const skills = useCommandCenterStore((s) => s.skills);
  const agentSkillCounts = useMemo(
    () => Object.fromEntries(agents.map((a) => {
      const at = a.agentType ?? 'unknown';
      const count = skills.filter((s) => s.agentTypes.includes(at as 'claude-code' | 'opencode' | 'copilot')).length;
      return [a.id, count];
    })),
    [agents, skills],
  );
  const planDebris = useMemo(() => {
    if (!plan.loaded || !plan.tasks) return null;
    return {
      tasks: plan.tasks.map((t) => ({
        id: t.id,
        status: t.status as 'pending' | 'claimed' | 'in_progress' | 'done' | 'failed' | 'blocked',
        assigneeId: t.assigneeId ?? null,
        role: t.role ?? null,
        retryCount: (t as Record<string, unknown>).retryCount as number | undefined,
        failedReason: (t as Record<string, unknown>).failedReason as string | null | undefined,
        blockedBy: t.blockedBy,
      })),
    };
  }, [plan]);
  const selectedAgentRole = useMemo(() => {
    if (!plan?.tasks || !selectedAgentId) return null;
    const task = plan.tasks.find(t => t.assigneeId === selectedAgentId && (t.status === 'claimed' || t.status === 'in_progress') && t.role);
    return task?.role ?? null;
  }, [plan, selectedAgentId]);

  // Compute recommendedFor for plan tasks based on roleAssignments
  const planTasksWithRecommendations = useMemo(() => {
    if (!plan.loaded || !plan.tasks) return plan;
    const updated = plan.tasks.map((t) => {
      if (t.role && roleAssignments.length > 0) {
        const assignment = roleAssignments.find((ra) => ra.roleId === t.role);
        if (assignment?.agentType) {
          return { ...t, recommendedFor: assignment.agentType };
        }
      }
      return t;
    });
    return { ...plan, tasks: updated };
  }, [plan, roleAssignments]);

  // Knowledge counts and recent entries for AgentIdentity
  const knowledgeCount = useMemo(() => ({
    workspace: knowledgeWorkspace.length,
    plan: knowledgePlan.length,
  }), [knowledgeWorkspace, knowledgePlan]);

  const recentKnowledge = useMemo(() => {
    const all = [...knowledgeWorkspace, ...knowledgePlan]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 3)
      .map((k) => ({ key: k.key, value: k.value, scope: k.scope }));
    return all;
  }, [knowledgeWorkspace, knowledgePlan]);

  // Compute knowledge links for constellation visualization
  const knowledgeLinksComputed = useMemo<KnowledgeLink[]>(() => {
    const links: KnowledgeLink[] = [];
    const allEntries = [...knowledgeWorkspace, ...knowledgePlan];
    // Group by author pairs — each pair of agents that share knowledge gets a link
    const pairCounts = new Map<string, { fromAgentId: string; toAgentId: string; scope: 'workspace' | 'plan'; authorIsUser: boolean; count: number }>();
    const agentIdSet = new Set(agents.map(a => a.id));

    for (const entry of allEntries) {
      const authorId = entry.authorId;
      if (!authorId) continue;
      // Create links from author to all other agents
      for (const agent of agents) {
        if (agent.id === authorId) continue;
        const key = [authorId, agent.id].sort().join('::') + '::' + entry.scope;
        const existing = pairCounts.get(key);
        const isUser = entry.author === 'user' || !agentIdSet.has(authorId);
        if (existing) {
          existing.count++;
        } else {
          pairCounts.set(key, {
            fromAgentId: authorId,
            toAgentId: agent.id,
            scope: entry.scope as 'workspace' | 'plan',
            authorIsUser: isUser,
            count: 1,
          });
        }
      }
    }
    for (const link of pairCounts.values()) {
      links.push(link);
    }
    return links;
  }, [knowledgeWorkspace, knowledgePlan, agents]);

  // Compute budget info from plan metadata + cost tracking
  const budgetInfo = useMemo(() => {
    if (!plan.loaded || !plan.maxBudgetUsd || plan.maxBudgetUsd <= 0) return null;
    // Sum up cost from all agent metrics
    let totalSpent = 0;
    for (const m of Object.values(metricsMap)) {
      if (m.estimatedCostUsd !== undefined && m.estimatedCostUsd >= 0) {
        totalSpent += m.estimatedCostUsd;
      }
    }
    const limit = plan.maxBudgetUsd;
    return { spent: totalSpent, limit, percentUsed: (totalSpent / limit) * 100 };
  }, [plan, metricsMap]);

  // Agent types map for constellation coloring
  const agentTypesMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const a of agents) {
      if (a.agentType) map[a.id] = a.agentType;
    }
    return map;
  }, [agents]);

  // Tell All: ask extension host to prompt user, then broadcast as knowledge
  const tellAllRequestedAt = useCommandCenterStore((s) => s.tellAllRequestedAt);
  useEffect(() => {
    if (!tellAllRequestedAt) return;
    vscodeApi?.postMessage({ type: 'tell-all-prompt' });
  }, [tellAllRequestedAt]);

  const hoveredAgent = hoveredAgentId ? agentMap[hoveredAgentId] : null;
  const hoveredMetrics = hoveredAgentId ? metricsMap[hoveredAgentId] : null;
  const panelSize = usePanelSize();

  // ── Render ──
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', minHeight: 380, flex: 1, background: 'transparent', zoom: fontSize === 'small' ? 0.87 : fontSize === 'large' ? 1.15 : 1 }}>
      {/* Universe view — hidden (not unmounted) when Operations is active to preserve PixiJS state.
           Also hidden until settings have hydrated, so user's defaultView preference wins over the initial default. */}
      <div style={{ flex: 1, display: settingsHydrated && viewMode === 'universe' ? 'flex' : 'none', flexDirection: 'column', position: 'relative' }}>
        <div ref={panelSize.ref} data-tour="universe" style={{ flex: 1, minHeight: 0, position: 'relative', background: 'transparent' }}>
          <RandomStarfield />
          <Universe
            width={panelSize.width} height={panelSize.height} agents={agents}
            metrics={metricsView} visualSettings={visualSettings} animationSpeed={animationSpeed}
            activeSubagents={activeSubagentsView} agentSkillCounts={agentSkillCounts}
            activeSkills={activeSkillsView} ships={ships} sparks={sparks}
            agentStates={agentStates} pausedAgentIds={pausedAgentIds}
            isolatedAgentId={isolatedAgentId} boostedAgentIds={boostedAgentIds}
            selectedAgentId={selectedAgentId} centerRequestedAt={centerRequestedAt}
            resetLayoutRequestedAt={resetLayoutRequestedAt}
            onPlanetHover={handlePlanetHover} onPlanetClick={handlePlanetClick}
            onAstronautConsumed={achievementCallbacks.handleAstronautConsumed}
            onAstronautSpawned={achievementCallbacks.handleAstronautSpawned}
            onUfoAbduction={achievementCallbacks.handleUfoAbduction}
            onUfoClicked={achievementCallbacks.handleUfoClicked}
            onSingularityClick={achievementCallbacks.handleSingularityClick}
            onUfoConsumed={achievementCallbacks.handleUfoConsumed}
            onAstronautTrapped={achievementCallbacks.handleAstronautTrapped}
            onAstronautEscaped={achievementCallbacks.handleAstronautEscaped}
            onAstronautGrazed={achievementCallbacks.handleAstronautGrazed}
            onAstronautLanded={achievementCallbacks.handleAstronautLanded}
            onAstronautBounced={achievementCallbacks.handleAstronautBounced}
            onRocketMan={achievementCallbacks.handleRocketMan}
            onTrickShot={achievementCallbacks.handleTrickShot}
            onKamikaze={achievementCallbacks.handleKamikaze}
            onCowDrop={achievementCallbacks.handleCowDrop}
            onShootingStarClicked={achievementCallbacks.handleShootingStarClicked}
            planTasks={planDebris}
            visible={viewMode === 'universe'}
            orchestratorAgentIds={orchestratorAgentIds}
            heartbeatStatuses={heartbeatStatuses}
            mcpServers={mcpServers}
            compactingAgentIds={compactingAgentIds}
            spawnBeams={spawnBeams}
            knowledgeLinks={knowledgeLinksComputed}
            agentTypesMap={agentTypesMap}
            contextUsage={contextLayers ? Object.fromEntries(
              Object.entries(contextLayers).map(([id, layer]) => [id, (layer as { usageRatio?: number }).usageRatio ?? 0])
            ) : undefined}
            wormholes={wormholes}
          />
        </div>
        {showOnboarding && <OnboardingCard onDismiss={() => setOnboardingDismissed(true)} onConnect={toggleConnect} />}
        <CommandCenter role={selectedAgentRole} knowledgeCount={knowledgeCount} recentKnowledge={recentKnowledge} budgetInfo={budgetInfo} onOpenSkill={handleOpenSkill} onCreateSkill={toggleCreateSkill} onOpenMarketplace={toggleMarketplace} onMoveSkill={handleMoveSkill} onDuplicateSkill={handleDuplicateSkill} />
      </div>

      {settingsHydrated && viewMode === 'operations' && (
        <OperationsView agents={agents} agentMap={agentMap} metricsMap={metricsMap} agentStates={agentStates}
          plan={planTasksWithRecommendations} plans={plans} selectedPlanId={selectedPlanId}
          roles={roles} roleAssignments={roleAssignments} agentProfiles={agentProfiles}
          onAssignRole={handleAssignRole} onCreateRole={handleCreateRole} onEditRole={handleEditRole} onDeleteRole={handleDeleteRole}
          onSelectPlan={(id) => { setSelectedPlanId(id); vscodeApi?.postMessage({ type: 'request-plan', planId: id }); }}
          onOpenSkill={handleOpenSkill} onCreateSkill={toggleCreateSkill} onOpenMarketplace={toggleMarketplace}
          onMoveSkill={handleMoveSkill} onDuplicateSkill={handleDuplicateSkill}
          knowledgeWorkspace={knowledgeWorkspace} knowledgePlan={knowledgePlan} knowledgePlanName={plan?.name}
          onKnowledgeAdd={(key, value, scope, validUntil, tier) => vscodeApi?.postMessage({ type: 'knowledge-add', key, value, scope, validUntil, tier })}
          onKnowledgeEdit={(key, value, scope, validUntil, tier) => vscodeApi?.postMessage({ type: 'knowledge-edit', key, value, scope, validUntil, tier })}
          onKnowledgeDelete={(key, scope) => vscodeApi?.postMessage({ type: 'knowledge-delete', key, scope })}
          traceSpans={traceSpans as import('@event-horizon/ui').OperationsViewProps['traceSpans']}
          traceAggregate={traceAggregate}
          costInsights={costInsights as CostInsightsData | null}
          costRecommendations={costRecommendations}
          contextLayers={contextLayers as Record<string, import('@event-horizon/ui').ContextLayerBreakdown> | null}
          onPersistedSearch={(query, opts) => vscodeApi?.postMessage({ type: 'search-events', query, ...(opts ?? {}) })}
          persistedSearchResults={persistedSearchResults}
          onClearPersistedSearch={() => setPersistedSearchResults(null)}
          onViewExecution={(taskId, agentId, claimTime, completeTime) => vscodeApi?.postMessage({ type: 'request-task-execution', taskId, agentId, claimTime, completeTime })}
          taskExecution={taskExecutionEvents as { taskId: string; events: import('@event-horizon/ui').TaskExecutionEvent[] } | null}
          onCloseExecution={() => setTaskExecutionEvents(null)}
          onAddToSharedKnowledge={(file) => vscodeApi?.postMessage({ type: 'knowledge-add', key: file, value: `File frequently read by multiple agents: ${file}`, scope: 'workspace' })} />
      )}

      <AchievementToasts />
      {infoOpen && <InfoOverlay extensionVersion={extensionVersion} onClose={toggleInfo} />}
      {connectOpen && <ConnectModal connectedAgentTypes={connectedAgentTypes} vscodeApi={vscodeApi} onClose={toggleConnect} />}
      {spawnOpen && <SpawnModal vscodeApi={vscodeApi} onClose={toggleSpawn} />}
      {createSkillOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={toggleCreateSkill}>
          <div style={{ background: 'linear-gradient(180deg, #0b1a12 0%, #060e09 100%)', border: '1px solid #1e4030', boxShadow: '0 4px 32px rgba(0,0,0,0.85)', clipPath: 'polygon(16px 0, 100% 0, 100% 100%, 0 100%, 0 16px)', padding: '14px 16px', width: 'min(420px, 90vw)', maxHeight: 'min(600px, 85vh)', overflowY: 'auto', fontFamily: 'Consolas, monospace' }} onClick={(e) => e.stopPropagation()}>
            <CreateSkillWizard onClose={toggleCreateSkill} onCreate={handleCreateSkill} />
          </div>
        </div>
      )}
      {marketplaceOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={toggleMarketplace}>
          <div style={{ background: 'linear-gradient(180deg, #0b1a12 0%, #060e09 100%)', border: '1px solid #1e4030', boxShadow: '0 4px 32px rgba(0,0,0,0.85)', clipPath: 'polygon(16px 0, 100% 0, 100% 100%, 0 100%, 0 16px)', padding: '14px 16px', width: 'min(480px, 92vw)', maxHeight: 'min(650px, 88vh)', overflowY: 'auto', fontFamily: 'Consolas, monospace' }} onClick={(e) => e.stopPropagation()}>
            <MarketplacePanel onClose={toggleMarketplace} onBrowse={handleMarketplaceBrowse} onSearch={handleMarketplaceSearch}
              onInstallSkill={handleInstallSkill} searchResults={marketplaceSearchResults} searchLoading={marketplaceSearchLoading}
              searchSource={marketplaceSearchSource} searchError={marketplaceSearchError} />
          </div>
        </div>
      )}
      <SettingsModal />
      {hoveredAgentId && hoveredAgent && (
        <div style={{ position: 'fixed', left: Math.min(mousePos.x + 14, window.innerWidth - 180), top: Math.min(Math.max(mousePos.y - 60, 8), window.innerHeight - 250), zIndex: 1000, pointerEvents: 'none' }}>
          <Tooltip agentName={hoveredAgent.name} loadPercent={Math.round((hoveredMetrics?.load ?? 0.5) * 100)} activeTask={hoveredAgent.currentTaskId} cwd={hoveredAgent.cwd} />
        </div>
      )}
    </div>
  );
}

const rootEl = document.getElementById('root');
if (rootEl) {
  try {
    const root = createRoot(rootEl);
    root.render(<ErrorBoundary><App /></ErrorBoundary>);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    rootEl.textContent = `Error: ${msg}`;
    if (typeof (window as unknown as { __ehScriptLoadError?: (m: string) => void }).__ehScriptLoadError === 'function') {
      (window as unknown as { __ehScriptLoadError: (m: string) => void }).__ehScriptLoadError('Error: ' + msg);
    }
  }
}
