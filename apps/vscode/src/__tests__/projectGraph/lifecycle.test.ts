/**
 * ProjectGraphLifecycle tests — verify the user-triggered rule:
 *
 *   - `attachIfExists(folder)` reads but never writes. No `.eh/` directory,
 *     no `.gitignore`, no empty DB file get created.
 *   - `openForBuild(folder)` is the ONE code path allowed to create files.
 *
 * The skill `/eh:optimize-context` is the user-facing trigger that reaches
 * `openForBuild` (via the `eh_build_graph` MCP handler).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ProjectGraphLifecycle } from '../../projectGraph/lifecycle.js';
import type { GraphNode } from '../../projectGraph/index.js';

function tmpWorkspace(label: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `eh-lifecycle-${label}-`));
}

function makeNode(id: string): GraphNode {
  const now = Date.now();
  return {
    id,
    label: id,
    type: 'function',
    sourceFile: '/abs/path/example.ts',
    sourceLocation: '1-10',
    properties: {},
    tag: 'EXTRACTED',
    confidence: 1.0,
    createdAt: now,
    updatedAt: now,
  };
}

describe('ProjectGraphLifecycle', () => {
  const workspaces: string[] = [];

  function newWorkspace(label = 'a'): string {
    const w = tmpWorkspace(label);
    workspaces.push(w);
    return w;
  }

  let lifecycle: ProjectGraphLifecycle;

  beforeEach(() => {
    lifecycle = new ProjectGraphLifecycle();
  });

  afterEach(async () => {
    await lifecycle.closeActive();
    lifecycle.dispose();
    for (const w of workspaces) {
      try { fs.rmSync(w, { recursive: true, force: true }); } catch { /* best effort */ }
    }
    workspaces.length = 0;
  });

  // ── attachIfExists: read-only ──────────────────────────────────────────

  it('attachIfExists on a folder with no graph file does NOT create .eh/, .gitignore, or graph.db', async () => {
    const ws = newWorkspace('clean');
    await lifecycle.attachIfExists(ws);

    expect(fs.existsSync(path.join(ws, '.eh'))).toBe(false);
    expect(fs.existsSync(path.join(ws, '.eh', '.gitignore'))).toBe(false);
    expect(fs.existsSync(path.join(ws, '.eh', 'graph.db'))).toBe(false);

    // The folder is tracked (so the build handler knows which folder is current),
    // but the store is null because no graph DB exists yet.
    expect(lifecycle.getActiveWorkspace()).toBe(path.resolve(ws));
    expect(lifecycle.getActiveStore()).toBeNull();
  });

  it('attachIfExists opens an existing graph.db produced by a prior build', async () => {
    const ws = newWorkspace('preexisting');

    // Simulate a prior `/eh:optimize-context` run.
    await lifecycle.openForBuild(ws);
    lifecycle.getActiveStore()!.upsertNode(makeNode('persisted'));
    await lifecycle.closeActive();

    // Activation re-attaches via attachIfExists.
    await lifecycle.attachIfExists(ws);
    const store = lifecycle.getActiveStore();
    expect(store).not.toBeNull();
    expect(store!.getNodeById('persisted')).not.toBeNull();
  });

  it('openForBuild starts fresh: stale rows from a prior build do NOT carry over', async () => {
    const ws = newWorkspace('rebuild');

    // First build seeds the graph and persists.
    await lifecycle.openForBuild(ws);
    lifecycle.getActiveStore()!.upsertNode(makeNode('first-build'));
    await lifecycle.closeActive();

    // Second build (e.g. user re-runs /eh:optimize-context) must NOT
    // carry over the prior node — the user expects a clean rebuild.
    await lifecycle.openForBuild(ws);
    const store = lifecycle.getActiveStore();
    expect(store).not.toBeNull();
    expect(store!.getNodeById('first-build')).toBeNull();
  });

  it('notifyDataChange fires onDataChange listeners', async () => {
    const ws = newWorkspace('datachange');
    await lifecycle.openForBuild(ws);

    let fired = 0;
    lifecycle.onDataChange(() => { fired++; });
    lifecycle.notifyDataChange();
    lifecycle.notifyDataChange();
    expect(fired).toBe(2);
  });

  // ── openForBuild: create-mode ──────────────────────────────────────────

  it('openForBuild creates .eh/ + .gitignore + graph.db on a clean folder', async () => {
    const ws = newWorkspace('build');
    const store = await lifecycle.openForBuild(ws);
    expect(store).not.toBeNull();

    expect(fs.existsSync(path.join(ws, '.eh'))).toBe(true);
    const gitignore = fs.readFileSync(path.join(ws, '.eh', '.gitignore'), 'utf8');
    expect(gitignore).toContain('*.db');

    // Push a row + close so the file is flushed.
    store.upsertNode(makeNode('n1'));
    await lifecycle.closeActive();
    expect(fs.existsSync(path.join(ws, '.eh', 'graph.db'))).toBe(true);
    expect(fs.statSync(path.join(ws, '.eh', 'graph.db')).size).toBeGreaterThan(0);
  });

  it('openForBuild does NOT overwrite a user-customised .gitignore', async () => {
    const ws = newWorkspace('userGitignore');
    const ehDir = path.join(ws, '.eh');
    fs.mkdirSync(ehDir, { recursive: true });
    fs.writeFileSync(path.join(ehDir, '.gitignore'), '# user notes\n*.db\n', 'utf8');

    await lifecycle.openForBuild(ws);
    const finalContent = fs.readFileSync(path.join(ehDir, '.gitignore'), 'utf8');
    expect(finalContent).toBe('# user notes\n*.db\n');
  });

  it('openForBuild upgrades an attachIfExists-tracked folder in place', async () => {
    const ws = newWorkspace('upgrade');
    await lifecycle.attachIfExists(ws);
    expect(lifecycle.getActiveStore()).toBeNull();

    const store = await lifecycle.openForBuild(ws);
    expect(store).not.toBeNull();
    expect(lifecycle.getActiveWorkspace()).toBe(path.resolve(ws));
  });

  // ── Lifecycle behaviors ────────────────────────────────────────────────

  it('closeActive flushes dirty state to disk', async () => {
    const ws = newWorkspace('flush');
    const store = await lifecycle.openForBuild(ws);
    store.upsertNode(makeNode('flush-me'));

    await lifecycle.closeActive();

    expect(fs.existsSync(path.join(ws, '.eh', 'graph.db'))).toBe(true);
    expect(lifecycle.getActiveStore()).toBeNull();
    expect(lifecycle.getActiveWorkspace()).toBeNull();
  });

  it('attaching from workspace A to B closes A and tracks B (no files created in B)', async () => {
    const wsA = newWorkspace('a');
    const wsB = newWorkspace('b');

    await lifecycle.openForBuild(wsA);
    expect(lifecycle.getActiveWorkspace()).toBe(path.resolve(wsA));

    await lifecycle.attachIfExists(wsB);
    expect(lifecycle.getActiveWorkspace()).toBe(path.resolve(wsB));
    expect(lifecycle.getActiveStore()).toBeNull();
    expect(fs.existsSync(path.join(wsB, '.eh'))).toBe(false);
  });

  it('attachIfExists on the same workspace twice is a no-op', async () => {
    const ws = newWorkspace('idem');
    await lifecycle.attachIfExists(ws);
    const ws1 = lifecycle.getActiveWorkspace();
    await lifecycle.attachIfExists(ws);
    expect(lifecycle.getActiveWorkspace()).toBe(ws1);
  });

  it('with no folder ever attached, getActiveStore and getActiveWorkspace return null', () => {
    expect(lifecycle.getActiveStore()).toBeNull();
    expect(lifecycle.getActiveWorkspace()).toBeNull();
  });

  it('emits onActiveStoreChange in the right order when transitioning attach → build → close', async () => {
    const ws = newWorkspace('emit');
    const seen: Array<'store' | 'null'> = [];
    lifecycle.onActiveStoreChange((s) => {
      seen.push(s ? 'store' : 'null');
    });

    await lifecycle.attachIfExists(ws);  // no DB yet → fires null
    await lifecycle.openForBuild(ws);    // creates DB → fires store
    await lifecycle.closeActive();       // → fires null

    expect(seen).toEqual(['null', 'store', 'null']);
  });
});
