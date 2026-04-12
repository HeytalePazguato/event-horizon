/**
 * Operations View — full-screen dashboard alternative to the Universe.
 * Left: agent sidebar. Right: tabbed content (Overview, Files, Logs, Timeline).
 * @event-horizon/ui
 */

import type { FC } from 'react';
import { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { AgentState, AgentMetrics } from '@event-horizon/core';
import { useCommandCenterStore } from './store.js';
import { AgentSidebar } from './panels/AgentSidebar.js';
import { OverviewPanel } from './panels/OverviewPanel.js';
import { FileHeatmapFull } from './panels/FileHeatmapFull.js';
import { LogsPanel } from './panels/LogsPanel.js';
import { TimelinePanel } from './panels/TimelinePanel.js';
import { SkillsPanel } from './panels/SkillsPanel.js';
import { PlanPanel } from './panels/PlanPanel.js';
import type { PlanView, PlanSummary } from './panels/PlanPanel.js';
import { RolesPanel } from './panels/RolesPanel.js';
import { KnowledgePanel } from './panels/KnowledgePanel.js';
import type { KnowledgeEntry } from './panels/KnowledgePanel.js';
import { TracesPanel } from './panels/TracesPanel.js';
import type { TraceSpanView } from './panels/TracesPanel.js';
import { CostInsightsPanel } from './panels/CostInsightsPanel.js';
import type { CostInsightsData } from './panels/CostInsightsPanel.js';
type OpsTab = 'overview' | 'activity' | 'files' | 'skills' | 'plan' | 'roles' | 'knowledge' | 'costs';
type ActivityView = 'timeline' | 'traces' | 'logs';

const tabStyle = (active: boolean): React.CSSProperties => ({
  padding: '6px 16px',
  fontSize: 13,
  fontFamily: 'Consolas, monospace',
  border: 'none',
  borderBottom: active ? '2px solid #40a060' : '2px solid transparent',
  background: 'transparent',
  color: active ? '#90d898' : '#4a7a58',
  cursor: 'pointer',
  fontWeight: active ? 600 : 400,
  letterSpacing: '0.03em',
});

export interface OperationsViewProps {
  agents: Array<{ id: string; name: string; agentType: string; cwd?: string }>;
  agentMap: Record<string, AgentState>;
  metricsMap: Record<string, AgentMetrics>;
  agentStates: Record<string, string>;
  plan?: PlanView;
  plans?: PlanSummary[];
  selectedPlanId?: string | null;
  onSelectPlan?: (id: string) => void;
  onOpenSkill?: (filePath: string) => void;
  onCreateSkill?: () => void;
  onOpenMarketplace?: () => void;
  onMoveSkill?: (filePath: string, newCategory: string) => void;
  onDuplicateSkill?: (filePath: string, newName: string) => void;
  roles?: Array<{ id: string; name: string; description: string; skills: string[]; instructions: string; builtIn: boolean }>;
  roleAssignments?: Array<{ roleId: string; agentType: string | null; agentId: string | null }>;
  agentProfiles?: Array<{ agentType: string; totalTasks: number; completedTasks: number; failedTasks: number; overallSuccessRate: number; avgDurationMs: number; avgCostUsd: number; byRole: Record<string, { total: number; completed: number; failed: number; avgDurationMs: number; avgCostUsd: number; avgTokens: number; successRate: number }>; lastUpdated: number }>;
  onAssignRole?: (roleId: string, agentType: string) => void;
  onCreateRole?: (role: { id: string; name: string; description: string; skills: string[]; instructions: string }) => void;
  onEditRole?: (role: { id: string; name: string; description: string; skills: string[]; instructions: string }) => void;
  onDeleteRole?: (roleId: string) => void;
  knowledgeWorkspace?: KnowledgeEntry[];
  knowledgePlan?: KnowledgeEntry[];
  knowledgePlanName?: string;
  onKnowledgeAdd?: (key: string, value: string, scope: 'workspace' | 'plan', validUntil?: number, tier?: import('./panels/KnowledgePanel.js').KnowledgeTier) => void;
  onKnowledgeEdit?: (key: string, value: string, scope: 'workspace' | 'plan', validUntil?: number, tier?: import('./panels/KnowledgePanel.js').KnowledgeTier) => void;
  onKnowledgeDelete?: (key: string, scope: 'workspace' | 'plan') => void;
  traceSpans?: TraceSpanView[];
  traceAggregate?: Record<string, number>;
  costInsights?: CostInsightsData | null;
  costRecommendations?: string[];
  contextLayers?: Record<string, import('./panels/CostInsightsPanel.js').ContextLayerBreakdown> | null;
  onAddToSharedKnowledge?: (file: string) => void;
  /** Trigger a persistence-backed event search (Phase 4.2). */
  onPersistedSearch?: (query: string, opts?: { agentId?: string; type?: string; since?: number }) => void;
  /** Results from the last persisted search — when non-null, replaces live log feed. */
  persistedSearchResults?: import('./panels/LogsPanel.js').PersistedSearchResult[] | null;
  /** Callback to clear persisted search and return to live mode. */
  onClearPersistedSearch?: () => void;
  /** Trigger an execution drill-down for a done/failed task (Phase 4.5). */
  onViewExecution?: (taskId: string, agentId: string, claimTime: number, completeTime: number) => void;
  /** Events returned for the most recent drill-down request. */
  taskExecution?: { taskId: string; events: import('./panels/PlanPanel.js').TaskExecutionEvent[] } | null;
  /** Close the execution modal. */
  onCloseExecution?: () => void;
}

const OPS_TOOLTIP_STYLE: React.CSSProperties = {
  position: 'fixed',
  top: 8,
  right: 12,
  width: 220,
  background: 'linear-gradient(180deg, #0d1e16 0%, #070f0a 100%)',
  border: '1px solid #2a5a3c',
  boxShadow: '0 4px 16px rgba(0,0,0,0.75)',
  padding: '8px 10px',
  fontFamily: 'Consolas, monospace',
  zIndex: 9999,
  pointerEvents: 'none',
  clipPath: 'polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%)',
};

export const OperationsView: FC<OperationsViewProps> = ({ agents, agentMap, metricsMap, agentStates, plan, plans = [], selectedPlanId, onSelectPlan, onOpenSkill, onCreateSkill, onOpenMarketplace, onMoveSkill, onDuplicateSkill, roles, roleAssignments, agentProfiles, onAssignRole, onCreateRole, onEditRole, onDeleteRole, knowledgeWorkspace = [], knowledgePlan = [], knowledgePlanName, onKnowledgeAdd, onKnowledgeEdit, onKnowledgeDelete, traceSpans = [], traceAggregate = {}, costInsights = null, costRecommendations = [], contextLayers = null, onAddToSharedKnowledge, onPersistedSearch, persistedSearchResults = null, onClearPersistedSearch, onViewExecution, taskExecution = null, onCloseExecution }) => {
  const [activeTab, setActiveTab] = useState<OpsTab>('overview');
  const [activityView, setActivityView] = useState<ActivityView>('timeline');
  const [hoveredTooltip, setHoveredTooltip] = useState<string | null>(null);
  const toggleViewMode = useCommandCenterStore((s) => s.toggleViewMode);
  const fileLockingEnabled = useCommandCenterStore((s) => s.fileLockingEnabled);
  const setFileLockingEnabled = useCommandCenterStore((s) => s.setFileLockingEnabled);
  const worktreeIsolation = useCommandCenterStore((s) => s.worktreeIsolation);
  const setWorktreeIsolation = useCommandCenterStore((s) => s.setWorktreeIsolation);
  const demoMode = useCommandCenterStore((s) => s.demoMode);
  const demoStartedAt = useCommandCenterStore((s) => s.demoStartedAt);
  const requestDemo = useCommandCenterStore((s) => s.requestDemo);
  const toggleConnect = useCommandCenterStore((s) => s.toggleConnect);
  const toggleSpawn = useCommandCenterStore((s) => s.toggleSpawn);
  const requestExport = useCommandCenterStore((s) => s.requestExport);
  const requestScreenshot = useCommandCenterStore((s) => s.requestScreenshot);
  const requestTellAll = useCommandCenterStore((s) => s.requestTellAll);
  const toggleInfo = useCommandCenterStore((s) => s.toggleInfo);
  const toggleSettings = useCommandCenterStore((s) => s.toggleSettings);
  const skillsCount = useCommandCenterStore((s) => s.skills.length);

  // Agent cwd map for timeline labels
  const agentCwds = useMemo(
    () => Object.fromEntries(Object.entries(agentMap).map(([id, a]) => [id, a.cwd])),
    [agentMap],
  );

  // Demo elapsed timer — use interval, not setState during render (that was causing crashes)
  const [demoElapsed, setDemoElapsed] = useState('');
  useEffect(() => {
    if (!demoMode || !demoStartedAt) { setDemoElapsed(''); return; }
    const tick = () => {
      const secs = Math.floor((Date.now() - demoStartedAt) / 1000);
      const m = Math.floor(secs / 60);
      const s = secs % 60;
      setDemoElapsed(`${m}:${s.toString().padStart(2, '0')}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [demoMode, demoStartedAt]);

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      background: 'linear-gradient(180deg, #080e0a 0%, #040806 100%)',
      fontFamily: 'Consolas, monospace',
      minHeight: 0,
    }}>
      {/* Main content area */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Left sidebar */}
        <AgentSidebar agents={agents} agentStates={agentStates} plans={plans} selectedPlanId={selectedPlanId} onSelectPlan={(id) => { onSelectPlan?.(id); setActiveTab('plan'); }} />

        {/* Right: tabs + content */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
          {/* Tab bar + command buttons */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            borderBottom: '1px solid #1a3020',
            background: 'rgba(8,16,10,0.8)',
            flexShrink: 0,
          }}>
            <button type="button" style={tabStyle(activeTab === 'overview')} onClick={() => setActiveTab('overview')}>Overview</button>
            <button type="button" style={tabStyle(activeTab === 'activity')} onClick={() => setActiveTab('activity')}>Activity</button>
            <button type="button" style={tabStyle(activeTab === 'files')} onClick={() => setActiveTab('files')}>Files</button>
            <button type="button" style={tabStyle(activeTab === 'skills')} onClick={() => setActiveTab('skills')}>
              Skills{skillsCount > 0 ? ` (${skillsCount})` : ''}
            </button>
            <button type="button" style={tabStyle(activeTab === 'plan')} onClick={() => setActiveTab('plan')}>
              Plan{plan?.tasks ? ` (${plan.tasks.filter((t) => t.status === 'done').length}/${plan.tasks.length})` : ''}
            </button>
            <button type="button" style={tabStyle(activeTab === 'roles')} onClick={() => setActiveTab('roles')}>
              Roles{roles && roles.length > 0 ? ` (${roles.length})` : ''}
            </button>
            <button type="button" style={tabStyle(activeTab === 'costs')} onClick={() => setActiveTab('costs')}>
              Costs{costRecommendations.length > 0 ? ` (${costRecommendations.length})` : ''}
            </button>
            <button type="button" style={tabStyle(activeTab === 'knowledge')} onClick={() => setActiveTab('knowledge')}>
              Knowledge{(knowledgeWorkspace.length + knowledgePlan.length) > 0 ? ` (${knowledgeWorkspace.length + knowledgePlan.length})` : ''}
            </button>

            {/* Command buttons — right-aligned */}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, padding: '0 8px' }}>
              {([
                { label: 'Connect', action: toggleConnect },
                { label: 'Spawn', action: toggleSpawn },
                { label: 'Export', action: requestExport },
                { label: 'Screenshot', action: requestScreenshot },
                { label: 'Tell All', action: requestTellAll },
                { label: 'Demo', action: requestDemo },
                { label: 'Info', action: toggleInfo },
                { label: 'Settings', action: toggleSettings },
              ] as Array<{ label: string; action: () => void }>).map((cmd) => (
                <button
                  key={cmd.label}
                  type="button"
                  onClick={cmd.action}
                  style={{
                    padding: '3px 8px',
                    border: '1px solid #1a3020',
                    borderRadius: 2,
                    background: 'transparent',
                    color: '#4a7a58',
                    fontSize: 10,
                    fontFamily: 'Consolas, monospace',
                    cursor: 'pointer',
                  }}
                >
                  {cmd.label}
                </button>
              ))}
            </div>
          </div>

          {/* Tab content */}
          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            {activeTab === 'overview' && (
              <OverviewPanel agentMap={agentMap} metricsMap={metricsMap} />
            )}
            {activeTab === 'files' && (
              <div style={{ padding: 16, height: '100%', boxSizing: 'border-box' }}>
                <FileHeatmapFull />
              </div>
            )}
            {activeTab === 'activity' && (
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
                {/* Activity sub-toggle */}
                <div style={{ display: 'flex', gap: 0, flexShrink: 0, padding: '8px 16px 0', background: 'rgba(8,16,10,0.5)' }}>
                  {([
                    { id: 'timeline' as ActivityView, label: 'Timeline' },
                    { id: 'traces' as ActivityView, label: 'Traces' },
                    { id: 'logs' as ActivityView, label: 'Logs' },
                  ]).map((v) => (
                    <button key={v.id} type="button" onClick={() => setActivityView(v.id)} style={{
                      padding: '4px 12px', border: 'none', fontSize: 11, fontFamily: 'Consolas, monospace', cursor: 'pointer',
                      background: activityView === v.id ? 'rgba(30,70,45,0.4)' : 'transparent',
                      color: activityView === v.id ? '#90d898' : '#4a7a58',
                      borderBottom: activityView === v.id ? '2px solid #40a060' : '2px solid transparent',
                      fontWeight: activityView === v.id ? 600 : 400,
                    }}>{v.label}{v.id === 'traces' && traceSpans.length > 0 ? ` (${traceSpans.length})` : ''}</button>
                  ))}
                </div>
                {/* Activity content */}
                <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                  {activityView === 'timeline' && (
                    <div style={{ padding: 16, height: '100%', boxSizing: 'border-box' }}>
                      <TimelinePanel agentCwds={agentCwds} />
                    </div>
                  )}
                  {activityView === 'traces' && (
                    <TracesPanel spans={traceSpans} aggregate={traceAggregate} agents={agents.map((a) => ({ id: a.id, name: a.name }))} />
                  )}
                  {activityView === 'logs' && (
                    <div style={{ padding: 16, height: '100%', boxSizing: 'border-box' }}>
                      <LogsPanel
                        onPersistedSearch={onPersistedSearch}
                        persistedResults={persistedSearchResults}
                        onClearPersistedSearch={onClearPersistedSearch}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
            {activeTab === 'skills' && (
              <div style={{ padding: 16, height: '100%', boxSizing: 'border-box', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <SkillsPanel onOpenSkill={onOpenSkill} onCreateSkill={onCreateSkill} onOpenMarketplace={onOpenMarketplace} onMoveSkill={onMoveSkill} onDuplicateSkill={onDuplicateSkill} />
              </div>
            )}
            {activeTab === 'plan' && (
              <PlanPanel
                plan={plan ?? { loaded: false }}
                onViewExecution={onViewExecution}
                taskExecution={taskExecution}
                onCloseExecution={onCloseExecution}
              />
            )}
            {activeTab === 'roles' && (
              <div style={{ padding: 16, height: '100%', boxSizing: 'border-box', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <RolesPanel roles={roles ?? []} assignments={roleAssignments ?? []} profiles={agentProfiles ?? []} agents={agents.map((a) => ({ id: a.id, name: a.name, type: a.agentType }))} onAssignRole={onAssignRole} onCreateRole={onCreateRole} onEditRole={onEditRole} onDeleteRole={onDeleteRole} />
              </div>
            )}
            {activeTab === 'costs' && (
              <CostInsightsPanel insights={costInsights} recommendations={costRecommendations} contextLayers={contextLayers} onAddToSharedKnowledge={onAddToSharedKnowledge} />
            )}
            {activeTab === 'knowledge' && (
              <div style={{ padding: 16, height: '100%', boxSizing: 'border-box', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <KnowledgePanel workspace={knowledgeWorkspace} plan={knowledgePlan} planName={knowledgePlanName} onAdd={onKnowledgeAdd ?? (() => {})} onEdit={onKnowledgeEdit ?? (() => {})} onDelete={onKnowledgeDelete ?? (() => {})} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Status bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '5px 12px',
        borderTop: '1px solid #1a3020',
        background: 'rgba(6,12,8,0.9)',
        fontSize: 11,
        color: '#3a6a48',
        flexShrink: 0,
      }}>
        <div style={{ width: 6, height: 6, borderRadius: 1, background: '#25904a', boxShadow: '0 0 5px #25904a', flexShrink: 0 }} />
        <span style={{ letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600 }}>Operations</span>
        <span>{agents.length} agent{agents.length !== 1 ? 's' : ''}</span>

        <button
          type="button"
          onClick={() => setFileLockingEnabled(!fileLockingEnabled)}
          style={{
            padding: '2px 8px',
            border: `1px solid ${fileLockingEnabled ? '#8a6a2a' : '#1a3020'}`,
            borderRadius: 2,
            background: fileLockingEnabled ? 'rgba(80,60,20,0.4)' : 'transparent',
            color: fileLockingEnabled ? '#d4944a' : '#3a6a48',
            fontSize: 11,
            fontFamily: 'Consolas, monospace',
            cursor: 'pointer',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: 5,
          }}
          onMouseEnter={() => setHoveredTooltip('File Locking: prevents multiple agents from writing the same file simultaneously')}
          onMouseLeave={() => setHoveredTooltip(null)}
        >
          {fileLockingEnabled ? 'Locks ON' : 'Locks OFF'}
        </button>

        <button
          type="button"
          onClick={() => setWorktreeIsolation(!worktreeIsolation)}
          style={{
            padding: '2px 8px',
            border: `1px solid ${worktreeIsolation ? '#4a7a9a' : '#1a3020'}`,
            borderRadius: 2,
            background: worktreeIsolation ? 'rgba(40,70,100,0.4)' : 'transparent',
            color: worktreeIsolation ? '#6ab0d4' : '#3a6a48',
            fontSize: 11,
            fontFamily: 'Consolas, monospace',
            cursor: 'pointer',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: 5,
          }}
          onMouseEnter={() => setHoveredTooltip('Worktree Isolation: spawned agents get their own git worktree — no file conflicts')}
          onMouseLeave={() => setHoveredTooltip(null)}
        >
          {worktreeIsolation ? 'Worktrees ON' : 'Worktrees OFF'}
        </button>

        {demoMode && (
          <button
            type="button"
            onClick={requestDemo}
            style={{
              padding: '2px 8px',
              border: '1px solid #8a5a2a',
              borderRadius: 2,
              background: 'rgba(40,25,10,0.8)',
              color: '#d4944a',
              fontSize: 11,
              fontFamily: 'Consolas, monospace',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 5,
            }}
          >
            <span style={{ fontSize: 10, opacity: 0.7 }}>DEMO</span>
            <span>{demoElapsed}</span>
            <span style={{ fontSize: 10, opacity: 0.8 }}>&#x2715;</span>
          </button>
        )}

        <button
          type="button"
          onClick={toggleViewMode}
          style={{
            marginLeft: 'auto',
            padding: '3px 10px',
            border: '1px solid #1e4030',
            borderRadius: 2,
            background: 'rgba(12,28,20,0.95)',
            color: '#50a068',
            fontSize: 11,
            fontFamily: 'Consolas, monospace',
            cursor: 'pointer',
            fontWeight: 500,
          }}
        >
          Universe View
        </button>
      </div>
      {hoveredTooltip && createPortal(
        <div style={OPS_TOOLTIP_STYLE}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#90d898', marginBottom: 2 }}>File Locking</div>
          <div style={{ fontSize: 11, color: '#6a9a78' }}>{hoveredTooltip}</div>
        </div>,
        document.body,
      )}
    </div>
  );
};
