/**
 * Right panel: command grid (icon buttons + tooltip).
 * @event-horizon/ui
 */

import type { FC } from 'react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import { useCommandCenterStore } from '../store.js';

// ── Icon SVGs ─────────────────────────────────────────────────────────────────

const IconPause: FC = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <rect x="2" y="2" width="3.5" height="10" rx="0.8" fill="currentColor" />
    <rect x="8.5" y="2" width="3.5" height="10" rx="0.8" fill="currentColor" />
  </svg>
);

const IconIsolate: FC = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
    <circle cx="7" cy="7" r="2.8" stroke="currentColor" strokeWidth="1" fill="none" />
    <circle cx="7" cy="7" r="1.2" fill="currentColor" />
    <line x1="7" y1="1" x2="7" y2="3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <line x1="7" y1="11" x2="7" y2="13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <line x1="1" y1="7" x2="3" y2="7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <line x1="11" y1="7" x2="13" y2="7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

const IconCenter: FC = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1.2" fill="none" />
    <line x1="7" y1="1" x2="7" y2="4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <line x1="7" y1="9.5" x2="7" y2="13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <line x1="1" y1="7" x2="4.5" y2="7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <line x1="9.5" y1="7" x2="13" y2="7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

const IconConnect: FC = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <circle cx="3.5" cy="10.5" r="2" stroke="currentColor" strokeWidth="1.2" fill="none" />
    <circle cx="10.5" cy="3.5" r="2" stroke="currentColor" strokeWidth="1.2" fill="none" />
    <line x1="5.2" y1="8.8" x2="8.8" y2="5.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    <circle cx="3.5" cy="10.5" r="0.7" fill="currentColor" />
    <circle cx="10.5" cy="3.5" r="0.7" fill="currentColor" />
  </svg>
);

const IconSpawn: FC = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <rect x="1.5" y="4" width="11" height="8" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none" />
    <line x1="1.5" y1="6.5" x2="12.5" y2="6.5" stroke="currentColor" strokeWidth="0.8" />
    <text x="4" y="11" fill="currentColor" fontSize="4" fontFamily="monospace">&gt;_</text>
  </svg>
);

const IconDemo: FC = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <polygon points="4,2 12,7 4,12" fill="currentColor" opacity="0.85" />
  </svg>
);

const IconInfo: FC = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
    <circle cx="7" cy="4.5" r="1" fill="currentColor" />
    <rect x="6" y="6.5" width="2" height="4.5" rx="0.5" fill="currentColor" />
  </svg>
);

// ── Button definitions ────────────────────────────────────────────────────────

interface CmdBtn {
  id: string;
  label: string;
  desc: string;
  icon: FC;
  requiresAgent?: boolean;
  alwaysActive?: boolean;
}

/**
 * Grid layout (5x3):
 *   Row 1 — Agent actions:  Pause, Isolate, Center
 *   Row 2 — Setup actions:  Connect, Spawn
 *   Row 3 — Meta/utility:   (empty x3), Demo, Info
 */
const GRID: Array<CmdBtn | null> = [
  // Row 1 — agent actions
  { id: 'pause',   label: 'Pause',   desc: 'Freeze agent animation and pulse.',     icon: IconPause,   requiresAgent: true },
  { id: 'isolate', label: 'Isolate', desc: 'Dim all other planets to focus.',       icon: IconIsolate,  requiresAgent: true },
  { id: 'center',  label: 'Center',  desc: 'Re-center the map.',                    icon: IconCenter,   alwaysActive: true },
  null, null,
  // Row 2 — setup actions
  { id: 'connect', label: 'Connect', desc: 'Connect a new agent to the universe.',  icon: IconConnect,  alwaysActive: true },
  { id: 'spawn',   label: 'Spawn',   desc: 'Open a terminal with an agent CLI.',    icon: IconSpawn,    alwaysActive: true },
  null, null, null,
  // Row 3 — meta/utility (bottom-right)
  null, null, null,
  { id: 'demo',    label: 'Demo',    desc: 'Toggle demo simulation.',               icon: IconDemo,     alwaysActive: true },
  { id: 'info',    label: 'Info',    desc: 'Show the universe guide.',              icon: IconInfo,     alwaysActive: true },
];

const BUTTONS = GRID.filter((b): b is CmdBtn => b !== null);

// ── Styles ────────────────────────────────────────────────────────────────────

const labelStyle = {
  color: '#6a8a7a',
  fontSize: 10,
  marginBottom: 8,
  letterSpacing: '0.05em',
  textTransform: 'uppercase' as const,
};

const gridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(5, 1fr)',
  gridTemplateRows: 'repeat(3, 1fr)',
  gap: 4,
  flex: 1,
  minHeight: 0,
};

const btnBase: React.CSSProperties = {
  border: '1px solid #2a4a3a',
  background: 'linear-gradient(180deg, #1a2820 0%, #0f1a18 100%)',
  color: '#5a7a6a',
  cursor: 'pointer',
  boxShadow: 'inset 0 1px 0 rgba(0,0,0,0.3)',
  aspectRatio: '1',
  minHeight: 28,
  padding: 4,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const btnActive: React.CSSProperties = {
  ...btnBase,
  border: '1px solid #3a6a4a',
  color: '#90d0a0',
  background: 'linear-gradient(180deg, #1e3228 0%, #142820 100%)',
  boxShadow: 'inset 0 0 0 1px rgba(80,140,100,0.2), inset 0 1px 0 rgba(100,160,100,0.1)',
};

const btnLit: React.CSSProperties = {
  ...btnActive,
  border: '1px solid #50aa70',
  color: '#b0f0c0',
  boxShadow: 'inset 0 0 0 1px rgba(100,180,120,0.35), 0 0 6px rgba(60,160,90,0.3)',
};

const btnDisabled: React.CSSProperties = {
  ...btnBase,
  opacity: 0.3,
  cursor: 'default',
};

// ── Command tooltip ──────────────────────────────────────────────────────────

const CmdTooltip: FC<{ label: string; desc: string }> = ({ label, desc }) =>
  createPortal(
    <div
      style={{
        position: 'fixed',
        bottom: 200,
        right: 12,
        width: 172,
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
        {label}
      </div>
      <div style={{ fontSize: 9, color: '#4a7a58', lineHeight: 1.5 }}>
        {desc}
      </div>
    </div>,
    document.body
  );

// ── Component ─────────────────────────────────────────────────────────────────

export const AgentControls: FC = () => {
  const {
    selectedAgentId,
    requestCenter,
    toggleConnect,
    connectOpen,
    togglePause,
    pausedAgentIds,
    toggleIsolate,
    isolatedAgentId,
    requestDemo,
    demoRequested,
    toggleInfo,
    infoOpen,
    toggleSpawn,
    spawnOpen,
  } = useCommandCenterStore(useShallow((s) => ({
    selectedAgentId: s.selectedAgentId,
    requestCenter: s.requestCenter,
    toggleConnect: s.toggleConnect,
    connectOpen: s.connectOpen,
    togglePause: s.togglePause,
    pausedAgentIds: s.pausedAgentIds,
    toggleIsolate: s.toggleIsolate,
    isolatedAgentId: s.isolatedAgentId,
    requestDemo: s.requestDemo,
    demoRequested: s.demoRequested,
    toggleInfo: s.toggleInfo,
    infoOpen: s.infoOpen,
    toggleSpawn: s.toggleSpawn,
    spawnOpen: s.spawnOpen,
  })));
  const [hovered, setHovered] = useState<string | null>(null);

  const hoveredBtn = hovered ? BUTTONS.find((b) => b.id === hovered) : null;

  function handleClick(id: string) {
    if (id === 'center') requestCenter();
    else if (id === 'connect') toggleConnect();
    else if (id === 'pause' && selectedAgentId) togglePause(selectedAgentId);
    else if (id === 'isolate' && selectedAgentId) toggleIsolate(selectedAgentId);
    else if (id === 'spawn') toggleSpawn();
    else if (id === 'demo') requestDemo();
    else if (id === 'info') toggleInfo();
  }

  function isActive(btn: CmdBtn): boolean {
    if (btn.requiresAgent) return !!selectedAgentId;
    return true;
  }

  function isLit(btn: CmdBtn): boolean {
    if (btn.id === 'connect') return connectOpen;
    if (btn.id === 'spawn') return spawnOpen;
    if (btn.id === 'demo') return demoRequested;
    if (btn.id === 'info') return infoOpen;
    if (btn.id === 'pause' && selectedAgentId) return !!pausedAgentIds[selectedAgentId];
    if (btn.id === 'isolate' && selectedAgentId) return isolatedAgentId === selectedAgentId;
    return false;
  }

  return (
    <div data-agent-controls style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {hoveredBtn && <CmdTooltip label={hoveredBtn.label} desc={hoveredBtn.desc} />}
      <div style={labelStyle}>Commands</div>
      <div style={gridStyle}>
        {GRID.map((btn, i) => {
          if (!btn) {
            return <button key={`empty-${i}`} type="button" style={btnDisabled} disabled tabIndex={-1} aria-hidden />;
          }
          const active = isActive(btn);
          const lit = isLit(btn);
          const style = !active ? btnDisabled : lit ? btnLit : btnActive;
          return (
            <button
              key={btn.id}
              type="button"
              style={style}
              disabled={!active}
              aria-label={btn.label}
              onClick={() => handleClick(btn.id)}
              onMouseEnter={() => setHovered(btn.id)}
              onMouseLeave={() => setHovered(null)}
            >
              <btn.icon />
            </button>
          );
        })}
      </div>
    </div>
  );
};
