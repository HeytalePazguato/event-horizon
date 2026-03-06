/**
 * Command Center — StarCraft II Terran-style: angular metallic panels,
 * left square (planet/minimap), center (info or logs), right 5×3 command grid.
 * @event-horizon/ui
 */

import type { FC } from 'react';
import { useState } from 'react';
import { AgentIdentity } from './panels/AgentIdentity.js';
import { MetricsPanel } from './panels/MetricsPanel.js';
import { AgentControls } from './panels/AgentControls.js';

const wrapper = {
  position: 'absolute' as const,
  bottom: 0,
  left: 0,
  right: 0,
  zIndex: 20,
  minHeight: 140,
  background: 'linear-gradient(180deg, #0c1014 0%, #080c10 100%)',
  borderTop: '4px solid #2a3830',
  borderLeft: '3px solid #1a2420',
  borderRight: '3px solid #1a2420',
  boxShadow: [
    'inset 0 0 0 1px rgba(50,90,60,0.4)',
    'inset 3px 0 6px rgba(0,0,0,0.5)',
    'inset -3px 0 6px rgba(0,0,0,0.5)',
    '0 -6px 24px rgba(0,0,0,0.7)',
    '0 -1px 0 rgba(60,100,70,0.3)',
  ].join(', '),
};

const titleBar = {
  padding: '6px 14px 8px',
  background: 'linear-gradient(180deg, #1a2226 0%, #12181c 100%)',
  borderBottom: '2px solid #1e2a24',
  fontFamily: 'Consolas, "Courier New", monospace',
  fontSize: 11,
  fontWeight: 700,
  color: '#6fc06a',
  letterSpacing: '0.12em',
  textTransform: 'uppercase' as const,
  boxShadow: 'inset 0 2px 0 rgba(70,110,80,0.25), inset 0 -1px 0 rgba(0,0,0,0.5)',
  textShadow: '0 0 8px rgba(60,140,70,0.35)',
  display: 'flex' as const,
  alignItems: 'center' as const,
  gap: 8,
};

const layout = {
  display: 'flex',
  padding: '10px 12px 12px',
  gap: 12,
  alignItems: 'stretch',
  minHeight: 108,
};

const leftPanel = {
  flex: '0 0 100px',
  width: 100,
  height: 100,
  minWidth: 100,
  minHeight: 100,
  background: 'linear-gradient(180deg, #0e1418 0%, #0a0e12 100%)',
  border: '2px solid #2a3a32',
  boxShadow: [
    'inset 0 0 0 1px rgba(40,70,50,0.35)',
    'inset 3px 3px 6px rgba(0,0,0,0.5)',
    '2px 0 0 #1a2420',
  ].join(', '),
  clipPath: 'polygon(0 12px, 12px 0, 100% 0, 100% 100%, 0 100%)',
  padding: 6,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const centerPanel = {
  flex: '1 1 auto',
  minWidth: 0,
  background: '#080a0c',
  border: '2px solid #2a3a32',
  boxShadow: [
    'inset 0 0 0 1px rgba(30,55,40,0.3)',
    'inset 2px 2px 4px rgba(0,0,0,0.6)',
  ].join(', '),
  padding: 8,
  fontFamily: 'Consolas, monospace',
  fontSize: 11,
  color: '#a0c098',
  overflow: 'auto' as const,
};

const rightPanel = {
  flex: '0 0 160px',
  minWidth: 160,
  background: 'linear-gradient(180deg, #0e1418 0%, #0a0e12 100%)',
  border: '2px solid #2a3a32',
  boxShadow: [
    'inset 0 0 0 1px rgba(40,70,50,0.35)',
    'inset -3px 3px 6px rgba(0,0,0,0.5)',
    '-2px 0 0 #1a2420',
  ].join(', '),
  clipPath: 'polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 0 100%)',
  padding: 8,
};

export const CommandCenter: FC = () => {
  const [minimized, setMinimized] = useState(false);
  return (
    <div data-command-center style={{ ...wrapper, minHeight: minimized ? 32 : 140 }}>
      <div style={titleBar}>
        <span>■ COMMAND CENTER</span>
        <button
          type="button"
          onClick={() => setMinimized((m) => !m)}
          aria-label={minimized ? 'Expand' : 'Minimize'}
          style={{
            marginLeft: 'auto',
            width: 18,
            height: 16,
            padding: 0,
            border: '1px solid #2a4a3a',
            background: 'rgba(20,40,30,0.9)',
            color: '#6fc06a',
            fontSize: 11,
            cursor: 'pointer',
            lineHeight: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {minimized ? '▴' : '▾'}
        </button>
      </div>
      {!minimized && (
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
      )}
    </div>
  );
};
