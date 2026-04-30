/**
 * Phase 13 — Incremental rescan: gap tests.
 *
 * Covers behaviors NOT in scannerRescan.test.ts:
 *  - concurrent MCP calls serialize via currentRescan
 *  - no-workspace returns informative error from the MCP tool
 *  - resolution fires exactly once per rescanFiles call
 *  - idempotency: unchanged file leaves graph labels intact
 *
 * Plus complementary scanner tests:
 *  - single-file update replaces only that file's nodes
 *  - deleted file cascades nodes and fileState
 *  - sinceMs picks up mtime-newer file, ignores unmodified file
 *  - empty path list is a no-op (resolution not triggered)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ProjectGraphDB } from '../../projectGraph/projectGraphDb.js';
import { ProjectGraphScanner, type ScanSummary } from '../../projectGraph/scanner.js';
import { TreeSitterExtractor } from '../../projectGraph/treeSitterExtractor.js';
import { McpServer, FileActivityTracker, type McpServerDeps } from '../../mcpServer.js';
import { LockManager } from '../../lockManager.js';
import { AgentStateManager } from '@event-horizon/core';
import { PlanBoardManager } from '../../planBoard.js';
import { MessageQueue } from '../../messageQueue.js';
import { RoleManager } from '../../roleManager.js';
import { AgentProfiler } from '../../agentProfiler.js';
import { SharedKnowledgeStore } from '../../sharedKnowledge.js';
import { runResolution } from '../../projectGraph/resolution.js';

// Mock the resolution pass so we can assert call-count in test 7.
// The mock returns a no-op result; real node extraction is unaffected.
vi.mock('../../projectGraph/resolution.js', () => ({
  runResolution: vi.fn(() => ({ merged: 0, unresolved: 0, totalRefs: 0 })),
}));

// ── Scanner-level tests ─────────────────────────────────────────────────────

describe('ProjectGraphScanner.rescanFiles — incremental behavior', () => {
  let workspaceDir: string;
  let db: ProjectGraphDB;
  let scanner: ProjectGraphScanner;

  beforeEach(async () => {
    vi.clearAllMocks();
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-incremental-'));
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

  it('single modified file: only that file\'s nodes change, others untouched', async () => {
    const fileA = path.join(workspaceDir, 'a.ts');
    const fileB = path.join(workspaceDir, 'b.ts');
    fs.writeFileSync(fileA, 'export function alpha() {}\n');
    fs.writeFileSync(fileB, 'export function beta() {}\n');

    await scanner.scanWorkspace();
    const store = db.getStore();
    const countB = store.getNodesByFile(fileB).length;
    expect(countB).toBeGreaterThan(0);

    fs.writeFileSync(fileA, 'export function alphaV2() {}\n');
    const summary = await scanner.rescanFiles([fileA]);

    expect(summary.filesProcessed).toBe(1);
    expect(summary.filesMatched).toBe(1);

    const nodesA = store.getNodesByFile(fileA);
    expect(nodesA.some((n) => n.label === 'alphaV2')).toBe(true);
    expect(nodesA.some((n) => n.label === 'alpha')).toBe(false);
    // fileB nodes are completely untouched
    expect(store.getNodesByFile(fileB).length).toBe(countB);
  });

  it('deleted file: cascades nodes and fileState', async () => {
    const fileC = path.join(workspaceDir, 'c.ts');
    fs.writeFileSync(fileC, 'export function gamma() {}\n');

    await scanner.scanWorkspace();
    const store = db.getStore();
    expect(store.getNodesByFile(fileC).length).toBeGreaterThan(0);
    expect(store.getFileState(fileC)).not.toBeNull();

    fs.unlinkSync(fileC);
    const summary = await scanner.rescanFiles([fileC]);

    expect(summary.filesProcessed).toBe(1);
    expect(store.getNodesByFile(fileC)).toHaveLength(0);
    expect(store.getFileState(fileC)).toBeNull();
  });

  it('sinceMs: picks up mtime-newer file, ignores unmodified file', async () => {
    const fileD = path.join(workspaceDir, 'd.ts');
    const fileE = path.join(workspaceDir, 'e.ts');
    fs.writeFileSync(fileD, 'export function delta() {}\n');
    fs.writeFileSync(fileE, 'export function epsilon() {}\n');

    await scanner.scanWorkspace();
    const since = Date.now();

    fs.writeFileSync(fileD, 'export function deltaV2() {}\n');
    const future = new Date(since + 2000);
    fs.utimesSync(fileD, future, future);

    // Empty explicit list — only sinceMs should drive which files are rescanned.
    const summary = await scanner.rescanFiles([], { sinceMs: since });

    expect(summary.filesProcessed).toBeGreaterThanOrEqual(1);
    const store = db.getStore();
    expect(store.getNodesByFile(fileD).some((n) => n.label === 'deltaV2')).toBe(true);
    // fileE predates `since` — original node still present
    expect(store.getNodesByFile(fileE).some((n) => n.label === 'epsilon')).toBe(true);
  });

  it('empty path list: no-op — filesProcessed=0 and resolution not triggered', async () => {
    const summary = await scanner.rescanFiles([]);

    expect(summary.filesProcessed).toBe(0);
    expect(summary.filesMatched).toBe(0);
    // The early-return path skips the resolution pass entirely.
    expect(summary.resolution).toBeUndefined();
    expect(vi.mocked(runResolution)).not.toHaveBeenCalled();
  });

  it('resolution fires exactly once per call regardless of file count', async () => {
    const files = ['p.ts', 'q.ts', 'r.ts'].map((f) => path.join(workspaceDir, f));
    files.forEach((f) => fs.writeFileSync(f, `export function fn_${path.basename(f, '.ts')}() {}\n`));

    await scanner.scanWorkspace();
    // Reset after scanWorkspace's own resolution call.
    vi.mocked(runResolution).mockClear();

    const summary = await scanner.rescanFiles(files);

    expect(summary.filesProcessed).toBe(3);
    // One resolution pass per rescanFiles call, not one per file.
    expect(vi.mocked(runResolution)).toHaveBeenCalledTimes(1);
  });

  it('idempotency: rescanning an unchanged file leaves graph labels intact', async () => {
    const fileF = path.join(workspaceDir, 'f.ts');
    fs.writeFileSync(fileF, 'export function stable() {}\n');

    await scanner.scanWorkspace();
    const store = db.getStore();

    const labelsBefore = store.getNodesByFile(fileF).map((n) => n.label).sort();
    const hashBefore = store.getFileState(fileF)?.contentHash;
    expect(labelsBefore.length).toBeGreaterThan(0);

    // Rescan same file with no disk change.
    await scanner.rescanFiles([fileF]);

    const labelsAfter = store.getNodesByFile(fileF).map((n) => n.label).sort();
    const hashAfter = store.getFileState(fileF)?.contentHash;

    expect(labelsAfter).toEqual(labelsBefore);
    expect(hashAfter).toBe(hashBefore);
  });
});

// ── MCP tool tests ──────────────────────────────────────────────────────────

function makeMcp(extra: Partial<McpServerDeps> = {}): McpServer {
  return new McpServer({
    lockManager: new LockManager(100),
    agentStateManager: new AgentStateManager(),
    fileActivityTracker: new FileActivityTracker(),
    planBoardManager: new PlanBoardManager(),
    messageQueue: new MessageQueue(),
    roleManager: new RoleManager(),
    agentProfiler: new AgentProfiler(),
    sharedKnowledge: new SharedKnowledgeStore(),
    ...extra,
  });
}

describe('eh_rescan_files MCP tool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('concurrent calls serialize — second call waits for first', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;

    const mockRescanFiles = vi.fn(async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise<void>((r) => setTimeout(r, 20));
      concurrent--;
      return {
        filesProcessed: 1, filesSkipped: 0, nodesCreated: 0,
        edgesCreated: 0, durationMs: 20, filesMatched: 1,
      } as ScanSummary;
    });

    const mcp = makeMcp({
      projectGraphScanner: { rescanFiles: mockRescanFiles } as unknown as ProjectGraphScanner,
    });

    const callRescan = (paths: string[]) =>
      mcp.handleRequest({
        jsonrpc: '2.0', method: 'tools/call',
        params: { name: 'eh_rescan_files', arguments: { paths } }, id: 1,
      });

    await Promise.all([callRescan(['a.ts']), callRescan(['b.ts'])]);

    // If calls were concurrent, maxConcurrent would be 2.
    expect(maxConcurrent).toBe(1);
    expect(mockRescanFiles).toHaveBeenCalledTimes(2);
  });

  it('no-workspace: returns informative error without calling the scanner', async () => {
    const mockScanner = { rescanFiles: vi.fn() } as unknown as ProjectGraphScanner;
    const mockLifecycle = {
      getActiveStore: () => null,
    } as unknown as McpServerDeps['projectGraphLifecycle'];

    const mcp = makeMcp({
      projectGraphScanner: mockScanner,
      projectGraphLifecycle: mockLifecycle,
    });

    const res = await mcp.handleRequest({
      jsonrpc: '2.0', method: 'tools/call',
      params: { name: 'eh_rescan_files', arguments: { paths: [] } }, id: 1,
    });

    const content = (res.result as { content: Array<{ text: string }> }).content[0];
    const parsed = JSON.parse(content.text);

    expect(parsed.ok).toBe(false);
    expect(parsed.error).toMatch(/workspace/i);
    expect(mockScanner.rescanFiles).not.toHaveBeenCalled();
  });
});
