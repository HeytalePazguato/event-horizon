/**
 * Left panel: selected agent identity with a type-matched planet icon.
 * @event-horizon/ui
 */

import type { FC } from 'react';
import { useCommandCenterStore } from '../store.js';

const stateColors: Record<string, string> = {
  idle: '#4a8a5a',
  thinking: '#d4a84a',
  working: '#b8a040',
  tool_use: '#6aa0d4',
  error: '#c65858',
};

// SVG planet icons keyed by agentType — each structurally distinct
function PlanetIcon({ type, size = 52 }: { type: string; size?: number }) {
  const r = size / 2;
  const cx = r;
  const cy = r;

  if (type === 'claude-code') {
    // Gas giant: tan with 3 bands + storm oval + ring arc
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ overflow: 'visible' }}>
        {/* Ring arc behind */}
        <ellipse cx={cx} cy={cy} rx={r * 1.65} ry={r * 0.22} fill="none" stroke="#c0a060" strokeWidth="2" strokeOpacity="0.35" />
        <circle cx={cx} cy={cy} r={r} fill="#c8b090" />
        <ellipse cx={cx} cy={cy - r * 0.38} rx={r * 0.92} ry={r * 0.13} fill="#907050" fillOpacity="0.85" />
        <ellipse cx={cx} cy={cy + r * 0.05} rx={r * 0.94} ry={r * 0.10} fill="#d4c098" fillOpacity="0.70" />
        <ellipse cx={cx} cy={cy + r * 0.38} rx={r * 0.88} ry={r * 0.12} fill="#7a5838" fillOpacity="0.80" />
        {/* Storm spot */}
        <ellipse cx={cx + r * 0.18} cy={cy - r * 0.10} rx={r * 0.22} ry={r * 0.14} fill="#e07040" fillOpacity="0.9" />
        <ellipse cx={cx + r * 0.18} cy={cy - r * 0.10} rx={r * 0.12} ry={r * 0.08} fill="#f09060" fillOpacity="0.8" />
        {/* Clip to circle */}
        <circle cx={cx} cy={cy} r={r} fill="none" />
      </svg>
    );
  }

  if (type === 'copilot') {
    // Icy world: blue-white with ice caps + crystal lines
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill="#7ac8e8" />
        {/* Ice caps */}
        <ellipse cx={cx} cy={cy - r * 0.58} rx={r * 0.52} ry={r * 0.30} fill="#ddf6ff" fillOpacity="0.92" />
        <ellipse cx={cx} cy={cy + r * 0.62} rx={r * 0.38} ry={r * 0.20} fill="#ddf6ff" fillOpacity="0.76" />
        {/* Crystal lines */}
        {[0.3, 1.0, 1.7, 2.4].map((a, i) => (
          <line key={i}
            x1={cx - Math.cos(a) * r * 0.8} y1={cy - Math.sin(a) * r * 0.8}
            x2={cx + Math.cos(a) * r * 0.8} y2={cy + Math.sin(a) * r * 0.8}
            stroke="#aaeeff" strokeWidth="0.9" strokeOpacity="0.45"
          />
        ))}
        {/* Surface sheen */}
        <ellipse cx={cx - r * 0.22} cy={cy - r * 0.24} rx={r * 0.3} ry={r * 0.18} fill="white" fillOpacity="0.18" />
      </svg>
    );
  }

  if (type === 'cursor') {
    // Ocean world: deep teal-blue with swirling currents + green landmasses
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Deep ocean body */}
        <circle cx={cx} cy={cy} r={r} fill="#0e7090" />
        {/* Depth patches */}
        <ellipse cx={cx - r * 0.22} cy={cy + r * 0.18} rx={r * 0.44} ry={r * 0.30} fill="#085870" fillOpacity="0.55" />
        <ellipse cx={cx + r * 0.30} cy={cy - r * 0.25} rx={r * 0.36} ry={r * 0.24} fill="#0a6880" fillOpacity="0.45" />
        {/* Swirling current arc */}
        <path d={`M ${cx - r * 0.7} ${cy} Q ${cx} ${cy - r * 0.7} ${cx + r * 0.6} ${cy + r * 0.1}`}
          fill="none" stroke="#3ab8d0" strokeWidth="1.4" strokeOpacity="0.55" />
        <path d={`M ${cx - r * 0.4} ${cy + r * 0.5} Q ${cx + r * 0.2} ${cy + r * 0.2} ${cx + r * 0.7} ${cy - r * 0.3}`}
          fill="none" stroke="#44ccdd" strokeWidth="1.0" strokeOpacity="0.40" />
        {/* Green landmass */}
        <ellipse cx={cx + r * 0.18} cy={cy - r * 0.30} rx={r * 0.22} ry={r * 0.16} fill="#2a8040" fillOpacity="0.82" />
        <ellipse cx={cx - r * 0.35} cy={cy + r * 0.38} rx={r * 0.16} ry={r * 0.12} fill="#2a8040" fillOpacity="0.75" />
        {/* Surf ring */}
        <circle cx={cx} cy={cy} r={r * 0.90} fill="none" stroke="#88eeff" strokeWidth="0.8" strokeOpacity="0.22" />
        {/* Polar sheen */}
        <ellipse cx={cx - r * 0.24} cy={cy - r * 0.26} rx={r * 0.30} ry={r * 0.17} fill="white" fillOpacity="0.16" />
      </svg>
    );
  }

  if (type === 'opencode') {
    // Rocky world: brown with craters
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill="#8b5a3c" />
        {/* Surface patches */}
        <ellipse cx={cx + r * 0.3} cy={cy - r * 0.2} rx={r * 0.35} ry={r * 0.25} fill="#7a5030" fillOpacity="0.4" />
        {/* Craters */}
        {[
          { dx: -0.3, dy: -0.3, cr: 0.18 },
          { dx:  0.3, dy:  0.2, cr: 0.14 },
          { dx: -0.1, dy:  0.35, cr: 0.12 },
          { dx:  0.2, dy: -0.42, cr: 0.10 },
        ].map((p, i) => (
          <g key={i}>
            <circle cx={cx + r * p.dx} cy={cy + r * p.dy} r={r * (p.cr + 0.06)} fill="#a07050" fillOpacity="0.8" />
            <circle cx={cx + r * p.dx} cy={cy + r * p.dy} r={r * p.cr} fill="#5a3820" fillOpacity="0.9" />
          </g>
        ))}
        {/* Highlight */}
        <ellipse cx={cx - r * 0.28} cy={cy - r * 0.28} rx={r * 0.28} ry={r * 0.16} fill="#c08060" fillOpacity="0.22" />
      </svg>
    );
  }

  // volcanic / unknown
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cy} r={r} fill="#281410" />
      <ellipse cx={cx + r * 0.28} cy={cy - r * 0.18} rx={r * 0.4} ry={r * 0.28} fill="#381c14" fillOpacity="0.55" />
      {/* Lava cracks */}
      {[0, 1, 2, 3, 4].map((i) => {
        const a = (i / 5) * Math.PI * 2 + 0.3;
        const len = r * 0.68;
        return (
          <line key={i}
            x1={cx + Math.cos(a) * r * 0.12} y1={cy + Math.sin(a) * r * 0.12}
            x2={cx + Math.cos(a) * len} y2={cy + Math.sin(a) * len}
            stroke="#ff6622" strokeWidth="1.2" strokeOpacity="0.85"
          />
        );
      })}
      {/* Hot spots */}
      {[{ dx: 0.2, dy: -0.35 }, { dx: -0.3, dy: 0.2 }, { dx: 0.35, dy: 0.25 }].map((p, i) => (
        <circle key={i} cx={cx + r * p.dx} cy={cy + r * p.dy} r={r * 0.08} fill="#ff9944" fillOpacity="0.92" />
      ))}
    </svg>
  );
}

function SingularityIcon({ size = 52 }: { size?: number }) {
  const r = size / 2;
  const cx = r;
  const cy = r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ overflow: 'visible' }}>
      {/* Outer glow */}
      <circle cx={cx} cy={cy} r={r * 0.95} fill="#220808" fillOpacity="0.6" />
      {/* Accretion disk - simplified */}
      <ellipse cx={cx} cy={cy} rx={r * 0.85} ry={r * 0.85} fill="none" stroke="#ff9944" strokeWidth="3" strokeOpacity="0.5" />
      <ellipse cx={cx} cy={cy} rx={r * 0.7} ry={r * 0.7} fill="none" stroke="#ffcc66" strokeWidth="2" strokeOpacity="0.7" />
      {/* Inner bright ring */}
      <circle cx={cx} cy={cy} r={r * 0.5} fill="#ffcc66" fillOpacity="0.9" />
      {/* Event horizon (black core) */}
      <circle cx={cx} cy={cy} r={r * 0.38} fill="#000000" />
    </svg>
  );
}

/** Extract the last folder name from a full path. */
function folderName(cwd: string): string {
  const normalized = cwd.replace(/\\/g, '/').replace(/\/+$/, '');
  return normalized.split('/').pop() || cwd;
}

export const AgentIdentity: FC = () => {
  const selectedAgent = useCommandCenterStore((s) => s.selectedAgent);
  const singularitySelected = useCommandCenterStore((s) => s.singularitySelected);

  return (
    <div data-agent-identity style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
      {singularitySelected ? (
        <>
          <div style={{ width: 54, height: 54, border: '2px solid #4a2020', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(20,8,8,0.6)', boxShadow: 'inset 0 0 12px rgba(140,60,20,0.3), 0 0 8px rgba(120,40,10,0.2)' }} aria-hidden>
            <SingularityIcon size={48} />
          </div>
          <span style={{ fontSize: 9, color: '#d4844a', fontWeight: 600, textAlign: 'center' }}>
            Singularity
          </span>
          <span style={{ fontSize: 7, color: '#8a5a3a', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            cosmic ledger
          </span>
        </>
      ) : !selectedAgent ? (
        <>
          <div style={{ width: 44, height: 44, border: '2px solid #2a4a3a', background: 'rgba(10,20,15,0.8)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }} aria-hidden>
            <span style={{ fontSize: 22, opacity: 0.5 }}>🪐</span>
          </div>
          <span style={{ fontSize: 9, color: '#5a6a62', textAlign: 'center' }}>Select a planet</span>
        </>
      ) : (
        <>
          <div style={{ width: 54, height: 54, border: '2px solid #3a6a4a', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(10,20,15,0.6)', boxShadow: 'inset 0 0 12px rgba(80,140,100,0.2), 0 0 8px rgba(60,120,80,0.15)', overflow: 'visible' }} aria-hidden>
            <PlanetIcon type={selectedAgent.type} size={48} />
          </div>
          <span style={{ fontSize: 11, color: '#8fc08a', fontWeight: 600, textAlign: 'center', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {selectedAgent.name}
          </span>
          <span style={{ fontSize: 9, color: stateColors[selectedAgent.state] ?? '#7a8a82' }}>
            {selectedAgent.state}
          </span>
          <span style={{ fontSize: 8, color: '#4a6a58', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {selectedAgent.type}
          </span>
          {selectedAgent.cwd && (
            <span style={{ fontSize: 8, color: '#5a7a6a', marginTop: 1, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {folderName(selectedAgent.cwd)}
            </span>
          )}
        </>
      )}
    </div>
  );
};
