import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolvePlanPath, readPlanFile } from '../planPathResolver';

let root: string;
let ws: string;
let outside: string;

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plan-resolver-')));
  ws = path.join(root, 'ws');
  outside = path.join(root, 'outside');
  fs.mkdirSync(path.join(ws, 'docs'), { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(ws, 'docs', 'plan.md'), '# plan\n');
  fs.writeFileSync(path.join(ws, 'notes.txt'), 'x');
  fs.writeFileSync(path.join(ws, 'big.md'), Buffer.alloc(1_048_577, 97));
  fs.writeFileSync(path.join(root, 'outside.md'), '# out\n');
  fs.writeFileSync(path.join(outside, 'secret.md'), '# secret\n');
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('resolvePlanPath', () => {
  it('accepts a relative path inside a folder', async () => {
    const r = await resolvePlanPath('docs/plan.md', [ws]);
    expect(r).toEqual({ ok: true, absPath: path.join(ws, 'docs', 'plan.md') });
    if (r.ok) expect(await readPlanFile(r.absPath)).toBe('# plan\n');
  });

  it('accepts an absolute path inside a folder', async () => {
    const abs = path.join(ws, 'docs', 'plan.md');
    expect(await resolvePlanPath(abs, [ws])).toEqual({ ok: true, absPath: abs });
  });

  it('first folder containing the file wins', async () => {
    const r = await resolvePlanPath('docs/plan.md', [outside, ws]);
    expect(r.ok).toBe(true);
  });

  it('rejects ../outside.md', async () => {
    const r = await resolvePlanPath('../outside.md', [ws]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/outside/i);
  });

  it('rejects an absolute path outside', async () => {
    const r = await resolvePlanPath(path.join(outside, 'secret.md'), [ws]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/outside/i);
  });

  it('rejects a symlink inside pointing outside', async () => {
    const link = path.join(ws, 'link.md');
    try {
      fs.symlinkSync(path.join(outside, 'secret.md'), link, 'file');
    } catch {
      return; // symlink creation not permitted (Windows without privilege)
    }
    const r = await resolvePlanPath('link.md', [ws]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/outside/i);
  });

  it('rejects non-.md files', async () => {
    const r = await resolvePlanPath('notes.txt', [ws]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/\.md/);
  });

  it('rejects files over 1 MB', async () => {
    const r = await resolvePlanPath('big.md', [ws]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/too large/i);
  });

  it('rejects missing files', async () => {
    const r = await resolvePlanPath('nope.md', [ws]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not found/i);
  });

  it('rejects empty workspace folders', async () => {
    const r = await resolvePlanPath('docs/plan.md', []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/workspace/i);
  });

  it('accepts a plan under a directory whose name starts with two dots', async () => {
    fs.mkdirSync(path.join(ws, '..docs'), { recursive: true });
    fs.writeFileSync(path.join(ws, '..docs', 'p.md'), '# p\n');
    const r = await resolvePlanPath(path.join('..docs', 'p.md'), [ws]);
    expect(r).toEqual({ ok: true, absPath: path.join(ws, '..docs', 'p.md') });
  });
});
