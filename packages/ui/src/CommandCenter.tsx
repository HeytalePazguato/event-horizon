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
import { useCommandCenterStore } from './store.js';

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

interface Connector {
  id: string;
  label: string;
  status: 'available' | 'auto' | 'soon';
  description: string;
}

const CONNECTORS: Connector[] = [
  { id: 'claude-code', label: 'Claude Code',     status: 'available', description: 'Installs hooks into ~/.claude/settings.json' },
  { id: 'copilot',     label: 'GitHub Copilot',  status: 'auto',      description: 'Auto-detected via VS Code output channel' },
  { id: 'cursor',      label: 'Cursor',           status: 'auto',      description: 'Detected natively — runs inside Cursor' },
  { id: 'opencode',    label: 'OpenCode',         status: 'soon',      description: 'Coming soon' },
  { id: 'ollama',      label: 'Ollama / Local',   status: 'soon',      description: 'Coming soon' },
];

const STATUS_COLORS: Record<Connector['status'], string> = {
  available: '#25904a',
  auto:      '#4a88cc',
  soon:      '#3a4a3a',
};
const STATUS_LABELS: Record<Connector['status'], string> = {
  available: 'Setup',
  auto:      'Auto',
  soon:      'Soon',
};

const ConnectPanel: FC<{ onClose: () => void }> = ({ onClose }) => {
  const requestConnectAgent = useCommandCenterStore((s) => s.requestConnectAgent);
  return (
    <div
      style={{
        position: 'absolute',
        bottom: '100%',
        right: 10,
        marginBottom: 6,
        background: 'linear-gradient(180deg, #0c1a14 0%, #060e0a 100%)',
        border: '1px solid #1e4030',
        boxShadow: '0 -4px 20px rgba(0,0,0,0.8), inset 0 0 0 1px rgba(30,80,50,0.2)',
        padding: '10px 12px',
        minWidth: 240,
        zIndex: 40,
        fontFamily: 'Consolas, monospace',
        clipPath: 'polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 0 100%)',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ fontSize: 9, color: '#3a8055', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 8 }}>
        Connect Agent
      </div>
      {CONNECTORS.map((c) => (
        <div
          key={c.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            paddingBottom: 6,
            marginBottom: 6,
            borderBottom: '1px solid rgba(30,60,40,0.4)',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, color: '#90b088', fontWeight: 600 }}>{c.label}</div>
            <div style={{ fontSize: 9, color: '#3a5a44', marginTop: 1 }}>{c.description}</div>
          </div>
          <button
            type="button"
            disabled={c.status === 'soon'}
            onClick={() => c.status === 'available' && requestConnectAgent(c.id)}
            style={{
              padding: '3px 8px',
              border: `1px solid ${c.status === 'soon' ? '#1e2e1e' : STATUS_COLORS[c.status]}`,
              background: c.status === 'available' ? 'linear-gradient(180deg, #1a3028 0%, #0f2018 100%)' : 'transparent',
              color: STATUS_COLORS[c.status],
              fontSize: 9,
              cursor: c.status === 'available' ? 'pointer' : 'default',
              letterSpacing: '0.05em',
              flexShrink: 0,
              opacity: c.status === 'soon' ? 0.4 : 1,
            }}
          >
            {STATUS_LABELS[c.status]}
          </button>
        </div>
      ))}
      <div
        style={{ fontSize: 8, color: '#2a4a34', textAlign: 'right', marginTop: 2, cursor: 'pointer' }}
        onClick={onClose}
      >
        Close ✕
      </div>
    </div>
  );
};

export const CommandCenter: FC = () => {
  const [minimized, setMinimized] = useState(false);
  const connectOpen   = useCommandCenterStore((s) => s.connectOpen);
  const toggleConnect = useCommandCenterStore((s) => s.toggleConnect);
  return (
    <div
      data-command-center
      style={{ ...wrapper, minHeight: minimized ? 38 : undefined, position: 'relative' }}
    >
      {connectOpen && <ConnectPanel onClose={toggleConnect} />}
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
