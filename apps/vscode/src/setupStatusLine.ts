/**
 * statusLine bridge — feeds Claude Code's statusLine JSON to Event Horizon
 * while keeping the user's own statusline exactly as it was.
 *
 * Claude Code pipes a session snapshot into the `statusLine.command` on every
 * update. The bridge reads that stdin once, posts it to /claude/status, then
 * re-runs the user's original command with the same stdin and prints its
 * output. The original command is handed to a shell as a single argument
 * (`bash -c <cmd>`, `powershell -Command <cmd>`, `$SHELL -c <cmd>`), the same
 * way Claude Code runs it — it is never spliced into the bridge script. On
 * Windows Claude Code uses Git Bash when installed and PowerShell otherwise,
 * so the bridge does the same.
 *
 * Modes (eventHorizon.claudeStatusLine.mode):
 * - chain  (default) wrap an existing statusLine; install nothing when there
 *          is none, because a custom statusLine hides Claude Code's footer
 *          hints (esc to interrupt, ? for shortcuts).
 * - always also install when there is none, printing a compact
 *          "[model] ctx N% · $cost" line.
 * - off    remove the bridge and restore the original.
 *
 * The original statusLine object is saved before replacement so removal
 * restores it exactly (or deletes the field if there was none).
 */

import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

export type StatusLineMode = 'chain' | 'always' | 'off';

export const BRIDGE_MARKER = 'eh-statusline';

export interface StatusLinePaths {
  settingsPath: string;
  dir: string;
  backupPath: string;
  commandPath: string;
  ps1Path: string;
  shPath: string;
}

export function defaultStatusLinePaths(home = os.homedir()): StatusLinePaths {
  const dir = path.join(home, '.event-horizon');
  return {
    settingsPath: path.join(home, '.claude', 'settings.json'),
    dir,
    backupPath: path.join(dir, 'statusline-original.json'),
    commandPath: path.join(dir, 'statusline-original.cmd'),
    ps1Path: path.join(dir, `${BRIDGE_MARKER}.ps1`),
    shPath: path.join(dir, `${BRIDGE_MARKER}.sh`),
  };
}

/** Saved before Event Horizon replaced the statusLine. */
export interface StatusLineBackup {
  /** The user's statusLine object, or null when there was none. */
  original: Record<string, unknown> | null;
  /** Git Bash location on Windows, when Claude Code would use it. */
  bashPath?: string | null;
}

/** Forward slashes: Git Bash eats backslashes in the command string. */
const fwd = (p: string): string => p.split('\\').join('/');

export function bridgeCommand(platform: NodeJS.Platform, paths: StatusLinePaths): string {
  return platform === 'win32'
    ? `powershell -NoProfile -ExecutionPolicy Bypass -File "${fwd(paths.ps1Path)}"`
    : `sh "${fwd(paths.shPath)}"`;
}

export function isBridgeCommand(command: unknown): boolean {
  return typeof command === 'string' && command.includes(BRIDGE_MARKER);
}

/** Where Claude Code would find Git Bash on Windows, or null. */
export function findGitBash(env: NodeJS.ProcessEnv = process.env, exists: (p: string) => boolean = fs.existsSync): string | null {
  const candidates = [
    env.CLAUDE_CODE_GIT_BASH_PATH,
    env.ProgramFiles && path.join(env.ProgramFiles, 'Git', 'bin', 'bash.exe'),
    env['ProgramFiles(x86)'] && path.join(env['ProgramFiles(x86)']!, 'Git', 'bin', 'bash.exe'),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe'),
  ].filter((p): p is string => typeof p === 'string' && p.length > 0);
  return candidates.find((p) => exists(p)) ?? null;
}

// ── Pure decision ───────────────────────────────────────────────────────────

export type StatusLineAction =
  | { kind: 'none' }
  | { kind: 'install'; statusLine: Record<string, unknown>; backup: StatusLineBackup | null }
  | { kind: 'refresh' }
  | { kind: 'restore'; statusLine: Record<string, unknown> | null };

/**
 * Decide what to do with the current statusLine. `backup` is the saved
 * original, if Event Horizon installed the bridge earlier.
 */
export function planStatusLine(
  current: Record<string, unknown> | undefined,
  backup: StatusLineBackup | null,
  mode: StatusLineMode,
  bridge: string,
): StatusLineAction {
  const ours = current !== undefined && isBridgeCommand(current.command);

  if (mode === 'off') {
    return ours && backup ? { kind: 'restore', statusLine: backup.original } : { kind: 'none' };
  }
  if (ours) return { kind: 'refresh' };

  if (current === undefined || current === null) {
    if (mode !== 'always') return { kind: 'none' };
    return { kind: 'install', statusLine: { type: 'command', command: bridge }, backup: { original: null } };
  }
  if (current.type !== undefined && current.type !== 'command') return { kind: 'none' };
  if (typeof current.command !== 'string' || current.command.trim() === '') return { kind: 'none' };

  // Keep the user's padding / refreshInterval / other fields; swap only the command.
  return { kind: 'install', statusLine: { ...current, command: bridge }, backup: { original: { ...current } } };
}

// ── Scripts ─────────────────────────────────────────────────────────────────

/** POSIX sh bridge. No bash required. */
export function buildShBridge(port: number, token: string | null, paths: StatusLinePaths): string {
  const auth = token ? ` -H "Authorization: Bearer ${token}"` : '';
  return `#!/bin/sh
# Event Horizon statusLine bridge. Auto-generated, do not edit.
PAYLOAD=$(cat)
# Post to Event Horizon in the background; never delay the statusline.
( printf '%s' "$PAYLOAD" | curl -s --max-time 1 -X POST -H "Content-Type: application/json"${auth} --data-binary @- "http://127.0.0.1:${port}/claude/status" >/dev/null 2>&1 & )
ORIG_FILE="${fwd(paths.commandPath)}"
if [ -s "$ORIG_FILE" ]; then
  ORIG=$(cat "$ORIG_FILE")
  # The original command is one argument to the shell, exactly as Claude Code runs it.
  printf '%s' "$PAYLOAD" | "\${SHELL:-/bin/sh}" -c "$ORIG"
  exit $?
fi
MODEL=$(printf '%s' "$PAYLOAD" | sed -n 's/.*"display_name" *: *"\\([^"]*\\)".*/\\1/p' | head -1)
PCT=$(printf '%s' "$PAYLOAD" | sed -n 's/.*"used_percentage" *: *\\([0-9.]*\\).*/\\1/p' | head -1)
COST=$(printf '%s' "$PAYLOAD" | sed -n 's/.*"total_cost_usd" *: *\\([0-9.]*\\).*/\\1/p' | head -1)
LINE="[\${MODEL:-Claude}]"
[ -n "$PCT" ] && LINE="$LINE ctx \${PCT%.*}%"
[ -n "$COST" ] && LINE="$LINE · \\$$(printf '%.2f' "$COST" 2>/dev/null || echo "$COST")"
printf '%s\\n' "$LINE"
`;
}

/** Windows PowerShell bridge. Runs the original via Git Bash when present, else PowerShell. */
export function buildPs1Bridge(port: number, token: string | null, paths: StatusLinePaths): string {
  const tokenLine = token ? `$req.Headers.Add('Authorization', 'Bearer ${token}')` : '';
  return `# Event Horizon statusLine bridge. Auto-generated, do not edit.
$ErrorActionPreference = 'SilentlyContinue'
# BOM-less UTF-8: Windows PowerShell 5.1's [Text.Encoding]::UTF8 emits a byte-order
# mark, which would reach the original command as a stray first character.
$utf8 = New-Object System.Text.UTF8Encoding $false
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
$payload = [Console]::In.ReadToEnd()

# Post to Event Horizon with a short timeout; a failure never blocks the statusline.
try {
  $bytes = $utf8.GetBytes($payload)
  $req = [System.Net.HttpWebRequest]::Create('http://127.0.0.1:${port}/claude/status')
  $req.Method = 'POST'
  $req.ContentType = 'application/json'
  $req.Timeout = 800
  ${tokenLine}
  $stream = $req.GetRequestStream(); $stream.Write($bytes, 0, $bytes.Length); $stream.Close()
  $req.GetResponse().Close()
} catch {}

$origFile = '${paths.commandPath.replace(/'/g, "''")}'
$backupFile = '${paths.backupPath.replace(/'/g, "''")}'
if (Test-Path $origFile) {
  $orig = [System.IO.File]::ReadAllText($origFile)
  $bash = $null
  try { $bash = (Get-Content -Raw $backupFile | ConvertFrom-Json).bashPath } catch {}
  # The original command is one argument to the shell Claude Code would use.
  if ($bash -and (Test-Path $bash)) { $payload | & $bash -c $orig }
  else { $payload | & powershell -NoProfile -Command $orig }
  exit $LASTEXITCODE
}

try {
  $j = $payload | ConvertFrom-Json
  $line = "[$($j.model.display_name)]"
  if ($j.context_window.used_percentage -ne $null) { $line += " ctx $([math]::Round($j.context_window.used_percentage))%" }
  if ($j.cost.total_cost_usd -ne $null) { $line += (' · $' + ('{0:N2}' -f $j.cost.total_cost_usd)) }
  Write-Output $line
} catch { Write-Output '[Claude]' }
`;
}

// ── File I/O ────────────────────────────────────────────────────────────────

async function readJson<T>(file: string): Promise<T | null> {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')) as T; } catch { return null; }
}

async function writeScripts(port: number, token: string | null, paths: StatusLinePaths, platform: NodeJS.Platform): Promise<void> {
  await fsp.mkdir(paths.dir, { recursive: true });
  if (platform === 'win32') {
    // With a BOM: Windows PowerShell 5.1 reads a BOM-less script as ANSI, which
    // garbles the middle dot and any non-ASCII character in the user's home path.
    await fsp.writeFile(paths.ps1Path, '\uFEFF' + buildPs1Bridge(port, token, paths), 'utf8');
  } else {
    await fsp.writeFile(paths.shPath, buildShBridge(port, token, paths), 'utf8');
    await fsp.chmod(paths.shPath, 0o755).catch(() => {});
  }
}

export interface SetupStatusLineOptions {
  port: number;
  token: string | null;
  mode: StatusLineMode;
  paths?: StatusLinePaths;
  platform?: NodeJS.Platform;
  gitBash?: string | null;
}

/** Apply the bridge for `mode`. Returns what was done. */
export async function setupStatusLine(opts: SetupStatusLineOptions): Promise<StatusLineAction['kind']> {
  const paths = opts.paths ?? defaultStatusLinePaths();
  const platform = opts.platform ?? process.platform;
  const settings = (await readJson<Record<string, unknown>>(paths.settingsPath)) ?? {};
  const current = settings.statusLine && typeof settings.statusLine === 'object'
    ? settings.statusLine as Record<string, unknown>
    : undefined;
  const backup = await readJson<StatusLineBackup>(paths.backupPath);
  const action = planStatusLine(current, backup, opts.mode, bridgeCommand(platform, paths));

  if (action.kind === 'restore') {
    await removeStatusLine(paths);
    return 'restore';
  }
  if (action.kind === 'refresh') {
    // Token may have changed; keep the scripts current.
    await writeScripts(opts.port, opts.token, paths, platform);
    return 'refresh';
  }
  if (action.kind === 'install') {
    const original = action.backup?.original ?? null;
    const bashPath = platform === 'win32' ? (opts.gitBash !== undefined ? opts.gitBash : findGitBash()) : null;
    await fsp.mkdir(paths.dir, { recursive: true });
    await fsp.writeFile(paths.backupPath, JSON.stringify({ original, bashPath }, null, 2), 'utf8');
    if (original && typeof original.command === 'string') await fsp.writeFile(paths.commandPath, original.command, 'utf8');
    else await fsp.rm(paths.commandPath, { force: true });
    await writeScripts(opts.port, opts.token, paths, platform);
    settings.statusLine = action.statusLine;
    await fsp.mkdir(path.dirname(paths.settingsPath), { recursive: true });
    await fsp.writeFile(paths.settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  }
  return action.kind;
}

/** Restore the original statusLine (or remove ours) and delete bridge files. */
export async function removeStatusLine(paths = defaultStatusLinePaths()): Promise<boolean> {
  const backup = await readJson<StatusLineBackup>(paths.backupPath);
  const settings = await readJson<Record<string, unknown>>(paths.settingsPath);
  let changed = false;
  if (settings) {
    const current = settings.statusLine as Record<string, unknown> | undefined;
    // Only touch the statusLine if it is still ours — the user may have replaced it.
    if (current && isBridgeCommand(current.command)) {
      if (backup?.original) settings.statusLine = backup.original;
      else delete settings.statusLine;
      await fsp.writeFile(paths.settingsPath, JSON.stringify(settings, null, 2), 'utf8');
      changed = true;
    }
  }
  for (const f of [paths.backupPath, paths.commandPath, paths.ps1Path, paths.shPath]) await fsp.rm(f, { force: true });
  return changed;
}
