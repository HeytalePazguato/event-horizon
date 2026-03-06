/**
 * Command Center overlay container (RTS-style bottom panel).
 * @event-horizon/ui
 */

import type { FC } from 'react';
import { AgentIdentity } from './panels/AgentIdentity.js';
import { MetricsPanel } from './panels/MetricsPanel.js';
import { AgentControls } from './panels/AgentControls.js';

const wrapper = {
  position: 'absolute' as const,
  bottom: 0,
  left: 0,
  right: 0,
  zIndex: 20,
  borderTop: '3px solid #3a6a4a',
  borderLeft: '2px solid #2a4a3a',
  borderRight: '2px solid #2a4a3a',
  boxShadow: 'inset 0 0 0 1px rgba(80,160,100,0.25), 0 -4px 20px rgba(0,0,0,0.5)',
  background: 'linear-gradient(180deg, #0c1820 0%, #061018 8%, #040c12 100%)',
};

const titleBar = {
  padding: '4px 12px 6px',
  background: 'linear-gradient(180deg, #1a3038 0%, #0f2028 100%)',
  borderBottom: '1px solid #2a4a3a',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 11,
  fontWeight: 700,
  color: '#a0d0a8',
  letterSpacing: '0.08em',
  textTransform: 'uppercase' as const,
  boxShadow: 'inset 0 1px 0 rgba(100,180,120,0.2)',
};

const layout = {
  display: 'flex',
  padding: '12px 16px',
  gap: 24,
  alignItems: 'stretch',
  fontFamily: 'system-ui, sans-serif',
  color: '#b8d4a0',
  fontSize: 13,
  minHeight: 100,
};

const leftPanel = { flex: '0 0 200px', minWidth: 0 };
const centerPanel = { flex: '1 1 auto', minWidth: 0 };
const rightPanel = { flex: '0 0 180px', minWidth: 0 };

export const CommandCenter: FC = () => {
  return (
    <div data-command-center style={wrapper}>
      <div style={titleBar}>■ Command center</div>
      <div style={layout}>
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
    </div>
  );
};
