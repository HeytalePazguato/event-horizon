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
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'Notification',
  'SubagentStart',
  'SubagentStop',
  'Stop',
  'TeammateIdle',
  'TaskCompleted',
  'InstructionsLoaded',
  'ConfigChange',
  'PreCompact',
  'WorktreeCreate',
  'WorktreeRemove',
] as const;

function buildEhUrl(): string {
  const token = getAuthToken();
  const tokenParam = token ? `?token=${token}` : '';
  return `http://127.0.0.1:${PORT}/claude${tokenParam}`;
}

/** True if a hook entry is our Event Horizon hook (any version — command or http). */
function isEhHook(h: Record<string, unknown>): boolean {
  // Legacy command-based hooks
  if (typeof h.command === 'string' && h.command.includes(`127.0.0.1:${PORT}/claude`)) return true;
  // New HTTP-based hooks
  if (typeof h.url === 'string' && h.url.includes(`127.0.0.1:${PORT}/claude`)) return true;
  return false;
}

/** True if the hook matches the current expected format exactly. */
function isCurrentEhHook(h: Record<string, unknown>): boolean {
  return h.type === 'http' && h.url === buildEhUrl();
}

/** Returns true if Event Horizon hooks exist in ~/.claude/settings.json (any token version). */
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
        return hs.some((c) => isEhHook(c));
      });
    });
  } catch {
    return false;
  }
}

/** Returns true if EH hooks exist but with a stale (old session) token or legacy command format. */
export async function hasStaleClaudeCodeHooks(): Promise<boolean> {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  try {
    const raw = await fsp.readFile(settingsPath, 'utf8');
    const settings = JSON.parse(raw) as Record<string, unknown>;
    const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;
    let hasAny = false;
    let hasCurrent = false;
    for (const hookEvent of EH_HOOK_EVENTS) {
      const entries = (hooks[hookEvent] ?? []) as unknown[];
      for (const h of entries) {
        const hh = h as Record<string, unknown>;
        const hs = (hh.hooks ?? []) as Array<Record<string, unknown>>;
        for (const c of hs) {
          if (isEhHook(c)) {
            hasAny = true;
            if (isCurrentEhHook(c)) hasCurrent = true;
          }
        }
      }
    }
    return hasAny && !hasCurrent;
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
        return !hs.some((c) => isEhHook(c));
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
  const currentUrl = buildEhUrl();

  for (const hookEvent of EH_HOOK_EVENTS) {
    const current = (merged[hookEvent] ?? []) as unknown[];

    // Remove stale EH hooks (old command-based curl or old token)
    const withoutStale = current.filter((h) => {
      const hh = h as Record<string, unknown>;
      const hs = (hh.hooks ?? []) as Array<Record<string, unknown>>;
      const hasStale = hs.some((c) => isEhHook(c) && !isCurrentEhHook(c));
      return !hasStale;
    });

    // Skip only if current correct http hook is already present
    const alreadyCurrent = withoutStale.some((h) => {
      const hh = h as Record<string, unknown>;
      const hs = (hh.hooks ?? []) as Array<Record<string, unknown>>;
      return hs.some((c) => isCurrentEhHook(c));
    });

    merged[hookEvent] = alreadyCurrent
      ? withoutStale
      : [...withoutStale, { matcher: '', hooks: [{ type: 'http', url: currentUrl }] }];
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
