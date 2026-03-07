/**
 * One-click setup for Claude Code hooks.
 * Reads ~/.claude/settings.json, merges in Event Horizon hooks, writes it back.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const PORT = 28765;

const EH_HOOKS = {
  SessionStart:        `agent.spawn`,
  SessionEnd:          `agent.terminate`,
  PreToolUse:          `tool.call`,
  PostToolUse:         `tool.result`,
  UserPromptSubmit:    `message.send`,
  Notification:        `message.receive`,
};

function buildCurlCommand(): string {
  // Pipe Claude's full hook payload (stdin) to our endpoint — works on Win10+, macOS, Linux
  return `curl -s -X POST http://127.0.0.1:${PORT}/claude -H "Content-Type: application/json" --data-binary @-`;
}

/** Returns true if Event Horizon hooks are already present in ~/.claude/settings.json */
export function isClaudeCodeHooksInstalled(): boolean {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  try {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    const settings = JSON.parse(raw) as Record<string, unknown>;
    const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;
    return Object.keys(EH_HOOKS).some((hookEvent) => {
      const entries = (hooks[hookEvent] ?? []) as unknown[];
      return entries.some((h) => {
        const hh = h as Record<string, unknown>;
        const hs = (hh.hooks ?? []) as Array<Record<string, unknown>>;
        return hs.some((c) => typeof c.command === 'string' && c.command.includes(`127.0.0.1:${PORT}/claude`));
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
        return !hs.some((c) => typeof c.command === 'string' && c.command.includes(`127.0.0.1:${PORT}/claude`));
      });
      if (filtered.length > 0) cleaned[hookEvent] = filtered;
    }
    settings.hooks = cleaned;
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  } catch {
    // File not found or malformed — nothing to remove
  }
}

export async function setupClaudeCodeHooks(): Promise<void> {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');

  // Read existing settings or start fresh
  let settings: Record<string, unknown> = {};
  try {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    settings = JSON.parse(raw);
  } catch {
    // File doesn't exist or is invalid — start fresh
  }

  // Merge hooks — keep any existing hooks the user already has
  const existing = (settings.hooks ?? {}) as Record<string, unknown[]>;
  const merged: Record<string, unknown[]> = { ...existing };

  for (const [hookEvent] of Object.entries(EH_HOOKS)) {
    const hookEntry = {
      matcher: '',
      hooks: [{ type: 'command', command: buildCurlCommand() }],
    };

    const current = (merged[hookEvent] ?? []) as unknown[];
    // Don't add duplicate — check if our curl command is already there
    const alreadyPresent = current.some((h) => {
      const hh = h as Record<string, unknown>;
      const hooks = (hh.hooks ?? []) as Array<Record<string, unknown>>;
      return hooks.some((c) => typeof c.command === 'string' && c.command.includes(`/claude`));
    });

    if (!alreadyPresent) {
      merged[hookEvent] = [...current, hookEntry];
    }
  }

  settings.hooks = merged;

  // Ensure ~/.claude/ directory exists
  const dir = path.dirname(settingsPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
}

export async function runSetupClaudeCodeHooks(): Promise<void> {
  try {
    setupClaudeCodeHooks();
    vscode.window.showInformationMessage(
      'Event Horizon: Claude Code hooks installed! Start a Claude Code session to see your agent appear.',
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    vscode.window.showErrorMessage(`Event Horizon: Failed to set up hooks — ${msg}`);
  }
}
