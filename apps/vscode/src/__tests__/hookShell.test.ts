/**
 * Hook shell tests — Windows without Git Bash gets PowerShell hooks, everyone
 * else keeps the fast POSIX commands, nothing requires bash, and the lock
 * check behaves the same in both scripts (run for real against a local server).
 */

import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { spawn, spawnSync } from 'child_process';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { __hookTestables, detectHookShell, buildLockCheckSh, buildLockCheckPs1, buildHookPs1 } from '../setupHooks.js';

const { expectedCommandFor, isCurrentEhHook, isEhHook, setHookShell } = __hookTestables;

afterAll(() => setHookShell(null));

describe('registered hook events', () => {
  it('includes the events adopted in 3.3.0', () => {
    const events = __hookTestables.hookEvents as readonly string[];
    for (const e of ['StopFailure', 'PostCompact', 'PermissionDenied', 'PostModelSwitch']) expect(events).toContain(e);
    expect(events).toHaveLength(22);
    // High-volume or consumer-less events stay out.
    for (const e of ['MessageDisplay', 'FileChanged', 'Elicitation', 'ElicitationResult']) expect(events).not.toContain(e);
  });
});

describe('detectHookShell', () => {
  it('uses PowerShell only on Windows without Git Bash', () => {
    expect(detectHookShell('win32', () => null)).toBe('powershell');
    expect(detectHookShell('win32', () => 'C:\\Program Files\\Git\\bin\\bash.exe')).toBe('posix');
    expect(detectHookShell('linux', () => null)).toBe('posix');
    expect(detectHookShell('darwin', () => null)).toBe('posix');
  });
});

describe('hook commands per shell', () => {
  it('PowerShell mode runs scripts for every event and uses no bash or POSIX operators', () => {
    setHookShell('powershell');
    for (const event of ['Stop', 'PreToolUse', 'UserPromptSubmit', 'SessionStart']) {
      const cmd = expectedCommandFor(event);
      expect(cmd).toMatch(/^powershell -NoProfile -ExecutionPolicy Bypass -File "/);
      expect(cmd).not.toMatch(/\bbash\b|\|\| true|\/dev\/null|\\/);
      expect(isEhHook({ command: cmd })).toBe(true);
    }
    expect(expectedCommandFor('PreToolUse')).toContain('eh-lock-check.ps1');
    expect(expectedCommandFor('UserPromptSubmit')).toMatch(/eh-hook\.ps1" -Inbox$/);
    expect(expectedCommandFor('Stop')).toMatch(/eh-hook\.ps1"$/);
  });

  it('POSIX mode runs the lock check with sh, not bash', () => {
    setHookShell('posix');
    const cmd = expectedCommandFor('PreToolUse');
    expect(cmd).toMatch(/^sh ".*eh-lock-check\.sh"$/);
    expect(cmd).not.toMatch(/\bbash\b/);
  });

  it('treats the 3.2.0 bash lock hook as stale so upgrades replace it', () => {
    setHookShell('posix');
    const old = { type: 'command', command: 'bash "C:/Users/me/.event-horizon/eh-lock-check.sh"' };
    expect(isEhHook(old)).toBe(true);
    expect(isCurrentEhHook(old, 'PreToolUse')).toBe(false);
  });

  it('switching shells makes the other shape stale, so hooks follow Git Bash being added or removed', () => {
    setHookShell('powershell');
    const ps = { type: 'command', command: expectedCommandFor('Stop') };
    setHookShell('posix');
    expect(isCurrentEhHook(ps, 'Stop')).toBe(false);
  });
});

describe('generated scripts never require bash', () => {
  it('sh lock check is POSIX', () => {
    const sh = buildLockCheckSh(28765, 'tok');
    expect(sh.startsWith('#!/bin/sh\n')).toBe(true);
    expect(sh).not.toContain('echo "$PAYLOAD"');
  });
});

// ── End to end ──────────────────────────────────────────────────────────────

let server: http.Server;
let port: number;
let lockAllowed = true;
const hits: Array<{ url: string; auth?: string; body: string }> = [];

beforeAll(() => new Promise<void>((resolve) => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const body = Buffer.concat(chunks).toString('utf8');
      hits.push({ url: req.url ?? '', auth: req.headers.authorization, body });
      if (req.url === '/lock') {
        res.statusCode = lockAllowed ? 200 : 409;
        res.end(JSON.stringify(lockAllowed ? { allowed: true } : { allowed: false, owner: 'Reviewer' }));
      } else if (req.url === '/claude/inbox') {
        res.end('[Event Horizon] You have 1 unread message from reviewer.');
      } else {
        res.end('');
      }
    });
  });
  server.listen(0, '127.0.0.1', () => { port = (server.address() as { port: number }).port; resolve(); });
}));
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

// A JSON payload with an escaped newline: dash's echo would turn \n into a real newline.
const EDIT = JSON.stringify({ session_id: 's1', cwd: '/w/proj', tool_name: 'Edit', tool_input: { file_path: '/w/proj/a.ts', new_string: 'x\ny' } });
const BASH_TOOL = JSON.stringify({ session_id: 's1', tool_name: 'Bash', tool_input: { command: 'ls' } });

const canSh = spawnSync('sh', ['-c', 'command -v curl >/dev/null'], { encoding: 'utf8' }).status === 0;
const canPs = process.platform === 'win32' && spawnSync('powershell', ['-NoProfile', '-Command', 'exit 0']).status === 0;

let dir: string;
beforeEach(() => { hits.length = 0; lockAllowed = true; dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-hook-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

// Async on purpose: spawnSync would block the event loop, so the in-process
// server above could never answer the script's requests.
function run(cmd: string, args: string[], input: string): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
    child.stdin.end(input);
  });
}
function runSh(input: string) {
  const file = path.join(dir, 'check.sh');
  fs.writeFileSync(file, buildLockCheckSh(port, 'tok'), 'utf8');
  return run('sh', [file], input);
}
function runPs(script: string, input: string, args: string[] = []) {
  const file = path.join(dir, 'hook.ps1');
  fs.writeFileSync(file, '\uFEFF' + script, 'utf8');
  return run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file, ...args], input);
}

describe.skipIf(!canSh)('sh lock check (end to end)', async () => {
  it('allows an unlocked edit, posts the event unchanged and requests the lock', async () => {
    const r = await runSh(EDIT);
    expect(r.status).toBe(0);
    expect(hits.find((h) => h.url === '/claude')!.body).toBe(EDIT);
    const lock = JSON.parse(hits.find((h) => h.url === '/lock')!.body);
    expect(lock).toMatchObject({ action: 'check', filePath: '/w/proj/a.ts', agentId: 's1', agentName: 'Claude Code (proj)' });
    expect(hits.every((h) => h.auth === 'Bearer tok')).toBe(true);
  }, 60_000);

  it('blocks with exit code 2 and names the owner', async () => {
    lockAllowed = false;
    const r = await runSh(EDIT);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('BLOCKED: /w/proj/a.ts is locked by Reviewer');
  }, 60_000);

  it('skips the lock for tools without a file path', async () => {
    expect((await runSh(BASH_TOOL)).status).toBe(0);
    expect(hits.some((h) => h.url === '/lock')).toBe(false);
  }, 60_000);
});

describe.skipIf(!canPs)('PowerShell hooks (end to end)', async () => {
  it('lock check allows an unlocked edit and requests the lock', async () => {
    const r = await runPs(buildLockCheckPs1(port, 'tok'), EDIT);
    expect(r.status).toBe(0);
    expect(hits.find((h) => h.url === '/claude')!.body).toBe(EDIT);
    const lock = JSON.parse(hits.find((h) => h.url === '/lock')!.body);
    expect(lock).toMatchObject({ action: 'check', filePath: '/w/proj/a.ts', agentId: 's1', agentName: 'Claude Code (proj)' });
    expect(hits.every((h) => h.auth === 'Bearer tok')).toBe(true);
  }, 40_000);

  it('lock check blocks with exit code 2 and names the owner', async () => {
    lockAllowed = false;
    const r = await runPs(buildLockCheckPs1(port, 'tok'), EDIT);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('BLOCKED: /w/proj/a.ts is locked by Reviewer');
  }, 40_000);

  it('lock check skips tools without a file path', async () => {
    expect((await runPs(buildLockCheckPs1(port, 'tok'), BASH_TOOL)).status).toBe(0);
    expect(hits.some((h) => h.url === '/lock')).toBe(false);
  }, 40_000);

  it('generic hook posts the payload unchanged and prints nothing', async () => {
    const r = await runPs(buildHookPs1(port, 'tok'), EDIT);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(hits[0]).toMatchObject({ url: '/claude', body: EDIT, auth: 'Bearer tok' });
  }, 40_000);

  it('inbox hook prints the server reply for Claude Code to inject', async () => {
    const r = await runPs(buildHookPs1(port, 'tok'), EDIT, ['-Inbox']);
    expect(r.stdout).toBe('[Event Horizon] You have 1 unread message from reviewer.');
    expect(hits[0].url).toBe('/claude/inbox');
  }, 40_000);
});
