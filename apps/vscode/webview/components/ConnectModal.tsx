/**
 * Connect modal — agent connection panel.
 * Extracted from index.tsx (Phase D — Webview Decomposition).
 */

interface ConnectModalProps {
  connectedAgentTypes: string[];
  vscodeApi: { postMessage: (msg: unknown) => void } | null;
  onClose: () => void;
}

const AGENT_OPTIONS = [
  { id: 'claude-code', label: 'Claude Code',    planet: '🟤', status: 'available' as const, desc: 'Installs curl hooks into ~/.claude/settings.json. One click, no token needed.' },
  { id: 'opencode',    label: 'OpenCode',       planet: '🟠', status: 'available' as const, desc: 'Installs a plugin into ~/.config/opencode/plugins/. Restart OpenCode after connecting.' },
  { id: 'copilot',     label: 'GitHub Copilot', planet: '🔵', status: 'available' as const, desc: 'Installs debug hooks into .github/hooks/. Check "Copilot Chat Hooks" output for events.' },
  { id: 'cursor',      label: 'Cursor',         planet: '🩵', status: 'soon'      as const, desc: 'Cursor connector coming soon.' },
  { id: 'ollama',      label: 'Ollama / Local', planet: '⚫', status: 'soon'      as const, desc: 'Local model support coming soon.' },
];

export function ConnectModal({ connectedAgentTypes, vscodeApi, onClose }: ConnectModalProps) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'linear-gradient(180deg, #0b1a12 0%, #060e09 100%)',
          border: '1px solid #1e4030', padding: '20px 24px', width: 360,
          fontFamily: 'Consolas, monospace', boxShadow: '0 4px 32px rgba(0,0,0,0.85)',
          clipPath: 'polygon(16px 0, 100% 0, 100% 100%, 0 100%, 0 16px)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ flex: 1, fontSize: 11, fontWeight: 700, color: '#3a9060', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
            Connect Agent
          </div>
          <button type="button" onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#2a5040', cursor: 'pointer', fontSize: 14, padding: 0, lineHeight: 1 }}>✕</button>
        </div>
        {AGENT_OPTIONS.map((c) => {
          const isConnected = connectedAgentTypes.includes(c.id);
          return (
            <div key={c.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 0', borderBottom: '1px solid rgba(30,70,45,0.35)' }}>
              <div style={{ fontSize: 18, lineHeight: 1, paddingTop: 1 }}>{c.planet}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: isConnected ? '#70e898' : '#90c088', fontWeight: 700, marginBottom: 2 }}>
                  {c.label}
                  {isConnected && <span style={{ fontSize: 8, color: '#40b868', marginLeft: 6, letterSpacing: '0.06em' }}>● LIVE</span>}
                </div>
                <div style={{ fontSize: 9, color: '#3a5a44', lineHeight: 1.4 }}>{c.desc}</div>
              </div>
              {isConnected ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
                  <div style={{ fontSize: 9, color: '#40b868', letterSpacing: '0.04em' }}>Connected</div>
                  <button type="button"
                    onClick={() => { vscodeApi?.postMessage({ type: 'remove-agent', agentType: c.id }); }}
                    style={{ padding: '2px 7px', border: '1px solid #4a3030', background: 'rgba(40,15,15,0.8)', color: '#805858', fontSize: 8, cursor: 'pointer' }}>
                    Disconnect
                  </button>
                </div>
              ) : c.status === 'available' ? (
                <button type="button"
                  onClick={() => { vscodeApi?.postMessage({ type: 'setup-agent', agentType: c.id }); }}
                  style={{ padding: '4px 10px', border: '1px solid #25904a', background: 'linear-gradient(180deg, #1a3828 0%, #0f2018 100%)', color: '#50c070', fontSize: 10, cursor: 'pointer', flexShrink: 0 }}>
                  Install
                </button>
              ) : (
                <div style={{ fontSize: 9, color: '#2a3a2a', flexShrink: 0, paddingTop: 2 }}>Soon</div>
              )}
            </div>
          );
        })}
        <div style={{ marginTop: 10, fontSize: 9, color: '#2a4a34', textAlign: 'center' }}>
          Event Horizon listens on port 28765 — any agent on this machine can connect
        </div>
      </div>
    </div>
  );
}
