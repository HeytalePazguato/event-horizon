/**
 * One-click setup for OpenCode hooks.
 * Reads ~/.opencode/config.json, merges in Event Horizon hooks, writes it back.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const PORT = 28765;

const EH_HOOK_EVENTS = [
  'session.created',
  'session.deleted',
  'tool.execute.before',
  'tool.execute.after',
  'message.updated',
] as const;

function buildCurlCommand(): string {
  return `curl -s -X POST http://127.0.0.1:${PORT}/opencode -H "Content-Type: application/json" --data-binary @-`;
}

/** True if a curl command string is our Event Horizon hook (any version). */
function isEhCommand(cmd: string): boolean {
  return cmd.includes(`127.0.0.1:${PORT}/opencode`);
}

/** True if the curl command matches the current expected format exactly. */
function isCurrentEhCommand(cmd: string): boolean {
  return cmd === buildCurlCommand();
}

function getConfigPath(): string {
  return path.join(os.homedir(), '.opencode', 'config.json');
}

function readConfig(): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(getConfigPath(), 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeConfig(config: Record<string, unknown>): void {
  const configPath = getConfigPath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}

/** Returns true if Event Horizon hooks are present in ~/.opencode/config.json */
export function isOpenCodeHooksInstalled(): boolean {
  const config = readConfig();
  const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
  return EH_HOOK_EVENTS.some((hookEvent) => {
    const entries = (hooks[hookEvent] ?? []) as unknown[];
    return entries.some((h) => {
      if (typeof h === 'string') return isEhCommand(h);
      const hh = h as Record<string, unknown>;
      const cmd = hh.command ?? hh.cmd;
      if (typeof cmd === 'string') return isEhCommand(cmd);
      const hs = (hh.hooks ?? []) as Array<Record<string, unknown>>;
      return hs.some((c) => typeof c.command === 'string' && isEhCommand(c.command));
    });
  });
}

/** Removes Event Horizon hooks from ~/.opencode/config.json */
export function removeOpenCodeHooks(): void {
  const config = readConfig();
  const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
  const cleaned: Record<string, unknown[]> = {};
  for (const [hookEvent, entries] of Object.entries(hooks)) {
    const filtered = entries.filter((h) => {
      if (typeof h === 'string') return !isEhCommand(h);
      const hh = h as Record<string, unknown>;
      const cmd = hh.command ?? hh.cmd;
      if (typeof cmd === 'string') return !isEhCommand(cmd);
      const hs = (hh.hooks ?? []) as Array<Record<string, unknown>>;
      return !hs.some((c) => typeof c.command === 'string' && isEhCommand(c.command));
    });
    if (filtered.length > 0) cleaned[hookEvent] = filtered;
  }
  config.hooks = cleaned;
  writeConfig(config);
}

export function setupOpenCodeHooks(): void {
  const config = readConfig();
  const existing = (config.hooks ?? {}) as Record<string, unknown[]>;
  const merged: Record<string, unknown[]> = { ...existing };
  const currentCmd = buildCurlCommand();

  for (const hookEvent of EH_HOOK_EVENTS) {
    const current = (merged[hookEvent] ?? []) as unknown[];

    // Remove stale EH hooks
    const withoutStale = current.filter((h) => {
      if (typeof h === 'string') return !isEhCommand(h) || isCurrentEhCommand(h);
      const hh = h as Record<string, unknown>;
      const cmd = hh.command ?? hh.cmd;
      if (typeof cmd === 'string') return !isEhCommand(cmd) || isCurrentEhCommand(cmd);
      const hs = (hh.hooks ?? []) as Array<Record<string, unknown>>;
      const hasStale = hs.some((c) => typeof c.command === 'string' && isEhCommand(c.command) && !isCurrentEhCommand(c.command));
      return !hasStale;
    });

    // Check if current hook already exists
    const alreadyCurrent = withoutStale.some((h) => {
      if (typeof h === 'string') return isCurrentEhCommand(h);
      const hh = h as Record<string, unknown>;
      const cmd = hh.command ?? hh.cmd;
      if (typeof cmd === 'string') return isCurrentEhCommand(cmd);
      const hs = (hh.hooks ?? []) as Array<Record<string, unknown>>;
      return hs.some((c) => typeof c.command === 'string' && isCurrentEhCommand(c.command));
    });

    merged[hookEvent] = alreadyCurrent
      ? withoutStale
      : [...withoutStale, { command: currentCmd }];
  }

  config.hooks = merged;
  writeConfig(config);
}

export async function runSetupOpenCodeHooks(): Promise<void> {
  try {
    setupOpenCodeHooks();
    void vscode.window.showInformationMessage(
      'Event Horizon: OpenCode hooks installed! Start an OpenCode session to see your agent appear.',
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    void vscode.window.showErrorMessage(`Event Horizon: Failed to set up OpenCode hooks — ${msg}`);
  }
}
