/**
 * Agent navigation sidebar for Operations view.
 * Shows "All Agents" + per-agent rows grouped by workspace.
 * @event-horizon/ui
 */

import type { FC } from 'react';
import { useCommandCenterStore } from '../store.js';
import { groupAgentsByWorkspace } from '../utils.js';
import { PlanetIcon, SingularityIcon } from './AgentIdentity.js';

const stateColors: Record<string, string> = {
  idle: '#4a8a5a',
  thinking: '#d4a84a',
  working: '#b8a040',
  tool_use: '#6aa0d4',
  waiting: '#d4944a',
  error: '#c65858',
};

export interface AgentSidebarProps {
  agents: Array<{ id: string; name: string; agentType: string; cwd?: string }>;
  agentStates: Record<string, string>;
}

export const AgentSidebar: FC<AgentSidebarProps> = ({ agents, agentStates }) => {
  const selectedAgentId = useCommandCenterStore((s) => s.selectedAgentId);
  const singularitySelected = useCommandCenterStore((s) => s.singularitySelected);
  const setSelectedAgent = useCommandCenterStore((s) => s.setSelectedAgent);
  const selectSingularity = useCommandCenterStore((s) => s.selectSingularity);

  const groups = groupAgentsByWorkspace(agents, agentStates);
  const isAllSelected = singularitySelected || (!selectedAgentId && agents.length > 0);

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
        overflowY: 'auto',
      }}
    >
      {/* Header */}
      <div style={{
        padding: '10px 12px 8px',
        fontSize: 9,
        color: '#3a7050',
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        fontWeight: 700,
        borderBottom: '1px solid #1a3020',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}>
        Agents
        <span style={{
          fontSize: 8,
          background: '#1a3020',
          color: '#50a068',
          padding: '1px 5px',
          borderRadius: 3,
        }}>
          {agents.length}
        </span>
      </div>

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
        <span style={{ fontSize: 11, color: isAllSelected ? '#90d898' : '#6a9a78', fontWeight: isAllSelected ? 600 : 400 }}>
          All Agents
        </span>
      </div>

      {/* Agent groups */}
      {groups.map((group) => (
        <div key={group.workspace}>
          {/* Group header — only show if there are multiple groups or the group has 2+ agents */}
          {(groups.length > 1 || group.agents.length > 1) && group.workspace !== 'Solo' && (
            <div style={{
              padding: '6px 12px 2px',
              fontSize: 8,
              color: '#3a6048',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}>
              {group.workspace}
            </div>
          )}

          {group.agents.map((a) => {
            const isSelected = selectedAgentId === a.id;
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
                <span style={{
                  flex: 1,
                  fontSize: 10,
                  color: isSelected ? '#90d898' : '#7a9a82',
                  fontWeight: isSelected ? 600 : 400,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {a.name}
                </span>
                <div style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: stateColors[a.state] ?? '#4a8a5a',
                  flexShrink: 0,
                }} />
              </div>
            );
          })}
        </div>
      ))}

      {agents.length === 0 && (
        <div style={{ padding: '16px 12px', fontSize: 10, color: '#3a5a48' }}>
          No agents connected.
        </div>
      )}
    </div>
  );
};
