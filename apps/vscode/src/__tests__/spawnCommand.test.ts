/**
 * Tests for cross-platform command resolution and argv-style spawn assembly.
 * Covers the fix for the "terminal process terminated with exit code 1" bug
 * that happened when PowerShell-only command strings were passed to cmd.exe.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ClaudeCodeSpawner, resolveCommand, type SpawnOpts } from '../spawnRegistry.js';

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, execFile: vi.fn(actual.execFile) };
});

import { execFile } from 'child_process';

function baseOpts(overrides: Partial<SpawnOpts> = {}): SpawnOpts {
  return {
    prompt: 'hello world',
    ...overrides,
  };
}

describe('ClaudeCodeSpawner.buildArgs — batch mode', () => {
  it('passes the prompt as a literal argv element (not a shell fragment)', () => {
    const args = ClaudeCodeSpawner.buildArgs(baseOpts({ prompt: 'test prompt' }), 'batch');
    const idx = args.indexOf('-p');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe('test prompt');
  });

  it('preserves prompts that would have broken shell escaping (quotes, parens, backticks)', () => {
    const nasty = `prompt with "double" 'single' $(subshell) \`backticks\` and [brackets] — negative -93.7474 values`;
    const args = ClaudeCodeSpawner.buildArgs(baseOpts({ prompt: nasty }), 'batch');
    const idx = args.indexOf('-p');
    expect(args[idx + 1]).toBe(nasty);
  });

  it('includes --verbose and --output-format stream-json for batch mode', () => {
    const args = ClaudeCodeSpawner.buildArgs(baseOpts(), 'batch');
    expect(args).toContain('--verbose');
    const ofIdx = args.indexOf('--output-format');
    expect(args[ofIdx + 1]).toBe('stream-json');
  });

  it('passes --allowedTools as a single unquoted argv element', () => {
    const args = ClaudeCodeSpawner.buildArgs(baseOpts(), 'batch');
    const idx = args.indexOf('--allowedTools');
    expect(idx).toBeGreaterThanOrEqual(0);
    // Must NOT be wrapped in single quotes or otherwise shell-escaped — that was the old behavior
    expect(args[idx + 1]).toBe('Edit,Write,Read,Grep,Glob,Bash,NotebookEdit,Skill,mcp__event-horizon__*');
    expect(args[idx + 1].startsWith("'")).toBe(false);
  });

  it('includes --model when provided', () => {
    const args = ClaudeCodeSpawner.buildArgs(baseOpts({ model: 'claude-opus-4-6' }), 'batch');
    const idx = args.indexOf('--model');
    expect(args[idx + 1]).toBe('claude-opus-4-6');
  });

  it('does NOT include --model when not provided', () => {
    const args = ClaudeCodeSpawner.buildArgs(baseOpts(), 'batch');
    expect(args).not.toContain('--model');
  });

  it('includes role-scoped system prompt when role is provided, unquoted', () => {
    const args = ClaudeCodeSpawner.buildArgs(baseOpts({ role: 'implementer' }), 'batch');
    const idx = args.indexOf('--append-system-prompt');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toContain('implementer');
    expect(args[idx + 1].startsWith("'")).toBe(false);
  });
});

describe('ClaudeCodeSpawner.buildArgs — interactive mode', () => {
  it('passes the prompt as a positional arg, no -p flag', () => {
    const args = ClaudeCodeSpawner.buildArgs(baseOpts({ prompt: 'start here' }), 'interactive');
    expect(args[0]).toBe('start here');
    expect(args).not.toContain('-p');
  });

  it('omits --verbose and --output-format so the REPL stays human-readable', () => {
    const args = ClaudeCodeSpawner.buildArgs(baseOpts(), 'interactive');
    expect(args).not.toContain('--verbose');
    expect(args).not.toContain('--output-format');
  });

  it('still pre-authorizes tools so the interactive agent can edit without prompts', () => {
    const args = ClaudeCodeSpawner.buildArgs(baseOpts(), 'interactive');
    expect(args).toContain('--allowedTools');
  });
});

describe('resolveCommand — Windows shim preference', () => {
  const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;

  afterEach(() => { vi.restoreAllMocks(); });

  it('prefers .cmd over extensionless file when where returns both', async () => {
    // Simulate Windows
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32' as NodeJS.Platform);
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: any) => {
      cb(null, 'C:\\Program Files\\nodejs\\opencode\r\nC:\\Program Files\\nodejs\\opencode.cmd\r\n', '');
      return {} as any;
    });

    const result = await resolveCommand('opencode');
    expect(result).not.toBeNull();
    expect(result!.fullPath).toBe('C:\\Program Files\\nodejs\\opencode.cmd');
    expect(result!.bin).toBe('cmd.exe');
    expect(result!.prefix).toContain('C:\\Program Files\\nodejs\\opencode.cmd');
  });

  it('prefers .exe over extensionless file on Windows', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32' as NodeJS.Platform);
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: any) => {
      cb(null, 'C:\\tools\\mytool\r\nC:\\tools\\mytool.exe\r\n', '');
      return {} as any;
    });

    const result = await resolveCommand('mytool');
    expect(result).not.toBeNull();
    expect(result!.fullPath).toBe('C:\\tools\\mytool.exe');
    // .exe is not a shim — no wrapping
    expect(result!.bin).toBe('C:\\tools\\mytool.exe');
    expect(result!.prefix).toEqual([]);
  });

  it('falls back to extensionless file if no Windows-executable extension found', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32' as NodeJS.Platform);
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: any) => {
      cb(null, 'C:\\tools\\mytool\r\n', '');
      return {} as any;
    });

    const result = await resolveCommand('mytool');
    expect(result).not.toBeNull();
    expect(result!.fullPath).toBe('C:\\tools\\mytool');
    expect(result!.bin).toBe('C:\\tools\\mytool');
  });

  it('does not apply Windows preference logic on non-Windows platforms', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux' as NodeJS.Platform);
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: any) => {
      cb(null, '/usr/bin/opencode\n', '');
      return {} as any;
    });

    const result = await resolveCommand('opencode');
    expect(result).not.toBeNull();
    expect(result!.fullPath).toBe('/usr/bin/opencode');
    expect(result!.bin).toBe('/usr/bin/opencode');
    expect(result!.prefix).toEqual([]);
  });
});

describe('argv contains no shell metacharacters that could fail in a non-shell spawn', () => {
  it('no argv element wraps content in shell substitution syntax', () => {
    const args = ClaudeCodeSpawner.buildArgs(
      baseOpts({
        prompt: 'normal prompt',
        role: 'implementer',
        model: 'claude-opus-4-6',
      }),
      'batch',
    );
    for (const arg of args) {
      // Shell syntax that broke cmd.exe:
      expect(arg.startsWith('([System.IO.File]::')).toBe(false);
      expect(arg.startsWith('$(cat')).toBe(false);
      expect(arg).not.toMatch(/^'.*'$/); // legacy single-quote wrapping
    }
  });
});
