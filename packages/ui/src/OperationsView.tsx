/**
 * Operations View — full-screen dashboard alternative to the Universe.
 * Left: agent sidebar. Right: tabbed content (Overview, Files, Logs, Timeline).
 * @event-horizon/ui
 */

import type { FC } from 'react';
import { useState, useMemo } from 'react';
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

type OpsTab = 'overview' | 'files' | 'logs' | 'timeline' | 'skills' | 'plan' | 'roles';

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

export const OperationsView: FC<OperationsViewProps> = ({ agents, agentMap, metricsMap, agentStates, plan, plans = [], selectedPlanId, onSelectPlan, onOpenSkill, onCreateSkill, onOpenMarketplace, onMoveSkill, onDuplicateSkill, roles, roleAssignments, agentProfiles, onAssignRole, onCreateRole, onEditRole, onDeleteRole }) => {
  const [activeTab, setActiveTab] = useState<OpsTab>('overview');
  const [hoveredTooltip, setHoveredTooltip] = useState<string | null>(null);
  const toggleViewMode = useCommandCenterStore((s) => s.toggleViewMode);
  const fileLockingEnabled = useCommandCenterStore((s) => s.fileLockingEnabled);
  const setFileLockingEnabled = useCommandCenterStore((s) => s.setFileLockingEnabled);
  const demoMode = useCommandCenterStore((s) => s.demoMode);
  const demoStartedAt = useCommandCenterStore((s) => s.demoStartedAt);
  const requestDemo = useCommandCenterStore((s) => s.requestDemo);
  const toggleConnect = useCommandCenterStore((s) => s.toggleConnect);
  const toggleSpawn = useCommandCenterStore((s) => s.toggleSpawn);
  const requestExport = useCommandCenterStore((s) => s.requestExport);
  const requestScreenshot = useCommandCenterStore((s) => s.requestScreenshot);
  const toggleInfo = useCommandCenterStore((s) => s.toggleInfo);
  const toggleSettings = useCommandCenterStore((s) => s.toggleSettings);
  const skillsCount = useCommandCenterStore((s) => s.skills.length);

  // Agent cwd map for timeline labels
  const agentCwds = useMemo(
    () => Object.fromEntries(Object.entries(agentMap).map(([id, a]) => [id, a.cwd])),
    [agentMap],
  );

  // Demo elapsed timer
  const [demoElapsed, setDemoElapsed] = useState('');
  if (demoMode && demoStartedAt) {
    const secs = Math.floor((Date.now() - demoStartedAt) / 1000);
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    const elapsed = `${m}:${s.toString().padStart(2, '0')}`;
    if (elapsed !== demoElapsed) setTimeout(() => setDemoElapsed(elapsed), 0);
  }

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
            <button type="button" style={tabStyle(activeTab === 'files')} onClick={() => setActiveTab('files')}>Files</button>
            <button type="button" style={tabStyle(activeTab === 'logs')} onClick={() => setActiveTab('logs')}>Logs</button>
            <button type="button" style={tabStyle(activeTab === 'timeline')} onClick={() => setActiveTab('timeline')}>Timeline</button>
            <button type="button" style={tabStyle(activeTab === 'skills')} onClick={() => setActiveTab('skills')}>
              Skills{skillsCount > 0 ? ` (${skillsCount})` : ''}
            </button>
            <button type="button" style={tabStyle(activeTab === 'plan')} onClick={() => setActiveTab('plan')}>
              Plan{plan?.tasks ? ` (${plan.tasks.filter((t) => t.status === 'done').length}/${plan.tasks.length})` : ''}
            </button>
            <button type="button" style={tabStyle(activeTab === 'roles')} onClick={() => setActiveTab('roles')}>
              Roles{roles && roles.length > 0 ? ` (${roles.length})` : ''}
            </button>

            {/* Command buttons — right-aligned */}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, padding: '0 8px' }}>
              {([
                { label: 'Connect', action: toggleConnect },
                { label: 'Spawn', action: toggleSpawn },
                { label: 'Export', action: requestExport },
                { label: 'Screenshot', action: requestScreenshot },
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
            {activeTab === 'logs' && (
              <div style={{ padding: 16, height: '100%', boxSizing: 'border-box' }}>
                <LogsPanel />
              </div>
            )}
            {activeTab === 'timeline' && (
              <div style={{ padding: 16, height: '100%', boxSizing: 'border-box' }}>
                <TimelinePanel agentCwds={agentCwds} />
              </div>
            )}
            {activeTab === 'skills' && (
              <div style={{ padding: 16, height: '100%', boxSizing: 'border-box' }}>
                <SkillsPanel onOpenSkill={onOpenSkill} onCreateSkill={onCreateSkill} onOpenMarketplace={onOpenMarketplace} onMoveSkill={onMoveSkill} onDuplicateSkill={onDuplicateSkill} />
              </div>
            )}
            {activeTab === 'plan' && (
              <PlanPanel plan={plan ?? { loaded: false }} />
            )}
            {activeTab === 'roles' && (
              <div style={{ padding: 16, height: '100%', boxSizing: 'border-box' }}>
                <RolesPanel roles={roles ?? []} assignments={roleAssignments ?? []} profiles={agentProfiles ?? []} onAssignRole={onAssignRole} onCreateRole={onCreateRole} onEditRole={onEditRole} onDeleteRole={onDeleteRole} />
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
