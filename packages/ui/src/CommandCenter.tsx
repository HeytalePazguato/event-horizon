/**
 * Command Center overlay — StarCraft-style: jagged metallic frame,
 * industrial panels, green accent, faction-legend feel.
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
  minHeight: 120,
  clipPath: 'polygon(0 14px, 12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%)',
  background: 'linear-gradient(180deg, #0e1418 0%, #0a0e12 8%, #060a0e 100%)',
  borderTop: '3px solid #3a5040',
  borderLeft: '2px solid #1a2520',
  borderRight: '2px solid #1a2520',
  boxShadow: [
    'inset 0 0 0 1px rgba(40,70,50,0.4)',
    'inset 2px 0 4px rgba(0,0,0,0.5)',
    'inset -2px 0 4px rgba(0,0,0,0.5)',
    'inset 0 3px 6px rgba(0,0,0,0.45)',
    '0 -8px 28px rgba(0,0,0,0.7)',
    '0 -2px 0 rgba(60,100,70,0.25)',
  ].join(', '),
};

const titleBar = {
  padding: '8px 16px 10px',
  background: 'linear-gradient(180deg, #1c2628 0%, #121a1c 40%, #0e1618 100%)',
  borderBottom: '2px solid #1e2a24',
  fontFamily: 'Consolas, "Courier New", monospace',
  fontSize: 11,
  fontWeight: 700,
  color: '#7fc07a',
  letterSpacing: '0.15em',
  textTransform: 'uppercase' as const,
  boxShadow: [
    'inset 0 2px 0 rgba(80,120,90,0.2)',
    'inset 0 -1px 0 rgba(0,0,0,0.5)',
  ].join(', '),
  textShadow: '0 0 10px rgba(80,160,90,0.3), 1px 1px 0 rgba(0,0,0,0.5)',
};

const legend = {
  display: 'flex' as const,
  gap: 16,
  padding: '4px 16px 6px',
  background: 'rgba(0,0,0,0.35)',
  borderBottom: '1px solid #1a2820',
  fontFamily: 'Consolas, monospace',
  fontSize: 10,
  color: '#6a8a72',
  letterSpacing: '0.08em',
};

const layout = {
  display: 'flex',
  padding: '12px 16px 14px',
  gap: 16,
  alignItems: 'stretch',
  fontFamily: 'Consolas, "Courier New", monospace',
  color: '#a8c8a0',
  fontSize: 12,
  minHeight: 88,
};

const panelFrame = {
  background: 'linear-gradient(180deg, rgba(14,22,26,0.98) 0%, rgba(8,14,18,0.99) 100%)',
  border: '1px solid #1e2e28',
  boxShadow: [
    'inset 0 0 0 1px rgba(30,55,40,0.35)',
    'inset 2px 2px 4px rgba(0,0,0,0.4)',
  ].join(', '),
  padding: 10,
  clipPath: 'polygon(0 6px, 6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)',
};

const leftPanel = { flex: '0 0 200px', minWidth: 0, ...panelFrame };
const centerPanel = { flex: '1 1 auto', minWidth: 0, ...panelFrame };
const rightPanel = { flex: '0 0 200px', minWidth: 0, ...panelFrame };

export const CommandCenter: FC = () => {
  return (
    <div data-command-center style={wrapper}>
      <div style={titleBar}>■ COMMAND CENTER</div>
      <div style={legend}>
        <span style={{ color: '#8a4040' }}>■</span> Agents
        <span style={{ color: '#4a8a5a' }}>■</span> Active
        <span style={{ color: '#6a6a4a' }}>■</span> Idle
      </div>
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
