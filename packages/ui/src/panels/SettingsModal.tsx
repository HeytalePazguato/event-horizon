/**
 * Settings modal: per-agent-type color and planet size customization
 * with live planet preview SVGs.
 * @event-horizon/ui
 */

import type { FC } from 'react';
import { useCommandCenterStore } from '../store.js';
import type { VisualAgentType } from '../store.js';
import { DEFAULT_VISUAL_SETTINGS } from '../store.js';

const AGENT_TYPES: { key: VisualAgentType; label: string }[] = [
  { key: 'claude-code', label: 'Claude Code' },
  { key: 'copilot',     label: 'Copilot' },
  { key: 'opencode',    label: 'OpenCode' },
  { key: 'cursor',      label: 'Cursor' },
  { key: 'unknown',     label: 'Unknown' },
];

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 300,
  background: 'rgba(0,0,0,0.70)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const modalStyle: React.CSSProperties = {
  background: 'linear-gradient(180deg, #0a1210 0%, #060a0e 100%)',
  border: '2px solid #1e3828',
  boxShadow: '0 0 40px rgba(0,0,0,0.9), inset 0 0 0 1px rgba(25,60,42,0.35)',
  padding: 16,
  minWidth: 380,
  maxWidth: 440,
  maxHeight: '80vh',
  overflowY: 'auto',
  fontFamily: 'Consolas, "Courier New", monospace',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 12,
  paddingBottom: 8,
  borderBottom: '1px solid #1e3328',
};

const sectionLabel: React.CSSProperties = {
  fontSize: 8,
  color: '#6a8a7a',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  marginBottom: 6,
  marginTop: 12,
};

const labelStyle: React.CSSProperties = {
  color: '#6a8a7a',
  fontSize: 8,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
};

/** Mini SVG planet preview that updates live with the configured color. */
function PlanetPreview({ type, color, sizeMult }: { type: VisualAgentType; color: string; sizeMult: number }) {
  const previewSize = 36;
  const viewBox = 50;
  const cx = viewBox / 2;
  const cy = viewBox / 2;
  const baseR = 14;
  const r = baseR * Math.min(sizeMult, 1.6); // clamp visual preview so it fits

  return (
    <svg width={previewSize} height={previewSize} viewBox={`0 0 ${viewBox} ${viewBox}`} style={{ overflow: 'visible', flexShrink: 0 }}>
      {/* Aura glow */}
      <circle cx={cx} cy={cy} r={r * 1.5} fill={color} fillOpacity="0.12" />
      <circle cx={cx} cy={cy} r={r * 1.25} fill="none" stroke={color} strokeWidth="1" strokeOpacity="0.3" />

      {type === 'claude-code' && (
        <>
          <circle cx={cx} cy={cy} r={r} fill="#c8b090" />
          <ellipse cx={cx} cy={cy - r * 0.38} rx={r * 0.92} ry={r * 0.13} fill="#907050" fillOpacity="0.85" />
          <ellipse cx={cx} cy={cy + r * 0.38} rx={r * 0.88} ry={r * 0.12} fill="#7a5838" fillOpacity="0.80" />
          <ellipse cx={cx + r * 0.1} cy={cy - r * 0.08} rx={r * 0.2} ry={r * 0.14} fill="#e07040" fillOpacity="0.9" />
        </>
      )}
      {type === 'copilot' && (
        <>
          <circle cx={cx} cy={cy} r={r} fill="#7ac8e8" />
          <ellipse cx={cx} cy={cy - r * 0.58} rx={r * 0.52} ry={r * 0.30} fill="#ddf6ff" fillOpacity="0.92" />
          <ellipse cx={cx} cy={cy + r * 0.62} rx={r * 0.38} ry={r * 0.20} fill="#ddf6ff" fillOpacity="0.76" />
        </>
      )}
      {type === 'opencode' && (
        <>
          <circle cx={cx} cy={cy} r={r} fill="#8b5a3c" />
          <circle cx={cx - r * 0.3} cy={cy - r * 0.2} r={r * 0.15} fill="#5a3820" fillOpacity="0.9" />
          <circle cx={cx + r * 0.2} cy={cy + r * 0.25} r={r * 0.12} fill="#5a3820" fillOpacity="0.9" />
        </>
      )}
      {type === 'cursor' && (
        <>
          <circle cx={cx} cy={cy} r={r} fill="#0e7090" />
          <ellipse cx={cx + r * 0.15} cy={cy - r * 0.25} rx={r * 0.18} ry={r * 0.14} fill="#2a8040" fillOpacity="0.82" />
          <circle cx={cx} cy={cy} r={r * 0.88} fill="none" stroke="#88eeff" strokeWidth="0.8" strokeOpacity="0.22" />
        </>
      )}
      {type === 'unknown' && (
        <>
          <circle cx={cx} cy={cy} r={r} fill="#281410" />
          {[0, 1, 2, 3].map((i) => {
            const a = (i / 4) * Math.PI * 2 + 0.3;
            return (
              <line key={i}
                x1={cx + Math.cos(a) * r * 0.12} y1={cy + Math.sin(a) * r * 0.12}
                x2={cx + Math.cos(a) * r * 0.65} y2={cy + Math.sin(a) * r * 0.65}
                stroke="#ff6622" strokeWidth="1.2" strokeOpacity="0.85"
              />
            );
          })}
        </>
      )}

      {/* Size indicator ring */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="0.6" strokeOpacity="0.4" />
    </svg>
  );
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '5px 6px',
  background: 'rgba(0,0,0,0.25)',
  border: '1px solid #1e3328',
};

const SPEED_LABELS: Record<string, string> = {
  '0.25': '0.25x',
  '0.5': '0.5x',
  '1': '1x',
  '1.5': '1.5x',
  '2': '2x',
  '3': '3x',
};

export const SettingsModal: FC = () => {
  const settingsOpen      = useCommandCenterStore((s) => s.settingsOpen);
  const toggleSettings    = useCommandCenterStore((s) => s.toggleSettings);
  const visualSettings    = useCommandCenterStore((s) => s.visualSettings);
  const setAgentColor     = useCommandCenterStore((s) => s.setAgentColor);
  const setAgentSizeMult  = useCommandCenterStore((s) => s.setAgentSizeMult);
  const resetVisualSettings = useCommandCenterStore((s) => s.resetVisualSettings);
  const achievementsEnabled = useCommandCenterStore((s) => s.achievementsEnabled);
  const setAchievementsEnabled = useCommandCenterStore((s) => s.setAchievementsEnabled);
  const animationSpeed    = useCommandCenterStore((s) => s.animationSpeed);
  const setAnimationSpeed = useCommandCenterStore((s) => s.setAnimationSpeed);
  const eventServerPort   = useCommandCenterStore((s) => s.eventServerPort);
  const setEventServerPort = useCommandCenterStore((s) => s.setEventServerPort);
  const fileLockingEnabled = useCommandCenterStore((s) => s.fileLockingEnabled);
  const setFileLockingEnabled = useCommandCenterStore((s) => s.setFileLockingEnabled);

  if (!settingsOpen) return null;

  const isDefault = AGENT_TYPES.every(({ key }) => {
    const cur = visualSettings[key];
    const def = DEFAULT_VISUAL_SETTINGS[key];
    return cur.color === def.color && cur.sizeMult === def.sizeMult;
  });

  return (
    <div style={overlayStyle} onClick={(e) => { if (e.target === e.currentTarget) toggleSettings(); }}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={headerStyle}>
          <span style={{ fontSize: 11, color: '#8fc08a', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            Settings
          </span>
          <button
            type="button"
            onClick={toggleSettings}
            style={{
              background: 'transparent',
              border: '1px solid #2a4a3a',
              color: '#6a8a7a',
              fontSize: 12,
              cursor: 'pointer',
              width: 22,
              height: 22,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              lineHeight: 1,
            }}
          >
            &times;
          </button>
        </div>

        {/* Agent visuals section */}
        <div style={sectionLabel}>Agent Visuals</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {AGENT_TYPES.map(({ key, label }) => {
            const cfg = visualSettings[key];
            return (
              <div key={key} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '5px 6px',
                background: 'rgba(0,0,0,0.25)',
                border: '1px solid #1e3328',
              }}>
                {/* Planet preview */}
                <PlanetPreview type={key} color={cfg.color} sizeMult={cfg.sizeMult} />

                {/* Controls */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {/* Agent name + color picker row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ ...labelStyle, color: '#8fc08a', fontSize: 9, fontWeight: 600, minWidth: 64 }}>
                      {label}
                    </span>
                    <div style={{
                      width: 14, height: 14, borderRadius: '50%',
                      background: cfg.color,
                      border: '1px solid rgba(255,255,255,0.15)',
                      flexShrink: 0,
                    }} />
                    <input
                      type="color"
                      value={cfg.color}
                      onChange={(e) => setAgentColor(key, e.target.value)}
                      title={`${label} color`}
                      style={{
                        width: 22, height: 18, padding: 0, border: '1px solid #2a4a3a',
                        background: 'transparent', cursor: 'pointer', flexShrink: 0,
                      }}
                    />
                  </div>

                  {/* Size slider row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ ...labelStyle, minWidth: 24, fontSize: 7 }}>Size</span>
                    <input
                      type="range"
                      min={0.4} max={2.0} step={0.05}
                      value={cfg.sizeMult}
                      onChange={(e) => setAgentSizeMult(key, parseFloat(e.target.value))}
                      title={`${label} size multiplier`}
                      style={{ flex: 1, height: 10, cursor: 'pointer', accentColor: cfg.color }}
                    />
                    <span style={{ color: '#b0d0a8', fontSize: 9, fontWeight: 600, minWidth: 30, textAlign: 'right' }}>
                      {cfg.sizeMult.toFixed(2)}&times;
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Reset button */}
        <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={resetVisualSettings}
            disabled={isDefault}
            style={{
              padding: '3px 12px',
              fontSize: 9,
              color: isDefault ? '#3a5a4a' : '#8fc08a',
              background: isDefault ? 'transparent' : 'rgba(50,90,60,0.3)',
              border: `1px solid ${isDefault ? '#1e3328' : '#2a4a3a'}`,
              cursor: isDefault ? 'default' : 'pointer',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              fontFamily: 'Consolas, monospace',
            }}
          >
            Reset to Defaults
          </button>
        </div>

        {/* Animation section */}
        <div style={sectionLabel}>Animation</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={rowStyle}>
            <span style={{ ...labelStyle, color: '#8fc08a', fontSize: 9 }}>Speed</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="range"
                min={0.25} max={3.0} step={0.25}
                value={animationSpeed}
                onChange={(e) => setAnimationSpeed(parseFloat(e.target.value))}
                title="Animation speed"
                style={{ width: 100, height: 10, cursor: 'pointer', accentColor: '#4a8a5a' }}
              />
              <span style={{ color: '#b0d0a8', fontSize: 9, fontWeight: 600, minWidth: 32, textAlign: 'right' }}>
                {SPEED_LABELS[String(animationSpeed)] ?? `${animationSpeed.toFixed(2)}x`}
              </span>
            </div>
          </div>
        </div>

        {/* General section */}
        <div style={sectionLabel}>General</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {/* Achievements toggle */}
          <div style={rowStyle}>
            <span style={{ ...labelStyle, color: '#8fc08a', fontSize: 9 }}>Achievements</span>
            <button
              type="button"
              onClick={() => setAchievementsEnabled(!achievementsEnabled)}
              style={{
                padding: '2px 10px',
                fontSize: 9,
                color: achievementsEnabled ? '#8fc08a' : '#6a5a5a',
                background: achievementsEnabled ? 'rgba(50,90,60,0.35)' : 'rgba(60,40,40,0.3)',
                border: `1px solid ${achievementsEnabled ? '#2a4a3a' : '#3a2828'}`,
                cursor: 'pointer',
                fontFamily: 'Consolas, monospace',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}
            >
              {achievementsEnabled ? 'On' : 'Off'}
            </button>
          </div>

          {/* File locking toggle */}
          <div style={rowStyle}>
            <span style={{ ...labelStyle, color: '#8fc08a', fontSize: 9 }}>File Locking</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                type="button"
                onClick={() => setFileLockingEnabled(!fileLockingEnabled)}
                style={{
                  padding: '2px 10px',
                  fontSize: 9,
                  color: fileLockingEnabled ? '#d4944a' : '#6a5a5a',
                  background: fileLockingEnabled ? 'rgba(80,60,20,0.35)' : 'rgba(60,40,40,0.3)',
                  border: `1px solid ${fileLockingEnabled ? '#8a6a2a' : '#3a2828'}`,
                  cursor: 'pointer',
                  fontFamily: 'Consolas, monospace',
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                }}
              >
                {fileLockingEnabled ? 'On' : 'Off'}
              </button>
              <span style={{ color: '#4a6a5a', fontSize: 7, fontStyle: 'italic' }}>reinstall hooks</span>
            </div>
          </div>

          {/* Event server port */}
          <div style={rowStyle}>
            <span style={{ ...labelStyle, color: '#8fc08a', fontSize: 9 }}>Event Server Port</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input
                type="number"
                min={1024} max={65535}
                value={eventServerPort}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v)) setEventServerPort(v);
                }}
                title="Event server port (requires restart)"
                style={{
                  width: 64,
                  padding: '2px 4px',
                  fontSize: 9,
                  background: 'rgba(0,0,0,0.4)',
                  border: '1px solid #2a4a3a',
                  color: '#a0c090',
                  fontFamily: 'Consolas, monospace',
                  textAlign: 'right',
                  outline: 'none',
                }}
              />
              <span style={{ color: '#4a6a5a', fontSize: 7, fontStyle: 'italic' }}>restart required</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
