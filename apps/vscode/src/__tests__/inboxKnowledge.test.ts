/**
 * Knowledge push through the prompt-submit inbox notice (task 5.5).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildInboxNotice,
  sharedKnowledge,
  messageQueue,
  _resetKnowledgeSent,
  KNOWLEDGE_NOTICE_MAX_CHARS,
} from '../eventServer.js';

const AGENT = 'agent-a';

function clearKnowledge(): void {
  const { workspace } = sharedKnowledge.getAllEntries();
  for (const e of workspace) sharedKnowledge.delete(e.key, 'workspace', 'user');
}

beforeEach(() => {
  clearKnowledge();
  _resetKnowledgeSent();
});

describe('buildInboxNotice — knowledge push', () => {
  it('stays empty when there is neither mail nor knowledge', () => {
    expect(buildInboxNotice(AGENT)).toBe('');
  });

  it('delivers an entry the agent has not seen yet', () => {
    sharedKnowledge.write('auth-flow', 'Tokens are JWTs signed in mcpOAuth.ts', 'workspace', 'peer', 'agent-b');
    const notice = buildInboxNotice(AGENT);
    expect(notice).toContain('Shared knowledge');
    expect(notice).toContain('- auth-flow: Tokens are JWTs signed in mcpOAuth.ts');
  });

  it('does not repeat an entry on the next turn', () => {
    sharedKnowledge.write('auth-flow', 'v1', 'workspace', 'peer', 'agent-b');
    expect(buildInboxNotice(AGENT)).toContain('auth-flow');
    expect(buildInboxNotice(AGENT)).toBe('');
  });

  it('re-sends an entry after it is updated', () => {
    const now = Date.now();
    sharedKnowledge.write('auth-flow', 'v1', 'workspace', 'peer', 'agent-b');
    buildInboxNotice(AGENT, now);
    const entry = sharedKnowledge.getAllEntries().workspace.find((e) => e.key === 'auth-flow')!;
    // Force a distinct updatedAt even within the same millisecond.
    sharedKnowledge.write('auth-flow', 'v2', 'workspace', 'peer', 'agent-b');
    const updated = sharedKnowledge.getAllEntries().workspace.find((e) => e.key === 'auth-flow')!;
    if (updated.updatedAt === entry.updatedAt) updated.updatedAt += 1;
    expect(buildInboxNotice(AGENT, now)).toContain('- auth-flow: v2');
  });

  it('tracks what was sent per agent', () => {
    sharedKnowledge.write('auth-flow', 'v1', 'workspace', 'peer', 'agent-b');
    expect(buildInboxNotice(AGENT)).toContain('auth-flow');
    expect(buildInboxNotice('agent-c')).toContain('auth-flow');
  });

  it("skips entries the agent wrote itself", () => {
    sharedKnowledge.write('mine', 'my own note', 'workspace', 'me', AGENT);
    expect(buildInboxNotice(AGENT)).toBe('');
  });

  it('skips auto-seeded instruction files', () => {
    sharedKnowledge.write('CLAUDE.md', 'instructions', 'workspace', 'scanner', 'auto', undefined, undefined, undefined, 'auto');
    expect(buildInboxNotice(AGENT)).toBe('');
  });

  it('skips expired entries', () => {
    const now = Date.now();
    sharedKnowledge.write('old', 'stale fact', 'workspace', 'peer', 'agent-b', undefined, now - 1000);
    expect(buildInboxNotice(AGENT, now)).toBe('');
  });

  it('caps the injected text and points at eh_read_shared for the rest', () => {
    for (let i = 0; i < 40; i++) {
      sharedKnowledge.write(`fact-${i}`, 'x'.repeat(120), 'workspace', 'peer', 'agent-b');
    }
    const notice = buildInboxNotice(AGENT);
    const knowledgePart = notice.slice(notice.indexOf('[Event Horizon] Shared knowledge'));
    const body = knowledgePart.split('\n(')[0];
    expect(body.length).toBeLessThanOrEqual(KNOWLEDGE_NOTICE_MAX_CHARS);
    expect(notice).toMatch(/more not shown — call eh_read_shared/);
  });

  it('truncates a single oversized entry instead of dropping it', () => {
    sharedKnowledge.write('huge', 'y'.repeat(5000), 'workspace', 'peer', 'agent-b');
    const notice = buildInboxNotice(AGENT);
    expect(notice).toContain('- huge: ');
    expect(notice.length).toBeLessThanOrEqual(KNOWLEDGE_NOTICE_MAX_CHARS + 10);
  });

  it('keeps the peer-mail notice and appends knowledge after it', () => {
    messageQueue.send('agent-b', 'Peer B', AGENT, 'hello');
    sharedKnowledge.write('auth-flow', 'v1', 'workspace', 'peer', 'agent-b');
    const notice = buildInboxNotice(AGENT);
    expect(notice.indexOf('unread message')).toBeGreaterThanOrEqual(0);
    expect(notice.indexOf('unread message')).toBeLessThan(notice.indexOf('Shared knowledge'));
  });
});
