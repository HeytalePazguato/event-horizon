import { describe, it, expect, beforeEach } from 'vitest';
import { keyForScannedFile, writeEntriesToStore, deleteScannedEntry, INCLUDE_GLOB, EXCLUDE_GLOB } from '../instructionFileScanner.js';
import type { ScannedFile } from '../instructionFileScanner.js';
import { SharedKnowledgeStore } from '../sharedKnowledge.js';

function makeFile(partial: Partial<ScannedFile> & Pick<ScannedFile, 'relLabel' | 'tier' | 'kind'>): ScannedFile {
  return {
    absPath: partial.absPath ?? `/workspace/${partial.relLabel}`,
    relLabel: partial.relLabel,
    content: partial.content ?? `# ${partial.relLabel}\nSome rule content.`,
    tier: partial.tier,
    kind: partial.kind,
    folderIndex: partial.folderIndex ?? 0,
  };
}

describe('keyForScannedFile', () => {
  it('prefixes keys with "auto:" so they cannot collide with user/agent keys', () => {
    const f = makeFile({ relLabel: 'CLAUDE.md', tier: 'L1', kind: 'claude' });
    expect(keyForScannedFile(f)).toBe('auto:CLAUDE.md');
  });

  it('produces stable keys for same relLabel across calls', () => {
    const a = makeFile({ relLabel: '.claude/rules/device-mappings.md', tier: 'L2', kind: 'rule' });
    const b = makeFile({ relLabel: '.claude/rules/device-mappings.md', tier: 'L2', kind: 'rule', content: 'different content' });
    expect(keyForScannedFile(a)).toBe(keyForScannedFile(b));
  });

  it('keeps multi-root labels distinct when relLabel differs', () => {
    const a = makeFile({ relLabel: 'core/CLAUDE.md', tier: 'L1', kind: 'claude' });
    const b = makeFile({ relLabel: 'notifications/CLAUDE.md', tier: 'L1', kind: 'claude' });
    expect(keyForScannedFile(a)).not.toBe(keyForScannedFile(b));
  });
});

describe('writeEntriesToStore', () => {
  let store: SharedKnowledgeStore;

  beforeEach(() => {
    store = new SharedKnowledgeStore();
  });

  it('writes each scanned file as a separate workspace entry with source=auto', () => {
    const files: ScannedFile[] = [
      makeFile({ relLabel: 'CLAUDE.md', tier: 'L1', kind: 'claude' }),
      makeFile({ relLabel: '.claude/rules/foo.md', tier: 'L2', kind: 'rule' }),
    ];
    writeEntriesToStore(store, files);
    const entries = store.getAllEntries().workspace;
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.source === 'auto')).toBe(true);
    expect(entries.every((e) => e.author === 'Event Horizon')).toBe(true);
    expect(entries.every((e) => e.authorId === 'system')).toBe(true);
    expect(entries.every((e) => e.scope === 'workspace')).toBe(true);
  });

  it('preserves tier assignment from scanned file', () => {
    writeEntriesToStore(store, [
      makeFile({ relLabel: 'CLAUDE.md', tier: 'L1', kind: 'claude' }),
      makeFile({ relLabel: '.claude/rules/foo.md', tier: 'L2', kind: 'rule' }),
    ]);
    const entries = store.getAllEntries().workspace;
    const claudeEntry = entries.find((e) => e.key === 'auto:CLAUDE.md');
    const ruleEntry = entries.find((e) => e.key === 'auto:.claude/rules/foo.md');
    expect(claudeEntry?.tier).toBe('L1');
    expect(ruleEntry?.tier).toBe('L2');
  });

  it('does not overwrite user-authored entries with the same key', () => {
    // Simulate: user wrote an entry; scanner later tries to write the same key.
    store.write(
      'auto:CLAUDE.md',
      'user-authored content',
      'workspace',
      'human',
      'user',
      undefined, undefined, 'L0', 'user',
    );
    writeEntriesToStore(store, [
      makeFile({ relLabel: 'CLAUDE.md', tier: 'L1', kind: 'claude', content: 'scanner content' }),
    ]);
    const entry = store.getAllEntries().workspace.find((e) => e.key === 'auto:CLAUDE.md');
    expect(entry?.value).toBe('user-authored content');
    expect(entry?.source).toBe('user');
    expect(entry?.tier).toBe('L0');
  });

  it('does not overwrite agent-authored entries with the same key', () => {
    store.write(
      'auto:CLAUDE.md',
      'agent wrote this',
      'workspace',
      'claude-code',
      'agent-42',
      undefined, undefined, 'L1', 'agent',
    );
    writeEntriesToStore(store, [
      makeFile({ relLabel: 'CLAUDE.md', tier: 'L1', kind: 'claude', content: 'scanner tried this' }),
    ]);
    const entry = store.getAllEntries().workspace.find((e) => e.key === 'auto:CLAUDE.md');
    expect(entry?.value).toBe('agent wrote this');
    expect(entry?.source).toBe('agent');
  });

  it('overwrites its own auto entries on re-scan (content changes reflected)', () => {
    writeEntriesToStore(store, [
      makeFile({ relLabel: 'CLAUDE.md', tier: 'L1', kind: 'claude', content: 'original' }),
    ]);
    writeEntriesToStore(store, [
      makeFile({ relLabel: 'CLAUDE.md', tier: 'L1', kind: 'claude', content: 'updated' }),
    ]);
    const entry = store.getAllEntries().workspace.find((e) => e.key === 'auto:CLAUDE.md');
    expect(entry?.value).toBe('updated');
    expect(entry?.source).toBe('auto');
  });
});

describe('deleteScannedEntry', () => {
  it('removes an auto-seeded entry by relLabel', () => {
    const store = new SharedKnowledgeStore();
    writeEntriesToStore(store, [
      makeFile({ relLabel: 'CLAUDE.md', tier: 'L1', kind: 'claude' }),
    ]);
    expect(store.getAllEntries().workspace).toHaveLength(1);
    const deleted = deleteScannedEntry(store, 'CLAUDE.md');
    expect(deleted).toBe(true);
    expect(store.getAllEntries().workspace).toHaveLength(0);
  });

  it('returns false when the entry does not exist', () => {
    const store = new SharedKnowledgeStore();
    expect(deleteScannedEntry(store, 'nonexistent.md')).toBe(false);
  });

  it('cannot delete user-authored entries that happen to share the auto: prefix', () => {
    const store = new SharedKnowledgeStore();
    // A user entry with the auto: prefix — contrived but defensive.
    store.write(
      'auto:CLAUDE.md',
      'user content',
      'workspace',
      'human',
      'user',
      undefined, undefined, 'L1', 'user',
    );
    // deleteScannedEntry uses authorId='system'; user's authorId='user' — mismatch blocks delete.
    const deleted = deleteScannedEntry(store, 'CLAUDE.md');
    expect(deleted).toBe(false);
    expect(store.getAllEntries().workspace).toHaveLength(1);
  });
});

describe('glob constants', () => {
  it('INCLUDE_GLOB covers all expected instruction filenames', () => {
    expect(INCLUDE_GLOB).toContain('CLAUDE.md');
    expect(INCLUDE_GLOB).toContain('AGENTS.md');
    expect(INCLUDE_GLOB).toContain('.cursorrules');
    expect(INCLUDE_GLOB).toContain('copilot-instructions.md');
    expect(INCLUDE_GLOB).toContain('.claude/rules/**/*.md');
  });

  it('EXCLUDE_GLOB blocks common noise directories', () => {
    expect(EXCLUDE_GLOB).toContain('node_modules');
    expect(EXCLUDE_GLOB).toContain('dist');
    expect(EXCLUDE_GLOB).toContain('.git');
  });
});
