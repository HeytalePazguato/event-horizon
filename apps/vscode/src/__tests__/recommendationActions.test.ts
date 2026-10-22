/**
 * Recommendation action dispatcher tests — each action kind, relative paths,
 * secret-gated refusal and failure reporting.
 */

import * as path from 'path';
import { describe, it, expect, vi } from 'vitest';
import { dispatchRecommendationAction, type RecommendationActionDeps } from '../recommendationActions.js';

const ROOT = path.resolve('/work/repo');

function deps(over: Partial<RecommendationActionDeps> = {}) {
  const knowledge: Array<[string, string]> = [];
  const posted: Array<Record<string, unknown>> = [];
  const broadcasts: string[] = [];
  const opened: string[] = [];
  const d: RecommendationActionDeps = {
    workspaceRoot: ROOT,
    readFile: async () => 'export const x = 1;\n',
    buildDigest: async (p) => `${p} (1 lines)\nRead ${p} for full contents.`,
    writeKnowledge: (k, v) => { knowledge.push([k, v]); },
    openFile: async (p) => { opened.push(p); },
    broadcast: (m) => { broadcasts.push(m); },
    postToWebview: (m) => { posted.push(m); },
    ...over,
  };
  return { d, knowledge, posted, broadcasts, opened };
}

describe('dispatchRecommendationAction', () => {
  it('add-to-knowledge stores the digest under the absolute path', async () => {
    const t = deps();
    const file = path.join(ROOT, 'src', 'auth.ts');
    const r = await dispatchRecommendationAction({ kind: 'add-to-knowledge', filePath: file }, t.d);
    expect(r).toMatchObject({ ok: true, knowledgeKey: file });
    expect(t.knowledge).toEqual([[file, `${file} (1 lines)\nRead ${file} for full contents.`]]);
  });

  it('resolves a relative path against the workspace root', async () => {
    const t = deps();
    const r = await dispatchRecommendationAction({ kind: 'add-to-knowledge', filePath: 'src/auth.ts' }, t.d);
    expect(r.knowledgeKey).toBe(path.join(ROOT, 'src', 'auth.ts'));
  });

  it('refuses secret files and writes nothing', async () => {
    const t = deps({ buildDigest: async () => null });
    const r = await dispatchRecommendationAction({ kind: 'add-to-knowledge', filePath: path.join(ROOT, '.env') }, t.d);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/secrets/);
    expect(t.knowledge).toEqual([]);
  });

  it('reports a file that cannot be read', async () => {
    const t = deps({ readFile: async () => { throw new Error('ENOENT'); } });
    const r = await dispatchRecommendationAction({ kind: 'add-to-knowledge', filePath: '/nope.ts' }, t.d);
    expect(r).toMatchObject({ ok: false });
    expect(t.knowledge).toEqual([]);
  });

  it('open-file opens the resolved path', async () => {
    const t = deps();
    const r = await dispatchRecommendationAction({ kind: 'open-file', filePath: 'src/a.ts' }, t.d);
    expect(r.ok).toBe(true);
    expect(t.opened).toEqual([path.join(ROOT, 'src', 'a.ts')]);
  });

  it('open-file reports failure', async () => {
    const t = deps({ openFile: vi.fn(async () => { throw new Error('nope'); }) });
    expect((await dispatchRecommendationAction({ kind: 'open-file', filePath: '/a.ts' }, t.d)).ok).toBe(false);
  });

  it('broadcast sends the message to every agent', async () => {
    const t = deps();
    expect((await dispatchRecommendationAction({ kind: 'broadcast', message: 'stop re-reading auth.ts' }, t.d)).ok).toBe(true);
    expect(t.broadcasts).toEqual(['stop re-reading auth.ts']);
  });

  it('focus-agent and open-task navigate the webview', async () => {
    const t = deps();
    await dispatchRecommendationAction({ kind: 'focus-agent', agentId: 'a1' }, t.d);
    await dispatchRecommendationAction({ kind: 'open-task', taskId: '2.1' }, t.d);
    expect(t.posted).toEqual([{ type: 'focus-agent', agentId: 'a1' }, { type: 'open-plan-task', taskId: '2.1' }]);
  });
});
