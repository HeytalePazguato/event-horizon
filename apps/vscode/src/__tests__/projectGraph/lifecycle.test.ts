/**
 * ProjectGraphLifecycle tests — open/close, workspace swap, .gitignore
 * provisioning, dirty-flush behavior, no-folder posture.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ProjectGraphLifecycle } from '../../projectGraph/lifecycle.js';
import type { GraphNode } from '../../projectGraph/index.js';

function tmpWorkspace(label: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `eh-lifecycle-${label}-`));
  return root;
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

  it('opens DB at <workspace>/.eh/graph.db and exposes a non-null active store', async () => {
    const ws = newWorkspace('open');
    await lifecycle.openForWorkspace(ws);

    const store = lifecycle.getActiveStore();
    expect(store).not.toBeNull();

    const expectedPath = path.join(path.resolve(ws), '.eh', 'graph.db');
    expect(lifecycle.getActiveDbPath()).toBe(expectedPath);
    expect(lifecycle.getActiveWorkspace()).toBe(path.resolve(ws));
  });

  it('writes .eh/.gitignore on first open and does NOT overwrite a user-customised one', async () => {
    const ws = newWorkspace('gi');
    await lifecycle.openForWorkspace(ws);

    const gitignorePath = path.join(ws, '.eh', '.gitignore');
    expect(fs.existsSync(gitignorePath)).toBe(true);
    const initialContent = fs.readFileSync(gitignorePath, 'utf8');
    expect(initialContent).toContain('*.db');

    await lifecycle.closeActive();

    // User customises the .gitignore
    fs.writeFileSync(gitignorePath, '# user notes\n*.db\n', 'utf8');

    await lifecycle.openForWorkspace(ws);
    const finalContent = fs.readFileSync(gitignorePath, 'utf8');
    expect(finalContent).toBe('# user notes\n*.db\n');
  });

  it('closeActive flushes dirty state to disk', async () => {
    const ws = newWorkspace('flush');
    await lifecycle.openForWorkspace(ws);

    const store = lifecycle.getActiveStore();
    expect(store).not.toBeNull();
    store!.upsertNode(makeNode('n1'));

    await lifecycle.closeActive();

    const dbPath = path.join(ws, '.eh', 'graph.db');
    expect(fs.existsSync(dbPath)).toBe(true);
    expect(fs.statSync(dbPath).size).toBeGreaterThan(0);
    expect(lifecycle.getActiveStore()).toBeNull();
  });

  it('swap from workspace A to B closes A and opens B', async () => {
    const wsA = newWorkspace('a');
    const wsB = newWorkspace('b');
    const seen: Array<string | null> = [];

    lifecycle.onActiveStoreChange((s) => {
      seen.push(s ? lifecycle.getActiveWorkspace() : null);
    });

    await lifecycle.openForWorkspace(wsA);
    expect(lifecycle.getActiveWorkspace()).toBe(path.resolve(wsA));

    await lifecycle.openForWorkspace(wsB);
    expect(lifecycle.getActiveWorkspace()).toBe(path.resolve(wsB));

    // Emitter sequence: open A → close A (null) → open B
    expect(seen[0]).toBe(path.resolve(wsA));
    expect(seen[1]).toBeNull();
    expect(seen[2]).toBe(path.resolve(wsB));
  });

  it('opening the same workspace twice is a no-op (no swap)', async () => {
    const ws = newWorkspace('idem');
    await lifecycle.openForWorkspace(ws);
    const store1 = lifecycle.getActiveStore();
    await lifecycle.openForWorkspace(ws);
    const store2 = lifecycle.getActiveStore();
    expect(store2).toBe(store1);
  });

  it('with no folder ever opened, getActiveStore returns null', () => {
    expect(lifecycle.getActiveStore()).toBeNull();
    expect(lifecycle.getActiveWorkspace()).toBeNull();
  });

  it('persists a buffer across open/close cycles', async () => {
    const ws = newWorkspace('persist');
    await lifecycle.openForWorkspace(ws);

    const storeA = lifecycle.getActiveStore()!;
    storeA.upsertNode(makeNode('persist-1'));
    await lifecycle.closeActive();

    // Re-open the same workspace, expect the node survives
    await lifecycle.openForWorkspace(ws);
    const storeB = lifecycle.getActiveStore()!;
    const found = storeB.getNodeById('persist-1');
    expect(found).not.toBeNull();
    expect(found!.label).toBe('persist-1');
  });
});
