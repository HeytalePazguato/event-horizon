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

/** Build a command that POSTs stdin to the EH server, silently succeeding if it's down. */
function buildEhCommand(): string {
  const url = buildEhUrl();
  return `curl -s --connect-timeout 2 -X POST -H "Content-Type: application/json" -d @- ${url} > /dev/null 2>&1 || true`;
}

/**
 * Build a PreToolUse command that checks file locks before allowing writes.
 * The script: reads JSON from stdin, extracts file_path from tool_input,
 * curls /lock to acquire the lock, and exits non-zero if blocked.
 * Falls back to the normal report-only hook if Event Horizon is down.
 */
function buildPreToolUseCommand(): string {
  const token = getAuthToken();
  const tokenParam = token ? `?token=${token}` : '';
  const lockUrl = `http://127.0.0.1:${PORT}/lock${tokenParam}`;
  const claudeUrl = `http://127.0.0.1:${PORT}/claude${tokenParam}`;

  // Bash script that:
  // 1. Reads stdin into a variable (the hook JSON payload)
  // 2. Sends the event to /claude (fire and forget)
  // 3. Extracts file_path from tool_input using grep/sed (no jq dependency)
  // 4. If a file_path is found AND the tool is a write tool, curls /lock
  // 5. If /lock returns 409, prints the owner with retry guidance and exits 1
  // eslint-disable-next-line no-useless-escape
  return `bash -c 'PAYLOAD=$(cat); echo "$PAYLOAD" | curl -s --connect-timeout 2 -X POST -H "Content-Type: application/json" -d @- ${claudeUrl} > /dev/null 2>&1 || true; FP=$(echo "$PAYLOAD" | grep -oP "\"file_path\"\\s*:\\s*\"\\K[^\"]+"); TN=$(echo "$PAYLOAD" | grep -oP "\"tool_name\"\\s*:\\s*\"\\K[^\"]+"); if [ -n "$FP" ]; then case "$TN" in Write|Edit|MultiEdit|WriteFile) AGENT=$(echo "$PAYLOAD" | grep -oP "\"session_id\"\\s*:\\s*\"\\K[^\"]+"); RESP=$(curl -s --connect-timeout 2 -X POST -H "Content-Type: application/json" -d "{\"action\":\"check\",\"filePath\":\"$FP\",\"agentId\":\"$AGENT\",\"agentName\":\"Claude Code\"}" ${lockUrl} 2>/dev/null); if echo "$RESP" | grep -q "\"allowed\":false"; then OWNER=$(echo "$RESP" | grep -oP "\"owner\"\\s*:\\s*\"\\K[^\"]+"); echo "[Event Horizon file lock] $FP is currently being edited by $OWNER. Do NOT attempt to write to this file right now. Work on a different file first, then retry this file in about 30 seconds when the other agent is done. This lock is managed by Event Horizon to prevent conflicting concurrent edits." >&2; exit 1; fi;; esac; fi'`;
}

/**
 * Build a PostToolUse command that releases file locks after writes complete.
 */
function buildPostToolUseCommand(): string {
  const token = getAuthToken();
  const tokenParam = token ? `?token=${token}` : '';
  const lockUrl = `http://127.0.0.1:${PORT}/lock${tokenParam}`;
  const claudeUrl = `http://127.0.0.1:${PORT}/claude${tokenParam}`;

  // eslint-disable-next-line no-useless-escape
  return `bash -c 'PAYLOAD=$(cat); echo "$PAYLOAD" | curl -s --connect-timeout 2 -X POST -H "Content-Type: application/json" -d @- ${claudeUrl} > /dev/null 2>&1 || true; FP=$(echo "$PAYLOAD" | grep -oP "\"file_path\"\\s*:\\s*\"\\K[^\"]+"); if [ -n "$FP" ]; then AGENT=$(echo "$PAYLOAD" | grep -oP "\"session_id\"\\s*:\\s*\"\\K[^\"]+"); curl -s --connect-timeout 2 -X POST -H "Content-Type: application/json" -d "{\"action\":\"release\",\"filePath\":\"$FP\",\"agentId\":\"$AGENT\"}" ${lockUrl} > /dev/null 2>&1 || true; fi'`;
}

/** True if a hook entry is our Event Horizon hook (any version — command or http). */
function isEhHook(h: Record<string, unknown>): boolean {
  // Legacy command-based hooks
  if (typeof h.command === 'string' && (h.command.includes(`127.0.0.1:${PORT}/claude`) || h.command.includes(`127.0.0.1:${PORT}/lock`))) return true;
  // New HTTP-based hooks
  if (typeof h.url === 'string' && h.url.includes(`127.0.0.1:${PORT}/claude`)) return true;
  return false;
}

/** True if the hook matches the current expected format exactly. */
function isCurrentEhHook(h: Record<string, unknown>): boolean {
  // Current: command-based silent hook
  if (typeof h.command === 'string' && h.command === buildEhCommand()) return true;
  // PreToolUse lock-checking command and PostToolUse lock-releasing command
  if (typeof h.command === 'string' && h.command === buildPreToolUseCommand()) return true;
  if (typeof h.command === 'string' && h.command === buildPostToolUseCommand()) return true;
  // Also match http-based (previous format) so we can migrate it
  if (h.type === 'http' && h.url === buildEhUrl()) return true;
  return false;
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

  for (const hookEvent of EH_HOOK_EVENTS) {
    const current = (merged[hookEvent] ?? []) as unknown[];

    // Remove stale EH hooks (old command-based curl or old token)
    const withoutStale = current.filter((h) => {
      const hh = h as Record<string, unknown>;
      const hs = (hh.hooks ?? []) as Array<Record<string, unknown>>;
      const hasStale = hs.some((c) => isEhHook(c) && !isCurrentEhHook(c));
      return !hasStale;
    });

    // Skip only if current correct hook is already present
    const alreadyCurrent = withoutStale.some((h) => {
      const hh = h as Record<string, unknown>;
      const hs = (hh.hooks ?? []) as Array<Record<string, unknown>>;
      return hs.some((c) => typeof c.command === 'string' && c.command === buildEhCommand());
    });

    // Use the lock-checking command for PreToolUse, lock-releasing for PostToolUse, normal for rest
    let cmd: string;
    if (hookEvent === 'PreToolUse') cmd = buildPreToolUseCommand();
    else if (hookEvent === 'PostToolUse' || hookEvent === 'PostToolUseFailure') cmd = buildPostToolUseCommand();
    else cmd = buildEhCommand();
    merged[hookEvent] = alreadyCurrent
      ? withoutStale
      : [...withoutStale, { matcher: '', hooks: [{ type: 'command', command: cmd }] }];
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
