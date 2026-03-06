/**
 * Left panel: square planet/minimap display (StarCraft-style).
 * Shows selected agent as a planet icon; empty state when none selected.
 * @event-horizon/ui
 */

import type { FC } from 'react';
import { useCommandCenterStore } from '../store.js';

const stateColors: Record<string, string> = {
  idle: '#4a8a5a',
  thinking: '#d4a84a',
  error: '#c65858',
};

export const AgentIdentity: FC = () => {
  const selectedAgent = useCommandCenterStore((s) => s.selectedAgent);

  return (
    <div data-agent-identity style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
      {!selectedAgent ? (
        <>
          <div
            style={{
              width: 44,
              height: 44,
              border: '2px solid #2a4a3a',
              background: 'rgba(10,20,15,0.8)',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            aria-hidden
          >
            <span style={{ fontSize: 22, opacity: 0.5 }}>🪐</span>
          </div>
          <span style={{ fontSize: 9, color: '#5a6a62', textAlign: 'center' }}>Select a planet</span>
        </>
      ) : (
        <>
          <div
            style={{
              width: 52,
              height: 52,
              border: '2px solid #3a6a4a',
              background: 'radial-gradient(circle at 30% 30%, rgba(60,100,70,0.4), rgba(20,40,30,0.9))',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: 'inset 0 0 12px rgba(80,140,100,0.2), 0 0 8px rgba(60,120,80,0.15)',
            }}
            aria-hidden
          >
            <span style={{ fontSize: 26 }}>🪐</span>
          </div>
          <span style={{ fontSize: 9, color: '#8fc08a', fontWeight: 600, textAlign: 'center', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {selectedAgent.name}
          </span>
          <span style={{ fontSize: 8, color: stateColors[selectedAgent.state] ?? '#7a8a82' }}>
            {selectedAgent.state}
          </span>
        </>
      )}
    </div>
  );
};
