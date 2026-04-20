/**
 * Agent + Plans navigation sidebar for Operations view.
 * Two tabs: "Agents" shows per-agent rows, "Plans" shows plans grouped by status.
 * @event-horizon/ui
 */

import type { FC } from 'react';
import { useState } from 'react';
import { useCommandCenterStore } from '../store.js';
import { groupAgentsByWorkspace, folderName } from '../utils.js';
import { PlanetIcon, SingularityIcon } from './AgentIdentity.js';
import type { PlanSummary } from './PlanPanel.js';

const stateColors: Record<string, string> = {
  idle: '#4a8a5a',
  thinking: '#d4a84a',
  working: '#b8a040',
  tool_use: '#6aa0d4',
  waiting: '#d4944a',
  error: '#c65858',
};

const planStatusColors: Record<string, string> = {
  active: '#40a060',
  completed: '#6aa0d4',
  archived: '#5a6a62',
};

export interface AgentSidebarProps {
  agents: Array<{ id: string; name: string; agentType: string; cwd?: string }>;
  agentStates: Record<string, string>;
  /** Map of agentId → heartbeat status ('alive' | 'stale' | 'lost'). */
  heartbeatStatuses?: Record<string, string>;
  plans?: PlanSummary[];
  selectedPlanId?: string | null;
  onSelectPlan?: (id: string) => void;
  /** Map of planId → orchestrator agentId — used to render ★ ORCH badge. */
  orchestratorMap?: Record<string, string>;
  /** Map of agentId → role (e.g. "implementer") — used to render role badge. */
  agentRoleMap?: Record<string, string>;
}

// ── Role badge colors (matches Roles tab conventions) ──
const roleColors: Record<string, { bg: string; fg: string }> = {
  orchestrator: { bg: '#2a4a20', fg: '#f0d890' },
  implementer: { bg: '#1e4030', fg: '#90d898' },
  reviewer:    { bg: '#3a2a4a', fg: '#c8a4e8' },
  tester:      { bg: '#2a3a4a', fg: '#a4c8e8' },
  researcher:  { bg: '#4a3a20', fg: '#e8c88a' },
  planner:     { bg: '#2a4a3a', fg: '#90d8b8' },
  debugger:    { bg: '#4a2a2a', fg: '#e8a4a4' },
};

function roleBadgeStyle(role: string): { bg: string; fg: string } {
  return roleColors[role.toLowerCase()] ?? { bg: '#2a3a2a', fg: '#a0b8a8' };
}

export const AgentSidebar: FC<AgentSidebarProps> = ({ agents, agentStates, heartbeatStatuses = {}, plans = [], selectedPlanId, onSelectPlan, orchestratorMap = {}, agentRoleMap = {} }) => {
  const selectedAgentId = useCommandCenterStore((s) => s.selectedAgentId);
  const singularitySelected = useCommandCenterStore((s) => s.singularitySelected);
  const setSelectedAgent = useCommandCenterStore((s) => s.setSelectedAgent);
  const selectSingularity = useCommandCenterStore((s) => s.selectSingularity);
  const [sidebarTab, setSidebarTab] = useState<'agents' | 'plans'>('agents');

  const groups = groupAgentsByWorkspace(agents, agentStates);
  const isAllSelected = singularitySelected || (!selectedAgentId && agents.length > 0);

  // Derive unique set of orchestrator agent IDs across all plans
  const orchestratorAgentIdSet = new Set(Object.values(orchestratorMap));

  // Group plans by status
  const activePlans = plans.filter((p) => p.status === 'active');
  const completedPlans = plans.filter((p) => p.status === 'completed');
  const archivedPlans = plans.filter((p) => p.status === 'archived');

  return (
    <div
      style={{
        width: 200,
        minWidth: 200,
        height: '100%',
        background: 'linear-gradient(180deg, #0a1410 0%, #060c08 100%)',
        borderRight: '1px solid #1a3020',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'Consolas, monospace',
      }}
    >
      {/* Tab bar */}
      <div style={{
        display: 'flex',
        borderBottom: '1px solid #1a3020',
        flexShrink: 0,
      }}>
        {(['agents', 'plans'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setSidebarTab(tab)}
            style={{
              flex: 1,
              padding: '8px 0',
              fontSize: 11,
              fontFamily: 'Consolas, monospace',
              fontWeight: sidebarTab === tab ? 700 : 400,
              color: sidebarTab === tab ? '#90d898' : '#4a7a58',
              background: 'transparent',
              border: 'none',
              borderBottom: sidebarTab === tab ? '2px solid #40a060' : '2px solid transparent',
              cursor: 'pointer',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
            }}
          >
            {tab === 'agents' ? `Agents (${agents.length})` : `Plans (${plans.length})`}
          </button>
        ))}
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {sidebarTab === 'agents' ? (
          <>
            {/* All Agents row */}
            <div
              onClick={selectSingularity}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                cursor: 'pointer',
                background: isAllSelected ? 'rgba(30,80,50,0.2)' : 'transparent',
                borderLeft: isAllSelected ? '3px solid #40a060' : '3px solid transparent',
                borderBottom: '1px solid rgba(30,60,40,0.3)',
              }}
            >
              <SingularityIcon size={20} />
              <span style={{ fontSize: 12, color: isAllSelected ? '#90d898' : '#6a9a78', fontWeight: isAllSelected ? 600 : 400 }}>
                All Agents
              </span>
            </div>

            {/* Agent groups */}
            {groups.map((group) => (
              <div key={group.workspace}>
                {(groups.length > 1 || group.agents.length > 1) && group.workspace !== 'Solo' && (
                  <div style={{
                    padding: '6px 12px 2px',
                    fontSize: 12,
                    color: '#3a6048',
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                  }}>
                    {group.workspace}
                  </div>
                )}

                {group.agents.map((a) => {
                  const isSelected = selectedAgentId === a.id;
                  const isOrchestrator = orchestratorAgentIdSet.has(a.id);
                  const role = agentRoleMap[a.id];
                  const roleStyle = role ? roleBadgeStyle(role) : null;
                  return (
                    <div
                      key={a.id}
                      onClick={() => setSelectedAgent(a.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '5px 12px',
                        cursor: 'pointer',
                        background: isSelected ? 'rgba(30,80,50,0.2)' : 'transparent',
                        borderLeft: isSelected ? '3px solid #40a060' : '3px solid transparent',
                      }}
                    >
                      <PlanetIcon type={a.agentType} size={18} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 12,
                          color: isSelected ? '#90d898' : '#7a9a82',
                          fontWeight: isSelected ? 600 : 400,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                        }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name}</span>
                          {isOrchestrator && (
                            <span
                              title="Orchestrator — manages this plan and spawns worker agents"
                              style={{
                                fontSize: 8,
                                lineHeight: 1,
                                padding: '2px 4px',
                                background: '#2a4a20',
                                color: '#f0d890',
                                border: '1px solid #5a6a20',
                                borderRadius: 2,
                                letterSpacing: '0.05em',
                                fontWeight: 700,
                                flexShrink: 0,
                              }}
                            >
                              {'\u2605'} ORCH
                            </span>
                          )}
                          {role && roleStyle && (
                            <span
                              title={`Role: ${role}`}
                              style={{
                                fontSize: 8,
                                lineHeight: 1,
                                padding: '2px 4px',
                                background: roleStyle.bg,
                                color: roleStyle.fg,
                                borderRadius: 2,
                                letterSpacing: '0.05em',
                                fontWeight: 600,
                                textTransform: 'uppercase',
                                flexShrink: 0,
                              }}
                            >
                              {role}
                            </span>
                          )}
                        </div>
                        {a.cwd && (
                          <div style={{
                            fontSize: 10,
                            color: '#4a7a5a',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}>
                            {folderName(a.cwd)}
                          </div>
                        )}
                      </div>
                      <div style={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        background: heartbeatStatuses[a.id] === 'lost' ? '#555555'
                          : heartbeatStatuses[a.id] === 'stale' ? '#d4944a'
                          : stateColors[a.state] ?? '#4a8a5a',
                        flexShrink: 0,
                      }} />
                    </div>
                  );
                })}
              </div>
            ))}

            {agents.length === 0 && (
              <div style={{ padding: '16px 12px', fontSize: 12, color: '#3a5a48' }}>
                No agents connected.
              </div>
            )}
          </>
        ) : (
          <>
            {/* Plans list */}
            {plans.length === 0 && (
              <div style={{ padding: '16px 12px', fontSize: 12, color: '#3a5a48' }}>
                No plans loaded.
                <div style={{ fontSize: 10, color: '#2a4a38', marginTop: 4 }}>
                  Use /eh:create-plan to create one.
                </div>
              </div>
            )}

            {activePlans.length > 0 && (
              <PlanSection label="Active" plans={activePlans} selectedId={selectedPlanId} onSelect={onSelectPlan} />
            )}
            {completedPlans.length > 0 && (
              <PlanSection label="Completed" plans={completedPlans} selectedId={selectedPlanId} onSelect={onSelectPlan} />
            )}
            {archivedPlans.length > 0 && (
              <PlanSection label="Archived" plans={archivedPlans} selectedId={selectedPlanId} onSelect={onSelectPlan} />
            )}
          </>
        )}
      </div>
    </div>
  );
};

// ── Plan section ────────────────────────────────────────────────────────────

const PlanSection: FC<{
  label: string;
  plans: PlanSummary[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}> = ({ label, plans, selectedId, onSelect }) => {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div>
      <div
        onClick={() => setCollapsed(!collapsed)}
        style={{
          padding: '6px 12px 2px',
          fontSize: 11,
          color: '#3a6048',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        <span style={{ fontSize: 8, color: '#3a5a48' }}>{collapsed ? '\u25B6' : '\u25BC'}</span>
        {label}
        <span style={{ fontSize: 10, color: '#2a4a38', marginLeft: 'auto' }}>{plans.length}</span>
      </div>
      {!collapsed && plans.map((plan) => {
        const isSelected = selectedId === plan.id;
        const progress = plan.totalTasks > 0 ? Math.round((plan.doneTasks / plan.totalTasks) * 100) : 0;
        const statusColor = planStatusColors[plan.status] ?? '#5a6a62';

        return (
          <div
            key={plan.id}
            onClick={() => onSelect?.(plan.id)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 3,
              padding: '6px 12px',
              cursor: 'pointer',
              background: isSelected ? 'rgba(30,80,50,0.2)' : 'transparent',
              borderLeft: isSelected ? '3px solid #40a060' : '3px solid transparent',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{
                width: 6, height: 6, borderRadius: 1,
                background: statusColor,
                boxShadow: `0 0 4px ${statusColor}`,
                flexShrink: 0,
              }} />
              <span style={{
                fontSize: 11,
                color: isSelected ? '#90d898' : '#7a9a82',
                fontWeight: isSelected ? 600 : 400,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
              }}>
                {plan.name}
              </span>
              <span style={{ fontSize: 9, color: '#4a6a58', flexShrink: 0 }}>
                {plan.doneTasks}/{plan.totalTasks}
              </span>
            </div>
            {/* Mini progress bar */}
            <div style={{
              height: 2,
              background: '#1a2a20',
              borderRadius: 1,
              overflow: 'hidden',
            }}>
              <div style={{
                height: '100%',
                width: `${progress}%`,
                background: statusColor,
                borderRadius: 1,
              }} />
            </div>
          </div>
        );
      })}
    </div>
  );
};
