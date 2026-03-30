/**
 * Info overlay — Universe guide modal.
 * Extracted from index.tsx (Phase D — Webview Decomposition).
 */

interface InfoOverlayProps {
  extensionVersion: string;
  onClose: () => void;
}

export function InfoOverlay({ extensionVersion, onClose }: InfoOverlayProps) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 300,
        background: 'rgba(0,0,0,0.75)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'linear-gradient(180deg, #0e1f18 0%, #091510 100%)',
          border: '1px solid #2a5a3c', borderRadius: 4,
          padding: '20px 24px', maxWidth: 380, color: '#b8d4a0',
          fontFamily: 'system-ui', fontSize: 12,
          boxShadow: '0 4px 24px rgba(0,0,0,0.7)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 14, fontWeight: 700, color: '#c8e4b0', marginBottom: 14, letterSpacing: '0.05em' }}>
          EVENT HORIZON — Universe Guide
        </div>
        {([
          ['🪐 Planets', 'Each AI coding agent appears as a planet. Its type determines the visual: Claude Code = gas giant (rings + storm), Copilot = icy world, OpenCode = rocky, others = volcanic.'],
          ['⚫ Black Hole', 'The singularity at the center. Astronauts that drift too close are captured and spiral in.'],
          ['🚀 Ships', 'Data transfers between agents are shown as ships flying curved arcs between planets.'],
          ['👨‍🚀 Astronauts', 'Background explorers drifting through the universe. Click empty space to spawn one.'],
          ['🛸 UFO', 'Appears periodically to abduct a cow from one of the planets. Fly-in → beam → fly-away.'],
          ['📡 Command Center', 'Select a planet to see its metrics. Use the command buttons to pause, isolate, or boost agents.'],
        ] as [string, string][]).map(([title, desc]) => (
          <div key={title} style={{ marginBottom: 10 }}>
            <span style={{ color: '#8fc08a', fontWeight: 600 }}>{title}</span>
            <span style={{ color: '#7a9a82', marginLeft: 6 }}>{desc}</span>
          </div>
        ))}
        {extensionVersion && (
          <div style={{ marginTop: 14, textAlign: 'center', color: '#3a5a48', fontSize: 9, letterSpacing: '0.05em' }}>
            v{extensionVersion}
          </div>
        )}
        <div style={{ marginTop: extensionVersion ? 6 : 14, textAlign: 'center', color: '#4a6a58', fontSize: 10 }}>
          Click anywhere to close
        </div>
      </div>
    </div>
  );
}
