/**
 * Command Center — StarCraft II Terran-style:
 * - Wide chamfered top corners on outer panel
 * - Side panels (portrait + commands) taller than center, protruding upward
 * - Green LED indicators at inner corners
 * - Dark steel color scheme with teal-green accents
 * @event-horizon/ui
 */

import type { FC } from 'react';
import { useState, useEffect } from 'react';
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

export interface BudgetInfo {
  spent: number;
  limit: number;
  percentUsed: number;
}

export interface CommandCenterProps {
  role?: string | null;
  knowledgeCount?: { workspace: number; plan: number };
  recentKnowledge?: Array<{ key: string; value: string; scope: string }>;
  budgetInfo?: BudgetInfo | null;
  onOpenSkill?: (filePath: string) => void;
  onCreateSkill?: () => void;
  onOpenMarketplace?: () => void;
  onMoveSkill?: (filePath: string, newCategory: string) => void;
  onDuplicateSkill?: (filePath: string, newName: string) => void;
}

/** Fuel gauge bar — shows budget spent vs limit with color coding. */
function FuelGauge({ info }: { info: BudgetInfo }) {
  const pct = Math.min(100, Math.max(0, info.percentUsed));
  const barColor = pct >= 80 ? '#cc3333' : pct >= 60 ? '#d4a84a' : '#40a060';
  const isFlashing = pct >= 80;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'Consolas, monospace', fontSize: 9, color: '#7a9a82', marginTop: 4 }}>
      <span style={{ color: '#4a6a52', flexShrink: 0 }}>BUDGET</span>
      <div style={{ flex: 1, height: 6, background: 'rgba(20,40,28,0.6)', border: '1px solid #1a3020', position: 'relative', overflow: 'hidden' }}>
        <div style={{
          width: `${pct}%`,
          height: '100%',
          background: barColor,
          boxShadow: isFlashing ? `0 0 6px ${barColor}` : undefined,
          animation: isFlashing ? 'eh-fuel-flash 0.8s ease-in-out infinite' : undefined,
          transition: 'width 0.3s ease',
        }} />
      </div>
      <span style={{ flexShrink: 0, color: pct >= 80 ? '#cc3333' : '#7a9a82' }}>
        ${info.spent.toFixed(2)} / ${info.limit.toFixed(2)} ({Math.round(pct)}%)
      </span>
      <style>{`@keyframes eh-fuel-flash { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }`}</style>
    </div>
  );
}

export const CommandCenter: FC<CommandCenterProps> = ({ role, knowledgeCount, recentKnowledge, budgetInfo, onOpenSkill, onCreateSkill, onOpenMarketplace, onMoveSkill, onDuplicateSkill } = {}) => {
  const minimized = useCommandCenterStore((s) => s.ccMinimized);
  const setCcMinimized = useCommandCenterStore((s) => s.setCcMinimized);
  const [hoveredBtn, setHoveredBtn] = useState<string | null>(null);
  const toggleSettings = useCommandCenterStore((s) => s.toggleSettings);
  const demoMode = useCommandCenterStore((s) => s.demoMode);
  const demoStartedAt = useCommandCenterStore((s) => s.demoStartedAt);
  const requestDemo = useCommandCenterStore((s) => s.requestDemo);
  // Live-ticking demo timer
  const [demoElapsed, setDemoElapsed] = useState('');
  useEffect(() => {
    if (!demoMode || !demoStartedAt) { setDemoElapsed(''); return; }
    const tick = () => {
      const secs = Math.floor((Date.now() - demoStartedAt) / 1000);
      const m = Math.floor(secs / 60);
      const s = secs % 60;
      setDemoElapsed(`${m}:${s.toString().padStart(2, '0')}`);
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [demoMode, demoStartedAt]);
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
            {hoveredBtn === 'viewToggle' ? 'Operations' : hoveredBtn === 'clearDemo' ? 'Clear Demo' : hoveredBtn === 'tour' ? 'Guided Tour' : hoveredBtn === 'settings' ? 'Settings' : (minimized ? 'Expand' : 'Minimize')}
          </div>
          <div style={{ fontSize: 9, color: '#4a7a58', lineHeight: 1.5 }}>
            {hoveredBtn === 'viewToggle' ? 'Switch to the full-screen Operations dashboard.' : hoveredBtn === 'clearDemo' ? 'Stop the demo simulation and remove all demo agents.' : hoveredBtn === 'tour' ? 'Restart the 4-step walkthrough of the Command Center.' : hoveredBtn === 'settings' ? 'Customize agent colors, sizes, and preferences.' : (minimized ? 'Expand the Command Center.' : 'Collapse the Command Center.')}
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
        {/* Demo mode indicator — right side, before header buttons */}
        {demoMode && (
          <button
            type="button"
            onClick={requestDemo}
            onMouseEnter={() => setHoveredBtn('clearDemo')}
            onMouseLeave={() => setHoveredBtn(null)}
            aria-label="Clear Demo"
            style={{
              marginLeft: 'auto',
              padding: '2px 8px',
              border: '1px solid #8a5a2a',
              borderRadius: 2,
              background: 'rgba(40,25,10,0.8)',
              color: '#d4944a',
              fontSize: 9,
              fontFamily: 'Consolas, monospace',
              fontWeight: 600,
              cursor: 'pointer',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              lineHeight: 1.4,
              display: 'flex',
              alignItems: 'center',
              gap: 5,
            }}
          >
            <span style={{ fontSize: 8, opacity: 0.7 }}>DEMO</span>
            <span>{demoElapsed}</span>
            <span style={{ fontSize: 8, opacity: 0.8 }}>&#x2715;</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => useCommandCenterStore.getState().toggleViewMode()}
          onMouseEnter={() => setHoveredBtn('viewToggle')}
          onMouseLeave={() => setHoveredBtn(null)}
          aria-label="Operations View"
          style={{
            marginLeft: demoMode ? 4 : 'auto',
            width: 20,
            height: 20,
            padding: 0,
            border: '1px solid #1e4030',
            background: 'rgba(12,28,20,0.95)',
            color: '#3a8055',
            fontSize: 9,
            cursor: 'pointer',
            lineHeight: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          &#x2261;
        </button>
        <button
          type="button"
          onClick={() => restartTour()}
          onMouseEnter={() => setHoveredBtn('tour')}
          onMouseLeave={() => setHoveredBtn(null)}
          aria-label="Guided Tour"
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
            <AgentIdentity role={role} knowledgeCount={knowledgeCount} recentKnowledge={recentKnowledge} />
          </div>

          {/* CENTER — metrics / info */}
          <div data-tour="metrics" style={centerPanelStyle}>
            <MetricsPanel onOpenSkill={onOpenSkill} onCreateSkill={onCreateSkill} onOpenMarketplace={onOpenMarketplace} onMoveSkill={onMoveSkill} onDuplicateSkill={onDuplicateSkill} />
            {budgetInfo && budgetInfo.limit > 0 && <FuelGauge info={budgetInfo} />}
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
