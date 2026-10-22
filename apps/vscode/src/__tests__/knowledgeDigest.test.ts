import { describe, it, expect } from 'vitest';
import { buildFileDigest } from '../knowledgeDigest';

const fakeSymbols = async () => ['export function alpha(a: number): number', 'export class Beta'];

function bigTsFile(): string {
  const out: string[] = ['export function alpha(a: number): number { return a; }', 'export class Beta {}'];
  for (let i = 0; i < 1998; i++) out.push(`const filler${i} = ${i};`);
  return out.join('\n');
}

describe('buildFileDigest', () => {
  it('digests a 2000-line TS file under the cap, listing symbols and ending with the pointer', async () => {
    const d = await buildFileDigest('src/big.ts', bigTsFile(), { extractSymbols: fakeSymbols });
    expect(d).not.toBeNull();
    const lines = d!.split('\n');
    expect(lines[0]).toBe('src/big.ts (2000 lines)');
    expect(d).toContain('export function alpha(a: number): number');
    expect(d).toContain('export class Beta');
    expect(lines[lines.length - 1]).toBe('Read src/big.ts for full contents.');
    expect(d!.length).toBeLessThanOrEqual(800 * 4);
  });

  it('returns null for .env files', async () => {
    expect(await buildFileDigest('.env', 'FOO=bar', { extractSymbols: fakeSymbols })).toBeNull();
  });

  it('returns null when content contains a secret', async () => {
    const content = 'export const k = "AKIAIOSFODNN7EXAMPLE";\n-----BEGIN RSA PRIVATE KEY-----\nabc\n';
    expect(await buildFileDigest('src/keys.ts', content, { extractSymbols: fakeSymbols })).toBeNull();
  });

  it('falls back to first lines for unsupported extensions', async () => {
    const d = await buildFileDigest('notes.txt', 'first line\nsecond line\n', {
      extractSymbols: async () => {
        throw new Error('should not be called');
      },
    });
    expect(d).toBe('notes.txt (2 lines)\nfirst line\nsecond line\nRead notes.txt for full contents.');
  });

  it('falls back to first lines when extraction fails or returns null', async () => {
    const content = 'line one\nline two';
    const a = await buildFileDigest('a.ts', content, { extractSymbols: async () => null });
    const b = await buildFileDigest('a.ts', content, {
      extractSymbols: async () => {
        throw new Error('wasm');
      },
    });
    expect(a).toContain('line one');
    expect(b).toBe(a);
  });

  it('always ends with the pointer even with a tiny cap', async () => {
    const d = await buildFileDigest('src/big.ts', bigTsFile(), { maxTokens: 1, extractSymbols: fakeSymbols });
    expect(d!.split('\n').pop()).toBe('Read src/big.ts for full contents.');
  });

  it('is deterministic', async () => {
    const a = await buildFileDigest('src/big.ts', bigTsFile(), { extractSymbols: fakeSymbols });
    const b = await buildFileDigest('src/big.ts', bigTsFile(), { extractSymbols: fakeSymbols });
    expect(a).toBe(b);
  });

  it('extracts exported symbols with the real tree-sitter extractor', async () => {
    const src = 'export function foo(a: number) {\n  return a;\n}\nfunction hidden() {}\nexport class Bar {\n  method() {}\n}\n';
    const d = await buildFileDigest('src/real.ts', src);
    expect(d).toContain('export function foo(a: number) {');
    expect(d).toContain('export class Bar {');
    expect(d).not.toContain('hidden');
  }, 30000);
});
