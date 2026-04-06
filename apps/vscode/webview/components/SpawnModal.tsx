/**
 * Spawn modal — launch new agent terminals.
 * Phase 2: supports both simple CLI launch and advanced spawn with role/prompt.
 */

import { useState } from 'react';

interface SpawnModalProps {
  vscodeApi: { postMessage: (msg: unknown) => void } | null;
  onClose: () => void;
}

const SPAWN_OPTIONS = [
  { id: 'claude-code', label: 'Claude Code', cmd: 'claude', planet: '\uD83D\uDFE4' },
  { id: 'opencode',    label: 'OpenCode',    cmd: 'opencode', planet: '\uD83D\uDFE0' },
  { id: 'cursor',      label: 'Cursor',      cmd: 'cursor', planet: '\uD83D\uDC8E' },
];

const ROLES = [
  { id: '', label: '(none)' },
  { id: 'implementer', label: 'Implementer' },
  { id: 'researcher', label: 'Researcher' },
  { id: 'reviewer', label: 'Reviewer' },
  { id: 'tester', label: 'Tester' },
  { id: 'debugger', label: 'Debugger' },
];

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '6px 8px', fontSize: 10,
  fontFamily: 'Consolas, monospace', background: '#0a1810', border: '1px solid #1e4030',
  color: '#90c088', outline: 'none', marginTop: 4,
};

const selectStyle: React.CSSProperties = {
  ...inputStyle, appearance: 'none' as const, cursor: 'pointer',
};

export function SpawnModal({ vscodeApi, onClose }: SpawnModalProps) {
  const [mode, setMode] = useState<'simple' | 'advanced'>('simple');
  const [selectedType, setSelectedType] = useState('claude-code');
  const [role, setRole] = useState('');
  const [prompt, setPrompt] = useState('');

  function handleAdvancedSpawn() {
    if (!prompt.trim()) return;
    vscodeApi?.postMessage({
      type: 'spawn-agent',
      agentType: selectedType,
      role: role || undefined,
      prompt: prompt.trim(),
    });
    onClose();
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'linear-gradient(180deg, #0b1a12 0%, #060e09 100%)',
          border: '1px solid #1e4030', padding: '20px 24px', width: 380,
          fontFamily: 'Consolas, monospace', boxShadow: '0 4px 32px rgba(0,0,0,0.85)',
          clipPath: 'polygon(16px 0, 100% 0, 100% 100%, 0 100%, 0 16px)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ flex: 1, fontSize: 11, fontWeight: 700, color: '#3a9060', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
            Spawn Agent
          </div>
          <button type="button" onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#2a5040', cursor: 'pointer', fontSize: 14, padding: 0, lineHeight: 1 }}>
            {'\u2715'}
          </button>
        </div>

        {/* Mode toggle */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button type="button" onClick={() => setMode('simple')}
            style={{ flex: 1, padding: '4px 8px', fontSize: 9, fontFamily: 'Consolas, monospace', border: '1px solid ' + (mode === 'simple' ? '#40a060' : '#1e4030'), background: mode === 'simple' ? '#1a3828' : 'transparent', color: mode === 'simple' ? '#90d898' : '#3a5a44', cursor: 'pointer' }}>
            Quick Launch
          </button>
          <button type="button" onClick={() => setMode('advanced')}
            style={{ flex: 1, padding: '4px 8px', fontSize: 9, fontFamily: 'Consolas, monospace', border: '1px solid ' + (mode === 'advanced' ? '#40a060' : '#1e4030'), background: mode === 'advanced' ? '#1a3828' : 'transparent', color: mode === 'advanced' ? '#90d898' : '#3a5a44', cursor: 'pointer' }}>
            With Prompt
          </button>
        </div>

        {mode === 'simple' ? (
          <>
            <div style={{ fontSize: 9, color: '#4a6a50', marginBottom: 12, lineHeight: 1.5 }}>
              Opens a new terminal in the IDE running the selected agent CLI.
            </div>
            {SPAWN_OPTIONS.map((a) => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid rgba(30,70,45,0.35)' }}>
                <div style={{ fontSize: 16, lineHeight: 1 }}>{a.planet}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: '#90c088', fontWeight: 700 }}>{a.label}</div>
                  <div style={{ fontSize: 9, color: '#3a5a44' }}>$ {a.cmd}</div>
                </div>
                <button type="button"
                  onClick={() => { vscodeApi?.postMessage({ type: 'spawn-agent', command: a.cmd, label: a.label }); onClose(); }}
                  style={{ padding: '4px 10px', border: '1px solid #25904a', background: 'linear-gradient(180deg, #1a3828 0%, #0f2018 100%)', color: '#50c070', fontSize: 10, cursor: 'pointer', flexShrink: 0 }}>
                  Launch
                </button>
              </div>
            ))}
          </>
        ) : (
          <>
            <div style={{ fontSize: 9, color: '#4a6a50', marginBottom: 12, lineHeight: 1.5 }}>
              Spawn an agent with a specific prompt and role. The agent runs in a VS Code terminal.
            </div>
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 9, color: '#4a7a58' }}>Agent Type</label>
              <select value={selectedType} onChange={(e) => setSelectedType(e.target.value)} style={selectStyle}>
                {SPAWN_OPTIONS.map((a) => (
                  <option key={a.id} value={a.id}>{a.label}</option>
                ))}
              </select>
            </div>
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 9, color: '#4a7a58' }}>Role (optional)</label>
              <select value={role} onChange={(e) => setRole(e.target.value)} style={selectStyle}>
                {ROLES.map((r) => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
              </select>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 9, color: '#4a7a58' }}>Prompt</label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="What should this agent do?"
                rows={3}
                style={{ ...inputStyle, resize: 'vertical', minHeight: 48 }}
              />
            </div>
            <button type="button" onClick={handleAdvancedSpawn}
              disabled={!prompt.trim()}
              style={{
                width: '100%', padding: '6px 12px', fontSize: 10, fontWeight: 700,
                border: '1px solid ' + (prompt.trim() ? '#25904a' : '#1e4030'),
                background: prompt.trim() ? 'linear-gradient(180deg, #1a3828 0%, #0f2018 100%)' : '#0a1810',
                color: prompt.trim() ? '#50c070' : '#2a4030',
                cursor: prompt.trim() ? 'pointer' : 'default',
                fontFamily: 'Consolas, monospace',
              }}>
              Spawn Agent
            </button>
          </>
        )}
      </div>
    </div>
  );
}
