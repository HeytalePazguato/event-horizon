/**
 * One-click setup for Cursor hooks.
 * Reads ~/.cursor/hooks.json, merges in Event Horizon hooks, writes it back.
 * Also registers EH as an MCP server in ~/.cursor/mcp.json.
 */

import * as vscode from 'vscode';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { getAuthToken, getEventServerPort } from './eventServer.js';

function getPort(): number {
  return getEventServerPort();
}

const HOOKS_FILE = path.join(os.homedir(), '.cursor', 'hooks.json');

const EH_HOOK_EVENTS = [
  'beforeSubmitPrompt',
  'stop',
  'beforeShellExecution',
  'afterShellExecution',
  'beforeReadFile',
  'afterFileEdit',
  'beforeMCPExecution',
  'afterMCPExecution',
  'afterAgentResponse',
  'afterAgentThought',
] as const;

/** Build a curl command that POSTs stdin JSON to the EH /cursor endpoint. */
function buildEhCommand(): string {
  const token = getAuthToken();
  const port = getPort();
  const authHeader = token ? ` -H "Authorization: Bearer ${token}"` : '';
  return `curl -s -X POST http://127.0.0.1:${port}/cursor -H "Content-Type: application/json"${authHeader} -d @- || true`;
}

/** True if a hook command is an Event Horizon hook (any version). */
function isEhHook(cmd: string): boolean {
  return cmd.includes('/cursor') && cmd.includes('127.0.0.1');
}

/** True if a hook command matches the current expected format exactly. */
function isCurrentEhHook(cmd: string): boolean {
  return cmd === buildEhCommand();
}

/** Returns true if Event Horizon hooks exist in ~/.cursor/hooks.json. */
export async function isCursorHooksInstalled(): Promise<boolean> {
  try {
    const raw = await fsp.readFile(HOOKS_FILE, 'utf8');
    const config = JSON.parse(raw) as Record<string, unknown>;
    const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
    return EH_HOOK_EVENTS.some((event) => {
      const entries = (hooks[event] ?? []) as Array<Record<string, unknown>>;
      return entries.some((h) => typeof h.command === 'string' && isEhHook(h.command));
    });
  } catch {
    return false;
  }
}

/** Returns true if EH hooks exist but with a stale token or old format. */
export async function hasStaleCursorHooks(): Promise<boolean> {
  try {
    const raw = await fsp.readFile(HOOKS_FILE, 'utf8');
    const config = JSON.parse(raw) as Record<string, unknown>;
    const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
    let hasAny = false;
    let hasCurrent = false;
    for (const event of EH_HOOK_EVENTS) {
      const entries = (hooks[event] ?? []) as Array<Record<string, unknown>>;
      for (const h of entries) {
        if (typeof h.command === 'string' && isEhHook(h.command)) {
          hasAny = true;
          if (isCurrentEhHook(h.command)) hasCurrent = true;
        }
      }
    }
    return hasAny && !hasCurrent;
  } catch {
    return false;
  }
}

/** Removes Event Horizon hooks from ~/.cursor/hooks.json. */
export async function removeCursorHooks(): Promise<void> {
  try {
    const raw = await fsp.readFile(HOOKS_FILE, 'utf8');
    const config = JSON.parse(raw) as Record<string, unknown>;
    const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
    const cleaned: Record<string, unknown[]> = {};
    for (const [event, entries] of Object.entries(hooks)) {
      const filtered = entries.filter((h) => {
        const hh = h as Record<string, unknown>;
        return !(typeof hh.command === 'string' && isEhHook(hh.command));
      });
      if (filtered.length > 0) cleaned[event] = filtered;
    }
    config.hooks = cleaned;
    // If hooks is empty, keep the version key
    await fsp.writeFile(HOOKS_FILE, JSON.stringify(config, null, 2), 'utf8');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code && code !== 'ENOENT') {
      void vscode.window.showWarningMessage(
        `Event Horizon: Could not remove Cursor hooks — ${(e as Error).message}`,
      );
    }
  }
}

/**
 * Write/update EH hooks in ~/.cursor/hooks.json.
 * Preserves user's existing hooks; replaces stale EH hooks with current ones.
 */
export async function setupCursorHooks(): Promise<void> {
  let config: Record<string, unknown> = { version: 1 };
  try {
    const raw = await fsp.readFile(HOOKS_FILE, 'utf8');
    config = JSON.parse(raw);
  } catch {
    // File doesn't exist or is invalid — start fresh
  }

  const existing = (config.hooks ?? {}) as Record<string, unknown[]>;
  const merged: Record<string, unknown[]> = { ...existing };

  const currentCmd = buildEhCommand();

  for (const event of EH_HOOK_EVENTS) {
    const current = (merged[event] ?? []) as Array<Record<string, unknown>>;

    // Remove stale EH hooks
    const withoutStale = current.filter((h) => {
      return !(typeof h.command === 'string' && isEhHook(h.command) && !isCurrentEhHook(h.command));
    });

    // Skip if current hook is already present
    const alreadyCurrent = withoutStale.some((h) => {
      return typeof h.command === 'string' && isCurrentEhHook(h.command);
    });

    merged[event] = alreadyCurrent
      ? withoutStale
      : [...withoutStale, { command: currentCmd }];
  }

  config.hooks = merged;
  if (!config.version) config.version = 1;

  const dir = path.dirname(HOOKS_FILE);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(HOOKS_FILE, JSON.stringify(config, null, 2), 'utf8');
}

/**
 * Register Event Horizon as an MCP server in ~/.cursor/mcp.json.
 * Reads existing config, merges our entry without overwriting other servers.
 */
export async function registerCursorMcpServer(): Promise<void> {
  const mcpJsonPath = path.join(os.homedir(), '.cursor', 'mcp.json');
  const token = getAuthToken();
  const port = getPort();
  const tokenParam = token ? `?token=${token}` : '';
  const mcpUrl = `http://127.0.0.1:${port}/mcp${tokenParam}`;

  let config: Record<string, unknown> = {};
  try {
    const raw = await fsp.readFile(mcpJsonPath, 'utf8');
    config = JSON.parse(raw);
  } catch {
    // File doesn't exist or is invalid — start fresh
  }

  const servers = (config.mcpServers ?? {}) as Record<string, unknown>;
  servers['event-horizon'] = { url: mcpUrl };
  config.mcpServers = servers;

  const dir = path.dirname(mcpJsonPath);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(mcpJsonPath, JSON.stringify(config, null, 2), 'utf8');
}

export async function runSetupCursorHooks(): Promise<void> {
  try {
    await setupCursorHooks();
    await registerCursorMcpServer();
    void vscode.window.showInformationMessage(
      'Event Horizon: Cursor hooks + MCP tools installed! Start a Cursor agent session to see your agent appear.',
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    void vscode.window.showErrorMessage(`Event Horizon: Failed to set up Cursor hooks — ${msg}`);
  }
}
