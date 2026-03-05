/**
 * Webview entry — mounts renderer + UI.
 */

import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';
import { Universe } from '@event-horizon/renderer';
import { CommandCenter } from '@event-horizon/ui';

const rootEl = document.getElementById('root');
if (rootEl) {
  const wrapperStyle: React.CSSProperties = {
    position: 'relative',
    width: '100%',
    height: '100%',
    minHeight: 400,
  };
  const root = createRoot(rootEl);
  root.render(
    <StrictMode>
      <div style={wrapperStyle}>
        <Universe width={800} height={500} />
        <CommandCenter />
      </div>
    </StrictMode>
  );
}
