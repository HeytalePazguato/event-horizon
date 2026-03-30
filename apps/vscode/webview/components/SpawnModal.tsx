/**
 * Spawn modal — launch new agent terminals.
 * Extracted from index.tsx (Phase D — Webview Decomposition).
 */

interface SpawnModalProps {
  vscodeApi: { postMessage: (msg: unknown) => void } | null;
  onClose: () => void;
}

const SPAWN_OPTIONS = [
  { id: 'claude-code', label: 'Claude Code', cmd: 'claude', planet: '🟤' },
  { id: 'opencode',    label: 'OpenCode',    cmd: 'opencode', planet: '🟠' },
  { id: 'aider',       label: 'Aider',       cmd: 'aider', planet: '🟢' },
];

export function SpawnModal({ vscodeApi, onClose }: SpawnModalProps) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'linear-gradient(180deg, #0b1a12 0%, #060e09 100%)',
          border: '1px solid #1e4030', padding: '20px 24px', width: 340,
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
            style={{ background: 'none', border: 'none', color: '#2a5040', cursor: 'pointer', fontSize: 14, padding: 0, lineHeight: 1 }}>✕</button>
        </div>
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
      </div>
    </div>
  );
}
