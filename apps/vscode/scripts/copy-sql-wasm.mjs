#!/usr/bin/env node
/**
 * Copy sql.js's WASM binary from node_modules into out/ so it ships alongside
 * the compiled extension and the runtime `locateSqlWasm` helper can find it
 * via `__dirname`. Runs as part of every build path (tsc dev, esbuild prod).
 *
 * Without this step the packaged VSIX crashes on activation with
 * `ENOENT: no such file or directory, open '<install>/out/sql-wasm.wasm'`
 * because esbuild's `--bundle` inlines sql.js's JS but WASM is a binary
 * asset it cannot embed, and `--no-dependencies` strips node_modules from
 * the VSIX — so the wasm has nowhere to live unless we copy it explicitly.
 */

import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const thisDir = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(thisDir, '..');
const outDir = join(extensionRoot, 'out');
const destFile = join(outDir, 'sql-wasm.wasm');

const sourcePath = require.resolve('sql.js/dist/sql-wasm.wasm');

if (!existsSync(outDir)) {
  mkdirSync(outDir, { recursive: true });
}

copyFileSync(sourcePath, destFile);
console.log(`[copy-sql-wasm] ${sourcePath} -> ${destFile}`);
