/**
 * statusLine bridge tests — install decisions, exact restore, and end-to-end
 * runs of the generated scripts against a local stand-in for Event Horizon.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import {
  planStatusLine,
  setupStatusLine,
  removeStatusLine,
  defaultStatusLinePaths,
  bridgeCommand,
  isBridgeCommand,
  findGitBash,
  buildShBridge,
  buildPs1Bridge,
} from '../setupStatusLine.js';

const BRIDGE = 'sh "/home/u/.event-horizon/eh-statusline.sh"';

describe('planStatusLine', () => {
  it('chain mode installs nothing when the user has no statusLine (footer hints stay)', () => {
    expect(planStatusLine(undefined, null, 'chain', BRIDGE)).toEqual({ kind: 'none' });
  });

  it('always mode installs a bare bridge when there is none', () => {
    expect(planStatusLine(undefined, null, 'always', BRIDGE)).toEqual({
      kind: 'install', statusLine: { type: 'command', command: BRIDGE }, backup: { original: null },
    });
  });

  it('wraps an existing statusLine, keeping its other fields', () => {
    const current = { type: 'command', command: '~/.claude/statusline.sh', padding: 2, refreshInterval: 5 };
    expect(planStatusLine(current, null, 'chain', BRIDGE)).toEqual({
      kind: 'install',
      statusLine: { type: 'command', command: BRIDGE, padding: 2, refreshInterval: 5 },
      backup: { original: current },
    });
  });

  it('refreshes when the bridge is already installed', () => {
    expect(planStatusLine({ type: 'command', command: BRIDGE }, { original: null }, 'chain', BRIDGE)).toEqual({ kind: 'refresh' });
  });

  it('re-wraps when the user replaced the bridge with a new statusLine', () => {
    const current = { type: 'command', command: 'echo new' };
    const plan = planStatusLine(current, { original: { type: 'command', command: 'echo old' } }, 'chain', BRIDGE);
    expect(plan).toMatchObject({ kind: 'install', backup: { original: current } });
  });

  it('off mode restores the original only when the bridge is ours', () => {
    const backup = { original: { type: 'command', command: 'echo mine' } };
    expect(planStatusLine({ command: BRIDGE }, backup, 'off', BRIDGE)).toEqual({ kind: 'restore', statusLine: backup.original });
    expect(planStatusLine({ command: 'echo theirs' }, backup, 'off', BRIDGE)).toEqual({ kind: 'none' });
  });

  it('ignores non-command or empty statusLines', () => {
    expect(planStatusLine({ type: 'static', text: 'x' }, null, 'chain', BRIDGE)).toEqual({ kind: 'none' });
    expect(planStatusLine({ type: 'command', command: '  ' }, null, 'chain', BRIDGE)).toEqual({ kind: 'none' });
  });
});

describe('bridgeCommand / helpers', () => {
  const paths = defaultStatusLinePaths('C:\\Users\\me');

  it('uses PowerShell with forward slashes on Windows and sh elsewhere — never bash', () => {
    const win = bridgeCommand('win32', paths);
    expect(win).toMatch(/^powershell -NoProfile/);
    expect(win).not.toContain('\\');
    expect(bridgeCommand('linux', defaultStatusLinePaths('/home/me'))).toMatch(/^sh "/);
    for (const c of [win, bridgeCommand('darwin', paths)]) expect(c).not.toMatch(/\bbash\b/);
    expect(isBridgeCommand(win)).toBe(true);
  });

  it('finds Git Bash where Claude Code would look', () => {
    const exists = (p: string) => p === 'C:\\Program Files\\Git\\bin\\bash.exe';
    expect(findGitBash({ ProgramFiles: 'C:\\Program Files' }, exists)).toBe('C:\\Program Files\\Git\\bin\\bash.exe');
    expect(findGitBash({ CLAUDE_CODE_GIT_BASH_PATH: 'D:\\git\\bash.exe' }, (p) => p === 'D:\\git\\bash.exe')).toBe('D:\\git\\bash.exe');
    expect(findGitBash({}, () => false)).toBeNull();
  });

  it('never interpolates the original command into the scripts', () => {
    const p = defaultStatusLinePaths('/home/me');
    for (const script of [buildShBridge(28765, 't', p), buildPs1Bridge(28765, 't', p)]) {
      expect(script).not.toContain('echo injected');
    }
  });
});

describe('setupStatusLine / removeStatusLine (files)', () => {
  let home: string;
  beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-sl-')); });
  afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });
  const write = (p: string, v: unknown) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2), 'utf8'); };

  it('wraps and then restores the exact original settings.json', async () => {
    const paths = defaultStatusLinePaths(home);
    write(paths.settingsPath, { statusLine: { type: 'command', command: 'echo "a; b && $(c)"', padding: 1 }, hooks: {} });
    const before = fs.readFileSync(paths.settingsPath, 'utf8');

    expect(await setupStatusLine({ port: 28765, token: 't', mode: 'chain', paths, platform: 'linux' })).toBe('install');
    const installed = JSON.parse(fs.readFileSync(paths.settingsPath, 'utf8'));
    expect(isBridgeCommand(installed.statusLine.command)).toBe(true);
    expect(installed.statusLine.padding).toBe(1);
    expect(fs.readFileSync(paths.commandPath, 'utf8')).toBe('echo "a; b && $(c)"');

    expect(await removeStatusLine(paths)).toBe(true);
    expect(fs.readFileSync(paths.settingsPath, 'utf8')).toBe(before);
    for (const f of [paths.backupPath, paths.commandPath, paths.shPath]) expect(fs.existsSync(f)).toBe(false);
  });

  it('deletes the field on removal when there was no statusLine before', async () => {
    const paths = defaultStatusLinePaths(home);
    write(paths.settingsPath, { hooks: {} });
    const before = fs.readFileSync(paths.settingsPath, 'utf8');
    await setupStatusLine({ port: 28765, token: 't', mode: 'always', paths, platform: 'linux' });
    await removeStatusLine(paths);
    expect(fs.readFileSync(paths.settingsPath, 'utf8')).toBe(before);
  });

  it('does not touch a statusLine the user put back themselves', async () => {
    const paths = defaultStatusLinePaths(home);
    write(paths.settingsPath, { statusLine: { type: 'command', command: 'echo old' } });
    await setupStatusLine({ port: 28765, token: 't', mode: 'chain', paths, platform: 'linux' });
    write(paths.settingsPath, { statusLine: { type: 'command', command: 'echo theirs' } });
    expect(await removeStatusLine(paths)).toBe(false);
    expect(JSON.parse(fs.readFileSync(paths.settingsPath, 'utf8')).statusLine.command).toBe('echo theirs');
  });

  it('off mode restores and cleans up', async () => {
    const paths = defaultStatusLinePaths(home);
    write(paths.settingsPath, { statusLine: { type: 'command', command: 'echo mine' } });
    await setupStatusLine({ port: 28765, token: 't', mode: 'chain', paths, platform: 'win32', gitBash: null });
    expect(await setupStatusLine({ port: 28765, token: 't', mode: 'off', paths, platform: 'win32' })).toBe('restore');
    expect(JSON.parse(fs.readFileSync(paths.settingsPath, 'utf8')).statusLine.command).toBe('echo mine');
  });
});

// ── End-to-end: run the generated bridge for real ───────────────────────────

let server: http.Server;
let port: number;
let posted: Array<{ auth?: string; body: string }> = [];

beforeAll(() => new Promise<void>((resolve) => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => { posted.push({ auth: req.headers.authorization, body: Buffer.concat(chunks).toString('utf8') }); res.end(''); });
  });
  server.listen(0, '127.0.0.1', () => { port = (server.address() as { port: number }).port; resolve(); });
}));
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const PAYLOAD = JSON.stringify({ session_id: 's1', model: { display_name: 'Opus 5' }, context_window: { used_percentage: 42.6 }, cost: { total_cost_usd: 1.234 } });

function hasCommand(cmd: string, args: string[]): boolean {
  return spawnSync(cmd, args, { encoding: 'utf8' }).status === 0;
}

async function waitForPost(): Promise<void> {
  for (let i = 0; i < 40 && posted.length === 0; i++) await new Promise((r) => setTimeout(r, 50));
}

const canRunSh = hasCommand('sh', ['-c', 'command -v curl >/dev/null']);
const canRunPs = process.platform === 'win32' && hasCommand('powershell', ['-NoProfile', '-Command', 'exit 0']);

describe.skipIf(!canRunSh)('sh bridge (end to end)', () => {
  let home: string;
  beforeEach(() => { posted = []; home = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-slsh-')); });
  afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

  it('posts the payload and prints the original command output unchanged', async () => {
    const paths = defaultStatusLinePaths(home);
    fs.mkdirSync(paths.dir, { recursive: true });
    // An original with shell syntax that would break if it were spliced into the script.
    fs.writeFileSync(paths.commandPath, `read -r X; echo "orig:$X" && echo 'semi;colon'`, 'utf8');
    fs.writeFileSync(paths.shPath, buildShBridge(port, 'tok', paths), 'utf8');
    const r = spawnSync('sh', [paths.shPath], { input: PAYLOAD, encoding: 'utf8', env: { ...process.env, SHELL: '/bin/sh' } });
    expect(r.stdout).toBe(`orig:${PAYLOAD}\nsemi;colon\n`);
    await waitForPost();
    expect(posted[0]).toEqual({ auth: 'Bearer tok', body: PAYLOAD });
  }, 60_000);

  it('prints a compact line when there is no original', async () => {
    const paths = defaultStatusLinePaths(home);
    fs.mkdirSync(paths.dir, { recursive: true });
    fs.writeFileSync(paths.shPath, buildShBridge(port, 'tok', paths), 'utf8');
    const r = spawnSync('sh', [paths.shPath], { input: PAYLOAD, encoding: 'utf8' });
    expect(r.stdout.trim()).toBe('[Opus 5] ctx 42% · $1.23');
  }, 60_000);
});

describe.skipIf(!canRunPs)('PowerShell bridge (end to end)', () => {
  let home: string;
  beforeEach(() => { posted = []; home = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-slps-')); });
  afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

  it('posts the payload and runs the original through PowerShell when Git Bash is absent', async () => {
    const paths = defaultStatusLinePaths(home);
    fs.mkdirSync(paths.dir, { recursive: true });
    fs.writeFileSync(paths.backupPath, JSON.stringify({ original: { command: 'x' }, bashPath: null }), 'utf8');
    fs.writeFileSync(paths.commandPath, `$t = $input | Out-String; Write-Output ('orig:' + $t.Trim()); Write-Output 'semi;colon'`, 'utf8');
    fs.writeFileSync(paths.ps1Path, '\uFEFF' + buildPs1Bridge(port, 'tok', paths), 'utf8');
    const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', paths.ps1Path], { input: PAYLOAD, encoding: 'utf8', timeout: 30_000 });
    expect(r.stdout.replace(/\r/g, '')).toBe(`orig:${PAYLOAD}\nsemi;colon\n`);
    await waitForPost();
    expect(posted[0]).toEqual({ auth: 'Bearer tok', body: PAYLOAD });
  }, 40_000);

  const gitBash = findGitBash();
  it.skipIf(!gitBash)('runs the original through Git Bash when Claude Code would', async () => {
    const paths = defaultStatusLinePaths(home);
    fs.mkdirSync(paths.dir, { recursive: true });
    fs.writeFileSync(paths.backupPath, JSON.stringify({ original: { command: 'x' }, bashPath: gitBash }), 'utf8');
    fs.writeFileSync(paths.commandPath, `read -r X; echo "bash:$X" && echo 'semi;colon'`, 'utf8');
    fs.writeFileSync(paths.ps1Path, '\uFEFF' + buildPs1Bridge(port, 'tok', paths), 'utf8');
    const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', paths.ps1Path], { input: PAYLOAD, encoding: 'utf8', timeout: 30_000 });
    expect(r.stdout.replace(/\r/g, '')).toBe(`bash:${PAYLOAD}\nsemi;colon\n`);
    await waitForPost();
    expect(posted[0].body).toBe(PAYLOAD);
  }, 40_000);

  it('prints a compact line when there is no original', () => {
    const paths = defaultStatusLinePaths(home);
    fs.mkdirSync(paths.dir, { recursive: true });
    fs.writeFileSync(paths.ps1Path, '\uFEFF' + buildPs1Bridge(port, null, paths), 'utf8');
    const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', paths.ps1Path], { input: PAYLOAD, encoding: 'utf8', timeout: 30_000 });
    expect(r.stdout.replace(/\r/g, '').trim()).toBe('[Opus 5] ctx 43% · $1.23');
  }, 40_000);
});
