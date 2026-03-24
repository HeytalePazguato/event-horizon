/**
 * Onboarding card shown when no agents are connected.
 * Extracted from index.tsx (Phase D — Webview Decomposition).
 */

import { useCommandCenterStore } from '@event-horizon/ui';

interface OnboardingCardProps {
  onDismiss: () => void;
  onConnect: () => void;
}

export function OnboardingCard({ onDismiss, onConnect }: OnboardingCardProps) {
  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        top: '38%',
        transform: 'translate(-50%, -50%)',
        textAlign: 'center',
        fontFamily: 'Consolas, monospace',
        zIndex: 5,
        pointerEvents: 'auto',
      }}
    >
      <div style={{
        background: 'linear-gradient(180deg, rgba(8,18,12,0.92) 0%, rgba(4,10,6,0.95) 100%)',
        border: '1px solid rgba(50,120,70,0.35)',
        borderRadius: 6,
        padding: '28px 36px 24px',
        minWidth: 320,
        maxWidth: 400,
        boxShadow: '0 0 40px rgba(0,0,0,0.6), 0 0 8px rgba(50,180,80,0.08)',
      }}>
        <div style={{ fontSize: 13, color: '#78b890', fontWeight: 600, letterSpacing: 0.5, marginBottom: 6 }}>
          EVENT HORIZON
        </div>
        <div style={{ fontSize: 11, color: '#4a7a5a', lineHeight: 1.5, marginBottom: 20 }}>
          Visualize your AI coding agents in real time.
          <br />
          Connect an agent or explore with a demo.
        </div>
        <button
          type="button"
          onClick={() => { onDismiss(); onConnect(); }}
          style={{
            display: 'block', width: '100%', padding: '9px 16px', marginBottom: 8,
            border: '1px solid #25904a', borderRadius: 3,
            background: 'linear-gradient(180deg, #1a3828 0%, #0f2018 100%)',
            color: '#60d080', fontSize: 11, fontFamily: 'Consolas, monospace',
            fontWeight: 600, cursor: 'pointer', letterSpacing: 0.3,
            transition: 'border-color 0.15s, box-shadow 0.15s',
          }}
          onMouseOver={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#40c868'; (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 0 8px rgba(60,200,100,0.25)'; }}
          onMouseOut={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#25904a'; (e.currentTarget as HTMLButtonElement).style.boxShadow = 'none'; }}
        >
          Connect Your First Agent
        </button>
        <button
          type="button"
          onClick={() => { onDismiss(); useCommandCenterStore.getState().requestDemo(); }}
          style={{
            display: 'block', width: '100%', padding: '8px 16px',
            border: '1px solid rgba(50,120,70,0.3)', borderRadius: 3,
            background: 'transparent', color: '#4a8a5a', fontSize: 10,
            fontFamily: 'Consolas, monospace', cursor: 'pointer', letterSpacing: 0.3,
            transition: 'border-color 0.15s, color 0.15s',
          }}
          onMouseOver={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#3a9a5a'; (e.currentTarget as HTMLButtonElement).style.color = '#60b870'; }}
          onMouseOut={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(50,120,70,0.3)'; (e.currentTarget as HTMLButtonElement).style.color = '#4a8a5a'; }}
        >
          Try Demo Mode
        </button>
        <div style={{ fontSize: 9, color: '#2a5040', marginTop: 14, lineHeight: 1.4 }}>
          Supports Claude Code, OpenCode, and GitHub Copilot.
          <br />
          100% local — no data leaves your machine.
        </div>
        <button
          type="button"
          onClick={onDismiss}
          style={{
            background: 'none', border: 'none', color: '#2a5040', fontSize: 9,
            fontFamily: 'Consolas, monospace', cursor: 'pointer', marginTop: 10, padding: 0,
            transition: 'color 0.15s',
          }}
          onMouseOver={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#4a8a5a'; }}
          onMouseOut={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#2a5040'; }}
        >
          Skip
        </button>
      </div>
    </div>
  );
}
