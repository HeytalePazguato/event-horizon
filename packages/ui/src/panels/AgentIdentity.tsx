/**
 * Left panel: agent name, wireframe-style icon, current task, state (StarCraft-style).
 * @event-horizon/ui
 */

import type { FC } from 'react';
import { useCommandCenterStore } from '../store.js';

const labelStyle = {
  color: '#6a8a7a',
  fontSize: 10,
  marginBottom: 4,
  letterSpacing: '0.05em',
  textTransform: 'uppercase' as const,
};
const valueStyle = { fontWeight: 600, color: '#b0d0a8' };

const stateColors: Record<string, string> = {
  idle: '#6b9f70',
  thinking: '#d4a84a',
  error: '#c65858',
};

export const AgentIdentity: FC = () => {
  const selectedAgent = useCommandCenterStore((s) => s.selectedAgent);

  if (!selectedAgent) {
    return (
      <div data-agent-identity>
        <div style={labelStyle}>Unit / Agent</div>
        <div
          style={{
            color: '#4a5a52',
            fontSize: 12,
            border: '1px dashed #2a4a3a',
            padding: 12,
            textAlign: 'center' as const,
            background: 'rgba(0,0,0,0.2)',
          }}
        >
          Select a planet
        </div>
      </div>
    );
  }

  const stateColor = stateColors[selectedAgent.state] ?? '#8a9a8a';

  return (
    <div data-agent-identity>
      <div style={labelStyle}>Unit / Agent</div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 10,
          paddingBottom: 8,
          borderBottom: '1px solid #1e3328',
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            border: '2px solid #3a6a4a',
            background: 'rgba(40,80,50,0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: 'inset 0 0 8px rgba(80,140,100,0.15)',
          }}
          aria-hidden
        >
          <span style={{ fontSize: 18 }}>🪐</span>
        </div>
        <span style={{ ...valueStyle, fontSize: 13 }}>{selectedAgent.name}</span>
      </div>
      <div style={{ ...labelStyle, marginTop: 6 }}>State</div>
      <div style={{ ...valueStyle, color: stateColor, fontSize: 12 }}>{selectedAgent.state}</div>
      <div style={{ ...labelStyle, marginTop: 8 }}>Current task</div>
      <div style={{ ...valueStyle, fontSize: 12 }}>
        {selectedAgent.currentTaskId ? `Task ${selectedAgent.currentTaskId}` : '—'}
      </div>
    </div>
  );
};
