/**
 * Shared bitmap font atlas for all world-space labels.
 * One pre-registered BitmapFont replaces per-Text canvas + GPU-texture allocation
 * (planet names, lightning spark labels, skill orbit labels).
 * @event-horizon/renderer
 */

import { BitmapFont } from 'pixi.js';

let installed = false;

export const EH_MONO_FONT_NAME = 'EH-Mono';

/**
 * Install the shared bitmap font. Idempotent — safe to call from module init
 * and from component mount.
 */
export function installEHBitmapFont(): void {
  if (installed) return;
  installed = true;
  BitmapFont.install({
    name: EH_MONO_FONT_NAME,
    style: {
      fontFamily: 'Consolas, Courier New, monospace',
      fontSize: 22,
      fill: 0xffffff,
    },
    chars: [
      ['a', 'z'], ['A', 'Z'], ['0', '9'],
      ' ', '.', ',', '!', '?', '-', '_', '+', '=', '*', '/', '\\',
      '(', ')', '[', ']', '{', '}', '<', '>', ':', ';', "'", '"',
      '@', '#', '$', '%', '^', '&', '|', '~', '`',
    ],
    resolution: 2,
  });
}
