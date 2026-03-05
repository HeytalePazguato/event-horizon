/**
 * Right panel: pause, restart, isolate, prioritize, view logs.
 * @event-horizon/ui
 */

import type { FC } from 'react';
import { useCommandCenterStore } from '../store.js';

const buttonStyle = {
  display: 'block',
  width: '100%',
  marginBottom: 6,
  padding: '6px 10px',
  background: 'rgba(68,136,170,0.25)',
  border: '1px solid rgba(68,136,170,0.5)',
  borderRadius: 4,
  color: '#e0e8f0',
  fontSize: 12,
  cursor: 'pointer' as const,
};

export const AgentControls: FC = () => {
  const selectedAgentId = useCommandCenterStore((s) => s.selectedAgentId);

  const disabled = !selectedAgentId;

  return (
    <div data-agent-controls>
      <div style={{ color: '#8899aa', fontSize: 11, marginBottom: 8 }}>Controls</div>
      <button type="button" style={buttonStyle} disabled={disabled} aria-label="Pause agent">
        Pause
      </button>
      <button type="button" style={buttonStyle} disabled={disabled} aria-label="Restart agent">
        Restart
      </button>
      <button type="button" style={buttonStyle} disabled={disabled} aria-label="Isolate agent">
        Isolate
      </button>
      <button type="button" style={buttonStyle} disabled={disabled} aria-label="Prioritize agent">
        Prioritize
      </button>
      <button type="button" style={buttonStyle} disabled={disabled} aria-label="View logs">
        View logs
      </button>
    </div>
  );
};
