/**
 * Hover tooltip: agent name, load %, active task.
 * @event-horizon/ui
 */

import type { FC } from 'react';

export interface TooltipProps {
  agentName: string;
  loadPercent: number;
  activeTask: string | null;
  cwd?: string;
}

/** Extract the last folder name from a full path. */
function folderName(cwd: string): string {
  const normalized = cwd.replace(/\\/g, '/').replace(/\/+$/, '');
  return normalized.split('/').pop() || cwd;
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

export const Tooltip: FC<TooltipProps> = ({ agentName, loadPercent, activeTask, cwd }) => {
  return (
    <div data-tooltip style={tooltipStyle} role="tooltip">
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{agentName}</div>
      {cwd && (
        <div style={{ color: '#6a8a9a', fontSize: 10, marginBottom: 3 }}>
          {folderName(cwd)}
        </div>
      )}
      <div style={{ color: '#8899aa' }}>Load: {loadPercent}%</div>
      <div style={{ color: '#8899aa', marginTop: 2 }}>
        {activeTask ?? 'Idle'}
      </div>
    </div>
  );
};
