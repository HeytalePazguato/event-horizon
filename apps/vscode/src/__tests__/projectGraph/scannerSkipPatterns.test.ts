/**
 * Scanner skip-pattern tests — fixture workspace with a vendor dir, a
 * minified bundle, and an oversized file. Only the normal source file
 * should produce nodes after a scan.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ProjectGraphDB } from '../../projectGraph/projectGraphDb.js';
import { ProjectGraphScanner } from '../../projectGraph/scanner.js';
import { TreeSitterExtractor } from '../../projectGraph/treeSitterExtractor.js';

describe('ProjectGraphScanner skip patterns', () => {
  let workspaceDir: string;
  let db: ProjectGraphDB;
  let scanner: ProjectGraphScanner;

  beforeEach(async () => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-scan-skip-'));

    // Real source file — should be scanned.
    fs.writeFileSync(path.join(workspaceDir, 'app.ts'), 'export function hello() {}\n');

    // Vendor dir — entire subtree should be skipped via SKIP_DIRS.
    const vendorDir = path.join(workspaceDir, 'vendor', 'foo');
    fs.mkdirSync(vendorDir, { recursive: true });
    fs.writeFileSync(path.join(vendorDir, 'bundled.ts'), 'export function vendorFn() {}\n');

    // Minified file — basename pattern match should skip.
    fs.writeFileSync(path.join(workspaceDir, 'lib.min.js'), 'function a(){}function b(){}\n');

    // Oversized file — pre-`tooLarge` cap.
    const big = 'x'.repeat(300 * 1024); // 300 KB > 256 KB default
    fs.writeFileSync(path.join(workspaceDir, 'huge.js'), `// ${big}\nfunction huge() {}\n`);

    // Bundled-by-content file (passes filename + size, fails minified heuristic).
    const longLine = 'function a(){}'.repeat(200); // > 1000 chars on one line
    fs.writeFileSync(path.join(workspaceDir, 'inline-bundle.js'), `${longLine}\n`);

    // Mock vscode workspace folder for the scanner's workspace check.
    (vscode.workspace as unknown as { workspaceFolders: { uri: { fsPath: string } }[] }).workspaceFolders = [
      { uri: { fsPath: workspaceDir } },
    ];

    db = await ProjectGraphDB.create();
    const ts = new TreeSitterExtractor();
    scanner = new ProjectGraphScanner(
      db.getStore(),
      { treeSitter: ts },
      { workspaceFolder: workspaceDir, maxFiles: 1000, includeMarkdown: false },
    );
  });

  afterEach(async () => {
    db.close();
    try { fs.rmSync(workspaceDir, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  it('only the normal source file produces graph nodes', async () => {
    const summary = await scanner.scanWorkspace();

    // Vendor dir, minified file, oversized file, inline-bundle file all
    // skipped one way or another. Only `app.ts` makes it through.
    expect(summary.filesProcessed).toBe(1);

    // The store should reflect that — one tracked file.
    expect(db.getStore().getTrackedFiles()).toEqual([path.join(workspaceDir, 'app.ts')]);

    // Skip reasons surface why each file was filtered.
    const reasons = summary.skipReasons!;
    expect(reasons.minified).toBeGreaterThanOrEqual(1); // inline-bundle.js
    expect(reasons.tooLarge).toBeGreaterThanOrEqual(1); // huge.js

    // Vendor dir is skipped at walk time, not as per-file `minified`/`tooLarge`,
    // so its files never appear in the matched count.
    expect(summary.filesMatched).toBeLessThanOrEqual(3); // app.ts + lib.min.js (filtered) + huge.js + inline-bundle.js — vendor not enumerated
  });
});
