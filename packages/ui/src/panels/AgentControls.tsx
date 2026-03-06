/**
 * Right panel: command grid (StarCraft-style action buttons).
 * @event-horizon/ui
 */

import type { FC } from 'react';
import { useCommandCenterStore } from '../store.js';

const labelStyle = {
  color: '#6a8a7a',
  fontSize: 10,
  marginBottom: 8,
  letterSpacing: '0.05em',
  textTransform: 'uppercase' as const,
};

const baseButton = {
  padding: '6px 10px',
  border: '1px solid #2a4a3a',
  background: 'linear-gradient(180deg, #1a2820 0%, #0f1a18 100%)',
  color: '#8a9a8a',
  fontSize: 11,
  cursor: 'pointer' as const,
  boxShadow: 'inset 0 1px 0 rgba(0,0,0,0.3)',
  flex: '1 1 0',
  minWidth: 0,
};

const activeButton = {
  ...baseButton,
  border: '1px solid #3a6a4a',
  color: '#b0d0a8',
  background: 'linear-gradient(180deg, #1e3228 0%, #142820 100%)',
  boxShadow: 'inset 0 0 0 1px rgba(80,140,100,0.2), inset 0 1px 0 rgba(100,160,100,0.1)',
};

const gridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, 1fr)',
  gap: 6,
};

export const AgentControls: FC = () => {
  const selectedAgentId = useCommandCenterStore((s) => s.selectedAgentId);
  const disabled = !selectedAgentId;

  return (
    <div data-agent-controls>
      <div style={labelStyle}>Commands</div>
      <div style={gridStyle}>
        <button
          type="button"
          style={disabled ? baseButton : activeButton}
          disabled={disabled}
          aria-label="Pause agent"
        >
          Pause
        </button>
        <button
          type="button"
          style={disabled ? baseButton : activeButton}
          disabled={disabled}
          aria-label="Restart agent"
        >
          Restart
        </button>
        <button
          type="button"
          style={disabled ? baseButton : activeButton}
          disabled={disabled}
          aria-label="Isolate agent"
        >
          Isolate
        </button>
        <button
          type="button"
          style={disabled ? baseButton : activeButton}
          disabled={disabled}
          aria-label="Prioritize agent"
        >
          Prioritize
        </button>
        <button
          type="button"
          style={disabled ? { ...baseButton, gridColumn: 'span 2' } : { ...activeButton, gridColumn: 'span 2' }}
          disabled={disabled}
          aria-label="View logs"
        >
          View logs
        </button>
      </div>
    </div>
  );
};
