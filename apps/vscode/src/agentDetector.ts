/**
 * AgentDetector — scans the user's PATH for installed AI agent CLIs (claude,
 * opencode, cursor) and reports which ones are available + whether their
 * Event Horizon hooks are configured.
 *
 * Used on extension activation to offer a one-click hook setup when an agent
 * CLI is detected without hooks.
 */

import * as cp from 'child_process';
import * as os from 'os';

export type DetectedAgentType = 'claude-code' | 'opencode' | 'cursor' | 'copilot';

export interface DetectedAgent {
  type: DetectedAgentType;
  /** Display name shown in user-facing notifications. */
  name: string;
  /** Resolved absolute path to the CLI binary, or '(vscode-extension)' for Copilot. */
  path: string;
  /** Optional version string parsed from `<cli> --version` (best-effort). */
  version?: string;
  /** True if EH hooks are already configured for this agent. */
  hookConfigured: boolean;
}

/** Run `which <cmd>` (Unix) / `where <cmd>` (Windows) and return the first line of output, or null if not found. */
function whichSync(cmd: string): string | null {
  const whichCmd = os.platform() === 'win32' ? 'where' : 'which';
  try {
    const out = cp.execSync(`${whichCmd} ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', timeout: 3000 });
    const line = out.split(/\r?\n/).find((l) => l.trim().length > 0);
    return line ? line.trim() : null;
  } catch {
    return null;
  }
}

/** Run `<cli> --version` and return the trimmed first-line output, or undefined. */
function tryVersion(cmd: string): string | undefined {
  try {
    const out = cp.execSync(`${cmd} --version`, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', timeout: 3000 });
    const line = out.split(/\r?\n/).find((l) => l.trim().length > 0);
    return line?.trim();
  } catch {
    return undefined;
  }
}

export interface AgentDetectorDeps {
  isClaudeCodeHooksInstalled: () => Promise<boolean>;
  isOpenCodeHooksInstalled: () => Promise<boolean>;
  isCopilotHooksInstalled: () => Promise<boolean>;
  isCursorHooksInstalled: () => Promise<boolean>;
  /** Optional injection for tests — defaults to live `whichSync`. */
  whichFn?: (cmd: string) => string | null;
  /** Optional injection for tests — defaults to live `tryVersion`. */
  versionFn?: (cmd: string) => string | undefined;
  /** Whether the GitHub.copilot extension is installed (caller resolves via vscode.extensions API). */
  copilotExtensionInstalled: boolean;
}

export class AgentDetector {
  constructor(private deps: AgentDetectorDeps) {}

  /** Detect all installed agent CLIs + check hook config status. */
  async detect(): Promise<DetectedAgent[]> {
    const w = this.deps.whichFn ?? whichSync;
    const v = this.deps.versionFn ?? tryVersion;
    const found: DetectedAgent[] = [];

    // Claude Code
    const claudePath = w('claude');
    if (claudePath) {
      found.push({
        type: 'claude-code',
        name: 'Claude Code',
        path: claudePath,
        version: v('claude'),
        hookConfigured: await this.deps.isClaudeCodeHooksInstalled(),
      });
    }

    // OpenCode
    const opencodePath = w('opencode');
    if (opencodePath) {
      found.push({
        type: 'opencode',
        name: 'OpenCode',
        path: opencodePath,
        version: v('opencode'),
        hookConfigured: await this.deps.isOpenCodeHooksInstalled(),
      });
    }

    // Cursor
    const cursorPath = w('cursor');
    if (cursorPath) {
      found.push({
        type: 'cursor',
        name: 'Cursor',
        path: cursorPath,
        version: v('cursor'),
        hookConfigured: await this.deps.isCursorHooksInstalled(),
      });
    }

    // Copilot — detected via VS Code extension API, not PATH
    if (this.deps.copilotExtensionInstalled) {
      found.push({
        type: 'copilot',
        name: 'GitHub Copilot',
        path: '(vscode-extension)',
        hookConfigured: await this.deps.isCopilotHooksInstalled(),
      });
    }

    return found;
  }

  /** Subset of detected agents that are installed but missing hooks. */
  async detectUnconfigured(): Promise<DetectedAgent[]> {
    const all = await this.detect();
    return all.filter((a) => !a.hookConfigured);
  }
}
