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
 * Write the lock-check script to ~/.event-horizon/eh-lock-check.sh
 * and return the path. Called once during hook setup.
 * The script is a proper file — no quoting issues, no inline bash -c nightmares.
 */
async function ensureLockScripts(): Promise<{ checkScript: string; releaseScript: string }> {
  const dir = path.join(os.homedir(), '.event-horizon');
  await fsp.mkdir(dir, { recursive: true });

  const token = getAuthToken();
  const tokenParam = token ? `?token=${token}` : '';
  const lockUrl = `http://127.0.0.1:${PORT}/lock${tokenParam}`;
  const claudeUrl = `http://127.0.0.1:${PORT}/claude${tokenParam}`;

  const checkScript = path.join(dir, 'eh-lock-check.sh');
  const checkContent = `#!/usr/bin/env bash
# Event Horizon — PreToolUse lock check. Auto-generated, do not edit.
PAYLOAD=$(cat)
echo "$PAYLOAD" | curl -s --connect-timeout 2 -X POST -H "Content-Type: application/json" -d @- "${claudeUrl}" > /dev/null 2>&1 || true
TN=$(echo "$PAYLOAD" | sed -n 's/.*"tool_name" *: *"\\([^"]*\\)".*/\\1/p' | head -1)
FP=$(echo "$PAYLOAD" | sed -n 's/.*"file_path" *: *"\\([^"]*\\)".*/\\1/p' | head -1)
if [ -n "$FP" ]; then
  AGENT=$(echo "$PAYLOAD" | sed -n 's/.*"session_id" *: *"\\([^"]*\\)".*/\\1/p' | head -1)
  CWD=$(echo "$PAYLOAD" | sed -n 's/.*"cwd" *: *"\\([^"]*\\)".*/\\1/p' | head -1)
  FOLDER=$(basename "$CWD" 2>/dev/null)
  ANAME="Claude Code"
  [ -n "$FOLDER" ] && ANAME="Claude Code ($FOLDER)"
  # Write/Edit tools: acquire the lock (check + acquire)
  # Read tools: just query if locked by someone else (no acquire)
  ACTION="query"
  if [ "$TN" = "Write" ] || [ "$TN" = "Edit" ] || [ "$TN" = "MultiEdit" ] || [ "$TN" = "WriteFile" ]; then
    ACTION="check"
  fi
  RESP=$(curl -s --connect-timeout 2 -X POST -H "Content-Type: application/json" \\
    -d "{\\"action\\":\\"$ACTION\\",\\"filePath\\":\\"$FP\\",\\"agentId\\":\\"$AGENT\\",\\"agentName\\":\\"$ANAME\\"}" \\
    "${lockUrl}" 2>/dev/null)
  if echo "$RESP" | grep -q '"allowed":false'; then
    OWNER=$(echo "$RESP" | sed -n 's/.*"owner" *: *"\\([^"]*\\)".*/\\1/p')
    echo "[Event Horizon file lock] BLOCKED: $FP is locked by $OWNER who is actively editing it. You MUST NOT access this file by ANY means — no Read, no Write, no Edit, no Bash commands. The lock will release automatically when $OWNER finishes (within 30 seconds of their last edit). Work on OTHER files first, then retry this file later." >&2
    exit 2
  fi
fi
`;
  await fsp.writeFile(checkScript, checkContent, 'utf8');
  await fsp.chmod(checkScript, 0o755).catch(() => {});

  const releaseScript = path.join(dir, 'eh-lock-release.sh');
  const releaseContent = `#!/usr/bin/env bash
# Event Horizon — PostToolUse lock release. Auto-generated, do not edit.
PAYLOAD=$(cat)
echo "$PAYLOAD" | curl -s --connect-timeout 2 -X POST -H "Content-Type: application/json" -d @- "${claudeUrl}" > /dev/null 2>&1 || true
FP=$(echo "$PAYLOAD" | sed -n 's/.*"file_path" *: *"\\([^"]*\\)".*/\\1/p' | head -1)
if [ -n "$FP" ]; then
  AGENT=$(echo "$PAYLOAD" | sed -n 's/.*"session_id" *: *"\\([^"]*\\)".*/\\1/p' | head -1)
  curl -s --connect-timeout 2 -X POST -H "Content-Type: application/json" \\
    -d "{\\"action\\":\\"release\\",\\"filePath\\":\\"$FP\\",\\"agentId\\":\\"$AGENT\\"}" \\
    "${lockUrl}" > /dev/null 2>&1 || true
fi
`;
  await fsp.writeFile(releaseScript, releaseContent, 'utf8');
  await fsp.chmod(releaseScript, 0o755).catch(() => {});

  return { checkScript, releaseScript };
}

/** Build the PreToolUse command — calls the external script file. */
function buildPreToolUseCommand(): string {
  const scriptPath = path.join(os.homedir(), '.event-horizon', 'eh-lock-check.sh').replace(/\\/g, '/');
  return `bash "${scriptPath}"`;
}

// PostToolUse no longer releases locks — locks are held until TTL expiry (30s).
// Each PreToolUse Write call refreshes the TTL, so the lock persists across
// sequential Write/Read cycles. This prevents Agent B from slipping in between
// Agent A's individual writes.

/** True if a hook entry is our Event Horizon hook (any version — command or http). */
function isEhHook(h: Record<string, unknown>): boolean {
  if (typeof h.command === 'string') {
    // Empty commands left from manual cleanup — treat as ours to remove
    if (h.command === '') return true;
    if (h.command.includes(`127.0.0.1:${PORT}/claude`)) return true;
    if (h.command.includes(`127.0.0.1:${PORT}/lock`)) return true;
    if (h.command.includes('eh-lock-check.sh') || h.command.includes('eh-lock-release.sh')) return true;
    if (h.command.includes('.event-horizon')) return true;
    // Catch any inline bash -c lock scripts from previous broken versions
    if (h.command.includes('bash -c') && h.command.includes('file_path')) return true;
  }
  if (typeof h.url === 'string' && h.url.includes(`127.0.0.1:${PORT}/claude`)) return true;
  return false;
}

/** True if the hook matches the current expected format exactly. */
function isCurrentEhHook(h: Record<string, unknown>): boolean {
  if (typeof h.command === 'string') {
    if (h.command === buildEhCommand()) return true;
    if (h.command === buildPreToolUseCommand()) return true;
  }
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
  // Write lock scripts to disk before setting up hooks (they reference the script files)
  await ensureLockScripts();
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
      return hs.some((c) => isCurrentEhHook(c));
    });

    // PreToolUse uses the lock-checking script; everything else uses the normal curl
    const cmd = hookEvent === 'PreToolUse' ? buildPreToolUseCommand() : buildEhCommand();
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
