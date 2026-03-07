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

function buildCurlCommand(hookEvent: string): string {
  // Works on Windows (curl is built-in since Win10 1803) and macOS/Linux
  return `curl -s -X POST http://127.0.0.1:${PORT}/claude -H "Content-Type: application/json" -d "{\\"event\\":\\"${hookEvent}\\"}"`;
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
      hooks: [{ type: 'command', command: buildCurlCommand(hookEvent) }],
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
