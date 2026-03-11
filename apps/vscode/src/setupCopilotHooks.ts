/**
 * One-click setup for GitHub Copilot agent hooks.
 *
 * Writes hooks to ~/.event-horizon/copilot-hooks.json (global, not per-project).
 * Registers that path in VS Code's chat.hookFilesLocations user setting so
 * Copilot picks it up automatically in every workspace.
 *
 * Does NOT touch ~/.claude/settings.json — that is exclusively for Claude Code.
 *
 * On Windows, VS Code runs hook commands through PowerShell. We use `curl.exe`
 * (bypasses PS alias) and quote `"@-"` (prevents splatting interpretation).
 */

import * as vscode from 'vscode';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { getAuthToken } from './eventServer.js';

const PORT = 28765;
const HOOKS_DIR = path.join(os.homedir(), '.event-horizon');
const HOOKS_FILE = path.join(HOOKS_DIR, 'copilot-hooks.json');
/** Path as it appears in the VS Code setting (tilde-based for portability). */
const HOOKS_SETTING_PATH = '~/.event-horizon/copilot-hooks.json';
const VSCODE_SETTING_KEY = 'chat.hookFilesLocations';

const EH_HOOK_EVENTS = [
  'SessionStart',
  'SessionEnd', // never fires as of March 2026 — kept in case Copilot fixes it
  'Stop',
  'PreToolUse',
  'PostToolUse',
  'UserPromptSubmit',
  'SubagentStart',
  'SubagentStop',
] as const;

/**
 * Build a curl command that works in both bash and PowerShell.
 * - `curl.exe` bypasses the PowerShell `curl` → `Invoke-WebRequest` alias
 * - `"@-"` prevents PowerShell from interpreting `@-` as a splatting operator
 */
function buildCurlCommand(): string {
  const token = getAuthToken();
  const tokenParam = token ? `?token=${token}` : '';
  return `curl.exe -s -X POST http://127.0.0.1:${PORT}/copilot${tokenParam} -H "Content-Type: application/json" --data-binary "@-"`;
}

function isEhCommand(cmd: string): boolean {
  return cmd.includes(`127.0.0.1:${PORT}/copilot`);
}

function isCurrentEhCommand(cmd: string): boolean {
  return cmd === buildCurlCommand();
}

/** Register our hooks file in VS Code's chat.hookFilesLocations user setting. */
async function ensureHooksLocationRegistered(): Promise<void> {
  const config = vscode.workspace.getConfiguration();
  const current = config.get<Record<string, boolean>>(VSCODE_SETTING_KEY) ?? {};
  if (current[HOOKS_SETTING_PATH]) return; // already registered
  await config.update(
    VSCODE_SETTING_KEY,
    { ...current, [HOOKS_SETTING_PATH]: true },
    vscode.ConfigurationTarget.Global,
  );
}

/** Remove our hooks file from VS Code's chat.hookFilesLocations user setting. */
async function removeHooksLocationRegistration(): Promise<void> {
  const config = vscode.workspace.getConfiguration();
  const current = config.get<Record<string, boolean>>(VSCODE_SETTING_KEY);
  if (!current || !(HOOKS_SETTING_PATH in current)) return;
  const updated = { ...current };
  delete updated[HOOKS_SETTING_PATH];
  await config.update(
    VSCODE_SETTING_KEY,
    Object.keys(updated).length > 0 ? updated : undefined,
    vscode.ConfigurationTarget.Global,
  );
}

export async function isCopilotHooksInstalled(): Promise<boolean> {
  try {
    const raw = await fsp.readFile(HOOKS_FILE, 'utf8');
    const config = JSON.parse(raw) as Record<string, unknown>;
    const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
    return EH_HOOK_EVENTS.some((event) => {
      const entries = (hooks[event] ?? []) as Array<Record<string, unknown>>;
      return entries.some((h) => typeof h.command === 'string' && isEhCommand(h.command));
    });
  } catch {
    return false;
  }
}

export async function hasStaleCopilotHooks(): Promise<boolean> {
  try {
    const raw = await fsp.readFile(HOOKS_FILE, 'utf8');
    const config = JSON.parse(raw) as Record<string, unknown>;
    const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
    let hasAny = false;
    let hasCurrent = false;
    for (const event of EH_HOOK_EVENTS) {
      const entries = (hooks[event] ?? []) as Array<Record<string, unknown>>;
      for (const h of entries) {
        if (typeof h.command === 'string' && isEhCommand(h.command)) {
          hasAny = true;
          if (isCurrentEhCommand(h.command)) hasCurrent = true;
        }
      }
    }
    return hasAny && !hasCurrent;
  } catch {
    return false;
  }
}

export async function removeCopilotHooks(): Promise<void> {
  try {
    await fsp.unlink(HOOKS_FILE);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code && code !== 'ENOENT') {
      void vscode.window.showWarningMessage(
        `Event Horizon: Could not remove Copilot hooks — ${(e as Error).message}`,
      );
    }
  }
  await removeHooksLocationRegistration();
}

export async function setupCopilotHooks(): Promise<void> {
  const currentCmd = buildCurlCommand();
  const hooks: Record<string, Array<Record<string, unknown>>> = {};
  for (const event of EH_HOOK_EVENTS) {
    hooks[event] = [{ type: 'command', command: currentCmd }];
  }

  await fsp.mkdir(HOOKS_DIR, { recursive: true });
  await fsp.writeFile(HOOKS_FILE, JSON.stringify({ hooks }, null, 2), 'utf8');
  await ensureHooksLocationRegistered();
}

export async function runSetupCopilotHooks(): Promise<void> {
  try {
    await setupCopilotHooks();
    void vscode.window.showInformationMessage(
      'Event Horizon: Copilot hooks installed globally. Copilot agent sessions will now send events in any workspace.',
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    void vscode.window.showErrorMessage(`Event Horizon: Failed to set up Copilot hooks — ${msg}`);
  }
}
