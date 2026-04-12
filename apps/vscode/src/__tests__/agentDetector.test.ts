/**
 * AgentDetector tests — CLI presence + hook-status detection.
 */

import { describe, it, expect, vi } from 'vitest';
import { AgentDetector } from '../agentDetector.js';

function makeDetector(opts: {
  installed: string[];                      // commands that resolve via `which`
  hooks: { claude?: boolean; opencode?: boolean; copilot?: boolean; cursor?: boolean };
  copilotExtensionInstalled?: boolean;
}) {
  return new AgentDetector({
    whichFn: (cmd: string) => opts.installed.includes(cmd) ? `/usr/local/bin/${cmd}` : null,
    versionFn: (cmd: string) => `${cmd} 1.0.0`,
    isClaudeCodeHooksInstalled: vi.fn(async () => opts.hooks.claude ?? false),
    isOpenCodeHooksInstalled: vi.fn(async () => opts.hooks.opencode ?? false),
    isCopilotHooksInstalled: vi.fn(async () => opts.hooks.copilot ?? false),
    isCursorHooksInstalled: vi.fn(async () => opts.hooks.cursor ?? false),
    copilotExtensionInstalled: opts.copilotExtensionInstalled ?? false,
  });
}

describe('AgentDetector', () => {
  describe('detect()', () => {
    it('returns empty when no agents installed', async () => {
      const d = makeDetector({ installed: [], hooks: {} });
      const result = await d.detect();
      expect(result).toEqual([]);
    });

    it('finds claude-code when installed', async () => {
      const d = makeDetector({ installed: ['claude'], hooks: {} });
      const result = await d.detect();
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('claude-code');
      expect(result[0].name).toBe('Claude Code');
      expect(result[0].path).toBe('/usr/local/bin/claude');
      expect(result[0].version).toBe('claude 1.0.0');
      expect(result[0].hookConfigured).toBe(false);
    });

    it('finds opencode when installed', async () => {
      const d = makeDetector({ installed: ['opencode'], hooks: { opencode: true } });
      const result = await d.detect();
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('opencode');
      expect(result[0].hookConfigured).toBe(true);
    });

    it('finds cursor when installed', async () => {
      const d = makeDetector({ installed: ['cursor'], hooks: {} });
      const result = await d.detect();
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('cursor');
    });

    it('finds copilot when extension installed (not via PATH)', async () => {
      const d = makeDetector({ installed: [], hooks: { copilot: false }, copilotExtensionInstalled: true });
      const result = await d.detect();
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('copilot');
      expect(result[0].path).toBe('(vscode-extension)');
      expect(result[0].version).toBeUndefined();
    });

    it('finds all four agents when all installed', async () => {
      const d = makeDetector({
        installed: ['claude', 'opencode', 'cursor'],
        hooks: { claude: true, opencode: true, cursor: true, copilot: true },
        copilotExtensionInstalled: true,
      });
      const result = await d.detect();
      expect(result).toHaveLength(4);
      const types = result.map((a) => a.type).sort();
      expect(types).toEqual(['claude-code', 'copilot', 'cursor', 'opencode']);
      // All hooks configured
      expect(result.every((a) => a.hookConfigured)).toBe(true);
    });

    it('reports correct hook status mix', async () => {
      const d = makeDetector({
        installed: ['claude', 'opencode'],
        hooks: { claude: true, opencode: false },
      });
      const result = await d.detect();
      const claude = result.find((a) => a.type === 'claude-code');
      const opencode = result.find((a) => a.type === 'opencode');
      expect(claude?.hookConfigured).toBe(true);
      expect(opencode?.hookConfigured).toBe(false);
    });
  });

  describe('detectUnconfigured()', () => {
    it('returns only agents missing hooks', async () => {
      const d = makeDetector({
        installed: ['claude', 'opencode', 'cursor'],
        hooks: { claude: true, opencode: false, cursor: false },
      });
      const result = await d.detectUnconfigured();
      expect(result).toHaveLength(2);
      const types = result.map((a) => a.type).sort();
      expect(types).toEqual(['cursor', 'opencode']);
    });

    it('returns empty when all installed agents have hooks', async () => {
      const d = makeDetector({
        installed: ['claude'],
        hooks: { claude: true },
      });
      const result = await d.detectUnconfigured();
      expect(result).toEqual([]);
    });

    it('returns empty when no agents installed', async () => {
      const d = makeDetector({ installed: [], hooks: {} });
      const result = await d.detectUnconfigured();
      expect(result).toEqual([]);
    });
  });
});
