#!/usr/bin/env node
/**
 * Standalone verification: bundle a tiny CJS that uses web-tree-sitter
 * with the same banner+define polyfill, then run it. If Parser.init
 * succeeds + a TS sample produces a function node, the polyfill works.
 */
import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import * as url from 'url';
import { execFileSync } from 'child_process';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const tmpEntry = path.join(root, 'out', '__verify-entry.mjs');
const tmpBundle = path.join(root, 'out', '__verify-bundle.cjs');

const entrySource = `
import { Parser, Language } from 'web-tree-sitter';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  console.log('[verify] calling Parser.init...');
  // Mirror the extension: TreeSitterExtractor always passes a locateFile hook,
  // so that is the path worth verifying. Bare Parser.init() would instead test
  // emscripten's default lookup, which the extension never uses — and which
  // changed name in 0.26 ('tree-sitter.wasm' -> 'web-tree-sitter.wasm'),
  // failing here for a reason that does not apply to the shipped code.
  await Parser.init({
    locateFile: () => path.join(${JSON.stringify(root)}, 'out', 'tree-sitter.wasm'),
  });
  console.log('[verify] Parser.init OK');

  const wasmPath = path.join(${JSON.stringify(root)}, 'out', 'tree-sitter-typescript.wasm');
  console.log('[verify] loading TS grammar from buffer...');
  const buf = fs.readFileSync(wasmPath);
  const lang = await Language.load(buf);
  console.log('[verify] grammar loaded OK');

  const parser = new Parser();
  parser.setLanguage(lang);
  const tree = parser.parse('function hello() { return 1; }');
  const root = tree.rootNode;
  const fnNode = root.descendantsOfType('function_declaration')[0];
  if (!fnNode) {
    console.error('[verify] FAIL: no function node parsed');
    process.exit(1);
  }
  console.log('[verify] parsed function:', fnNode.childForFieldName('name')?.text);
  console.log('[verify] PASS');
}
main().catch((e) => { console.error('[verify] FAIL', e); process.exit(1); });
`;

fs.writeFileSync(tmpEntry, entrySource);

await esbuild.build({
  entryPoints: [tmpEntry],
  outfile: tmpBundle,
  bundle: true,
  format: 'cjs',
  platform: 'node',
  banner: {
    js: 'var __importMetaUrl = require("url").pathToFileURL(__filename).href;',
  },
  define: {
    'import.meta.url': '__importMetaUrl',
  },
});

console.log('[verify] bundled, executing...');
try {
  const out = execFileSync(process.execPath, [tmpBundle], { encoding: 'utf8' });
  console.log(out);
} catch (e) {
  console.error('[verify] execution failed');
  console.error(e.stdout || '');
  console.error(e.stderr || '');
  process.exit(1);
} finally {
  fs.rmSync(tmpEntry, { force: true });
  fs.rmSync(tmpBundle, { force: true });
  fs.rmSync(tmpBundle + '.map', { force: true });
}
