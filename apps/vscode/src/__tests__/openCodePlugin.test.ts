/**
 * Tests for the bundled OpenCode plugin sources (src/generated/pluginSources.ts).
 *
 * The generated file is gitignored and produced by scripts/build-plugins.mjs.
 * Turbo runs `build` before `test`, but if the file is absent (e.g. vitest run
 * straight after a clean checkout) the suite generates it itself.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { pathToFileURL } from 'url';

const pkgRoot = path.resolve(__dirname, '..', '..');
const generatedFile = path.join(pkgRoot, 'src', 'generated', 'pluginSources.ts');

let V1 = '';
let V2 = '';
let tmpDir = '';

const TOKEN = 'tok-SECRET-123';
const withToken = (src: string) => src.split('__EH_AUTH_TOKEN__').join(TOKEN);

function writeMjs(name: string, content: string): string {
  const file = path.join(tmpDir, name);
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

beforeAll(async () => {
  if (!fs.existsSync(generatedFile)) {
    // Generated artifact missing: build it rather than fail on an import error.
    execFileSync(process.execPath, ['scripts/build-plugins.mjs'], { cwd: pkgRoot, stdio: 'pipe' });
  }
  const mod = await import('../generated/pluginSources.js');
  V1 = mod.OPENCODE_V1_SOURCE;
  V2 = mod.OPENCODE_V2_SOURCE;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-plugin-'));
});

afterAll(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('generated plugin sources', () => {
  it('exports non-empty strings that carry the token placeholder', () => {
    for (const src of [V1, V2]) {
      expect(typeof src).toBe('string');
      expect(src.length).toBeGreaterThan(200);
      expect(src).toContain('__EH_AUTH_TOKEN__');
    }
  });

  it.each([['v1'], ['v2']])('%s parses as valid ESM (node --check)', (which) => {
    const file = writeMjs(`${which}.mjs`, withToken(which === 'v1' ? V1 : V2));
    expect(() => execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })).not.toThrow();
  });

  it('v2 default-exports a plain { id, setup } literal', () => {
    expect(V2).toMatch(/export\s*\{\s*[\w$]+\s+as\s+default\s*\}|export\s+default/);
    expect(V2).toMatch(/id:\s*"event-horizon"/);
    expect(V2).toMatch(/async setup\s*\(/);
  });

  it('v2 does not import @opencode/plugin or @opencode-ai/plugin', () => {
    expect(V2).not.toMatch(/@opencode(-ai)?\/plugin/);
    expect(V2).not.toMatch(/^\s*import\s/m);
  });

  it('v1 default-exports the EventHorizon function', () => {
    expect(V1).toMatch(/function EventHorizon\s*\(/);
  });

  it('neither source spawns subprocesses', () => {
    for (const src of [V1, V2]) {
      expect(src).not.toContain('spawnSync');
      expect(src).not.toContain('child_process');
    }
  });

  it('the token is never placed in an argv-shaped construct', () => {
    for (const src of [V1, V2]) {
      expect(src).not.toMatch(/\b(spawn|spawnSync|exec|execSync|execFile|execFileSync)\s*\(/);
      expect(src).not.toContain('"-e"');
      expect(src).not.toContain("'-e'");
      // The only use of the token is the Authorization header value.
      const occurrences = src.split('__EH_AUTH_TOKEN__').length - 1;
      expect(occurrences).toBeGreaterThan(0);
      expect(src).toMatch(/AUTH_TOKEN = "__EH_AUTH_TOKEN__"/);
      expect(src).toMatch(/Bearer/);
    }
  });
});

describe('built v2 plugin at runtime', () => {
  it('registers hooks, forwards events, and cleans up with session.deleted', async () => {
    const calls: Array<{ url: string; init: { body?: string; keepalive?: boolean; headers?: Record<string, string> } }> = [];
    const fetchStub = vi.fn((url: string, init: { body?: string }) => {
      calls.push({ url: String(url), init });
      return Promise.resolve({ status: 200, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal('fetch', fetchStub);

    try {
      const file = writeMjs('v2-runtime.mjs', withToken(V2));
      const mod = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as {
        default: { id: string; setup: (ctx: unknown) => Promise<() => void> };
      };
      expect(mod.default.id).toBe('event-horizon');

      const hooks: string[] = [];
      let capturedSignal: AbortSignal | undefined;
      const ctx = {
        location: { directory: '/work/my-proj', project: { id: 'proj1' } },
        tool: { hook: async (name: string) => { hooks.push(`tool:${name}`); return { dispose: () => {} }; } },
        permission: { hook: async (name: string) => { hooks.push(`permission:${name}`); return { dispose: () => {} }; } },
        event: {
          subscribe: ({ signal }: { signal: AbortSignal }) => {
            capturedSignal = signal;
            return (async function* () {
              yield { type: 'session.idle', sessionID: 's1' };
              await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()));
            })();
          },
        },
      };

      const cleanup = await mod.default.setup(ctx);
      expect(typeof cleanup).toBe('function');
      expect(hooks).toEqual(['tool:execute.before', 'tool:execute.after', 'permission:evaluate']);

      // Let the subscription loop forward its one event.
      await new Promise((r) => setTimeout(r, 20));
      const names = () => calls.map((c) => (JSON.parse(c.init.body ?? '{}') as { event: string }).event);
      expect(names()).toContain('session.created');
      expect(names()).toContain('session.idle');
      expect(calls[0].url).toBe('http://127.0.0.1:28765/opencode');
      expect(calls[0].init.headers?.Authorization).toBe(`Bearer ${TOKEN}`);

      cleanup();
      expect(capturedSignal?.aborted).toBe(true);
      const last = calls[calls.length - 1];
      expect((JSON.parse(last.init.body ?? '{}') as { event: string }).event).toBe('session.deleted');
      expect(last.init.keepalive).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
