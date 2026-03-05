/**
 * Hover tooltip: agent name, load %, active task.
 * @event-horizon/ui
 */

import type { FC } from 'react';

export const Tooltip: FC<{ text: string }> = ({ text }) => {
  return <div data-tooltip>{text}</div>;
};
