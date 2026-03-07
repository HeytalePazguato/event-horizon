/**
 * Command Center — StarCraft II Terran-style:
 * - Wide chamfered top corners on outer panel
 * - Side panels (portrait + commands) taller than center, protruding upward
 * - Green LED indicators at inner corners
 * - Dark steel color scheme with teal-green accents
 * @event-horizon/ui
 */

import type { FC } from 'react';
import { useState } from 'react';
import { AgentIdentity } from './panels/AgentIdentity.js';
import { MetricsPanel } from './panels/MetricsPanel.js';
import { AgentControls } from './panels/AgentControls.js';

const CHAMFER = 28;

const wrapper: React.CSSProperties = {
  position: 'absolute',
  bottom: 0,
  left: 0,
  right: 0,
  zIndex: 20,
  background: 'linear-gradient(180deg, #06090c 0%, #03060a 100%)',
  borderTop: '3px solid #182820',
  boxShadow: [
    'inset 0 0 0 1px rgba(25,60,42,0.55)',
    'inset 4px 0 10px rgba(0,0,0,0.65)',
    'inset -4px 0 10px rgba(0,0,0,0.65)',
    '0 -10px 40px rgba(0,0,0,0.9)',
    '0 -2px 0 rgba(30,70,50,0.35)',
  ].join(', '),
  clipPath: `polygon(${CHAMFER}px 0, calc(100% - ${CHAMFER}px) 0, 100% ${CHAMFER}px, 100% 100%, 0 100%, 0 ${CHAMFER}px)`,
};

const headerBar: React.CSSProperties = {
  paddingTop: 5,
  paddingBottom: 5,
  paddingLeft: CHAMFER + 10,
  paddingRight: CHAMFER + 10,
  background: 'linear-gradient(180deg, #0d1a18 0%, #081210 100%)',
  borderBottom: '1px solid #122018',
  fontFamily: 'Consolas, "Courier New", monospace',
  fontSize: 10,
  fontWeight: 700,
  color: '#3a8055',
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  textShadow: '0 0 8px rgba(40,130,70,0.4)',
};

const layout: React.CSSProperties = {
  display: 'flex',
  paddingLeft: 10,
  paddingRight: 10,
  paddingBottom: 10,
  paddingTop: 2,
  gap: 8,
  alignItems: 'flex-end',
};

// LED indicator dot
function Led({ style }: { style: React.CSSProperties }) {
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        width: 5,
        height: 5,
        borderRadius: 1,
        ...style,
      }}
    />
  );
}

const leftPanelStyle: React.CSSProperties = {
  flex: '0 0 114px',
  width: 114,
  minWidth: 114,
  height: 128,
  background: 'linear-gradient(155deg, #0c1318 0%, #070a0e 100%)',
  border: '2px solid #1c3028',
  boxShadow: [
    'inset 0 0 0 1px rgba(25,60,42,0.28)',
    'inset 3px 3px 10px rgba(0,0,0,0.65)',
    '1px 0 0 #0d1c18',
  ].join(', '),
  clipPath: 'polygon(0 22px, 22px 0, 100% 0, 100% 100%, 0 100%)',
  padding: 8,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  position: 'relative',
};

const centerPanelStyle: React.CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  height: 108,
  background: 'linear-gradient(180deg, #050709 0%, #030507 100%)',
  border: '2px solid #162420',
  boxShadow: [
    'inset 0 0 0 1px rgba(18,48,32,0.22)',
    'inset 2px 2px 8px rgba(0,0,0,0.75)',
  ].join(', '),
  padding: 8,
  fontFamily: 'Consolas, monospace',
  fontSize: 11,
  color: '#90b088',
  overflowY: 'auto',
};

const rightPanelStyle: React.CSSProperties = {
  flex: '0 0 180px',
  minWidth: 180,
  height: 128,
  background: 'linear-gradient(155deg, #0c1318 0%, #070a0e 100%)',
  border: '2px solid #1c3028',
  boxShadow: [
    'inset 0 0 0 1px rgba(25,60,42,0.28)',
    'inset -3px 3px 10px rgba(0,0,0,0.65)',
    '-1px 0 0 #0d1c18',
  ].join(', '),
  clipPath: 'polygon(0 0, calc(100% - 22px) 0, 100% 22px, 100% 100%, 0 100%)',
  padding: 8,
  position: 'relative',
};

const LED_ON = '#25904a';
const LED_DIM = '#154a28';

export const CommandCenter: FC = () => {
  const [minimized, setMinimized] = useState(false);
  return (
    <div
      data-command-center
      style={{ ...wrapper, minHeight: minimized ? 38 : undefined }}
    >
      <div style={headerBar}>
        {/* Status LED */}
        <div
          aria-hidden
          style={{
            width: 7,
            height: 7,
            borderRadius: 1,
            background: LED_ON,
            boxShadow: `0 0 6px ${LED_ON}`,
            flexShrink: 0,
          }}
        />
        <span>Command Center</span>
        {/* Separator ticks */}
        <div aria-hidden style={{ marginLeft: 4, display: 'flex', gap: 3, alignItems: 'center' }}>
          {[1, 0.5, 0.25].map((op, k) => (
            <div key={k} style={{ width: 2, height: 10, background: `rgba(40,120,60,${op})` }} />
          ))}
        </div>
        <button
          type="button"
          onClick={() => setMinimized((m) => !m)}
          aria-label={minimized ? 'Expand' : 'Minimize'}
          style={{
            marginLeft: 'auto',
            width: 20,
            height: 16,
            padding: 0,
            border: '1px solid #1e4030',
            background: 'rgba(12,28,20,0.95)',
            color: '#3a8055',
            fontSize: 10,
            cursor: 'pointer',
            lineHeight: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            clipPath: minimized ? undefined : 'polygon(0 3px, 3px 0, 100% 0, 100% 100%, 0 100%)',
          }}
        >
          {minimized ? '▴' : '▾'}
        </button>
      </div>

      {!minimized && (
        <div style={layout}>
          {/* LEFT — portrait/identity panel */}
          <div style={leftPanelStyle}>
            <Led style={{ top: 6, right: 6, background: LED_ON, boxShadow: `0 0 5px ${LED_ON}` }} />
            <Led style={{ bottom: 6, right: 6, background: LED_DIM }} />
            <AgentIdentity />
          </div>

          {/* CENTER — metrics / info */}
          <div style={centerPanelStyle}>
            <MetricsPanel />
          </div>

          {/* RIGHT — command grid */}
          <div style={rightPanelStyle}>
            <Led style={{ top: 6, left: 6, background: LED_ON, boxShadow: `0 0 5px ${LED_ON}` }} />
            <Led style={{ bottom: 6, left: 6, background: LED_DIM }} />
            <AgentControls />
          </div>
        </div>
      )}
    </div>
  );
};
