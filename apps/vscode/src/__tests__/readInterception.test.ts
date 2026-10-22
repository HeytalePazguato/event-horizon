/**
 * Digest interception tests — deny once then allow, freshness against disk,
 * secrets, the /lock route, and the real lock scripts passing the hook JSON
 * through to Claude Code.
 */

import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { spawn, spawnSync } from 'child_process';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ReadInterceptor, type KnowledgeLike } from '../readInterception.js';
import { handleRequest, _setAuthToken, _setCallbacks, _clearRateLimits, sharedKnowledge, setReadInterception } from '../eventServer.js';
import { buildLockCheckSh, buildLockCheckPs1 } from '../setupHooks.js';

const FILE = '/repo/src/auth.ts';
const DIGEST = '/repo/src/auth.ts (120 lines)\nexport function login()\nRead /repo/src/auth.ts for full contents.';

function interceptor(over: { entries?: KnowledgeLike[]; mtime?: number | null; secret?: boolean; enabled?: boolean; platform?: NodeJS.Platform } = {}) {
  return new ReadInterceptor({
    entries: () => over.entries ?? [{ key: FILE, value: DIGEST, updatedAt: 2_000 }],
    mtimeMs: () => (over.mtime === undefined ? 1_000 : over.mtime),
    isSecretPath: () => over.secret ?? false,
    enabled: () => over.enabled ?? true,
    platform: over.platform ?? 'linux',
    now: () => 5_000,
  });
}

describe('ReadInterceptor', () => {
  it('answers the first read with the digest as a PreToolUse deny', () => {
    const out = interceptor().decide('agent-b', FILE, 'Read');
    expect(out?.hookSpecificOutput).toMatchObject({ hookEventName: 'PreToolUse', permissionDecision: 'deny' });
    expect(out!.hookSpecificOutput.permissionDecisionReason).toContain(DIGEST);
    expect(out!.hookSpecificOutput.permissionDecisionReason).toMatch(/run Read again on the same path/);
  });

  it('lets the retry through so the file stays editable', () => {
    const i = interceptor();
    expect(i.decide('agent-b', FILE, 'Read')).not.toBeNull();
    expect(i.decide('agent-b', FILE, 'Read')).toBeNull();
    expect(i.decide('agent-b', FILE, 'Read')).toBeNull();
  });

  it('intercepts each agent once', () => {
    const i = interceptor();
    expect(i.decide('agent-b', FILE, 'Read')).not.toBeNull();
    expect(i.decide('agent-c', FILE, 'Read')).not.toBeNull();
  });

  it('intercepts again after the knowledge entry is updated', () => {
    const entries = [{ key: FILE, value: DIGEST, updatedAt: 2_000 }];
    const i = interceptor({ entries });
    i.decide('agent-b', FILE, 'Read');
    entries[0] = { ...entries[0], updatedAt: 3_000 };
    expect(i.decide('agent-b', FILE, 'Read')).not.toBeNull();
  });

  it('passes the read through when the file changed after the digest was stored', () => {
    expect(interceptor({ mtime: 9_999 }).decide('agent-b', FILE, 'Read')).toBeNull();
  });

  it('passes through when the file cannot be read, is secret, or the feature is off', () => {
    expect(interceptor({ mtime: null }).decide('agent-b', FILE, 'Read')).toBeNull();
    expect(interceptor({ secret: true }).decide('agent-b', FILE, 'Read')).toBeNull();
    expect(interceptor({ enabled: false }).decide('agent-b', FILE, 'Read')).toBeNull();
  });

  it('only intercepts reads of files that are in knowledge', () => {
    const i = interceptor();
    expect(i.decide('agent-b', FILE, 'Edit')).toBeNull();
    expect(i.decide('agent-b', FILE, undefined)).toBeNull();
    expect(i.decide('agent-b', '/repo/src/other.ts', 'Read')).toBeNull();
  });

  it('ignores expired entries', () => {
    expect(interceptor({ entries: [{ key: FILE, value: DIGEST, updatedAt: 2_000, validUntil: 4_000 }] }).decide('a', FILE, 'Read')).toBeNull();
  });

  it('matches Windows paths regardless of case and slash direction', () => {
    const i = interceptor({ platform: 'win32', entries: [{ key: 'C:/Repo/src/auth.ts', value: DIGEST, updatedAt: 2_000 }] });
    expect(i.decide('a', 'c:\\repo\\SRC\\auth.ts', 'Read')).not.toBeNull();
  });
});

// ── /lock route + real scripts ──────────────────────────────────────────────

let server: http.Server;
let port: number;
let tmp: string;
let hotFile: string;
const TOKEN = 'tok-intercept';

beforeAll(() => new Promise<void>((resolve) => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-intercept-'));
  hotFile = path.join(tmp, 'hot.ts');
  fs.writeFileSync(hotFile, 'export const x = 1;\n');
  // Make the file older than the knowledge entry written below.
  const past = new Date(Date.now() - 60_000);
  fs.utimesSync(hotFile, past, past);
  server = http.createServer(handleRequest);
  server.listen(0, '127.0.0.1', () => { port = (server.address() as { port: number }).port; resolve(); });
}));

afterAll(() => new Promise<void>((resolve) => {
  _setAuthToken(null);
  _setCallbacks(null);
  _clearRateLimits();
  sharedKnowledge.delete(hotFile, 'workspace', 'user');
  fs.rmSync(tmp, { recursive: true, force: true });
  server.close(() => resolve());
}));

let agentSeq = 0;
beforeEach(() => {
  _clearRateLimits();
  _setAuthToken(TOKEN);
  _setCallbacks({ onEvent: () => {} });
  setReadInterception(true);
  sharedKnowledge.write(hotFile, 'hot.ts digest', 'workspace', 'user', 'user');
  agentSeq++;
});

function post(body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = http.request(`http://127.0.0.1:${port}/lock`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode!, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

describe('/lock query with digest interception', () => {
  it('returns the hook JSON for the first Read and allows the retry', async () => {
    const agentId = `route-${agentSeq}`;
    const first = await post({ action: 'query', filePath: hotFile, agentId, toolName: 'Read' });
    expect(first.status).toBe(200);
    expect(Object.keys(first.json)).toEqual(['hookSpecificOutput']);
    const second = await post({ action: 'query', filePath: hotFile, agentId, toolName: 'Read' });
    expect(second.json).toMatchObject({ allowed: true });
  });

  it('old scripts that send no toolName are never intercepted', async () => {
    const res = await post({ action: 'query', filePath: hotFile, agentId: `old-${agentSeq}` });
    expect(res.json).toMatchObject({ allowed: true });
  });

  it('respects the setting', async () => {
    setReadInterception(false);
    const res = await post({ action: 'query', filePath: hotFile, agentId: `off-${agentSeq}`, toolName: 'Read' });
    expect(res.json).toMatchObject({ allowed: true });
  });
});

function run(cmd: string, args: string[], input: string): Promise<{ status: number | null; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args);
    let stdout = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout }));
    child.stdin.end(input);
  });
}

const canSh = spawnSync('sh', ['-c', 'command -v curl >/dev/null']).status === 0;
const canPs = process.platform === 'win32' && spawnSync('powershell', ['-NoProfile', '-Command', 'exit 0']).status === 0;

describe.skipIf(!canSh)('sh lock script passes the digest to Claude Code', () => {
  it('prints the hook JSON on the first Read and nothing on the retry', async () => {
    const script = path.join(tmp, 'check.sh');
    fs.writeFileSync(script, buildLockCheckSh(port, TOKEN), 'utf8');
    // JSON-escape the path (Windows backslashes) the way Claude Code would send it.
    const payload = JSON.stringify({ session_id: `sh-${agentSeq}`, cwd: tmp, tool_name: 'Read', tool_input: { file_path: hotFile.split('\\').join('/') } });
    const first = await run('sh', [script], payload);
    expect(first.status).toBe(0);
    expect(JSON.parse(first.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
    const retry = await run('sh', [script], payload);
    expect(retry).toEqual({ status: 0, stdout: '' });
  }, 60_000);
});

describe.skipIf(!canPs)('PowerShell lock script passes the digest to Claude Code', () => {
  it('prints the hook JSON on the first Read and nothing on the retry', async () => {
    const script = path.join(tmp, 'check.ps1');
    fs.writeFileSync(script, '\uFEFF' + buildLockCheckPs1(port, TOKEN), 'utf8');
    const payload = JSON.stringify({ session_id: `ps-${agentSeq}`, cwd: tmp, tool_name: 'Read', tool_input: { file_path: hotFile } });
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script];
    const first = await run('powershell', args, payload);
    expect(first.status).toBe(0);
    expect(JSON.parse(first.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
    const retry = await run('powershell', args, payload);
    expect(retry).toEqual({ status: 0, stdout: '' });
  }, 60_000);
});
