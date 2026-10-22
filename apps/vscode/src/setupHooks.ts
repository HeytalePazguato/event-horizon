/**
 * One-click setup for Claude Code hooks.
 * Reads ~/.claude/settings.json, merges in Event Horizon hooks, writes it back.
 */

import * as vscode from 'vscode';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { getAuthToken } from './eventServer.js';
import { setupTelemetryEnv, removeTelemetryEnv } from './setupTelemetryEnv.js';
import { setupStatusLine, removeStatusLine, findGitBash, type StatusLineMode } from './setupStatusLine.js';

const PORT = 28765;

/**
 * Which shell Claude Code will run our hook commands through. On Windows it
 * uses Git Bash when installed and PowerShell otherwise; everywhere else a
 * POSIX shell. The fast curl one-liners need a POSIX shell (`|| true`,
 * `/dev/null`, and in Windows PowerShell 5.1 `curl` is Invoke-WebRequest), so
 * without Git Bash every hook runs a PowerShell script instead. PowerShell
 * start-up costs a few hundred ms per call, so it is only used when needed.
 */
export type HookShell = 'posix' | 'powershell';

let hookShellOverride: HookShell | null = null;

export function detectHookShell(platform: NodeJS.Platform = process.platform, gitBash: () => string | null = findGitBash): HookShell {
  if (hookShellOverride) return hookShellOverride;
  return platform === 'win32' && !gitBash() ? 'powershell' : 'posix';
}

const ehDir = (): string => path.join(os.homedir(), '.event-horizon');
/** Forward slashes: Git Bash eats backslashes in command strings, PowerShell accepts both. */
const fwd = (p: string): string => p.split('\\').join('/');

function powershellFile(script: string, ...args: string[]): string {
  return `powershell -NoProfile -ExecutionPolicy Bypass -File "${fwd(path.join(ehDir(), script))}"${args.map((x) => ` ${x}`).join('')}`;
}

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
  // Turn ended on an API error; otherwise indistinguishable from a normal Stop.
  'StopFailure',
  // Outcome of the compaction PreCompact announces (tokens before/after).
  'PostCompact',
  // Auto-mode classifier refused a tool: the agent is blocked, not idle.
  'PermissionDenied',
  // Live model id without waiting for a transcript entry.
  'PostModelSwitch',
] as const;

function buildEhUrl(): string {
  return `http://127.0.0.1:${PORT}/claude`;
}

function buildAuthHeader(): string {
  const token = getAuthToken();
  return token ? `-H "Authorization: Bearer ${token}"` : '';
}

/** Build a command that POSTs stdin to the EH server, silently succeeding if it's down. */
function buildEhCommand(): string {
  if (detectHookShell() === 'powershell') return powershellFile('eh-hook.ps1');
  const url = buildEhUrl();
  const authHeader = buildAuthHeader();
  return `curl -s --connect-timeout 2 --max-time 3 -X POST -H "Content-Type: application/json" ${authHeader} -d @- ${url} > /dev/null 2>&1 || true`;
}

/** PreToolUse lock check (POSIX sh). Exits 2 with a message when another agent holds the lock. */
export function buildLockCheckSh(port: number, token: string | null): string {
  const lockUrl = `http://127.0.0.1:${port}/lock`;
  const claudeUrl = `http://127.0.0.1:${port}/claude`;
  const authHeaderLine = token ? `-H "Authorization: Bearer ${token}"` : '';
  return `#!/bin/sh
# Event Horizon — PreToolUse lock check. Auto-generated, do not edit.
PAYLOAD=$(cat)
printf '%s' "$PAYLOAD" | curl -s --connect-timeout 2 --max-time 3 -X POST -H "Content-Type: application/json" ${authHeaderLine} -d @- "${claudeUrl}" > /dev/null 2>&1 || true
TN=$(printf '%s' "$PAYLOAD" | sed -n 's/.*"tool_name" *: *"\\([^"]*\\)".*/\\1/p' | head -1)
FP=$(printf '%s' "$PAYLOAD" | sed -n 's/.*"file_path" *: *"\\([^"]*\\)".*/\\1/p' | head -1)
if [ -n "$FP" ]; then
  AGENT=$(printf '%s' "$PAYLOAD" | sed -n 's/.*"session_id" *: *"\\([^"]*\\)".*/\\1/p' | head -1)
  CWD=$(printf '%s' "$PAYLOAD" | sed -n 's/.*"cwd" *: *"\\([^"]*\\)".*/\\1/p' | head -1)
  FOLDER=$(basename "$CWD" 2>/dev/null)
  ANAME="Claude Code"
  [ -n "$FOLDER" ] && ANAME="Claude Code ($FOLDER)"
  # Write/Edit tools: acquire the lock (check + acquire)
  # Read tools: just query if locked by someone else (no acquire)
  ACTION="query"
  if [ "$TN" = "Write" ] || [ "$TN" = "Edit" ] || [ "$TN" = "MultiEdit" ] || [ "$TN" = "WriteFile" ]; then
    ACTION="check"
  fi
  RESP=$(curl -s --connect-timeout 2 --max-time 3 -X POST -H "Content-Type: application/json" ${authHeaderLine} \\
    -d "{\\"action\\":\\"$ACTION\\",\\"filePath\\":\\"$FP\\",\\"agentId\\":\\"$AGENT\\",\\"agentName\\":\\"$ANAME\\",\\"toolName\\":\\"$TN\\"}" \\
    "${lockUrl}" 2>/dev/null)
  if echo "$RESP" | grep -q '"allowed":false'; then
    OWNER=$(echo "$RESP" | sed -n 's/.*"owner" *: *"\\([^"]*\\)".*/\\1/p')
    echo "[Event Horizon file lock] BLOCKED: $FP is locked by $OWNER who is actively editing it. You MUST NOT access this file by ANY means — no Read, no Write, no Edit, no Bash commands. The lock will release automatically when $OWNER finishes (within 30 seconds of their last edit). Work on OTHER files first, then retry this file later." >&2
    exit 2
  fi
  # A Read of a file in shared knowledge may be answered with its digest: the
  # server returns the PreToolUse hook JSON and Claude Code reads it from stdout.
  if printf '%s' "$RESP" | grep -q '"hookSpecificOutput"'; then
    printf '%s' "$RESP"
    exit 0
  fi
fi
`;
}

/**
 * Write the lock-check script to ~/.event-horizon/eh-lock-check.sh
 * and return the path. Called once during hook setup.
 * The script is a proper file — no quoting issues, no inline bash -c nightmares.
 */
export async function ensureLockScripts(): Promise<{ checkScript: string; releaseScript: string }> {
  const dir = path.join(os.homedir(), '.event-horizon');
  await fsp.mkdir(dir, { recursive: true });

  const token = getAuthToken();
  const lockUrl = `http://127.0.0.1:${PORT}/lock`;
  const claudeUrl = `http://127.0.0.1:${PORT}/claude`;
  const authHeaderLine = token ? `-H "Authorization: Bearer ${token}"` : '';

  const checkScript = path.join(dir, 'eh-lock-check.sh');
  const checkContent = buildLockCheckSh(PORT, token);
  await fsp.writeFile(checkScript, checkContent, 'utf8');
  await fsp.chmod(checkScript, 0o755).catch(() => {});

  const releaseScript = path.join(dir, 'eh-lock-release.sh');
  const releaseContent = `#!/bin/sh
# Event Horizon — PostToolUse lock release. Auto-generated, do not edit.
PAYLOAD=$(cat)
printf '%s' "$PAYLOAD" | curl -s --connect-timeout 2 --max-time 3 -X POST -H "Content-Type: application/json" ${authHeaderLine} -d @- "${claudeUrl}" > /dev/null 2>&1 || true
FP=$(printf '%s' "$PAYLOAD" | sed -n 's/.*"file_path" *: *"\\([^"]*\\)".*/\\1/p' | head -1)
if [ -n "$FP" ]; then
  AGENT=$(printf '%s' "$PAYLOAD" | sed -n 's/.*"session_id" *: *"\\([^"]*\\)".*/\\1/p' | head -1)
  curl -s --connect-timeout 2 --max-time 3 -X POST -H "Content-Type: application/json" ${authHeaderLine} \\
    -d "{\\"action\\":\\"release\\",\\"filePath\\":\\"$FP\\",\\"agentId\\":\\"$AGENT\\"}" \\
    "${lockUrl}" > /dev/null 2>&1 || true
fi
`;
  await fsp.writeFile(releaseScript, releaseContent, 'utf8');
  await fsp.chmod(releaseScript, 0o755).catch(() => {});

  // PowerShell equivalents for Windows without Git Bash. Written with a BOM:
  // Windows PowerShell 5.1 reads a BOM-less script as ANSI.
  if (process.platform === 'win32') {
    await fsp.writeFile(path.join(dir, 'eh-hook.ps1'), '\uFEFF' + buildHookPs1(PORT, token), 'utf8');
    await fsp.writeFile(path.join(dir, 'eh-lock-check.ps1'), '\uFEFF' + buildLockCheckPs1(PORT, token), 'utf8');
  }

  return { checkScript, releaseScript };
}

const PS1_PRELUDE = `$ErrorActionPreference = 'SilentlyContinue'
$utf8 = New-Object System.Text.UTF8Encoding $false
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$payload = [Console]::In.ReadToEnd()
`;

function ps1Post(token: string | null): string {
  const auth = token ? `\n    $req.Headers.Add('Authorization', 'Bearer ${token}')` : '';
  return `function Post-Json([string]$url, [string]$body, [int]$timeoutMs = 2000) {
  try {
    $bytes = $utf8.GetBytes($body)
    $req = [System.Net.HttpWebRequest]::Create($url)
    $req.Method = 'POST'
    $req.ContentType = 'application/json'
    $req.Timeout = $timeoutMs${auth}
    $s = $req.GetRequestStream(); $s.Write($bytes, 0, $bytes.Length); $s.Close()
    $resp = $req.GetResponse()
    $reader = New-Object System.IO.StreamReader($resp.GetResponseStream(), $utf8)
    $text = $reader.ReadToEnd(); $reader.Close(); $resp.Close()
    return @{ Status = [int]$resp.StatusCode; Body = $text }
  } catch [System.Net.WebException] {
    $r = $_.Exception.Response
    if ($r) {
      $reader = New-Object System.IO.StreamReader($r.GetResponseStream(), $utf8)
      $text = $reader.ReadToEnd(); $reader.Close()
      return @{ Status = [int]$r.StatusCode; Body = $text }
    }
    return $null
  } catch { return $null }
}
`;
}

/** Generic hook (POST and discard) and, with -Inbox, the prompt-submit notice (print the reply). */
export function buildHookPs1(port: number, token: string | null): string {
  return `# Event Horizon, Claude Code hook (PowerShell). Auto-generated, do not edit.
param([switch]$Inbox)
${PS1_PRELUDE}${ps1Post(token)}
if ($Inbox) {
  $r = Post-Json 'http://127.0.0.1:${port}/claude/inbox' $payload
  # Claude Code injects this hook's stdout into the turn.
  if ($r -and $r.Body) { [Console]::Out.Write($r.Body) }
} else {
  $null = Post-Json 'http://127.0.0.1:${port}/claude' $payload
}
exit 0
`;
}

/** PreToolUse lock check (PowerShell); same behaviour as eh-lock-check.sh. */
export function buildLockCheckPs1(port: number, token: string | null): string {
  return `# Event Horizon, PreToolUse lock check (PowerShell). Auto-generated, do not edit.
${PS1_PRELUDE}${ps1Post(token)}
$null = Post-Json 'http://127.0.0.1:${port}/claude' $payload
try { $j = $payload | ConvertFrom-Json } catch { exit 0 }
$fp = $j.tool_input.file_path
if (-not $fp) { exit 0 }
$tn = [string]$j.tool_name
$folder = ''
if ($j.cwd) { $folder = Split-Path -Leaf ([string]$j.cwd) }
$name = 'Claude Code'
if ($folder) { $name = "Claude Code ($folder)" }
# Write/Edit tools acquire the lock; reads only ask whether someone else holds it.
$action = 'query'
if (@('Write', 'Edit', 'MultiEdit', 'WriteFile') -contains $tn) { $action = 'check' }
$body = @{ action = $action; filePath = [string]$fp; agentId = [string]$j.session_id; agentName = $name; toolName = $tn } | ConvertTo-Json -Compress
$r = Post-Json 'http://127.0.0.1:${port}/lock' $body
if ($r -and $r.Body -match '"allowed"\\s*:\\s*false') {
  $owner = 'another agent'
  try { $o = ($r.Body | ConvertFrom-Json).owner; if ($o) { $owner = $o } } catch {}
  [Console]::Error.WriteLine("[Event Horizon file lock] BLOCKED: $fp is locked by $owner who is actively editing it. You MUST NOT access this file by ANY means. No Read, no Write, no Edit, no Bash commands. The lock will release automatically when $owner finishes (within 30 seconds of their last edit). Work on OTHER files first, then retry this file later.")
  exit 2
}
# A Read of a file in shared knowledge may be answered with its digest.
if ($r -and $r.Body -match '"hookSpecificOutput"') { [Console]::Out.Write($r.Body); exit 0 }
exit 0
`;
}

/**
 * Build the UserPromptSubmit command.
 *
 * Unlike every other hook, this one keeps stdout: Claude Code injects a
 * UserPromptSubmit hook's output into that turn's context. The /claude/inbox
 * route records the event like /claude does, then answers with a one-line
 * notice when peer mail is waiting (and an empty body when it isn't). That
 * gives a dormant session a wake-up it can act on the next time you type,
 * without the extension host needing to push anything.
 */
function buildPromptSubmitCommand(): string {
  if (detectHookShell() === 'powershell') return powershellFile('eh-hook.ps1', '-Inbox');
  const authHeader = buildAuthHeader();
  return `curl -s --connect-timeout 2 --max-time 3 -X POST -H "Content-Type: application/json" ${authHeader} -d @- http://127.0.0.1:${PORT}/claude/inbox 2>/dev/null || true`;
}

/** Build the PreToolUse command — calls the external script file. */
function buildPreToolUseCommand(): string {
  if (detectHookShell() === 'powershell') return powershellFile('eh-lock-check.ps1');
  // sh, not bash: the script is POSIX and must not require bash.
  return `sh "${fwd(path.join(ehDir(), 'eh-lock-check.sh'))}"`;
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

/** The command this specific hook event is supposed to run. */
function expectedCommandFor(hookEvent: string): string {
  if (hookEvent === 'PreToolUse') return buildPreToolUseCommand();
  if (hookEvent === 'UserPromptSubmit') return buildPromptSubmitCommand();
  return buildEhCommand();
}

/**
 * True if the hook matches what this event is supposed to run.
 *
 * Must be checked per event, not against "any command Event Horizon might
 * install". It used to accept all three shapes regardless of which event they
 * were attached to, so when UserPromptSubmit moved from the generic command to
 * the inbox one, the old generic command still counted as current: it was
 * neither removed as stale nor replaced, and the change never reached anyone
 * who already had hooks installed. Any future per-event divergence would have
 * failed to roll out the same silent way.
 */
function isCurrentEhHook(h: Record<string, unknown>, hookEvent: string): boolean {
  if (typeof h.command === 'string') {
    // Legacy hooks contain the query-string token; they're NOT current (v2.0.0 breaking change).
    if (h.command.includes('?token=')) return false;
    return h.command === expectedCommandFor(hookEvent);
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
            if (isCurrentEhHook(c, hookEvent)) hasCurrent = true;
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
  await removeTelemetryEnv();
  await removeStatusLine();
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
      const hasStale = hs.some((c) => isEhHook(c) && !isCurrentEhHook(c, hookEvent));
      return !hasStale;
    });

    // Skip only if current correct hook is already present
    const alreadyCurrent = withoutStale.some((h) => {
      const hh = h as Record<string, unknown>;
      const hs = (hh.hooks ?? []) as Array<Record<string, unknown>>;
      return hs.some((c) => isCurrentEhHook(c, hookEvent));
    });

    // PreToolUse uses the lock-checking script; everything else uses the normal curl
    const cmd = hookEvent === 'PreToolUse'
      ? buildPreToolUseCommand()
      : hookEvent === 'UserPromptSubmit'
        ? buildPromptSubmitCommand()
        : buildEhCommand();
    merged[hookEvent] = alreadyCurrent
      ? withoutStale
      : [...withoutStale, { matcher: '', hooks: [{ type: 'command', command: cmd }] }];
  }

  settings.hooks = merged;

  const dir = path.dirname(settingsPath);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');

  // OTel export to Event Horizon lives in the same file; keep it in step with the hooks.
  const telemetryEnabled = vscode.workspace.getConfiguration('eventHorizon').get<boolean>('claudeTelemetry.enabled', true);
  if (telemetryEnabled) await setupTelemetryEnv(PORT, getAuthToken());
  else await removeTelemetryEnv();

  // statusLine bridge: wraps an existing statusLine by default (see setupStatusLine.ts).
  const statusLineMode = vscode.workspace.getConfiguration('eventHorizon').get<StatusLineMode>('claudeStatusLine.mode', 'chain');
  await setupStatusLine({ port: PORT, token: getAuthToken(), mode: statusLineMode });
}

/**
 * Register Event Horizon as an MCP server in ~/.claude.json (global only).
 * Also cleans up any stale project-level .claude.json entries to prevent conflicts.
 */
export async function registerMcpServer(): Promise<void> {
  const claudeJsonPath = path.join(os.homedir(), '.claude.json');
  // v2.0.0: MCP URL no longer carries ?token=. Claude Code discovers auth via
  // RFC 9728 .well-known/oauth-protected-resource and obtains JWT access
  // tokens through OAuth 2.1 client_credentials flow.
  const mcpUrl = `http://127.0.0.1:${PORT}/mcp`;

  let config: Record<string, unknown> = {};
  try {
    const raw = await fsp.readFile(claudeJsonPath, 'utf8');
    config = JSON.parse(raw);
  } catch {
    // File doesn't exist or is invalid — start fresh
  }

  const servers = (config.mcpServers ?? {}) as Record<string, unknown>;
  servers['event-horizon'] = { type: 'http', url: mcpUrl };
  config.mcpServers = servers;

  await fsp.writeFile(claudeJsonPath, JSON.stringify(config, null, 2), 'utf8');

  // Clean up project-level .claude.json entries that may have stale tokens
  void cleanupProjectMcpEntries();
}

/** Remove event-horizon MCP entries from project-level .claude.json files to prevent stale token conflicts. */
async function cleanupProjectMcpEntries(): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders) return;

  for (const folder of folders) {
    const projectClaudeJson = path.join(folder.uri.fsPath, '.claude.json');
    try {
      const raw = await fsp.readFile(projectClaudeJson, 'utf8');
      const config = JSON.parse(raw) as Record<string, unknown>;
      const servers = config.mcpServers as Record<string, unknown> | undefined;
      if (servers && 'event-horizon' in servers) {
        delete servers['event-horizon'];
        // If no servers left, remove the key entirely
        if (Object.keys(servers).length === 0) {
          delete config.mcpServers;
        }
        await fsp.writeFile(projectClaudeJson, JSON.stringify(config, null, 2), 'utf8');
      }
    } catch {
      // File doesn't exist or can't be parsed — fine
    }
  }
}

export async function runSetupClaudeCodeHooks(): Promise<void> {
  try {
    await setupClaudeCodeHooks();
    // Also register MCP server for tool-based coordination
    await registerMcpServer();
    void vscode.window.showInformationMessage(
      'Event Horizon: Claude Code hooks + MCP tools installed! Start a Claude Code session to see your agent appear.',
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    void vscode.window.showErrorMessage(`Event Horizon: Failed to set up hooks — ${msg}`);
  }
}

/**
 * Internals exposed for tests. These decide whether an installed hook gets
 * replaced on activation, which is the difference between a change reaching
 * users automatically and silently never rolling out.
 */
export const __hookTestables = {
  expectedCommandFor,
  isCurrentEhHook,
  isEhHook,
  setHookShell: (shell: HookShell | null): void => { hookShellOverride = shell; },
  hookEvents: EH_HOOK_EVENTS,
};
