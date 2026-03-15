/**
 * Settings panel: per-agent-type color and planet size customization.
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

const labelStyle: React.CSSProperties = {
  color: '#6a8a7a',
  fontSize: 8,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
};

export const SettingsPanel: FC = () => {
  const visualSettings    = useCommandCenterStore((s) => s.visualSettings);
  const setAgentColor     = useCommandCenterStore((s) => s.setAgentColor);
  const setAgentSizeMult  = useCommandCenterStore((s) => s.setAgentSizeMult);
  const resetVisualSettings = useCommandCenterStore((s) => s.resetVisualSettings);

  const isDefault = AGENT_TYPES.every(({ key }) => {
    const cur = visualSettings[key];
    const def = DEFAULT_VISUAL_SETTINGS[key];
    return cur.color === def.color && cur.sizeMult === def.sizeMult;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {AGENT_TYPES.map(({ key, label }) => {
        const cfg = visualSettings[key];
        return (
          <div key={key} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '3px 4px',
            background: 'rgba(0,0,0,0.25)',
            border: '1px solid #1e3328',
          }}>
            {/* Color swatch */}
            <div style={{
              width: 14, height: 14, borderRadius: '50%',
              background: cfg.color,
              border: '1px solid rgba(255,255,255,0.15)',
              flexShrink: 0,
            }} />

            {/* Agent name */}
            <span style={{ ...labelStyle, minWidth: 56, color: '#8fc08a', fontSize: 9, fontWeight: 600 }}>
              {label}
            </span>

            {/* Color picker */}
            <input
              type="color"
              value={cfg.color}
              onChange={(e) => setAgentColor(key, e.target.value)}
              title={`${label} color`}
              style={{
                width: 20, height: 16, padding: 0, border: '1px solid #2a4a3a',
                background: 'transparent', cursor: 'pointer', flexShrink: 0,
              }}
            />

            {/* Size slider */}
            <input
              type="range"
              min={0.4} max={2.0} step={0.05}
              value={cfg.sizeMult}
              onChange={(e) => setAgentSizeMult(key, parseFloat(e.target.value))}
              title={`${label} size multiplier`}
              style={{ flex: 1, minWidth: 50, height: 10, cursor: 'pointer', accentColor: cfg.color }}
            />

            {/* Size value */}
            <span style={{ color: '#b0d0a8', fontSize: 9, fontWeight: 600, minWidth: 28, textAlign: 'right' }}>
              {cfg.sizeMult.toFixed(2)}&times;
            </span>
          </div>
        );
      })}

      {/* Reset button */}
      <button
        type="button"
        onClick={resetVisualSettings}
        disabled={isDefault}
        style={{
          alignSelf: 'flex-end',
          padding: '2px 8px',
          fontSize: 8,
          color: isDefault ? '#3a5a4a' : '#8fc08a',
          background: isDefault ? 'transparent' : 'rgba(50,90,60,0.3)',
          border: `1px solid ${isDefault ? '#1e3328' : '#2a4a3a'}`,
          cursor: isDefault ? 'default' : 'pointer',
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
        }}
      >
        Reset to Defaults
      </button>
    </div>
  );
};
