/**
 * Spawn Registry — manages spawning AI agents in VS Code terminals.
 * Supports Claude Code, OpenCode, and Cursor via pluggable backends.
 *
 * Spawns use argv-style `cp.spawn(bin, args, { shell: false })` — no shell,
 * no escaping, no temp files. Windows shim files (.cmd / .bat / .ps1) are
 * detected and wrapped via `cmd.exe` or `powershell.exe` so the underlying
 * binary runs identically across platforms.
 */

import * as vscode from 'vscode';
import * as cp from 'child_process';

// ── Interfaces ─────────────────────────────────────────────────────────────

export interface SpawnOpts {
  prompt: string;
  role?: string;
  cwd?: string;
  model?: string;
  planId?: string;
  taskId?: string;
  envVars?: Record<string, string>;
  /** When 'worktree', create a git worktree before spawning and set cwd to it. */
  isolation?: 'none' | 'worktree';
  /**
   * Interactive mode: spawn without `-p` so the user can type follow-up prompts
   * and the agent responds. Default false — batch mode via `-p` is correct for
   * orchestrated work.
   */
  interactive?: boolean;
}

export interface SpawnResult {
  agentId: string;
  type: string;
  status: 'spawned' | 'unavailable' | 'error';
  message: string;
  terminalName?: string;
  pid?: number;
}

export interface SpawnBackend {
  type: string;
  spawn(opts: SpawnOpts): Promise<SpawnResult>;
  stop(agentId: string): Promise<void>;
  resume?(agentId: string, sessionId: string, prompt: string): Promise<SpawnResult>;
  isAvailable(): Promise<boolean>;
}

export interface SpawnedAgentInfo {
  type: string;
  terminalName: string;
  terminal: vscode.Terminal;
  role: string;
  taskId: string;
  spawnedAt: number;
  /** Underlying child process (when spawned via spawnWithTerminal). Used for real SIGTERM/SIGKILL. */
  process?: cp.ChildProcess;
  pid?: number;
  /** True when spawned in interactive REPL mode — excluded from the silence watchdog. */
  interactive?: boolean;
}

// ── Cross-platform command resolution ───────────────────────────────────────

/**
 * A resolved CLI binary, ready to pass to `cp.spawn(bin, [...prefix, ...args])`.
 * On Windows, npm-installed CLIs are usually `.cmd` shim files which Node cannot
 * execute directly with `shell: false`. We detect those and wrap with `cmd.exe /c`.
 */
export interface ResolvedCommand {
  /** Binary to pass as the first arg to `cp.spawn`. */
  bin: string;
  /** Args that must precede the caller's args (for shim wrapping). Empty for direct execution. */
  prefix: string[];
  /** Underlying resolved path (for diagnostics). Same as `bin` when no wrapping is needed. */
  fullPath: string;
  /**
   * When true, the command needs cmd.exe wrapping and the caller must use
   * `buildFinalArgs()` to combine fullPath + user args into a single /c
   * command string with correct quoting (paths with spaces, etc.).
   */
  wrapForCmd?: boolean;
}

/**
 * Resolve a command name to a spawnable binary. Returns null when the command
 * is not on PATH. Handles Windows `.cmd`/`.bat`/`.ps1` shim files transparently.
 */
export async function resolveCommand(cmd: string): Promise<ResolvedCommand | null> {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  const lines = await new Promise<string[]>((resolve) => {
    cp.execFile(finder, [cmd], (err, stdout) => {
      if (err) return resolve([]);
      resolve(String(stdout).split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length > 0));
    });
  });
  if (lines.length === 0) return null;

  // On Windows, `where` returns multiple matches (e.g. `opencode` and
  // `opencode.cmd`). The extensionless entry is a Unix shell script that
  // Node cannot execute with `shell: false`. Prefer the .cmd/.bat/.exe
  // entry so the shim-wrapping logic below can kick in.
  let fullPath = lines[0];
  if (process.platform === 'win32' && lines.length > 1) {
    const winExec = lines.find((l) => {
      const lo = l.toLowerCase();
      return lo.endsWith('.cmd') || lo.endsWith('.bat') || lo.endsWith('.exe') || lo.endsWith('.ps1');
    });
    if (winExec) fullPath = winExec;
  }

  if (process.platform === 'win32') {
    const lower = fullPath.toLowerCase();
    if (lower.endsWith('.cmd') || lower.endsWith('.bat')) {
      return { bin: 'cmd.exe', prefix: ['/d', '/s', '/c'], fullPath, wrapForCmd: true };
    }
    if (lower.endsWith('.ps1')) {
      return {
        bin: 'powershell.exe',
        prefix: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', fullPath],
        fullPath,
      };
    }
  }
  return { bin: fullPath, prefix: [], fullPath };
}

// ── Stream-JSON failure parsing ─────────────────────────────────────────────

interface StreamJsonFailure {
  authFailed: boolean;
  errorMessage: string | null;
  apiStatus: number | null;
}

/**
 * Parse the tail of a Claude Code stream-json stdout for common failure modes.
 * Returns structured info so callers can show actionable notifications.
 */
function parseStreamJsonFailure(stdoutTail: string): StreamJsonFailure {
  const result: StreamJsonFailure = { authFailed: false, errorMessage: null, apiStatus: null };
  // Each line is a JSON object — scan for error indicators
  for (const line of stdoutTail.split(/\r?\n/)) {
    if (!line.startsWith('{')) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.error === 'authentication_failed' || obj.api_error_status === 401) {
        result.authFailed = true;
      }
      if (obj.type === 'result' && obj.is_error) {
        result.errorMessage = obj.result ?? null;
        result.apiStatus = obj.api_error_status ?? null;
      }
    } catch { /* not valid JSON, skip */ }
  }
  return result;
}

// ── cmd.exe argument escaping ───────────────────────────────────────────────

/**
 * Escape a single argument for use inside a `cmd.exe /s /c "..."` command string.
 * Handles both C-runtime argv parsing (target program) and cmd.exe `%` expansion.
 */
function escapeArgForCmd(arg: string): string {
  if (arg === '') return '""';
  // 1. Escape for C runtime: double backslashes before `"`, escape `"` → `\"`
  let s = arg.replace(/(\\*)"/g, '$1$1\\"');
  // Double trailing backslashes (they'd escape the closing quote)
  s = s.replace(/(\\+)$/, '$1$1');
  // 2. Wrap in double quotes
  s = `"${s}"`;
  // 3. Escape `%` for cmd.exe (the only metachar active inside double quotes)
  s = s.replace(/%/g, '%%');
  return s;
}

/**
 * Build the final args array for `cp.spawn` from a resolved command + user args.
 *
 * For cmd.exe-wrapped `.cmd`/`.bat` shims, combines `fullPath + userArgs` into a
 * single `/c` command string with correct quoting so **paths containing spaces**
 * work correctly. Returns `verbatimArgs: true` so the caller passes
 * `windowsVerbatimArguments: true` to `cp.spawn` (prevents Node from adding a
 * second layer of quotes that cmd.exe would mis-parse).
 *
 * For all other commands, simply spreads `[...prefix, ...userArgs]` unchanged.
 */
export function buildFinalArgs(
  resolved: ResolvedCommand,
  userArgs: readonly string[],
): { args: string[]; verbatimArgs?: boolean } {
  if (!resolved.wrapForCmd) {
    return { args: [...resolved.prefix, ...userArgs] };
  }
  // Build: cmd.exe /d /s /c ""fullPath" "arg1" "arg2 with spaces" ..."
  // `/s /c` strips the outer quotes, leaving the inner quoting intact.
  const parts = [resolved.fullPath, ...userArgs].map(escapeArgForCmd);
  return {
    args: ['/d', '/s', '/c', `"${parts.join(' ')}"`],
    verbatimArgs: true,
  };
}

// ── Spawn diagnostics output channel ────────────────────────────────────────

let _agentOutputChannel: vscode.OutputChannel | null = null;
function agentOutputChannel(): vscode.OutputChannel {
  if (!_agentOutputChannel) {
    _agentOutputChannel = vscode.window.createOutputChannel('Event Horizon — Agents');
  }
  return _agentOutputChannel;
}

/** Redact long free-form strings (prompts) in argv for safe logging. */
function redactArgsForLog(args: readonly string[]): string[] {
  const REDACT_AFTER = new Set(['-p', '--prompt', '--append-system-prompt']);
  return args.map((a, i) => {
    const prev = i > 0 ? args[i - 1] : undefined;
    if (prev && REDACT_AFTER.has(prev)) return `<${a.length} chars redacted>`;
    return a;
  });
}

function logSpawn(
  agentId: string,
  resolved: ResolvedCommand,
  args: readonly string[],
  cwd: string | undefined,
): void {
  const ch = agentOutputChannel();
  ch.appendLine(`[${new Date().toISOString()}] spawn ${agentId}`);
  ch.appendLine(`  fullPath: ${resolved.fullPath}`);
  if (resolved.prefix.length > 0) ch.appendLine(`  shimPrefix: ${JSON.stringify(resolved.prefix)}`);
  ch.appendLine(`  args: ${JSON.stringify(redactArgsForLog(args))}`);
  ch.appendLine(`  cwd: ${cwd ?? '(undefined)'}`);
}

// ── Helper: spawn a child process wired to a VS Code pseudoterminal ─────────

export interface SpawnedTerminalHandle {
  terminal: vscode.Terminal;
  process: cp.ChildProcess;
  pid?: number;
  /** Returns the last ≤8 KB of stdout captured from the child process. */
  getStdoutTail(): string;
}

/**
 * Spawn a binary with an argv array (no shell) and pipe its stdout/stderr into
 * a VS Code terminal via a Pseudoterminal. Returns the terminal AND the underlying
 * ChildProcess so the spawn registry can kill the real PID (not just dispose the
 * terminal).
 *
 * Using `shell: false` means the binary is executed directly via `execve` (or the
 * Windows equivalent) and args flow as literal strings — no shell escaping, no
 * temp files, no cross-shell parse differences. Use `resolveCommand()` first to
 * get a `ResolvedCommand` that handles Windows shim files.
 *
 * stderr is duplicated to the `Event Horizon — Agents` output channel so a
 * terminal that dies instantly still leaves a debuggable trail.
 */
export function spawnWithTerminal(
  bin: string,
  args: readonly string[],
  opts: {
    cwd?: string;
    env: NodeJS.ProcessEnv;
    name: string;
    agentId?: string;
    onExit?: (code: number | null) => void;
    /** When true, pass `windowsVerbatimArguments: true` to `cp.spawn` (for cmd.exe wrapping). */
    verbatimArgs?: boolean;
  },
): SpawnedTerminalHandle {
  const writeEmitter = new vscode.EventEmitter<string>();
  const closeEmitter = new vscode.EventEmitter<number | void>();
  const ch = agentOutputChannel();
  const logPrefix = opts.agentId ? `[${opts.agentId}]` : `[${opts.name}]`;

  const child = cp.spawn(bin, args as string[], {
    cwd: opts.cwd,
    env: opts.env,
    shell: false,
    windowsHide: true,
    ...(opts.verbatimArgs ? { windowsVerbatimArguments: true } : {}),
  });

  // Close stdin immediately — batch-mode agents receive their prompt via argv,
  // not stdin. Leaving stdin open causes some CLIs (e.g. Claude Code) to wait
  // for data that never arrives, printing a noisy warning before proceeding.
  child.stdin?.end();

  const toTerm = (buf: Buffer | string): string => {
    // VS Code pseudoterminal expects \r\n line endings
    const s = typeof buf === 'string' ? buf : buf.toString('utf8');
    return s.replace(/\r?\n/g, '\r\n');
  };

  // Buffer the tail of stdout so we can dump it to the output channel on failure.
  // Stream-json CLIs (Claude Code) send errors to stdout, not stderr — without
  // this, a fast-failing process leaves zero diagnostics because the pseudoterminal
  // is disposed before the user can read it.
  const TAIL_LIMIT = 8192;
  let stdoutTail = '';

  child.stdout?.on('data', (d) => {
    writeEmitter.fire(toTerm(d));
    const chunk = typeof d === 'string' ? d : d.toString('utf8');
    stdoutTail = (stdoutTail + chunk).slice(-TAIL_LIMIT);
  });
  child.stderr?.on('data', (d) => {
    writeEmitter.fire(toTerm(d));
    // Mirror stderr to the output channel — survives terminal disposal
    ch.append(`${logPrefix} stderr: ${typeof d === 'string' ? d : d.toString('utf8')}`);
  });

  child.on('error', (err) => {
    const msg = `[spawn error] ${err.message}`;
    writeEmitter.fire(`\r\n\u001b[31m${msg}\u001b[0m\r\n`);
    ch.appendLine(`${logPrefix} ${msg}`);
  });

  child.on('exit', (code) => {
    writeEmitter.fire(`\r\n\u001b[90m[process exited with code ${code ?? 'null'}]\u001b[0m\r\n`);
    ch.appendLine(`${logPrefix} process exited with code ${code ?? 'null'}`);
    // On non-zero exit, dump the last chunk of stdout to the output channel.
    // This is the only way to capture stream-json errors from fast-failing agents.
    if (code !== 0 && stdoutTail.length > 0) {
      ch.appendLine(`${logPrefix} stdout (last ${stdoutTail.length} chars before exit):`);
      ch.append(stdoutTail);
      ch.appendLine('');
    }
    closeEmitter.fire(code ?? 0);
    opts.onExit?.(code);
  });

  const pty: vscode.Pseudoterminal = {
    onDidWrite: writeEmitter.event,
    onDidClose: closeEmitter.event,
    open: () => { /* nothing — data flows from child */ },
    close: () => {
      // User closed the terminal — kill the process so it doesn't linger
      if (!child.killed && child.exitCode === null) {
        try { child.kill('SIGTERM'); } catch { /* ignore */ }
      }
    },
  };

  const terminal = vscode.window.createTerminal({ name: opts.name, pty });

  return { terminal, process: child, pid: child.pid, getStdoutTail: () => stdoutTail };
}

/**
 * Kill a child process gracefully (SIGTERM) and escalate to SIGKILL if it doesn't exit within 3s.
 * Resolves with `true` once the process is dead, `false` if we couldn't confirm termination.
 */
export async function killChildProcess(child: cp.ChildProcess, timeoutMs = 3000): Promise<boolean> {
  if (!child || child.exitCode !== null || child.killed) return true;

  return new Promise<boolean>((resolve) => {
    let resolved = false;
    const done = (ok: boolean) => {
      if (resolved) return;
      resolved = true;
      resolve(ok);
    };

    child.once('exit', () => done(true));

    try { child.kill('SIGTERM'); } catch { /* ignore */ }

    setTimeout(() => {
      if (child.exitCode === null && !child.killed) {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
      }
    }, timeoutMs);

    // Hard deadline so we don't wait forever if neither signal is honored
    setTimeout(() => done(child.exitCode !== null || child.killed), timeoutMs + 500);
  });
}

// ── Spawn Registry ─────────────────────────────────────────────────────────

export class SpawnRegistry {
  private backends = new Map<string, SpawnBackend>();
  private spawnedAgents = new Map<string, SpawnedAgentInfo>();
  /**
   * session UUID → spawn-time synthetic id. Populated when a worker's first
   * MCP call reaches us (usually `eh_heartbeat` or `eh_claim_task`) — we match
   * its unknown session UUID against the most-recently-spawned unlinked agent.
   * Without this map, `eh_stop_agent` called with a session UUID (which is all
   * `eh_list_agents` returns) would miss every spawn entry.
   */
  private sessionToSpawn = new Map<string, string>();
  private disposables: vscode.Disposable[] = [];
  private changeListeners: Array<() => void> = [];
  /**
   * Called when a spawned agent exits (process exit or terminal closed).
   * The extension host uses this to inject synthetic `agent.terminate` events
   * into the event pipeline so AgentStateManager/SQLite/webview stay in sync.
   */
  private exitCallback: ((agentId: string, info: SpawnedAgentInfo, reason: string) => void) | null = null;

  constructor() {
    // Track terminal close events — also kill the process if the user closed
    // the terminal without stopping first. Pseudoterminal.close() already
    // sends SIGTERM, but this escalates to SIGKILL after the grace period.
    this.disposables.push(
      vscode.window.onDidCloseTerminal((terminal) => {
        for (const [agentId, info] of this.spawnedAgents) {
          if (info.terminal === terminal) {
            if (info.process && info.process.exitCode === null && !info.process.killed) {
              void killChildProcess(info.process).catch(() => { /* ignore */ });
            }
            this.spawnedAgents.delete(agentId);
            this.notifyChange();
            this.exitCallback?.(agentId, info, 'terminal-closed');
            break;
          }
        }
      }),
    );
  }

  /** Register a callback for when any spawned agent exits. */
  onAgentExit(cb: (agentId: string, info: SpawnedAgentInfo, reason: string) => void): void {
    this.exitCallback = cb;
  }

  onChange(listener: () => void): void {
    this.changeListeners.push(listener);
  }

  private notifyChange(): void {
    for (const fn of this.changeListeners) {
      try { fn(); } catch { /* ignore listener errors */ }
    }
  }

  /** Map of agentId → role for every currently spawned agent. */
  getAgentRoleMap(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [agentId, info] of this.spawnedAgents) {
      if (info.role) result[agentId] = info.role;
    }
    return result;
  }

  register(backend: SpawnBackend): void {
    this.backends.set(backend.type, backend);
  }

  /** Worktree manager reference — set externally by eventServer initMcpServer. */
  worktreeManager?: import('./worktreeManager.js').WorktreeManager;

  /** Default isolation mode — controlled by VS Code setting. */
  private defaultIsolation: 'none' | 'worktree' = 'none';

  setDefaultIsolation(mode: 'none' | 'worktree'): void {
    this.defaultIsolation = mode;
  }

  getDefaultIsolation(): 'none' | 'worktree' {
    return this.defaultIsolation;
  }

  async spawn(type: string, opts: SpawnOpts): Promise<SpawnResult> {
    const backend = this.backends.get(type);
    if (!backend) {
      return { agentId: '', type, status: 'error', message: `No backend registered for type: ${type}` };
    }
    const available = await backend.isAvailable();
    if (!available) {
      return { agentId: '', type, status: 'unavailable', message: `${type} CLI is not available in PATH` };
    }

    // Apply default isolation if not explicitly specified
    const isolation = opts.isolation ?? (this.defaultIsolation === 'worktree' ? 'worktree' : undefined);

    // Worktree isolation: create worktree and override cwd
    if (isolation === 'worktree' && opts.taskId && this.worktreeManager) {
      const cwd = opts.cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (cwd) {
        try {
          const agentId = `${type}-${Date.now()}`; // temporary for worktree naming
          const wt = await this.worktreeManager.create(agentId, opts.taskId, cwd);
          opts = { ...opts, cwd: wt.path };
        } catch {
          // Fall through — spawn without worktree
        }
      }
    }

    const result = await backend.spawn(opts);
    return result;
  }

  /**
   * Link a session UUID (the id that workers register with over MCP) to a
   * spawn-time synthetic id. Call this from MCP handlers that see worker-side
   * calls (eh_heartbeat, eh_claim_task) with an unknown session UUID — we try
   * to correlate it with the most recent unlinked spawn.
   *
   * Returns the spawn id if linked, null otherwise.
   */
  linkSession(sessionId: string): string | null {
    if (this.sessionToSpawn.has(sessionId)) return this.sessionToSpawn.get(sessionId)!;

    // Find the most recent spawn that doesn't yet have a linked session.
    const linkedSpawnIds = new Set(this.sessionToSpawn.values());
    let best: { spawnId: string; spawnedAt: number } | null = null;
    for (const [spawnId, info] of this.spawnedAgents) {
      if (linkedSpawnIds.has(spawnId)) continue;
      if (!best || info.spawnedAt > best.spawnedAt) {
        best = { spawnId, spawnedAt: info.spawnedAt };
      }
    }
    if (!best) return null;
    // Don't link if the spawn is more than 5 minutes old — likely not the same agent.
    if (Date.now() - best.spawnedAt > 5 * 60 * 1000) return null;

    this.sessionToSpawn.set(sessionId, best.spawnId);
    return best.spawnId;
  }

  /** Lookup the spawn id for a given session UUID, if linked. */
  getSpawnIdForSession(sessionId: string): string | undefined {
    return this.sessionToSpawn.get(sessionId);
  }

  async stop(agentId: string): Promise<{ stopped: boolean; message: string }> {
    // First try direct lookup by spawn-time synthetic id (keys in spawnedAgents).
    let info = this.spawnedAgents.get(agentId);
    let resolvedId = agentId;

    // Fallback 1: the caller passed a session UUID (what eh_list_agents returns).
    // Resolve through the sessionToSpawn map populated by worker MCP calls.
    if (!info) {
      const spawnId = this.sessionToSpawn.get(agentId);
      if (spawnId) {
        info = this.spawnedAgents.get(spawnId);
        if (info) resolvedId = spawnId;
      }
    }

    // Fallback 2: try to link now (first heartbeat may not have arrived yet,
    // but maybe we can still correlate by recency).
    if (!info) {
      const spawnId = this.linkSession(agentId);
      if (spawnId) {
        info = this.spawnedAgents.get(spawnId);
        if (info) resolvedId = spawnId;
      }
    }

    // Fallback 3: substring match (rare but cheap).
    if (!info) {
      for (const [spawnId, candidate] of this.spawnedAgents) {
        const lowerArg = agentId.toLowerCase();
        const lowerSpawn = spawnId.toLowerCase();
        if (lowerArg === lowerSpawn || lowerSpawn.includes(lowerArg) || lowerArg.includes(lowerSpawn)) {
          info = candidate;
          resolvedId = spawnId;
          break;
        }
      }
    }

    if (!info) {
      // Try backends as a last resort
      for (const backend of this.backends.values()) {
        try {
          await backend.stop(agentId);
          return { stopped: true, message: `Agent ${agentId} stopped via backend` };
        } catch { /* continue */ }
      }
      return { stopped: false, message: `Agent ${agentId} not found in spawn registry (tried direct + fuzzy match). Close the terminal manually.` };
    }
    // Reassign agentId to the resolved spawn id for downstream code.
    agentId = resolvedId;

    // Kill the real child process if we have one — terminal.dispose() alone
    // does NOT terminate the underlying CLI in non-pty mode, so `claude -p`
    // kept running and burned tokens.
    let processKilled = true;
    if (info.process) {
      processKilled = await killChildProcess(info.process);
    }

    // Delegate to backend so it can do any backend-specific cleanup, then
    // dispose the terminal as a belt-and-suspenders fallback.
    const backend = this.backends.get(info.type);
    if (backend) {
      try { await backend.stop(agentId); } catch { /* ignore */ }
    }
    try { info.terminal.dispose(); } catch { /* ignore */ }

    this.spawnedAgents.delete(agentId);
    // Clean up any session mappings pointing at this spawn.
    for (const [sessionId, spawnId] of this.sessionToSpawn) {
      if (spawnId === agentId) this.sessionToSpawn.delete(sessionId);
    }
    this.notifyChange();
    const msg = processKilled
      ? `Agent ${agentId} stopped`
      : `Agent ${agentId} stopped (process may still be running — check tasklist/ps)`;
    return { stopped: processKilled, message: msg };
  }

  /**
   * Kill every tracked spawned agent. Used by orchestrators to abort a plan.
   * Returns a summary of which agents were killed and which may still be running.
   */
  async stopAll(): Promise<{ stopped: number; total: number; ids: string[]; stubborn: string[] }> {
    const ids = Array.from(this.spawnedAgents.keys());
    const stubborn: string[] = [];
    let stopped = 0;
    for (const id of ids) {
      try {
        const result = await this.stop(id);
        if (result.stopped) {
          stopped++;
        } else {
          stubborn.push(id);
        }
      } catch {
        stubborn.push(id);
      }
    }
    return { stopped, total: ids.length, ids, stubborn };
  }

  async getAvailableTypes(): Promise<string[]> {
    const available: string[] = [];
    for (const backend of this.backends.values()) {
      if (await backend.isAvailable()) {
        available.push(backend.type);
      }
    }
    return available;
  }

  getSpawnedAgents(): Map<string, SpawnedAgentInfo> {
    return new Map(this.spawnedAgents);
  }

  getSpawnedAgent(agentId: string): SpawnedAgentInfo | undefined {
    return this.spawnedAgents.get(agentId);
  }

  trackAgent(agentId: string, info: SpawnedAgentInfo): void {
    this.spawnedAgents.set(agentId, info);
    this.notifyChange();
  }

  /** Remove an agent from the registry (used by natural-exit handlers). */
  untrackAgent(agentId: string): void {
    const info = this.spawnedAgents.get(agentId);
    if (info && this.spawnedAgents.delete(agentId)) {
      this.notifyChange();
      this.exitCallback?.(agentId, info, 'process-exit');
    }
  }

  /** Find terminal for a spawned agent. */
  getTerminal(agentId: string): vscode.Terminal | undefined {
    return this.spawnedAgents.get(agentId)?.terminal;
  }

  /** Try to match a non-spawned agent to a terminal by name pattern. */
  findTerminalForAgent(agentId: string): vscode.Terminal | undefined {
    // Check spawned agents first
    const spawned = this.spawnedAgents.get(agentId);
    if (spawned) return spawned.terminal;
    // Scan open terminals for name match
    for (const terminal of vscode.window.terminals) {
      if (terminal.name.includes(agentId)) {
        return terminal;
      }
    }
    return undefined;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }
}

// ── Claude Code Spawner ────────────────────────────────────────────────────

export class ClaudeCodeSpawner implements SpawnBackend {
  type = 'claude-code';
  private registry: SpawnRegistry;
  private serverPort: number;
  private getAuthToken: () => string | null;

  constructor(registry: SpawnRegistry, serverPort: number, getAuthToken: () => string | null) {
    this.registry = registry;
    this.serverPort = serverPort;
    this.getAuthToken = getAuthToken;
  }

  async isAvailable(): Promise<boolean> {
    return (await resolveCommand('claude')) !== null;
  }

  /** Assemble the Claude CLI argv for a spawn (without any shim prefix). Exposed for tests. */
  static buildArgs(opts: SpawnOpts, mode: 'batch' | 'interactive'): string[] {
    const args: string[] = [];
    if (mode === 'interactive') {
      // Claude's interactive mode seeds the conversation from a positional prompt.
      args.push(opts.prompt);
    } else {
      args.push('-p', opts.prompt, '--verbose', '--output-format', 'stream-json');
    }
    args.push('--allowedTools', 'Edit,Write,Read,Grep,Glob,Bash,NotebookEdit,Skill,mcp__event-horizon__*');
    if (opts.model) args.push('--model', opts.model);
    if (opts.role) {
      args.push(
        '--append-system-prompt',
        `You are assigned the ${opts.role} role. Follow role-specific instructions from Event Horizon.`,
      );
    }
    return args;
  }

  async spawn(opts: SpawnOpts): Promise<SpawnResult> {
    const agentId = `claude-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const suffix = opts.interactive ? 'Interactive' : (opts.taskId ?? 'general');
    const terminalName = `\u2600\uFE0F Claude \u2014 ${opts.role ?? 'Worker'} (${suffix})`;

    const resolved = await resolveCommand('claude');
    if (!resolved) {
      return { agentId, type: this.type, status: 'unavailable', message: 'claude CLI is not available in PATH' };
    }

    const args = ClaudeCodeSpawner.buildArgs(opts, opts.interactive ? 'interactive' : 'batch');
    const cwd = opts.cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const token = this.getAuthToken();
    const env: Record<string, string> = {
      EH_AGENT_ID: agentId,
      EH_API_URL: `http://127.0.0.1:${this.serverPort}`,
      ...(token ? { EH_AUTH_TOKEN: token } : {}),
      ...(opts.planId ? { EH_PLAN_ID: opts.planId } : {}),
      ...(opts.taskId ? { EH_TASK_ID: opts.taskId } : {}),
      ...opts.envVars,
    };

    logSpawn(agentId, resolved, args, cwd);

    // Interactive mode: let VS Code run the CLI as the terminal's root process.
    // `shellPath` + `shellArgs` avoids any user-shell layer entirely.
    if (opts.interactive) {
      const { args: shellArgs } = buildFinalArgs(resolved, args);
      const terminal = vscode.window.createTerminal({
        name: terminalName,
        cwd,
        env: { ...process.env, ...env } as { [key: string]: string },
        shellPath: resolved.bin,
        shellArgs,
      });
      terminal.show();
      this.registry.trackAgent(agentId, {
        type: this.type,
        terminalName,
        terminal,
        role: opts.role ?? 'worker',
        taskId: opts.taskId ?? '',
        spawnedAt: Date.now(),
        interactive: true,
      });
      return {
        agentId,
        type: this.type,
        status: 'spawned',
        message: `Claude Code agent spawned interactively in terminal "${terminalName}". Use the terminal to send follow-up prompts.`,
        terminalName,
      };
    }

    const registry = this.registry;
    const { args: finalArgs, verbatimArgs } = buildFinalArgs(resolved, args);
    const handle = spawnWithTerminal(resolved.bin, finalArgs, {
      cwd,
      env: { ...process.env, ...env },
      name: terminalName,
      agentId,
      verbatimArgs,
      onExit: (code) => {
        // Auto-remove from registry on natural exit (success or failure)
        if (registry.getSpawnedAgent(agentId)) {
          registry.untrackAgent(agentId);
        }

        // On failure, parse stream-json stdout for actionable errors
        if (code !== 0 && code !== null) {
          const failure = parseStreamJsonFailure(handle.getStdoutTail());
          const ch = agentOutputChannel();
          ch.appendLine(`[${agentId}] failure analysis: auth=${failure.authFailed}, apiStatus=${failure.apiStatus}, msg=${failure.errorMessage}`);

          if (failure.authFailed) {
            const msg = 'Claude Code authentication expired. Re-authenticate in a terminal, then retry the spawn.';
            vscode.window.showWarningMessage(msg, 'Open Claude Terminal').then((choice) => {
              if (choice === 'Open Claude Terminal') {
                // Open an interactive terminal so the user can re-authenticate
                const authTerminal = vscode.window.createTerminal({ name: '\u{1F511} Claude Auth', cwd });
                authTerminal.sendText(`"${resolved.fullPath}" --version`);
                authTerminal.show();
              }
            });
          } else if (failure.errorMessage) {
            vscode.window.showErrorMessage(`Claude Code agent failed: ${failure.errorMessage}`);
          } else {
            vscode.window.showErrorMessage(`Claude Code agent exited with code ${code}. Check "Event Horizon — Agents" output for details.`);
          }
        }
      },
    });
    const { terminal, process: child, pid } = handle;

    // Apply focus setting
    const focusSetting = vscode.workspace.getConfiguration('eventHorizon').get<string>('spawnTerminalFocus', 'focus-on-interaction');
    if (focusSetting === 'focus') {
      terminal.show();
    }

    this.registry.trackAgent(agentId, {
      type: this.type,
      terminalName,
      terminal,
      role: opts.role ?? 'worker',
      taskId: opts.taskId ?? '',
      spawnedAt: Date.now(),
      process: child,
      pid,
    });

    return {
      agentId,
      type: this.type,
      status: 'spawned',
      message: `Claude Code agent spawned in terminal "${terminalName}"`,
      terminalName,
      pid,
    };
  }

  async stop(_agentId: string): Promise<void> {
    // Real process termination is handled centrally in SpawnRegistry.stop()
    // via killChildProcess(). Nothing to do at the backend level.
  }

  async resume(agentId: string, sessionId: string, prompt: string): Promise<SpawnResult> {
    const terminalName = `\u2600\uFE0F Claude \u2014 Resume (${sessionId.slice(0, 8)})`;
    const resolved = await resolveCommand('claude');
    if (!resolved) {
      return { agentId, type: this.type, status: 'unavailable', message: 'claude CLI is not available in PATH' };
    }

    const args: string[] = [
      '--resume', sessionId,
      '-p', prompt,
      '--verbose', '--output-format', 'stream-json',
      '--allowedTools', 'Edit,Write,Read,Grep,Glob,Bash,NotebookEdit,Skill,mcp__event-horizon__*',
    ];

    const token = this.getAuthToken();
    const env: Record<string, string> = {
      EH_AGENT_ID: agentId,
      EH_API_URL: `http://127.0.0.1:${this.serverPort}`,
      ...(token ? { EH_AUTH_TOKEN: token } : {}),
    };

    logSpawn(agentId, resolved, args, undefined);

    const registry = this.registry;
    const { terminal, process: child, pid } = spawnWithTerminal(resolved.bin, [...resolved.prefix, ...args], {
      env: { ...process.env, ...env },
      name: terminalName,
      agentId,
      onExit: () => {
        if (registry.getSpawnedAgent(agentId)) {
          registry.untrackAgent(agentId);
        }
      },
    });

    this.registry.trackAgent(agentId, {
      type: this.type,
      terminalName,
      terminal,
      role: 'worker',
      taskId: '',
      spawnedAt: Date.now(),
      process: child,
      pid,
    });

    return {
      agentId,
      type: this.type,
      status: 'spawned',
      message: `Claude Code agent resumed session ${sessionId}`,
      terminalName,
      pid,
    };
  }
}

// ── OpenCode Spawner ───────────────────────────────────────────────────────

export class OpenCodeSpawner implements SpawnBackend {
  type = 'opencode';
  private registry: SpawnRegistry;
  private serverPort: number;
  private getAuthToken: () => string | null;

  constructor(registry: SpawnRegistry, serverPort: number, getAuthToken: () => string | null) {
    this.registry = registry;
    this.serverPort = serverPort;
    this.getAuthToken = getAuthToken;
  }

  async isAvailable(): Promise<boolean> {
    if ((await resolveCommand('opencode')) !== null) return true;
    return (await resolveCommand('crush')) !== null;
  }

  async spawn(opts: SpawnOpts): Promise<SpawnResult> {
    const agentId = `opencode-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const terminalName = `\uD83C\uDF3F OpenCode \u2014 ${opts.role ?? 'Worker'} (${opts.taskId ?? 'general'})`;

    // Prefer `opencode`, fall back to `crush` — resolve whichever is on PATH.
    const resolved = (await resolveCommand('opencode')) ?? (await resolveCommand('crush'));
    if (!resolved) {
      return { agentId, type: this.type, status: 'unavailable', message: 'opencode/crush CLI is not available in PATH' };
    }

    const args: string[] = ['-p', opts.prompt, '-f', 'json', '-q'];

    const token = this.getAuthToken();
    const env: Record<string, string> = {
      EH_AGENT_ID: agentId,
      EH_API_URL: `http://127.0.0.1:${this.serverPort}`,
      ...(token ? { EH_AUTH_TOKEN: token } : {}),
      ...(opts.planId ? { EH_PLAN_ID: opts.planId } : {}),
      ...(opts.taskId ? { EH_TASK_ID: opts.taskId } : {}),
      ...opts.envVars,
    };
    const cwd = opts.cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    logSpawn(agentId, resolved, args, cwd);

    const registry = this.registry;
    const { args: finalArgs, verbatimArgs } = buildFinalArgs(resolved, args);
    const handle = spawnWithTerminal(resolved.bin, finalArgs, {
      cwd,
      env: { ...process.env, ...env },
      name: terminalName,
      agentId,
      verbatimArgs,
      onExit: (code) => {
        if (registry.getSpawnedAgent(agentId)) {
          registry.untrackAgent(agentId);
        }
        if (code !== 0 && code !== null) {
          const tail = handle.getStdoutTail();
          const ch = agentOutputChannel();
          ch.appendLine(`[${agentId}] exited ${code}, stdout tail: ${tail.slice(-500)}`);
          vscode.window.showErrorMessage(`OpenCode agent exited with code ${code}. Check "Event Horizon — Agents" output for details.`);
        }
      },
    });
    const { terminal, process: child, pid } = handle;

    const focusSetting = vscode.workspace.getConfiguration('eventHorizon').get<string>('spawnTerminalFocus', 'focus-on-interaction');
    if (focusSetting === 'focus') {
      terminal.show();
    }

    this.registry.trackAgent(agentId, {
      type: this.type,
      terminalName,
      terminal,
      role: opts.role ?? 'worker',
      taskId: opts.taskId ?? '',
      spawnedAt: Date.now(),
      process: child,
      pid,
    });

    return {
      agentId,
      type: this.type,
      status: 'spawned',
      message: `OpenCode agent spawned in terminal "${terminalName}"`,
      terminalName,
      pid,
    };
  }

  async stop(_agentId: string): Promise<void> {
    // Real process termination handled centrally in SpawnRegistry.stop().
  }
}

// ── Cursor Spawner ─────────────────────────────────────────────────────────

export class CursorSpawner implements SpawnBackend {
  type = 'cursor';
  private registry: SpawnRegistry;
  private serverPort: number;
  private getAuthToken: () => string | null;

  constructor(registry: SpawnRegistry, serverPort: number, getAuthToken: () => string | null) {
    this.registry = registry;
    this.serverPort = serverPort;
    this.getAuthToken = getAuthToken;
  }

  async isAvailable(): Promise<boolean> {
    return (await resolveCommand('cursor')) !== null;
  }

  async spawn(opts: SpawnOpts): Promise<SpawnResult> {
    // Auto-setup hooks if not already installed
    try {
      const { isCursorHooksInstalled, setupCursorHooks, registerCursorMcpServer, syncCursorAgents } = await import('./setupCursorHooks.js');
      if (!(await isCursorHooksInstalled())) {
        await setupCursorHooks();
        await registerCursorMcpServer();
      }
      await syncCursorAgents();
    } catch { /* setup failed — continue with spawn */ }

    const agentId = `cursor-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const terminalName = `\uD83D\uDC8E Cursor \u2014 ${opts.role ?? 'Worker'} (${opts.taskId ?? 'general'})`;

    const resolved = await resolveCommand('cursor');
    if (!resolved) {
      return { agentId, type: this.type, status: 'unavailable', message: 'cursor CLI is not available in PATH' };
    }

    const args: string[] = ['--cli', '-p', opts.prompt];

    const token = this.getAuthToken();
    const env: Record<string, string> = {
      EH_AGENT_ID: agentId,
      EH_API_URL: `http://127.0.0.1:${this.serverPort}`,
      ...(token ? { EH_AUTH_TOKEN: token } : {}),
      ...(opts.planId ? { EH_PLAN_ID: opts.planId } : {}),
      ...(opts.taskId ? { EH_TASK_ID: opts.taskId } : {}),
      ...opts.envVars,
    };
    const cwd = opts.cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    logSpawn(agentId, resolved, args, cwd);

    const registry = this.registry;
    const { args: finalArgs, verbatimArgs } = buildFinalArgs(resolved, args);
    const handle = spawnWithTerminal(resolved.bin, finalArgs, {
      cwd,
      env: { ...process.env, ...env },
      name: terminalName,
      agentId,
      verbatimArgs,
      onExit: (code) => {
        if (registry.getSpawnedAgent(agentId)) {
          registry.untrackAgent(agentId);
        }
        if (code !== 0 && code !== null) {
          const tail = handle.getStdoutTail();
          const ch = agentOutputChannel();
          ch.appendLine(`[${agentId}] exited ${code}, stdout tail: ${tail.slice(-500)}`);
          vscode.window.showErrorMessage(`Cursor agent exited with code ${code}. Check "Event Horizon — Agents" output for details.`);
        }
      },
    });
    const { terminal, process: child, pid } = handle;

    const focusSetting = vscode.workspace.getConfiguration('eventHorizon').get<string>('spawnTerminalFocus', 'focus-on-interaction');
    if (focusSetting === 'focus') {
      terminal.show();
    }

    this.registry.trackAgent(agentId, {
      type: this.type,
      terminalName,
      terminal,
      role: opts.role ?? 'worker',
      taskId: opts.taskId ?? '',
      spawnedAt: Date.now(),
      process: child,
      pid,
    });

    return {
      agentId,
      type: this.type,
      status: 'spawned',
      message: `Cursor agent spawned in terminal "${terminalName}"`,
      terminalName,
      pid,
    };
  }

  async stop(_agentId: string): Promise<void> {
    // Real process termination handled centrally in SpawnRegistry.stop().
  }
}
