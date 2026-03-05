/**
 * Command Center overlay container (RTS-style bottom panel).
 * @event-horizon/ui
 */

import type { FC } from 'react';
import { AgentIdentity } from './panels/AgentIdentity.js';
import { MetricsPanel } from './panels/MetricsPanel.js';
import { AgentControls } from './panels/AgentControls.js';

export const CommandCenter: FC = () => {
  return (
    <div data-command-center>
      <AgentIdentity />
      <MetricsPanel />
      <AgentControls />
    </div>
  );
};
