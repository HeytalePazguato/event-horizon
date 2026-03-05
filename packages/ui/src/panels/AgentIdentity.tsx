/**
 * Left panel: agent name, icon, current task, state.
 * @event-horizon/ui
 */

import type { FC } from 'react';
import { useCommandCenterStore } from '../store.js';

const labelStyle = { color: '#8899aa', fontSize: 11, marginBottom: 4 };
const valueStyle = { fontWeight: 600 };

const stateColors: Record<string, string> = {
  idle: '#6b9',
  thinking: '#fa8',
  error: '#e66',
};

export const AgentIdentity: FC = () => {
  const selectedAgent = useCommandCenterStore((s) => s.selectedAgent);

  if (!selectedAgent) {
    return (
      <div data-agent-identity>
        <div style={labelStyle}>Agent</div>
        <div style={{ color: '#667' }}>Select a planet</div>
      </div>
    );
  }

  const stateColor = stateColors[selectedAgent.state] ?? '#8899aa';

  return (
    <div data-agent-identity>
      <div style={labelStyle}>Agent</div>
      <div style={{ ...valueStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 18 }} aria-hidden>🪐</span>
        <span>{selectedAgent.name}</span>
      </div>
      <div style={{ ...labelStyle, marginTop: 8 }}>State</div>
      <div style={{ ...valueStyle, color: stateColor }}>{selectedAgent.state}</div>
      <div style={{ ...labelStyle, marginTop: 8 }}>Current task</div>
      <div style={valueStyle}>
        {selectedAgent.currentTaskId ? `Task ${selectedAgent.currentTaskId}` : '—'}
      </div>
    </div>
  );
};
