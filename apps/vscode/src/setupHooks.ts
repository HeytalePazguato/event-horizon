/**
 * One-click setup for Claude Code hooks.
 * Reads ~/.claude/settings.json, merges in Event Horizon hooks, writes it back.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const PORT = 28765;

// 3.7 — plain array; only the names matter, values were never used
const EH_HOOK_EVENTS = [
  'SessionStart',
  'SessionEnd',
  'PreToolUse',
  'PostToolUse',
  'UserPromptSubmit',
  'Notification',
] as const;

function buildCurlCommand(): string {
  // Pipe Claude's full hook payload (stdin) to our endpoint — works on Win10+, macOS, Linux
  return `curl -s -X POST http://127.0.0.1:${PORT}/claude -H "Content-Type: application/json" --data-binary @-`;
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
export function isClaudeCodeHooksInstalled(): boolean {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  try {
    const raw = fs.readFileSync(settingsPath, 'utf8');
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
export function removeClaudeCodeHooks(): void {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  try {
    const raw = fs.readFileSync(settingsPath, 'utf8');
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
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  } catch {
    // File not found or malformed — nothing to remove
  }
}

// 3.2 — synchronous I/O; removed misleading async keyword
export function setupClaudeCodeHooks(): void {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');

  let settings: Record<string, unknown> = {};
  try {
    const raw = fs.readFileSync(settingsPath, 'utf8');
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
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
}

export async function runSetupClaudeCodeHooks(): Promise<void> {
  try {
    setupClaudeCodeHooks();
    void vscode.window.showInformationMessage(
      'Event Horizon: Claude Code hooks installed! Start a Claude Code session to see your agent appear.',
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    void vscode.window.showErrorMessage(`Event Horizon: Failed to set up hooks — ${msg}`);
  }
}
