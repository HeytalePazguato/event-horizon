import { describe, it, expect, beforeEach } from 'vitest';
import { SharedKnowledgeStore } from '../sharedKnowledge.js';

describe('SharedKnowledgeStore.source field', () => {
  let store: SharedKnowledgeStore;

  beforeEach(() => {
    store = new SharedKnowledgeStore();
  });

  it('round-trips source="auto" through write/read', () => {
    store.write('foo', 'bar', 'workspace', 'Event Horizon', 'system', undefined, undefined, 'L1', 'auto');
    const entries = store.read('foo');
    expect(entries).toHaveLength(1);
    expect(entries[0].source).toBe('auto');
  });

  it('round-trips source="user" through write/read', () => {
    store.write('foo', 'bar', 'workspace', 'human', 'user', undefined, undefined, 'L0', 'user');
    expect(store.read('foo')[0].source).toBe('user');
  });

  it('round-trips source="agent" through write/read', () => {
    store.write('foo', 'bar', 'plan', 'claude-code', 'agent-42', 'plan-1', undefined, 'L2', 'agent');
    expect(store.read('foo', 'plan-1')[0].source).toBe('agent');
  });

  it('preserves existing source when tier is updated and no new source provided', () => {
    store.write('foo', 'v1', 'workspace', 'human', 'user', undefined, undefined, 'L1', 'user');
    store.write('foo', 'v2', 'workspace', 'human', 'user');
    expect(store.read('foo')[0].source).toBe('user');
  });
});

describe('SharedKnowledgeStore.writeIfNotUserAuthored', () => {
  let store: SharedKnowledgeStore;

  beforeEach(() => {
    store = new SharedKnowledgeStore();
  });

  it('writes an auto entry when no prior entry exists', () => {
    const entry = store.writeIfNotUserAuthored('k', 'v', 'workspace', 'Event Horizon', 'system', undefined, undefined, 'L1');
    expect(entry).not.toBeNull();
    expect(entry?.source).toBe('auto');
    expect(entry?.value).toBe('v');
  });

  it('preserves user-authored entries with the same key', () => {
    store.write('k', 'user content', 'workspace', 'human', 'user', undefined, undefined, 'L0', 'user');
    const result = store.writeIfNotUserAuthored('k', 'auto content', 'workspace', 'Event Horizon', 'system', undefined, undefined, 'L1');
    expect(result?.value).toBe('user content');
    expect(result?.source).toBe('user');
    expect(result?.tier).toBe('L0');
  });

  it('preserves agent-authored entries with the same key', () => {
    store.write('k', 'agent content', 'workspace', 'claude-code', 'agent-7', undefined, undefined, 'L1', 'agent');
    const result = store.writeIfNotUserAuthored('k', 'auto content', 'workspace', 'Event Horizon', 'system', undefined, undefined, 'L1');
    expect(result?.value).toBe('agent content');
    expect(result?.source).toBe('agent');
  });

  it('overwrites prior auto entries (re-scan case)', () => {
    store.writeIfNotUserAuthored('k', 'v1', 'workspace', 'Event Horizon', 'system', undefined, undefined, 'L1');
    const result = store.writeIfNotUserAuthored('k', 'v2', 'workspace', 'Event Horizon', 'system', undefined, undefined, 'L1');
    expect(result?.value).toBe('v2');
    expect(result?.source).toBe('auto');
  });

  it('works for plan scope as well', () => {
    store.writeIfNotUserAuthored('k', 'v', 'plan', 'Event Horizon', 'system', 'plan-1', undefined, 'L2');
    const entries = store.getAllEntries('plan-1').plan;
    expect(entries).toHaveLength(1);
    expect(entries[0].source).toBe('auto');
  });
});

describe('SharedKnowledgeStore.getAllEntries', () => {
  it('returns workspace and plan arrays without duplicating entries', () => {
    const store = new SharedKnowledgeStore();
    store.write('ws-1', 'x', 'workspace', 'Event Horizon', 'system');
    store.write('ws-2', 'y', 'workspace', 'Event Horizon', 'system');
    store.write('plan-1', 'z', 'plan', 'Event Horizon', 'system', 'my-plan');
    const { workspace, plan } = store.getAllEntries('my-plan');
    expect(workspace.map((e) => e.key).sort()).toEqual(['ws-1', 'ws-2']);
    expect(plan.map((e) => e.key)).toEqual(['plan-1']);
  });

  it('returns empty plan array when no planId provided and no default plan exists', () => {
    const store = new SharedKnowledgeStore();
    store.write('ws-1', 'x', 'workspace', 'Event Horizon', 'system');
    const { workspace, plan } = store.getAllEntries();
    expect(workspace).toHaveLength(1);
    expect(plan).toEqual([]);
  });
});
