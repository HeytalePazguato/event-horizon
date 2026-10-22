/**
 * File digests for the shared knowledge store: a compact summary of a hot file
 * (path, line count, exported symbol signatures or the first lines) plus a
 * pointer telling the reader where to get the full contents.
 *
 * Async because symbol extraction goes through web-tree-sitter, whose WASM
 * runtime and grammars load asynchronously. The project-graph extractor is
 * imported lazily so callers that inject their own extractor never pay for it.
 */

import * as path from 'path';
import { mayCache } from './secretScanner.js';

const DEFAULT_MAX_TOKENS = 800;
const CHARS_PER_TOKEN = 4;
const MAX_SIGNATURE_CHARS = 160;
const FALLBACK_LINES = 40;

const SYMBOL_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.py', '.cs', '.php',
]);

export interface FileDigestOptions {
  /** Token cap for the whole digest, header and pointer included. Default 800. */
  maxTokens?: number;
  /** Workspace .gitignore check, forwarded to the secret-path guard. */
  isIgnored?: (p: string) => boolean;
  /** Returns symbol signatures, or null when extraction is unsupported/failed. */
  extractSymbols?: (filePath: string, content: string) => Promise<string[] | null>;
}

/**
 * Default extractor: runs the project-graph tree-sitter extractor and renders
 * each exported top-level declaration as its (trimmed) source line.
 */
async function defaultExtractSymbols(filePath: string, content: string): Promise<string[] | null> {
  const { treeSitterExtractor } = await import('./projectGraph/treeSitterExtractor.js');
  const result = await treeSitterExtractor.extract(filePath, content);
  if (result.skipped) return null;

  const ext = path.extname(filePath).toLowerCase();
  const lines = content.split(/\r?\n/);
  const seen = new Set<number>();
  const out: string[] = [];
  const real = result.nodes
    .filter((n) => n.tag === 'EXTRACTED' && n.sourceLocation && n.type !== 'module')
    .map((n) => Number(n.sourceLocation))
    .filter((n) => Number.isInteger(n) && n >= 1)
    .sort((a, b) => a - b);

  for (const lineNo of real) {
    if (seen.has(lineNo)) continue;
    seen.add(lineNo);
    const raw = lines[lineNo - 1];
    if (raw === undefined) continue;
    const text = raw.trim();
    const indented = /^\s/.test(raw);
    let exported: boolean;
    if (ext === '.py') exported = !indented && !/^(async\s+)?(def|class)\s+_/.test(text);
    else if (ext === '.cs') exported = /\bpublic\b/.test(text);
    else if (ext === '.php') exported = !/\b(private|protected)\b/.test(text);
    else exported = !indented && /^export\b/.test(text);
    if (exported) out.push(text.length > MAX_SIGNATURE_CHARS ? `${text.slice(0, MAX_SIGNATURE_CHARS - 1)}…` : text);
  }
  return out;
}

/**
 * Build a digest + pointer for a file, or null when it must not be cached
 * (secret path or content). Deterministic for identical inputs.
 */
export async function buildFileDigest(
  filePath: string,
  content: string,
  opts: FileDigestOptions = {},
): Promise<string | null> {
  if (!mayCache(filePath, content, { isIgnored: opts.isIgnored })) return null;

  const maxChars = Math.max(1, opts.maxTokens ?? DEFAULT_MAX_TOKENS) * CHARS_PER_TOKEN;
  const lines = content.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  const header = `${filePath} (${lines.length} lines)`;
  const pointer = `Read ${filePath} for full contents.`;

  let body: string[] | null = null;
  if (SYMBOL_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
    try {
      body = await (opts.extractSymbols ?? defaultExtractSymbols)(filePath, content);
    } catch {
      body = null;
    }
  }
  if (!body || body.length === 0) {
    body = lines
      .slice(0, FALLBACK_LINES)
      .map((l) => l.trimEnd())
      .filter((l) => l.length > 0);
  }

  // Header and pointer always count against the cap; body lines fill the rest.
  let used = header.length + 1 + pointer.length;
  const kept: string[] = [];
  for (const line of body) {
    if (used + line.length + 1 > maxChars) break;
    kept.push(line);
    used += line.length + 1;
  }
  return [header, ...kept, pointer].join('\n');
}
