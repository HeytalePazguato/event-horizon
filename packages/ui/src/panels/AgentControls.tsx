/**
 * Right panel: command grid (StarCraft-style action buttons).
 * @event-horizon/ui
 */

import type { FC } from 'react';
import { useCommandCenterStore } from '../store.js';

const labelStyle = {
  color: '#6a8a7a',
  fontSize: 10,
  marginBottom: 8,
  letterSpacing: '0.05em',
  textTransform: 'uppercase' as const,
};

const baseButton = {
  padding: '6px 10px',
  border: '1px solid #2a4a3a',
  background: 'linear-gradient(180deg, #1a2820 0%, #0f1a18 100%)',
  color: '#8a9a8a',
  fontSize: 11,
  cursor: 'pointer' as const,
  boxShadow: 'inset 0 1px 0 rgba(0,0,0,0.3)',
  flex: '1 1 0',
  minWidth: 0,
};

const activeButton = {
  ...baseButton,
  border: '1px solid #3a6a4a',
  color: '#b0d0a8',
  background: 'linear-gradient(180deg, #1e3228 0%, #142820 100%)',
  boxShadow: 'inset 0 0 0 1px rgba(80,140,100,0.2), inset 0 1px 0 rgba(100,160,100,0.1)',
};

const gridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(5, 1fr)',
  gridTemplateRows: 'repeat(3, 1fr)',
  gap: 4,
  flex: 1,
  minHeight: 0,
};

const slotStyle = (active: boolean) => ({
  ...(active ? activeButton : baseButton),
  aspectRatio: '1',
  minHeight: 28,
  padding: 4,
  fontSize: 9,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center' as const,
});

export const AgentControls: FC = () => {
  const selectedAgentId = useCommandCenterStore((s) => s.selectedAgentId);
  const requestCenter = useCommandCenterStore((s) => s.requestCenter);
  const disabled = !selectedAgentId;

  return (
    <div data-agent-controls style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={labelStyle}>Commands</div>
      <div style={gridStyle}>
        <button type="button" style={slotStyle(!disabled)} disabled={disabled} aria-label="Pause agent">Pause</button>
        <button type="button" style={slotStyle(!disabled)} disabled={disabled} aria-label="Restart agent">Restart</button>
        <button type="button" style={slotStyle(!disabled)} disabled={disabled} aria-label="Isolate agent">Isolate</button>
        <button type="button" style={slotStyle(!disabled)} disabled={disabled} aria-label="Prioritize agent">Prioritize</button>
        <button type="button" style={{ ...slotStyle(!disabled), gridColumn: 'span 1' }} disabled={disabled} aria-label="View logs">Logs</button>
        <button type="button" style={slotStyle(true)} onClick={requestCenter} aria-label="Re-center map">Center</button>
        <button type="button" style={slotStyle(false)} disabled aria-label="Unused" tabIndex={-1} />
        <button type="button" style={slotStyle(false)} disabled aria-label="Unused" tabIndex={-1} />
        <button type="button" style={slotStyle(false)} disabled aria-label="Unused" tabIndex={-1} />
        <button type="button" style={slotStyle(false)} disabled aria-label="Unused" tabIndex={-1} />
        <button type="button" style={slotStyle(false)} disabled aria-label="Unused" tabIndex={-1} />
        <button type="button" style={slotStyle(false)} disabled aria-label="Unused" tabIndex={-1} />
        <button type="button" style={slotStyle(false)} disabled aria-label="Unused" tabIndex={-1} />
        <button type="button" style={slotStyle(false)} disabled aria-label="Unused" tabIndex={-1} />
        <button type="button" style={slotStyle(false)} disabled aria-label="Unused" tabIndex={-1} />
      </div>
    </div>
  );
};
