/**
 * Spawn Registry — manages spawning AI agents in VS Code terminals.
 * Supports Claude Code, OpenCode, and Cursor via pluggable backends.
 */

import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

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
  pid?: number;
}

// ── Utility: shell-safe prompt handling ──────────────────────────────────────

/**
 * Write a prompt string to a temp file and return a shell fragment that reads it.
 * This avoids shell escaping issues entirely — PowerShell and bash interpret
 * inline quotes differently, so long prompts with special characters (negative
 * numbers like -93.7474, JSON, quotes) break when escaped inline.
 */
async function writePromptFile(prompt: string, id: string): Promise<{ filePath: string; readFragment: string; cleanup: string }> {
  const filePath = path.join(os.tmpdir(), `eh-prompt-${id}.txt`);
  await fsp.writeFile(filePath, prompt, 'utf8');
  if (process.platform === 'win32') {
    // PowerShell: read file via .NET, single-quoted path avoids expansion
    const escaped = filePath.replace(/'/g, "''");
    return {
      filePath,
      readFragment: `([System.IO.File]::ReadAllText('${escaped}'))`,
      cleanup: `; Remove-Item '${escaped}' -ErrorAction SilentlyContinue`,
    };
  }
  // Bash: command substitution with cat
  const escaped = filePath.replace(/'/g, "'\\''");
  return {
    filePath,
    readFragment: `"$(cat '${escaped}')"`,
    cleanup: `; rm -f '${escaped}'`,
  };
}

/** Escape a short, controlled string for use in a shell argument (role names, etc.). */
function shellQuote(s: string): string {
  if (process.platform === 'win32') {
    // PowerShell: single-quote with '' for literal quotes
    return `'${s.replace(/'/g, "''")}'`;
  }
  // Bash: single-quote with '\'' for literal quotes
  return `'${s.replace(/'/g, "'\\''")}'`;
}

// ── Utility: check if command exists in PATH ────────────────────────────────

async function commandExists(cmd: string): Promise<boolean> {
  // cmd is always a hardcoded binary name (claude, opencode, cursor), not user input
  return new Promise((resolve) => {
    const which = process.platform === 'win32' ? 'where' : 'which';
    cp.execFile(which, [cmd], (err) => {
      resolve(!err);
    });
  });
}

// ── Spawn Registry ─────────────────────────────────────────────────────────

export class SpawnRegistry {
  private backends = new Map<string, SpawnBackend>();
  private spawnedAgents = new Map<string, SpawnedAgentInfo>();
  private disposables: vscode.Disposable[] = [];

  constructor() {
    // Track terminal close events
    this.disposables.push(
      vscode.window.onDidCloseTerminal((terminal) => {
        for (const [agentId, info] of this.spawnedAgents) {
          if (info.terminal === terminal) {
            this.spawnedAgents.delete(agentId);
            break;
          }
        }
      }),
    );
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
    const backend = this.backends.get(info.type);
    if (backend) {
      await backend.stop(agentId);
    } else {
      info.terminal.dispose();
    }
    this.spawnedAgents.delete(agentId);
    return { stopped: true, message: `Agent ${agentId} stopped` };
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
    return commandExists('claude');
  }

  async spawn(opts: SpawnOpts): Promise<SpawnResult> {
    const agentId = `claude-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const terminalName = `\u2600\uFE0F Claude \u2014 ${opts.role ?? 'Worker'} (${opts.taskId ?? 'general'})`;

    // Write prompt to temp file to avoid shell escaping issues
    const pf = await writePromptFile(opts.prompt, agentId);

    // Build command — --verbose is required when using -p with --output-format stream-json
    const parts = ['claude', '-p', pf.readFragment, '--verbose', '--output-format', 'stream-json'];
    if (opts.model) parts.push('--model', opts.model);
    if (opts.role) {
      parts.push('--append-system-prompt', shellQuote(`You are assigned the ${opts.role} role. Follow role-specific instructions from Event Horizon.`));
    }

    const token = this.getAuthToken();
    const env: Record<string, string> = {
      EH_AGENT_ID: agentId,
      EH_API_URL: `http://127.0.0.1:${this.serverPort}`,
      ...(token ? { EH_AUTH_TOKEN: token } : {}),
      ...(opts.planId ? { EH_PLAN_ID: opts.planId } : {}),
      ...(opts.taskId ? { EH_TASK_ID: opts.taskId } : {}),
      ...opts.envVars,
    };

    const terminal = vscode.window.createTerminal({
      name: terminalName,
      cwd: opts.cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      env,
    });

    const command = parts.join(' ') + pf.cleanup;
    terminal.sendText(command);

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
    });

    return {
      agentId,
      type: this.type,
      status: 'spawned',
      message: `Claude Code agent spawned in terminal "${terminalName}"`,
      terminalName,
    };
  }

  async stop(agentId: string): Promise<void> {
    const info = this.registry.getSpawnedAgent(agentId);
    if (info?.terminal) {
      info.terminal.dispose();
    }
  }

  async resume(agentId: string, sessionId: string, prompt: string): Promise<SpawnResult> {
    const terminalName = `\u2600\uFE0F Claude \u2014 Resume (${sessionId.slice(0, 8)})`;
    const pf = await writePromptFile(prompt, agentId);
    const parts = ['claude', '--resume', sessionId, '-p', pf.readFragment, '--verbose', '--output-format', 'stream-json'];

    const token = this.getAuthToken();
    const env: Record<string, string> = {
      EH_AGENT_ID: agentId,
      EH_API_URL: `http://127.0.0.1:${this.serverPort}`,
      ...(token ? { EH_AUTH_TOKEN: token } : {}),
    };

    const terminal = vscode.window.createTerminal({ name: terminalName, env });
    terminal.sendText(parts.join(' ') + pf.cleanup);

    this.registry.trackAgent(agentId, {
      type: this.type,
      terminalName,
      terminal,
      role: 'worker',
      taskId: '',
      spawnedAt: Date.now(),
    });

    return {
      agentId,
      type: this.type,
      status: 'spawned',
      message: `Claude Code agent resumed session ${sessionId}`,
      terminalName,
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
    const hasOpenCode = await commandExists('opencode');
    if (hasOpenCode) return true;
    return commandExists('crush');
  }

  async spawn(opts: SpawnOpts): Promise<SpawnResult> {
    const agentId = `opencode-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const terminalName = `\uD83C\uDF3F OpenCode \u2014 ${opts.role ?? 'Worker'} (${opts.taskId ?? 'general'})`;

    const hasOpenCode = await commandExists('opencode');
    const cmd = hasOpenCode ? 'opencode' : 'crush';

    const pf = await writePromptFile(opts.prompt, agentId);
    const parts = [cmd, '-p', pf.readFragment, '-f', 'json', '-q'];

    const token = this.getAuthToken();
    const env: Record<string, string> = {
      EH_AGENT_ID: agentId,
      EH_API_URL: `http://127.0.0.1:${this.serverPort}`,
      ...(token ? { EH_AUTH_TOKEN: token } : {}),
      ...(opts.planId ? { EH_PLAN_ID: opts.planId } : {}),
      ...(opts.taskId ? { EH_TASK_ID: opts.taskId } : {}),
      ...opts.envVars,
    };

    const terminal = vscode.window.createTerminal({
      name: terminalName,
      cwd: opts.cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      env,
    });

    terminal.sendText(parts.join(' ') + pf.cleanup);

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
    });

    return {
      agentId,
      type: this.type,
      status: 'spawned',
      message: `OpenCode agent spawned in terminal "${terminalName}"`,
      terminalName,
    };
  }

  async stop(agentId: string): Promise<void> {
    const info = this.registry.getSpawnedAgent(agentId);
    if (info?.terminal) {
      info.terminal.dispose();
    }
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
    return commandExists('cursor');
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

    const pf = await writePromptFile(opts.prompt, agentId);
    const parts = ['cursor', '--cli', '-p', pf.readFragment];

    const token = this.getAuthToken();
    const env: Record<string, string> = {
      EH_AGENT_ID: agentId,
      EH_API_URL: `http://127.0.0.1:${this.serverPort}`,
      ...(token ? { EH_AUTH_TOKEN: token } : {}),
      ...(opts.planId ? { EH_PLAN_ID: opts.planId } : {}),
      ...(opts.taskId ? { EH_TASK_ID: opts.taskId } : {}),
      ...opts.envVars,
    };

    const terminal = vscode.window.createTerminal({
      name: terminalName,
      cwd: opts.cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      env,
    });

    terminal.sendText(parts.join(' ') + pf.cleanup);

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
    });

    return {
      agentId,
      type: this.type,
      status: 'spawned',
      message: `Cursor agent spawned in terminal "${terminalName}"`,
      terminalName,
    };
  }

  async stop(agentId: string): Promise<void> {
    const info = this.registry.getSpawnedAgent(agentId);
    if (info?.terminal) {
      info.terminal.dispose();
    }
  }
}
