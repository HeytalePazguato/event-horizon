/**
 * OpenCode installer tests.
 *
 * v1 and v2 OpenCode load incompatible plugin shapes (v1: default-exported
 * function; v2: `{ id, setup }` literal). The installer must detect the major,
 * write the matching bundle with the auth token substituted, flag a v1 file as
 * stale once OpenCode reports v2, and never touch ~/.config/opencode/package.json.
 *
 * `os.homedir()` is redirected to a throwaway temp dir so the real user config
 * is never read or written.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as realOs from 'os';

const state = vi.hoisted(() => ({ home: '', token: 'tok-abc123' as string | null }));

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  const homedir = () => state.home;
  return { ...actual, homedir, default: { ...actual, homedir } };
});

vi.mock('../eventServer.js', () => ({ getAuthToken: () => state.token }));

// Record every path the installer writes, while still writing for real.
const writes = vi.hoisted(() => [] as string[]);
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  const writeFile = ((file: Parameters<typeof actual.writeFile>[0], ...rest: unknown[]) => {
    writes.push(String(file));
    return (actual.writeFile as (...a: unknown[]) => Promise<void>)(file, ...rest);
  }) as typeof actual.writeFile;
  return { ...actual, writeFile, default: { ...actual, writeFile } };
});

import {
  detectOpenCodeMajor,
  parseOpenCodeMajor,
  buildPluginSource,
  setupOpenCodeHooks,
  hasStaleOpenCodeHooks,
  isOpenCodeHooksInstalled,
  removeOpenCodeHooks,
} from '../setupOpenCodeHooks.js';

const versionIs = (out: string) => () => Promise.resolve(out);
const versionFails = () => Promise.reject(new Error('spawn opencode ENOENT'));

const configDir = () => path.join(state.home, '.config', 'opencode');
const pluginFile = () => path.join(configDir(), 'plugins', 'event-horizon.ts');
const readPlugin = () => fsp.readFile(pluginFile(), 'utf8');

const V2_LITERAL = /id:\s*"event-horizon"/;
const V1_FUNCTION = /function EventHorizon\s*\(/;

beforeEach(async () => {
  state.home = await fsp.mkdtemp(path.join(realOs.tmpdir(), 'eh-opencode-'));
  state.token = 'tok-abc123';
});

afterEach(async () => {
  await fsp.rm(state.home, { recursive: true, force: true });
});

describe('parseOpenCodeMajor / detectOpenCodeMajor', () => {
  it('parses a bare v1 version', async () => {
    expect(parseOpenCodeMajor('1.19.1\n')).toBe(1);
    expect(await detectOpenCodeMajor(versionIs('1.19.1'))).toBe(1);
  });

  it('parses the prefixed v2 form', async () => {
    expect(parseOpenCodeMajor('opencode v2.1.1')).toBe(2);
    expect(await detectOpenCodeMajor(versionIs('opencode v2.1.1\r\n'))).toBe(2);
  });

  it('returns null for garbage', async () => {
    expect(await detectOpenCodeMajor(versionIs('command not found'))).toBeNull();
    expect(await detectOpenCodeMajor(versionIs(''))).toBeNull();
  });

  it('returns null for an unsupported major', () => {
    expect(parseOpenCodeMajor('3.0.0')).toBeNull();
    expect(parseOpenCodeMajor('0.9.2')).toBeNull();
  });

  it('returns null instead of throwing when the binary is missing', async () => {
    await expect(detectOpenCodeMajor(versionFails)).resolves.toBeNull();
  });
});

describe('buildPluginSource', () => {
  it('substitutes the token and drops the placeholder', () => {
    for (const major of [1, 2] as const) {
      const src = buildPluginSource(major, 'tok-abc123');
      expect(src).toContain('AUTH_TOKEN = "tok-abc123"');
      expect(src).not.toContain('__EH_AUTH_TOKEN__');
      expect(src.startsWith('// @event-horizon/opencode-plugin')).toBe(true);
    }
  });

  it('picks the shape per major', () => {
    expect(buildPluginSource(1, 't')).toMatch(V1_FUNCTION);
    expect(buildPluginSource(1, 't')).not.toMatch(V2_LITERAL);
    expect(buildPluginSource(2, 't')).toMatch(V2_LITERAL);
    expect(buildPluginSource(2, 't')).not.toMatch(V1_FUNCTION);
  });

  it('cannot break out of the string literal with a hostile token', () => {
    expect(buildPluginSource(2, 'a"b\\c')).toContain('AUTH_TOKEN = "a\\"b\\\\c"');
  });
});

describe('setupOpenCodeHooks', () => {
  it('writes the v1 plugin on a v1 install', async () => {
    const result = await setupOpenCodeHooks(versionIs('1.19.1'));
    expect(result).toEqual({ detected: 1, written: 1 });
    const src = await readPlugin();
    expect(src).toMatch(V1_FUNCTION);
    expect(src).toContain('AUTH_TOKEN = "tok-abc123"');
    expect(src).not.toContain('__EH_AUTH_TOKEN__');
    expect(await isOpenCodeHooksInstalled()).toBe(true);
  });

  it('writes the v2 plugin on a v2 install', async () => {
    const result = await setupOpenCodeHooks(versionIs('opencode v2.1.1'));
    expect(result).toEqual({ detected: 2, written: 2 });
    const src = await readPlugin();
    expect(src).toMatch(V2_LITERAL);
    expect(src).not.toContain('__EH_AUTH_TOKEN__');
  });

  it('falls back to v1 when the version cannot be detected', async () => {
    const result = await setupOpenCodeHooks(versionFails);
    expect(result).toEqual({ detected: null, written: 1 });
    expect(await readPlugin()).toMatch(V1_FUNCTION);
  });

  it('keeps an installed v2 file on v2 when detection fails', async () => {
    await setupOpenCodeHooks(versionIs('2.1.1'));
    const result = await setupOpenCodeHooks(versionFails);
    expect(result.written).toBe(2);
    expect(await readPlugin()).toMatch(V2_LITERAL);
  });

  it('writes an empty token when the server has none, still without the placeholder', async () => {
    state.token = null;
    await setupOpenCodeHooks(versionIs('2.1.1'));
    const src = await readPlugin();
    expect(src).toContain('AUTH_TOKEN = ""');
    expect(src).not.toContain('__EH_AUTH_TOKEN__');
  });

  it('never writes package.json and leaves the user one byte-for-byte', async () => {
    await fsp.mkdir(configDir(), { recursive: true });
    const pkgPath = path.join(configDir(), 'package.json');
    const original = '{\n  "dependencies": { "@opencode-ai/plugin": "1.2.27" }\n}\n';
    await fsp.writeFile(pkgPath, original, 'utf8');
    writes.length = 0;

    await setupOpenCodeHooks(versionIs('1.19.1'));
    await setupOpenCodeHooks(versionIs('2.1.1'));

    expect(await fsp.readFile(pkgPath, 'utf8')).toBe(original);
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.some((p) => p.endsWith('package.json'))).toBe(false);
  });

  it('does not create package.json when none exists', async () => {
    await setupOpenCodeHooks(versionIs('2.1.1'));
    expect(fs.existsSync(path.join(configDir(), 'package.json'))).toBe(false);
  });

  it('removes the plugin it installed', async () => {
    await setupOpenCodeHooks(versionIs('2.1.1'));
    await removeOpenCodeHooks();
    expect(await isOpenCodeHooksInstalled()).toBe(false);
  });
});

describe('hasStaleOpenCodeHooks', () => {
  it('is false when nothing is installed, even without opencode', async () => {
    expect(await hasStaleOpenCodeHooks(versionFails)).toBe(false);
  });

  it('is false right after installing for the same major', async () => {
    await setupOpenCodeHooks(versionIs('1.19.1'));
    expect(await hasStaleOpenCodeHooks(versionIs('1.19.1'))).toBe(false);
  });

  it('is true when a v1 file is installed but OpenCode reports v2', async () => {
    await setupOpenCodeHooks(versionIs('1.19.1'));
    expect(await hasStaleOpenCodeHooks(versionIs('opencode v2.1.1'))).toBe(true);
  });

  it('is true when a v2 file is installed but OpenCode reports v1', async () => {
    await setupOpenCodeHooks(versionIs('2.1.1'));
    expect(await hasStaleOpenCodeHooks(versionIs('1.19.1'))).toBe(true);
  });

  it('is true when the token changed', async () => {
    await setupOpenCodeHooks(versionIs('2.1.1'));
    state.token = 'tok-rotated';
    expect(await hasStaleOpenCodeHooks(versionIs('2.1.1'))).toBe(true);
  });

  it('does not flag a current file as stale when detection fails', async () => {
    await setupOpenCodeHooks(versionIs('2.1.1'));
    await expect(hasStaleOpenCodeHooks(versionFails)).resolves.toBe(false);
  });

  it('flags the pre-3.3.0 template plugin as stale', async () => {
    await fsp.mkdir(path.dirname(pluginFile()), { recursive: true });
    await fsp.writeFile(
      pluginFile(),
      '// @event-horizon/opencode-plugin\nconst AUTH_TOKEN = "tok-abc123";\nexport default async function EventHorizon() { return {}; };\n',
      'utf8',
    );
    expect(await hasStaleOpenCodeHooks(versionIs('1.19.1'))).toBe(true);
  });
});
