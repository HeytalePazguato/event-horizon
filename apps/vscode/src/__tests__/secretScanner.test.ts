import { describe, it, expect } from 'vitest';
import {
  isSecretPath,
  containsSecret,
  mayCache,
  createGitignoreMatcher,
  shannonEntropy,
} from '../secretScanner';

// Fake credentials assembled at runtime so this file is not itself a secret trigger.
const ANT = 'sk-' + 'ant-api03-' + 'AbCdEf0123456789_-XyZaBcDeFgHiJkLmNoPqRs';
const GHP = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';
const AWS = 'AKIA' + 'IOSFODNN7EXAMPLE';

describe('isSecretPath', () => {
  it.each([
    '/repo/.env',
    '/repo/.env.local',
    '/repo/.env.production',
    'C:\\repo\\.env.local',
    '/repo/certs/server.pem',
    '/repo/tls.KEY',
    '/repo/a.p12',
    '/repo/a.pfx',
    '/repo/a.jks',
    '/repo/a.keystore',
    '/home/u/.ssh/id_rsa',
    'C:\\Users\\u\\.ssh\\config',
    '/home/u/.ssh/id_ed25519.pub',
    '/home/u/id_ecdsa',
    '/home/u/.aws/config',
    '/home/u/.gnupg/pubring.kbx',
    '/repo/aws-credentials.json',
    '/repo/Secrets.yaml',
    '/repo/client_secret.json',
    '/repo/.npmrc',
    '/repo/.netrc',
    '/home/u/.pgpass',
    '/home/u/.git-credentials',
  ])('rejects %s', (p) => {
    expect(isSecretPath(p)).toBe(true);
  });

  it.each([
    '/repo/.env.example',
    '/repo/.env.sample',
    '/repo/.env.template',
    '/repo/src/index.ts',
    '/repo/README.md',
    '/repo/package-lock.json',
    '/repo/src/keyboard.ts',
    '/repo/environment.ts',
  ])('allows %s', (p) => {
    expect(isSecretPath(p)).toBe(false);
  });

  it('consults the isIgnored callback', () => {
    expect(isSecretPath('/repo/dist/a.js', { isIgnored: (p) => p.includes('/dist/') })).toBe(true);
    expect(isSecretPath('/repo/src/a.js', { isIgnored: (p) => p.includes('/dist/') })).toBe(false);
  });
});

describe('createGitignoreMatcher', () => {
  const root = '/repo';
  const m = (text: string) => createGitignoreMatcher(text, root);

  it('ignores blank and comment lines', () => {
    expect(m('\n# node_modules\n\n')('/repo/node_modules/x.js')).toBe(false);
  });

  it('matches unanchored names at any depth', () => {
    const f = m('secret.txt');
    expect(f('/repo/secret.txt')).toBe(true);
    expect(f('/repo/a/b/secret.txt')).toBe(true);
    expect(f('/repo/a/notsecret.txt')).toBe(false);
  });

  it('supports * globs', () => {
    const f = m('*.log');
    expect(f('/repo/a/debug.log')).toBe(true);
    expect(f('/repo/a/debug.txt')).toBe(false);
  });

  it('trailing slash matches directories and their contents only', () => {
    const f = m('build/');
    expect(f('/repo/build/out.js')).toBe(true);
    expect(f('/repo/pkg/build/out.js')).toBe(true);
    expect(f('/repo/build')).toBe(false); // a file named build
  });

  it('leading slash anchors to root', () => {
    const f = m('/dist');
    expect(f('/repo/dist/a.js')).toBe(true);
    expect(f('/repo/pkg/dist/a.js')).toBe(false);
  });

  it('supports ** patterns', () => {
    const f = m('**/gen/*.ts\nlogs/**');
    expect(f('/repo/gen/a.ts')).toBe(true);
    expect(f('/repo/x/y/gen/a.ts')).toBe(true);
    expect(f('/repo/logs/a/b.txt')).toBe(true);
    expect(f('/repo/src/a.ts')).toBe(false);
  });

  it('supports ! negation (last match wins)', () => {
    const f = m('*.env\n!keep.env');
    expect(f('/repo/a.env')).toBe(true);
    expect(f('/repo/keep.env')).toBe(false);
  });

  it('handles CRLF, Windows paths and outside-root paths', () => {
    const f = createGitignoreMatcher('*.log\r\n', 'C:\\repo');
    expect(f('C:\\repo\\sub\\a.log')).toBe(true);
    expect(f('C:\\other\\a.log')).toBe(false);
  });

  it('integrates with isSecretPath', () => {
    const isIgnored = m('private/\n!private/ok.txt');
    expect(isSecretPath('/repo/private/a.txt', { isIgnored })).toBe(true);
    expect(isSecretPath('/repo/src/a.txt', { isIgnored })).toBe(false);
  });
});

describe('containsSecret', () => {
  it('flags known prefixes', () => {
    expect(containsSecret(`const k = "${ANT}";`)).toBe(true);
    expect(containsSecret('key=sk-' + 'proj1234567890abcdefghij12')).toBe(true);
    expect(containsSecret(`token: ${GHP}`)).toBe(true);
    expect(containsSecret('github_pat_' + '11ABCDEFG0abcdefghijkl_mnop')).toBe(true);
    expect(containsSecret(`aws ${AWS}`)).toBe(true);
    expect(containsSecret('ASIA' + 'ABCDEFGHIJKLMNOP')).toBe(true);
    expect(containsSecret('xoxb-' + '123456789012-abcdefghij')).toBe(true);
    expect(containsSecret('xoxp-' + '123456789012-abcdefghij')).toBe(true);
    expect(containsSecret('AIza' + 'SyA1234567890abcdefghijklmnopqrstuv')).toBe(true);
    expect(containsSecret('glpat-' + 'abcdefghij0123456789')).toBe(true);
    expect(containsSecret('-----BEGIN ' + 'RSA PRIVATE KEY-----\nMII...')).toBe(true);
    expect(containsSecret('-----BEGIN ' + 'PRIVATE KEY-----')).toBe(true);
    expect(containsSecret('-----BEGIN ' + 'OPENSSH PRIVATE KEY-----')).toBe(true);
    expect(
      containsSecret('eyJhbGciOiJIUzI1NiJ9.' + 'eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig'),
    ).toBe(true);
  });

  it('does not flag public keys or certificates', () => {
    expect(containsSecret('-----BEGIN PUBLIC KEY-----\nabc')).toBe(false);
    expect(containsSecret('-----BEGIN CERTIFICATE-----\nabc')).toBe(false);
  });

  it('flags high-entropy base64 and hex tokens', () => {
    expect(containsSecret('secret = "q8Zk2Lx9Vb7NmR4tYw1Pc6Hd3Fs5Jg0AaBe"')).toBe(true);
    expect(containsSecret('key: 9f86d081884c7d659a2feaa0c55ad015')).toBe(true); // 32 hex
    expect(containsSecret('a3f1c9e07b5d2486f0a1b2c3d4e5f60718293a4b5c6d7e8f9012')).toBe(true);
  });

  it('allows ordinary source', () => {
    const src = `
import { EventBus } from '@event-horizon/core';
export class SomeVeryLongDescriptiveClassNameForTestingPurposes {
  readonly someVeryLongPropertyNameThatKeepsGoing = 42;
}
const path = 'apps/vscode/src/__tests__/secretScanner.test.ts';
const kebab = 'this-is-a-very-long-kebab-case-identifier-name-here';
`;
    expect(containsSecret(src)).toBe(false);
    expect(containsSecret('')).toBe(false);
  });

  it('does not flag lockfile integrity hashes', () => {
    const lock = `"integrity": "sha512-${'Zk3Qp9Xw7Lm2Vb8Nc4Rt6Yh1Jd5Fs0GaAeBuIoPlKjHgMnCxDwSqEzTyUrVfWb+/=='}"
"integrity": "sha1-Zk3Qp9Xw7Lm2Vb8Nc4Rt6Yh1Jd5="
"integrity": "sha256-Zk3Qp9Xw7Lm2Vb8Nc4Rt6Yh1Jd5Fs0GaAeBuIoPlKjH="`;
    expect(containsSecret(lock)).toBe(false);
  });

  it('does not flag git SHAs or repeated characters', () => {
    expect(containsSecret('commit 0e27351a1b2c3d4e5f60718293a4b5c6d7e8f901')).toBe(false);
    expect(containsSecret('a'.repeat(64))).toBe(false);
    expect(containsSecret('0'.repeat(40) + '1' + '0'.repeat(10))).toBe(false);
  });

  it('only scans the first ~1MB', () => {
    const filler = 'x '.repeat(600_000);
    expect(containsSecret(filler + ANT)).toBe(false);
    expect(containsSecret(ANT + filler)).toBe(true);
  });
});

describe('shannonEntropy', () => {
  it('is 0 for uniform and grows with variety', () => {
    expect(shannonEntropy('aaaa')).toBe(0);
    expect(shannonEntropy('abcd')).toBeCloseTo(2, 5);
  });
});

describe('mayCache', () => {
  it('rejects secret paths', () => {
    expect(mayCache('/repo/.env.local', 'FOO=bar')).toBe(false);
    expect(mayCache('/home/u/.ssh/id_rsa', 'whatever')).toBe(false);
  });

  it('rejects secret content in ordinary files', () => {
    expect(mayCache('/repo/src/a.ts', `const k = "${ANT}";`)).toBe(false);
  });

  it('allows ordinary source and env templates', () => {
    expect(mayCache('/repo/src/a.ts', 'export const x = 1;\n')).toBe(true);
    expect(mayCache('/repo/.env.example', 'API_URL=http://localhost\n')).toBe(true);
  });

  it('rejects gitignored files via opts', () => {
    expect(mayCache('/repo/out/a.js', 'x', { isIgnored: () => true })).toBe(false);
  });

  it('gates FileReadCache: .env withheld, normal file kept', async () => {
    const { FileReadCache } = await import('../fileReadCache');
    const c = new FileReadCache((p, t) => mayCache(p, t));
    c.record('/repo/.env', 'A=1', 1, 'x', 1);
    c.record('/repo/ok.ts', 'let a = 1;', 1, 'x', 2);
    expect(c.get('/repo/.env')).toBeUndefined();
    expect(c.getDigest(100).map((e) => e.path)).toEqual(['/repo/ok.ts']);
  });
});
