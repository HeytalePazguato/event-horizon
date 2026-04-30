/**
 * ProjectGraphScanner.rescanFiles — incremental rescan API tests.
 *
 * Covers:
 *  - empty array returns no-op summary without throwing
 *  - rescan one file re-extracts only that file
 *  - rescan three files processes all three, leaves others untouched
 *  - rescan a now-deleted file cascades (nodes + edges removed)
 *  - sinceMs picks up an externally mtime'd file not in the explicit path list
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ProjectGraphDB } from '../../projectGraph/projectGraphDb.js';
import { ProjectGraphScanner } from '../../projectGraph/scanner.js';
import { TreeSitterExtractor } from '../../projectGraph/treeSitterExtractor.js';

describe('ProjectGraphScanner.rescanFiles', () => {
  let workspaceDir: string;
  let db: ProjectGraphDB;
  let scanner: ProjectGraphScanner;

  beforeEach(async () => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-rescan-'));

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
    try { fs.rmSync(workspaceDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  it('empty array returns no-op summary without throwing', async () => {
    const summary = await scanner.rescanFiles([]);
    expect(summary.filesProcessed).toBe(0);
    expect(summary.filesSkipped).toBe(0);
    expect(summary.filesMatched).toBe(0);
    expect(summary.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('rescan one file re-extracts only that file', async () => {
    const fileA = path.join(workspaceDir, 'a.ts');
    const fileB = path.join(workspaceDir, 'b.ts');
    fs.writeFileSync(fileA, 'export function alpha() {}\n');
    fs.writeFileSync(fileB, 'export function beta() {}\n');

    // Initial full scan so both files are indexed.
    await scanner.scanWorkspace();
    const store = db.getStore();
    const beforeA = store.getNodesByFile(fileA);
    const beforeB = store.getNodesByFile(fileB);
    expect(beforeA.length).toBeGreaterThan(0);
    expect(beforeB.length).toBeGreaterThan(0);

    // Update only fileA on disk.
    fs.writeFileSync(fileA, 'export function alphaUpdated() {}\n');

    const summary = await scanner.rescanFiles([fileA]);

    // One file processed, fileB's nodes untouched.
    expect(summary.filesProcessed).toBe(1);
    expect(summary.filesMatched).toBe(1);

    const afterA = store.getNodesByFile(fileA);
    const afterB = store.getNodesByFile(fileB);

    // fileA nodes updated (label should reflect the new function name).
    expect(afterA.some((n) => n.label === 'alphaUpdated')).toBe(true);
    expect(afterA.some((n) => n.label === 'alpha')).toBe(false);

    // fileB nodes completely untouched.
    expect(afterB.length).toBe(beforeB.length);
    expect(afterB.some((n) => n.label === 'beta')).toBe(true);
  });

  it('rescan three files processes all three', async () => {
    const files = ['x.ts', 'y.ts', 'z.ts'].map((f) => path.join(workspaceDir, f));
    files.forEach((f) => fs.writeFileSync(f, `export function fn_${path.basename(f, '.ts')}() {}\n`));

    await scanner.scanWorkspace();

    // Update all three.
    files.forEach((f) => fs.writeFileSync(f, `export function fn_${path.basename(f, '.ts')}_v2() {}\n`));

    const summary = await scanner.rescanFiles(files);
    expect(summary.filesProcessed).toBe(3);
    expect(summary.filesMatched).toBe(3);

    const store = db.getStore();
    for (const f of files) {
      const nodes = store.getNodesByFile(f);
      expect(nodes.some((n) => n.label.endsWith('_v2'))).toBe(true);
    }
  });

  it('rescan a deleted file cascades nodes and file_state', async () => {
    const fileC = path.join(workspaceDir, 'c.ts');
    fs.writeFileSync(fileC, 'export function gamma() {}\n');

    await scanner.scanWorkspace();
    const store = db.getStore();
    expect(store.getNodesByFile(fileC).length).toBeGreaterThan(0);
    expect(store.getFileState(fileC)).not.toBeNull();

    // Delete the file on disk.
    fs.unlinkSync(fileC);

    const summary = await scanner.rescanFiles([fileC]);

    // Deletion counted as processed (not skipped).
    expect(summary.filesProcessed).toBe(1);

    // Nodes and file state should be gone.
    expect(store.getNodesByFile(fileC)).toHaveLength(0);
    expect(store.getFileState(fileC)).toBeNull();
  });

  it('sinceMs picks up an externally mtime-bumped file', async () => {
    const fileD = path.join(workspaceDir, 'd.ts');
    const fileE = path.join(workspaceDir, 'e.ts');
    fs.writeFileSync(fileD, 'export function delta() {}\n');
    fs.writeFileSync(fileE, 'export function epsilon() {}\n');

    await scanner.scanWorkspace();

    const since = Date.now();

    // Update fileD after the `since` timestamp.
    fs.writeFileSync(fileD, 'export function deltaUpdated() {}\n');
    // Touch mtime explicitly to be sure it's > since.
    const futureTime = new Date(since + 2000);
    fs.utimesSync(fileD, futureTime, futureTime);

    // fileE is NOT updated — its mtime is before `since`.

    // Rescan with empty explicit list but sinceMs set.
    const summary = await scanner.rescanFiles([], { sinceMs: since });

    expect(summary.filesProcessed).toBeGreaterThanOrEqual(1);

    const store = db.getStore();
    const nodesD = store.getNodesByFile(fileD);
    expect(nodesD.some((n) => n.label === 'deltaUpdated')).toBe(true);

    // fileE was not touched — still has the original node.
    const nodesE = store.getNodesByFile(fileE);
    expect(nodesE.some((n) => n.label === 'epsilon')).toBe(true);
  });
});
