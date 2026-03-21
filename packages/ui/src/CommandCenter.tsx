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
import { createPortal } from 'react-dom';
import { AgentIdentity } from './panels/AgentIdentity.js';
import { MetricsPanel } from './panels/MetricsPanel.js';
import { AgentControls } from './panels/AgentControls.js';
import { useCommandCenterStore } from './store.js';
import { GuidedTour, restartTour } from './GuidedTour.js';

const CHAMFER = 28;
const STEP = 28; // how far the center dips below the side wings (128 − 108)

// Left panel right edge: paddingLeft(10) + width(114) = 124
// Right panel left edge from right: paddingRight(10) + width(180) = 190
const M_CLIP = `polygon(
  0 ${CHAMFER}px, ${CHAMFER}px 0, 155px 0,
  183px ${STEP}px, calc(100% - 248px) ${STEP}px, calc(100% - 220px) 0,
  calc(100% - ${CHAMFER}px) 0, 100% ${CHAMFER}px,
  100% 100%, 0 100%)`;

// Outer container: handles screen positioning only — NO clipPath so ConnectPanel isn't masked.
const outerWrapper: React.CSSProperties = {
  position: 'absolute',
  bottom: 0,
  left: 0,
  right: 0,
  zIndex: 20,
};

// Inner chrome: M-shaped clipPath — sides taller, center dips down.
const wrapper: React.CSSProperties = {
  background: 'linear-gradient(180deg, #06090c 0%, #03060a 100%)',
  borderTop: '3px solid #182820',
  boxShadow: [
    'inset 0 0 0 1px rgba(25,60,42,0.55)',
    'inset 4px 0 10px rgba(0,0,0,0.65)',
    'inset -4px 0 10px rgba(0,0,0,0.65)',
    '0 -10px 40px rgba(0,0,0,0.9)',
    '0 -2px 0 rgba(30,70,50,0.35)',
  ].join(', '),
  clipPath: M_CLIP,
};

const headerBar: React.CSSProperties = {
  paddingTop: 8, // extra top creates the tall side-wings; clipped away in center
  paddingBottom: 5,
  paddingLeft: CHAMFER - 7,
  paddingRight: CHAMFER + 7,
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
  paddingTop: 8,
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
  height: 134,
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
  height: 134,
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
  overflow: 'hidden',
};

const rightPanelStyle: React.CSSProperties = {
  flex: '0 0 180px',
  minWidth: 180,
  height: 134,
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

export interface CommandCenterProps {
  onOpenSkill?: (filePath: string) => void;
  onCreateSkill?: () => void;
  onOpenMarketplace?: () => void;
  onMoveSkill?: (filePath: string, newCategory: string) => void;
  onDuplicateSkill?: (filePath: string, newName: string) => void;
}

export const CommandCenter: FC<CommandCenterProps> = ({ onOpenSkill, onCreateSkill, onOpenMarketplace, onMoveSkill, onDuplicateSkill } = {}) => {
  const minimized = useCommandCenterStore((s) => s.ccMinimized);
  const setCcMinimized = useCommandCenterStore((s) => s.setCcMinimized);
  const [hoveredBtn, setHoveredBtn] = useState<string | null>(null);
  const toggleSettings = useCommandCenterStore((s) => s.toggleSettings);
  return (
    <div data-command-center style={outerWrapper}>
      <div style={{ ...wrapper, minHeight: minimized ? 38 : undefined }}>
      {hoveredBtn && createPortal(
        <div
          style={{
            position: 'fixed',
            bottom: minimized ? 75 : 212,
            right: 12,
            width: 190,
            background: 'linear-gradient(180deg, #0d1e16 0%, #070f0a 100%)',
            border: '1px solid #2a5a3c',
            boxShadow: '0 -4px 16px rgba(0,0,0,0.75)',
            padding: '7px 9px',
            fontFamily: 'Consolas, monospace',
            zIndex: 9999,
            pointerEvents: 'none',
            clipPath: 'polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%)',
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, color: '#90d898', letterSpacing: '0.04em', marginBottom: 4 }}>
            {hoveredBtn === 'tour' ? 'Guided Tour' : hoveredBtn === 'settings' ? 'Settings' : (minimized ? 'Expand' : 'Minimize')}
          </div>
          <div style={{ fontSize: 9, color: '#4a7a58', lineHeight: 1.5 }}>
            {hoveredBtn === 'tour' ? 'Restart the 4-step walkthrough of the Command Center.' : hoveredBtn === 'settings' ? 'Customize agent colors, sizes, and preferences.' : (minimized ? 'Expand the Command Center.' : 'Collapse the Command Center.')}
          </div>
        </div>,
        document.body
      )}
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
          onClick={() => restartTour()}
          onMouseEnter={() => setHoveredBtn('tour')}
          onMouseLeave={() => setHoveredBtn(null)}
          aria-label="Guided Tour"
          style={{
            marginLeft: 'auto',
            width: 20,
            height: 20,
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
          }}
        >
          ?
        </button>
        <button
          type="button"
          onClick={toggleSettings}
          onMouseEnter={() => setHoveredBtn('settings')}
          onMouseLeave={() => setHoveredBtn(null)}
          aria-label="Settings"
          style={{
            width: 20,
            height: 20,
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
          }}
        >
          &#x2699;
        </button>
        <button
          type="button"
          onClick={() => setCcMinimized(!minimized)}
          onMouseEnter={() => setHoveredBtn('minimize')}
          onMouseLeave={() => setHoveredBtn(null)}
          aria-label={minimized ? 'Expand' : 'Minimize'}
          style={{
            width: 20,
            height: 20,
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
          <div data-tour="identity" style={leftPanelStyle}>
            <Led style={{ top: 6, right: 6, background: LED_ON, boxShadow: `0 0 5px ${LED_ON}` }} />
            <Led style={{ bottom: 6, right: 6, background: LED_DIM }} />
            <AgentIdentity />
          </div>

          {/* CENTER — metrics / info */}
          <div data-tour="metrics" style={centerPanelStyle}>
            <MetricsPanel onOpenSkill={onOpenSkill} onCreateSkill={onCreateSkill} onOpenMarketplace={onOpenMarketplace} onMoveSkill={onMoveSkill} onDuplicateSkill={onDuplicateSkill} />
          </div>

          {/* RIGHT — command grid */}
          <div data-tour="commands" style={rightPanelStyle}>
            <Led style={{ top: 6, left: 6, background: LED_ON, boxShadow: `0 0 5px ${LED_ON}` }} />
            <Led style={{ bottom: 6, left: 6, background: LED_DIM }} />
            <AgentControls />
          </div>
        </div>
      )}
      </div>
      <GuidedTour />
    </div>
  );
};
