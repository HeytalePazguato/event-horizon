#!/usr/bin/env node
/**
 * Copy tree-sitter WASM binaries from node_modules into out/ so they ship alongside
 * the compiled extension. Runs as part of every build path (tsc dev, esbuild prod).
 *
 * Copies:
 * - tree-sitter.wasm from web-tree-sitter
 * - tree-sitter-typescript.wasm and tree-sitter-tsx.wasm from tree-sitter-typescript
 * - tree-sitter-javascript.wasm from tree-sitter-javascript
 */

import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const thisDir = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(thisDir, '..');
const outDir = join(extensionRoot, 'out');

if (!existsSync(outDir)) {
  mkdirSync(outDir, { recursive: true });
}

// Copy tree-sitter.wasm from web-tree-sitter
const treeSitterWasm = require.resolve('web-tree-sitter/tree-sitter.wasm');
const treeSitterDest = join(outDir, 'tree-sitter.wasm');
copyFileSync(treeSitterWasm, treeSitterDest);
console.log(`[copy-tree-sitter-wasm] ${treeSitterWasm} -> ${treeSitterDest}`);

// Copy tree-sitter-typescript.wasm from tree-sitter-typescript
const typeScriptWasm = require.resolve('tree-sitter-typescript/tree-sitter-typescript.wasm');
const typeScriptDest = join(outDir, 'tree-sitter-typescript.wasm');
copyFileSync(typeScriptWasm, typeScriptDest);
console.log(`[copy-tree-sitter-wasm] ${typeScriptWasm} -> ${typeScriptDest}`);

// Copy tree-sitter-tsx.wasm from tree-sitter-typescript
const tsxWasm = require.resolve('tree-sitter-typescript/tree-sitter-tsx.wasm');
const tsxDest = join(outDir, 'tree-sitter-tsx.wasm');
copyFileSync(tsxWasm, tsxDest);
console.log(`[copy-tree-sitter-wasm] ${tsxWasm} -> ${tsxDest}`);

// Copy tree-sitter-javascript.wasm from tree-sitter-javascript
const jsWasm = require.resolve('tree-sitter-javascript/tree-sitter-javascript.wasm');
const jsDest = join(outDir, 'tree-sitter-javascript.wasm');
copyFileSync(jsWasm, jsDest);
console.log(`[copy-tree-sitter-wasm] ${jsWasm} -> ${jsDest}`);

// Copy tree-sitter-php_only.wasm — the pure-PHP grammar (no HTML embedding).
// Phase 10.2 targets `.php` source files; Blade/templating files (`.phtml`,
// `.blade.php`) are out of scope until embedded grammars are tackled.
const phpWasm = require.resolve('tree-sitter-php/tree-sitter-php_only.wasm');
const phpDest = join(outDir, 'tree-sitter-php.wasm');
copyFileSync(phpWasm, phpDest);
console.log(`[copy-tree-sitter-wasm] ${phpWasm} -> ${phpDest}`);

// Copy tree-sitter-python.wasm
const pythonWasm = require.resolve('tree-sitter-python/tree-sitter-python.wasm');
const pythonDest = join(outDir, 'tree-sitter-python.wasm');
copyFileSync(pythonWasm, pythonDest);
console.log(`[copy-tree-sitter-wasm] ${pythonWasm} -> ${pythonDest}`);

// Copy tree-sitter-c_sharp.wasm — note the underscore in the source filename.
// We rename to a hyphen on the way out so consumers don't need to know about
// the upstream package's quirk.
const csharpWasm = require.resolve('tree-sitter-c-sharp/tree-sitter-c_sharp.wasm');
const csharpDest = join(outDir, 'tree-sitter-c-sharp.wasm');
copyFileSync(csharpWasm, csharpDest);
console.log(`[copy-tree-sitter-wasm] ${csharpWasm} -> ${csharpDest}`);
