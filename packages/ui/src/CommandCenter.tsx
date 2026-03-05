/**
 * Command Center overlay container (RTS-style bottom panel).
 * @event-horizon/ui
 */

import type { FC } from 'react';
import { AgentIdentity } from './panels/AgentIdentity.js';
import { MetricsPanel } from './panels/MetricsPanel.js';
import { AgentControls } from './panels/AgentControls.js';

const layout = {
  display: 'flex',
  position: 'absolute' as const,
  bottom: 0,
  left: 0,
  right: 0,
  height: 120,
  background: 'linear-gradient(180deg, rgba(10,10,20,0.85) 0%, rgba(10,10,25,0.98) 100%)',
  borderTop: '1px solid rgba(68,136,170,0.4)',
  padding: '12px 16px',
  gap: 24,
  alignItems: 'stretch',
  fontFamily: 'system-ui, sans-serif',
  color: '#e0e8f0',
  fontSize: 13,
};

const leftPanel = { flex: '0 0 200px', minWidth: 0 };
const centerPanel = { flex: '1 1 auto', minWidth: 0 };
const rightPanel = { flex: '0 0 180px', minWidth: 0 };

export const CommandCenter: FC = () => {
  return (
    <div data-command-center style={layout}>
      <div style={leftPanel}>
        <AgentIdentity />
      </div>
      <div style={centerPanel}>
        <MetricsPanel />
      </div>
      <div style={rightPanel}>
        <AgentControls />
      </div>
    </div>
  );
};
