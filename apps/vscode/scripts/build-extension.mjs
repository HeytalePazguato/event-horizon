#!/usr/bin/env node
/**
 * Build the extension bundle with esbuild.
 *
 * The banner + define pair below polyfills `import.meta.url` for any ESM
 * code that gets pulled into the CJS bundle. `web-tree-sitter` v0.25
 * specifically calls `createRequire(import.meta.url)` inside `Parser.init`;
 * when bundled to CJS without this polyfill, `import.meta.url` is
 * `undefined` and the runtime throws
 *
 *     TypeError: The argument 'filename' must be a file URL object,
 *     file URL string, or absolute path string. Received undefined
 *
 * — which kills every grammar load, leaves the project graph populated
 * only with markdown nodes, and was the actual cause of the v3.0.0
 * "graph contains only docs" bug.
 */

import * as esbuild from 'esbuild';
import { argv } from 'node:process';

const isProd = argv.includes('--prod');

await esbuild.build({
  entryPoints: ['src/extension.ts'],
  outfile: 'out/extension.js',
  bundle: true,
  format: 'cjs',
  platform: 'node',
  external: ['vscode'],
  minify: isProd,
  sourcemap: isProd ? 'linked' : true,
  banner: {
    // Make import.meta.url resolvable inside the bundled CJS context.
    // Native CJS modules have __filename; we convert it to a file:// URL
    // so any code that does `createRequire(import.meta.url)` finds a
    // valid path. Works in both prod (minified) and dev (sourcemap) builds.
    js: 'var __importMetaUrl = require("url").pathToFileURL(__filename).href;',
  },
  define: {
    'import.meta.url': '__importMetaUrl',
  },
});
