/**
 * One-click setup for Claude Code hooks.
 * Reads ~/.claude/settings.json, merges in Event Horizon hooks, writes it back.
 */

import * as vscode from 'vscode';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { getAuthToken } from './eventServer.js';

const PORT = 28765;

const EH_HOOK_EVENTS = [
  'SessionStart',
  'SessionEnd',
  'PreToolUse',
  'PostToolUse',
  'UserPromptSubmit',
  'Notification',
] as const;

function buildCurlCommand(): string {
  const token = getAuthToken();
  const tokenParam = token ? `?token=${token}` : '';
  return `curl -s -X POST http://127.0.0.1:${PORT}/claude${tokenParam} -H "Content-Type: application/json" --data-binary @-`;
}

/** True if a curl command string is our Event Horizon hook (any version). */
function isEhCommand(cmd: string): boolean {
  return cmd.includes(`127.0.0.1:${PORT}/claude`);
}

/** True if the curl command matches the current expected format exactly. */
function isCurrentEhCommand(cmd: string): boolean {
  return cmd === buildCurlCommand();
}

/** Returns true if Event Horizon hooks are present in ~/.claude/settings.json */
export async function isClaudeCodeHooksInstalled(): Promise<boolean> {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  try {
    const raw = await fsp.readFile(settingsPath, 'utf8');
    const settings = JSON.parse(raw) as Record<string, unknown>;
    const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;
    return EH_HOOK_EVENTS.some((hookEvent) => {
      const entries = (hooks[hookEvent] ?? []) as unknown[];
      return entries.some((h) => {
        const hh = h as Record<string, unknown>;
        const hs = (hh.hooks ?? []) as Array<Record<string, unknown>>;
        return hs.some((c) => typeof c.command === 'string' && isEhCommand(c.command));
      });
    });
  } catch {
    return false;
  }
}

/** Removes Event Horizon hooks from ~/.claude/settings.json */
export async function removeClaudeCodeHooks(): Promise<void> {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  try {
    const raw = await fsp.readFile(settingsPath, 'utf8');
    const settings = JSON.parse(raw) as Record<string, unknown>;
    const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;
    const cleaned: Record<string, unknown[]> = {};
    for (const [hookEvent, entries] of Object.entries(hooks)) {
      const filtered = entries.filter((h) => {
        const hh = h as Record<string, unknown>;
        const hs = (hh.hooks ?? []) as Array<Record<string, unknown>>;
        return !hs.some((c) => typeof c.command === 'string' && isEhCommand(c.command));
      });
      if (filtered.length > 0) cleaned[hookEvent] = filtered;
    }
    settings.hooks = cleaned;
    await fsp.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  } catch (e) {
    // File not found — nothing to remove; permission errors are worth surfacing
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code && code !== 'ENOENT') {
      void vscode.window.showWarningMessage(
        `Event Horizon: Could not remove hooks — ${(e as Error).message}`,
      );
    }
  }
}

// 4.7 — converted to async file I/O
export async function setupClaudeCodeHooks(): Promise<void> {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');

  let settings: Record<string, unknown> = {};
  try {
    const raw = await fsp.readFile(settingsPath, 'utf8');
    settings = JSON.parse(raw);
  } catch {
    // File doesn't exist or is invalid — start fresh
  }

  const existing = (settings.hooks ?? {}) as Record<string, unknown[]>;
  const merged: Record<string, unknown[]> = { ...existing };
  const currentCmd = buildCurlCommand();

  for (const hookEvent of EH_HOOK_EVENTS) {
    const current = (merged[hookEvent] ?? []) as unknown[];

    // 2.1 — remove stale EH hooks (old format without --data-binary @-)
    const withoutStale = current.filter((h) => {
      const hh = h as Record<string, unknown>;
      const hs = (hh.hooks ?? []) as Array<Record<string, unknown>>;
      const hasStale = hs.some((c) => typeof c.command === 'string' && isEhCommand(c.command) && !isCurrentEhCommand(c.command));
      return !hasStale;
    });

    // 1.5 — skip only if current correct command is already present
    const alreadyCurrent = withoutStale.some((h) => {
      const hh = h as Record<string, unknown>;
      const hs = (hh.hooks ?? []) as Array<Record<string, unknown>>;
      return hs.some((c) => typeof c.command === 'string' && isCurrentEhCommand(c.command));
    });

    merged[hookEvent] = alreadyCurrent
      ? withoutStale
      : [...withoutStale, { matcher: '', hooks: [{ type: 'command', command: currentCmd }] }];
  }

  settings.hooks = merged;

  const dir = path.dirname(settingsPath);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
}

export async function runSetupClaudeCodeHooks(): Promise<void> {
  try {
    await setupClaudeCodeHooks();
    void vscode.window.showInformationMessage(
      'Event Horizon: Claude Code hooks installed! Start a Claude Code session to see your agent appear.',
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    void vscode.window.showErrorMessage(`Event Horizon: Failed to set up hooks — ${msg}`);
  }
}
