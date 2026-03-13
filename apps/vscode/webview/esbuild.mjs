import * as esbuild from 'esbuild';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const minify = process.argv.includes('--minify');

const pixiSetup = path.resolve(__dirname, 'pixi-setup.ts');

// Resolve the pixi.js package directory from the renderer
const rendererDir = path.resolve(__dirname, '..', '..', '..', 'packages', 'renderer');
const rendererRequire = createRequire(path.join(rendererDir, 'package.json'));
const pixiEntry = rendererRequire.resolve('pixi.js');
const pixiDir = path.resolve(pixiEntry, '..', '..');  // lib/index.js → pixi.js/

/**
 * pixi-lite plugin:
 * 1. Bare `pixi.js` → our lightweight pixi-setup.ts
 * 2. `pixi.js/internal/*` → actual pixi.js/lib/* files on disk (bypasses exports map)
 */
const pixiLitePlugin = {
  name: 'pixi-lite',
  setup(build) {
    // Bare 'pixi.js' → lightweight setup
    build.onResolve({ filter: /^pixi\.js$/ }, () => ({
      path: pixiSetup,
    }));

    // pixi.js/internal/* → pixi.js/lib/* on disk
    build.onResolve({ filter: /^pixi\.js\/internal\// }, (args) => ({
      path: path.join(pixiDir, 'lib', args.path.replace('pixi.js/internal/', '')),
    }));

    // pixi.js/* subpath imports (pixi.js/app, pixi.js/graphics, etc.)
    // Resolve using the renderer's node_modules since pixi.js isn't a direct dep of vscode
    build.onResolve({ filter: /^pixi\.js\/.+/ }, (args) => ({
      path: rendererRequire.resolve(args.path),
    }));
  },
};

await esbuild.build({
  entryPoints: [path.resolve(__dirname, 'index.tsx')],
  bundle: true,
  outfile: path.resolve(__dirname, '..', 'webview-dist', 'main.js'),
  format: 'iife',
  platform: 'browser',
  loader: { '.tsx': 'tsx', '.ts': 'ts' },
  jsx: 'automatic',
  treeShaking: true,
  minify,
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  plugins: [pixiLitePlugin],
});
