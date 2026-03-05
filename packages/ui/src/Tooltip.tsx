/**
 * Hover tooltip: agent name, load %, active task.
 * @event-horizon/ui
 */

import type { FC } from 'react';

export interface TooltipProps {
  agentName: string;
  loadPercent: number;
  activeTask: string | null;
}

const tooltipStyle = {
  position: 'absolute' as const,
  padding: '8px 12px',
  background: 'rgba(10,10,25,0.95)',
  border: '1px solid rgba(68,136,170,0.5)',
  borderRadius: 6,
  fontSize: 12,
  color: '#e0e8f0',
  pointerEvents: 'none' as const,
  zIndex: 1000,
  maxWidth: 220,
};

export const Tooltip: FC<TooltipProps> = ({ agentName, loadPercent, activeTask }) => {
  return (
    <div data-tooltip style={tooltipStyle} role="tooltip">
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{agentName}</div>
      <div style={{ color: '#8899aa' }}>Load: {loadPercent}%</div>
      <div style={{ color: '#8899aa', marginTop: 2 }}>
        {activeTask ?? 'Idle'}
      </div>
    </div>
  );
};
