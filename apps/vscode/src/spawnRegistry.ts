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
}

/**
 * Resolve a command name to a spawnable binary. Returns null when the command
 * is not on PATH. Handles Windows `.cmd`/`.bat`/`.ps1` shim files transparently.
 */
export async function resolveCommand(cmd: string): Promise<ResolvedCommand | null> {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  const fullPath = await new Promise<string | null>((resolve) => {
    cp.execFile(finder, [cmd], (err, stdout) => {
      if (err) return resolve(null);
      const first = String(stdout).split(/\r?\n/).map((s) => s.trim()).find((s) => s.length > 0);
      resolve(first ?? null);
    });
  });
  if (!fullPath) return null;

  if (process.platform === 'win32') {
    const lower = fullPath.toLowerCase();
    if (lower.endsWith('.cmd') || lower.endsWith('.bat')) {
      return { bin: 'cmd.exe', prefix: ['/d', '/s', '/c', fullPath], fullPath };
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
  });

  const toTerm = (buf: Buffer | string): string => {
    // VS Code pseudoterminal expects \r\n line endings
    const s = typeof buf === 'string' ? buf : buf.toString('utf8');
    return s.replace(/\r?\n/g, '\r\n');
  };

  child.stdout?.on('data', (d) => writeEmitter.fire(toTerm(d)));
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

  return { terminal, process: child, pid: child.pid };
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
  private disposables: vscode.Disposable[] = [];
  private changeListeners: Array<() => void> = [];

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
            break;
          }
        }
      }),
    );
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

  async stop(agentId: string): Promise<{ stopped: boolean; message: string }> {
    const info = this.spawnedAgents.get(agentId);
    if (!info) {
      // Try backends
      for (const backend of this.backends.values()) {
        try {
          await backend.stop(agentId);
          return { stopped: true, message: `Agent ${agentId} stopped` };
        } catch { /* continue */ }
      }
      return { stopped: false, message: `Agent ${agentId} not found in spawn registry` };
    }

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
    this.notifyChange();
    const msg = processKilled
      ? `Agent ${agentId} stopped`
      : `Agent ${agentId} stopped (process may still be running — check tasklist/ps)`;
    return { stopped: processKilled, message: msg };
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
    if (this.spawnedAgents.delete(agentId)) {
      this.notifyChange();
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
      const terminal = vscode.window.createTerminal({
        name: terminalName,
        cwd,
        env: { ...process.env, ...env } as { [key: string]: string },
        shellPath: resolved.bin,
        shellArgs: [...resolved.prefix, ...args],
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
    const { terminal, process: child, pid } = spawnWithTerminal(resolved.bin, [...resolved.prefix, ...args], {
      cwd,
      env: { ...process.env, ...env },
      name: terminalName,
      agentId,
      onExit: () => {
        // Auto-remove from registry on natural exit (success or failure)
        if (registry.getSpawnedAgent(agentId)) {
          registry.untrackAgent(agentId);
        }
      },
    });

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
    const { terminal, process: child, pid } = spawnWithTerminal(resolved.bin, [...resolved.prefix, ...args], {
      cwd,
      env: { ...process.env, ...env },
      name: terminalName,
      agentId,
      onExit: () => {
        if (registry.getSpawnedAgent(agentId)) {
          registry.untrackAgent(agentId);
        }
      },
    });

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
    const { terminal, process: child, pid } = spawnWithTerminal(resolved.bin, [...resolved.prefix, ...args], {
      cwd,
      env: { ...process.env, ...env },
      name: terminalName,
      agentId,
      onExit: () => {
        if (registry.getSpawnedAgent(agentId)) {
          registry.untrackAgent(agentId);
        }
      },
    });

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
