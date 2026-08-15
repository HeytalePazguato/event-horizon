/**
 * Message Queue tests — unit tests for MessageQueue + MCP tool integration.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MessageQueue, buildAgentAlias } from '../messageQueue.js';
import { McpServer, FileActivityTracker } from '../mcpServer.js';
import { LockManager } from '../lockManager.js';
import { AgentStateManager } from '@event-horizon/core';
import { PlanBoardManager } from '../planBoard.js';
import { RoleManager } from '../roleManager.js';
import { AgentProfiler } from '../agentProfiler.js';
import { SharedKnowledgeStore } from '../sharedKnowledge.js';

// ── MessageQueue unit tests ─────────────────────────────────────────────────

describe('MessageQueue', () => {
  let queue: MessageQueue;

  beforeEach(() => {
    queue = new MessageQueue();
  });

  describe('send', () => {
    it('creates a message with an ID and timestamp', () => {
      const msg = queue.send('a1', 'Alpha', 'a2', 'Hello');
      expect(msg.id).toMatch(/^msg-/);
      expect(msg.fromAgentId).toBe('a1');
      expect(msg.fromAgentName).toBe('Alpha');
      expect(msg.toAgentId).toBe('a2');
      expect(msg.message).toBe('Hello');
      expect(msg.timestamp).toBeTypeOf('number');
      expect(msg.read).toBe(false);
    });

    it('assigns sequential IDs', () => {
      const m1 = queue.send('a1', 'Alpha', 'a2', 'First');
      const m2 = queue.send('a1', 'Alpha', 'a2', 'Second');
      expect(m1.id).toBe('msg-1');
      expect(m2.id).toBe('msg-2');
    });

    it('defaults agent traffic to kind "peer"', () => {
      expect(queue.send('a1', 'Alpha', 'a2', 'Hello').kind).toBe('peer');
    });

    it('defaults Event Horizon traffic to kind "system"', () => {
      expect(queue.send('event-horizon', 'Event Horizon', 'a2', 'Notice').kind).toBe('system');
    });
  });

  describe('getUnread', () => {
    it('returns unread messages for the target agent', () => {
      queue.send('a1', 'Alpha', 'a2', 'Hello from A');
      queue.send('a1', 'Alpha', 'a3', 'Hello to C');
      const { messages } = queue.getUnread('a2');
      expect(messages).toHaveLength(1);
      expect(messages[0].message).toBe('Hello from A');
    });

    it('marks targeted messages as read after retrieval', () => {
      queue.send('a1', 'Alpha', 'a2', 'Hello');
      expect(queue.getUnread('a2').messages).toHaveLength(1);
      expect(queue.getUnread('a2').messages).toHaveLength(0); // already read
    });

    it('does not return messages sent by the same agent', () => {
      queue.send('a1', 'Alpha', '*', 'Broadcast');
      expect(queue.getUnread('a1').messages).toHaveLength(0);
    });

    it('returns broadcast messages to all other agents', () => {
      queue.send('a1', 'Alpha', '*', 'Broadcast');
      const msgsA2 = queue.getUnread('a2').messages;
      const msgsA3 = queue.getUnread('a3').messages;
      expect(msgsA2).toHaveLength(1);
      expect(msgsA2[0].message).toBe('Broadcast');
      expect(msgsA3).toHaveLength(1);
    });

    it('does not re-deliver broadcast messages', () => {
      queue.send('a1', 'Alpha', '*', 'Broadcast');
      queue.getUnread('a2'); // first read
      expect(queue.getUnread('a2').messages).toHaveLength(0);
    });

    it('returns peer messages in chronological order', () => {
      queue.send('a1', 'Alpha', 'a2', 'First');
      queue.send('a3', 'Gamma', 'a2', 'Second');
      const { messages } = queue.getUnread('a2');
      expect(messages).toHaveLength(2);
      expect(messages[0].message).toBe('First');
      expect(messages[1].message).toBe('Second');
    });
  });

  // The bug this guards: a real peer message buried under hundreds of system
  // notices, unreachable because the response truncated before it.
  describe('getUnread filtering', () => {
    function seedNoisyInbox(): void {
      for (let i = 0; i < 200; i++) {
        queue.send('event-horizon', 'Event Horizon', 'a2', `Plan notice ${i}`);
      }
      queue.send('a1', 'Alpha', 'a2', 'THE REAL MESSAGE');
      for (let i = 200; i < 400; i++) {
        queue.send('event-horizon', 'Event Horizon', 'a2', `Plan notice ${i}`);
      }
    }

    it('surfaces peer messages ahead of system noise', () => {
      seedNoisyInbox();
      const { messages } = queue.getUnread('a2');
      expect(messages[0].message).toBe('THE REAL MESSAGE');
      expect(messages[0].kind).toBe('peer');
    });

    it('returns only peer messages when kind=peer', () => {
      seedNoisyInbox();
      const { messages } = queue.getUnread('a2', { kind: 'peer' });
      expect(messages).toHaveLength(1);
      expect(messages[0].message).toBe('THE REAL MESSAGE');
    });

    it('leaves filtered-out messages unread', () => {
      seedNoisyInbox();
      queue.getUnread('a2', { kind: 'peer' });
      const { messages } = queue.getUnread('a2', { kind: 'system' });
      expect(messages.length).toBeGreaterThan(0);
    });

    it('reports what the limit held back', () => {
      seedNoisyInbox();
      const { messages, pending } = queue.getUnread('a2', { limit: 10 });
      expect(messages).toHaveLength(10);
      expect(pending.peer).toBe(0);
      expect(pending.system).toBe(391);
    });

    it('filters by sender', () => {
      queue.send('a1', 'Alpha', 'a2', 'From Alpha');
      queue.send('a3', 'Gamma', 'a2', 'From Gamma');
      const { messages } = queue.getUnread('a2', { fromAgentId: 'a3' });
      expect(messages).toHaveLength(1);
      expect(messages[0].message).toBe('From Gamma');
    });

    it('excludes a sender', () => {
      queue.send('event-horizon', 'Event Horizon', 'a2', 'Notice');
      queue.send('a1', 'Alpha', 'a2', 'Peer');
      const { messages } = queue.getUnread('a2', { excludeFrom: 'event-horizon' });
      expect(messages).toHaveLength(1);
      expect(messages[0].message).toBe('Peer');
    });

    it('orders system notices newest-first so stale ones fall off the limit', () => {
      queue.send('event-horizon', 'Event Horizon', 'a2', 'Old');
      queue.send('event-horizon', 'Event Horizon', 'a2', 'New');
      const { messages } = queue.getUnread('a2', { limit: 1 });
      expect(messages[0].message).toBe('New');
    });
  });

  describe('assigned aliases', () => {
    // 2026-08-13T14:30:22.500 local time
    const T = new Date(2026, 7, 13, 14, 30, 22, 500).getTime();

    it('builds a readable project-runtime-clock address', () => {
      expect(buildAgentAlias('C:\\Work\\event-horizon', 'claude-code', T))
        .toBe('event-horizon-claude-143022');
    });

    it('falls back when there is no workspace path', () => {
      expect(buildAgentAlias(null, null, T)).toBe('workspace-agent-143022');
    });

    it('assigns once and never changes it', () => {
      const first = queue.ensureAlias('sess-1', '/work/proj', 'claude-code', T);
      const later = queue.ensureAlias('sess-1', '/work/proj', 'claude-code', T + 90_000);
      expect(later).toBe(first);
    });

    // The case that broke the workspace+name scheme: five sessions of one
    // runtime in one project. Every one must get its own address.
    it('gives every session of the same runtime a distinct address', () => {
      const aliases = new Set<string>();
      for (let i = 0; i < 5; i++) {
        aliases.add(queue.ensureAlias(`sess-${i}`, '/work/proj', 'claude-code', T));
      }
      expect(aliases.size).toBe(5);
    });

    it('resolves an alias to its session', () => {
      const alias = queue.ensureAlias('sess-1', '/work/proj', 'claude-code', T);
      expect(queue.getRouteOwner(alias)).toBe('sess-1');
    });

    it('delivers mail addressed to an alias', () => {
      const alias = queue.ensureAlias('sess-1', '/work/proj', 'claude-code', T);
      queue.send('a1', 'Alpha', 'sess-1', 'Found a bug in your module', { toAlias: alias });
      const { messages } = queue.getUnread('sess-1');
      expect(messages).toHaveLength(1);
      expect(messages[0].message).toBe('Found a bug in your module');
    });

    // A long-lived idle agent must stay reachable at the address peers hold.
    it('keeps the address after a terminate event', () => {
      const alias = queue.ensureAlias('sess-1', '/work/proj', 'claude-code', T);
      queue.send('a1', 'Alpha', 'sess-1', 'Much later', { toAlias: alias });
      // Nothing in the queue expires an address — no unregister exists.
      expect(queue.getRouteOwner(alias)).toBe('sess-1');
      expect(queue.getUnread('sess-1').messages).toHaveLength(1);
    });
  });

  describe('claimed handles', () => {
    it('claims a workspace-unique handle', () => {
      const result = queue.claimHandle('sess-1', '/work', 'Reviewer');
      expect(result.ok).toBe(true);
      expect(result.handle).toBe('reviewer');
      expect(queue.getRouteOwner(result.route!)).toBe('sess-1');
    });

    it('refuses a handle held by another running agent', () => {
      queue.claimHandle('sess-1', '/work', 'reviewer');
      const result = queue.claimHandle('sess-2', '/work', 'reviewer', () => true);
      expect(result.ok).toBe(false);
      expect(result.heldBy).toBe('sess-1');
    });

    it('lets a replacement take over a stopped agent\'s handle', () => {
      queue.claimHandle('sess-old', '/work', 'reviewer');
      const result = queue.claimHandle('sess-new', '/work', 'reviewer', () => false);
      expect(result.ok).toBe(true);
    });

    it('lets the holder re-claim its own handle', () => {
      queue.claimHandle('sess-1', '/work', 'reviewer');
      expect(queue.claimHandle('sess-1', '/work', 'reviewer').ok).toBe(true);
    });

    it('scopes handles to a project', () => {
      queue.claimHandle('sess-1', '/work/proj-a', 'reviewer');
      expect(queue.claimHandle('sess-2', '/work/proj-b', 'reviewer').ok).toBe(true);
    });

    it('rejects malformed handles', () => {
      expect(queue.claimHandle('sess-1', '/work', '-bad').ok).toBe(false);
      expect(queue.claimHandle('sess-1', '/work', 'has space').ok).toBe(false);
      expect(queue.claimHandle('sess-1', '/work', '').ok).toBe(false);
    });

    // The whole point of handles: an address that outlives the session.
    it('survives a restart: mail queued for a handle reaches the new session', () => {
      const claim = queue.claimHandle('sess-old', '/work/proj', 'csp');
      queue.send('a1', 'Alpha', 'sess-old', 'Build ready', { toAlias: claim.route });

      // Old session is gone; its replacement claims the same name.
      const reclaim = queue.claimHandle('sess-new', '/work/proj', 'csp', () => false);
      expect(reclaim.ok).toBe(true);

      const { messages } = queue.getUnread('sess-new');
      expect(messages).toHaveLength(1);
      expect(messages[0].message).toBe('Build ready');
    });

    // A message sent to a name that couldn't be resolved was stored with the
    // raw target and no route, and stayed undeliverable forever — even after
    // the name became resolvable. That orphaned a real reply in practice.
    it('delivers a message queued against an unresolved handle once it resolves', () => {
      queue.send('a1', 'Alpha', 'eh-dev', 'queued before the handle existed', { toAlias: null });
      expect(queue.getUnread('receiver').messages).toHaveLength(0);

      queue.claimHandle('receiver', '/work/proj', 'eh-dev');

      const { messages } = queue.getUnread('receiver');
      expect(messages).toHaveLength(1);
      expect(messages[0].message).toBe('queued before the handle existed');
    });

    it('does not hand an unresolved message to the wrong agent', () => {
      queue.send('a1', 'Alpha', 'eh-dev', 'for eh-dev only', { toAlias: null });
      queue.claimHandle('receiver', '/work/proj', 'eh-dev');
      queue.claimHandle('bystander', '/work/proj', 'someone-else');

      expect(queue.getUnread('bystander').messages).toHaveLength(0);
      expect(queue.getUnread('receiver').messages).toHaveLength(1);
    });

    it('holds an unresolved message when the handle is claimed in several projects', () => {
      queue.send('a1', 'Alpha', 'reviewer', 'ambiguous', { toAlias: null });
      queue.claimHandle('one', '/work/a', 'reviewer');
      queue.claimHandle('two', '/work/b', 'reviewer');

      expect(queue.getUnread('one').messages).toHaveLength(0);
      expect(queue.getUnread('two').messages).toHaveLength(0);
    });

    it('routes to the handle holder, not to a sibling session', () => {
      queue.ensureAlias('sess-1', '/work/proj', 'claude-code', 1);
      queue.ensureAlias('sess-2', '/work/proj', 'claude-code', 2);
      const claim = queue.claimHandle('sess-2', '/work/proj', 'ic');
      queue.send('a1', 'Alpha', 'sess-2', 'For IC only', { toAlias: claim.route });

      expect(queue.getUnread('sess-1').messages).toHaveLength(0);
      expect(queue.getUnread('sess-2').messages).toHaveLength(1);
    });
  });

  // Handles lived only in memory, so restarting Event Horizon voided every
  // agent's address at once and the sender saw what looked like a routing bug.
  describe('handle persistence', () => {
    it('round-trips ownership through serialize/restore', () => {
      queue.claimHandle('sess-1', '/work/proj', 'csp');
      const saved = queue.serializeHandles();
      expect(saved).toEqual([{ route: 'proj::@csp', agentId: 'sess-1' }]);

      const restarted = new MessageQueue();
      restarted.restoreHandles(saved);
      expect(restarted.getRouteOwner('proj::@csp')).toBe('sess-1');
      expect(restarted.getHandle('sess-1')).toBe('csp');
    });

    it('delivers to a restored handle after a restart', () => {
      queue.claimHandle('sess-1', '/work/proj', 'csp');
      const restarted = new MessageQueue();
      restarted.restoreHandles(queue.serializeHandles());

      restarted.send('other', 'Other', 'csp', 'still reachable', { toAlias: 'proj::@csp' });
      expect(restarted.getUnread('sess-1').messages).toHaveLength(1);
    });

    it('notifies on alias assignment so the host can persist', () => {
      let calls = 0;
      queue.setOnIdentityChanged(() => { calls++; });
      queue.ensureAlias('sess-1', '/work/proj', 'claude-code', Date.now());
      expect(calls).toBe(1);
    });

    it('round-trips aliases through serialize/restore', () => {
      const alias = queue.ensureAlias('sess-1', '/work/proj', 'claude-code', Date.now());
      const restarted = new MessageQueue();
      restarted.restoreAliases(queue.serializeAliases());
      expect(restarted.getAlias('sess-1')).toBe(alias);
      expect(restarted.getRouteOwner(alias)).toBe('sess-1');
    });

    // The regression: a restart re-derived the alias from a fresh clock, so a
    // long-running agent silently changed address and every shared one broke.
    it('keeps the original alias after a restart, not a fresh clock reading', () => {
      const original = queue.ensureAlias('sess-1', '/work/proj', 'claude-code', new Date(2026, 0, 1, 9, 15, 0).getTime());
      const restarted = new MessageQueue();
      restarted.restoreAliases(queue.serializeAliases());
      const afterRestart = restarted.ensureAlias('sess-1', '/work/other', 'claude-code', new Date(2026, 0, 2, 23, 59, 0).getTime());
      expect(afterRestart).toBe(original);
    });

    it('notifies on claim so the host can persist', () => {
      let calls = 0;
      queue.setOnIdentityChanged(() => { calls++; });
      queue.claimHandle('sess-1', '/work/proj', 'csp');
      expect(calls).toBe(1);
    });

    it('does not notify while restoring — that is a load, not a claim', () => {
      let calls = 0;
      queue.setOnIdentityChanged(() => { calls++; });
      queue.restoreHandles([{ route: 'proj::@csp', agentId: 'sess-1' }]);
      expect(calls).toBe(0);
    });

    it('ignores malformed persisted entries', () => {
      queue.restoreHandles([
        { route: '', agentId: 'x' },
        { route: 'proj::@ok', agentId: '' },
        { route: 'proj::@good', agentId: 'sess-9' },
      ]);
      expect(queue.getRouteOwner('proj::@good')).toBe('sess-9');
      expect(queue.getRouteOwner('')).toBeNull();
    });

    it('tolerates nothing saved yet', () => {
      expect(() => queue.restoreHandles(undefined)).not.toThrow();
    });
  });

  describe('summarizeUnread', () => {
    it('counts without consuming', () => {
      queue.send('a1', 'Alpha', 'a2', 'Peer one');
      queue.send('event-horizon', 'Event Horizon', 'a2', 'Notice');

      const summary = queue.summarizeUnread('a2');
      expect(summary).toMatchObject({ peer: 1, system: 1, senders: ['Alpha'] });

      // Peeking must not eat the message it announces.
      expect(queue.getUnread('a2').messages).toHaveLength(2);
    });

    it('reports nothing for an empty inbox', () => {
      expect(queue.summarizeUnread('a2')).toMatchObject({ peer: 0, system: 0, senders: [] });
    });
  });

  describe('hasUnreadFrom', () => {
    it('reports a pending notice from a given sender', () => {
      queue.send('event-horizon', 'Event Horizon', 'a2', 'Notice');
      expect(queue.hasUnreadFrom('a2', 'event-horizon')).toBe(true);
      expect(queue.hasUnreadFrom('a2', 'a1')).toBe(false);
    });

    it('clears once the notice is read', () => {
      queue.send('event-horizon', 'Event Horizon', 'a2', 'Notice');
      queue.getUnread('a2');
      expect(queue.hasUnreadFrom('a2', 'event-horizon')).toBe(false);
    });
  });

  describe('getUnreadCount', () => {
    it('counts unread messages', () => {
      queue.send('a1', 'Alpha', 'a2', 'Hello');
      queue.send('a3', 'Gamma', 'a2', 'Hi');
      expect(queue.getUnreadCount('a2')).toBe(2);
    });

    it('decrements after reading', () => {
      queue.send('a1', 'Alpha', 'a2', 'Hello');
      expect(queue.getUnreadCount('a2')).toBe(1);
      queue.getUnread('a2');
      expect(queue.getUnreadCount('a2')).toBe(0);
    });

    it('counts broadcasts', () => {
      queue.send('a1', 'Alpha', '*', 'Broadcast');
      expect(queue.getUnreadCount('a2')).toBe(1);
      expect(queue.getUnreadCount('a3')).toBe(1);
      queue.getUnread('a2');
      expect(queue.getUnreadCount('a2')).toBe(0);
      expect(queue.getUnreadCount('a3')).toBe(1); // a3 hasn't read yet
    });

    it('does not count own messages', () => {
      queue.send('a1', 'Alpha', '*', 'My broadcast');
      expect(queue.getUnreadCount('a1')).toBe(0);
    });
  });

  describe('eviction', () => {
    it('evicts oldest messages when over limit', () => {
      const small = new MessageQueue(3);
      small.send('a1', 'Alpha', 'a2', 'msg-1');
      small.send('a1', 'Alpha', 'a2', 'msg-2');
      small.send('a1', 'Alpha', 'a2', 'msg-3');
      small.send('a1', 'Alpha', 'a2', 'msg-4'); // evicts msg-1
      const { messages } = small.getUnread('a2');
      expect(messages).toHaveLength(3);
      expect(messages[0].message).toBe('msg-2');
    });
  });

  describe('clear', () => {
    it('removes all messages', () => {
      queue.send('a1', 'Alpha', 'a2', 'Hello');
      queue.clear();
      expect(queue.getUnread('a2').messages).toHaveLength(0);
      expect(queue.getUnreadCount('a2')).toBe(0);
    });
  });
});

// ── MCP Tool Integration ────────────────────────────────────────────────────

describe('Messaging MCP tools', () => {
  let mcp: McpServer;
  let mcpQueue: MessageQueue;
  let agentStateManager: AgentStateManager;

  /** Register a running agent so liveness-sensitive paths have something real. */
  function connectAgent(id: string): void {
    agentStateManager.apply({
      id: `ev-${id}`,
      agentId: id,
      agentName: 'Claude Code',
      agentType: 'claude-code',
      type: 'agent.spawn',
      timestamp: Date.now(),
      payload: { cwd: '/work/proj' },
    });
  }

  beforeEach(() => {
    const lockManager = new LockManager(100);
    lockManager.setEnabled(true);
    mcpQueue = new MessageQueue();
    agentStateManager = new AgentStateManager();
    mcp = new McpServer({
      lockManager,
      agentStateManager,
      fileActivityTracker: new FileActivityTracker(),
      planBoardManager: new PlanBoardManager(),
      messageQueue: mcpQueue,
      roleManager: new RoleManager(),
      agentProfiler: new AgentProfiler(),
      sharedKnowledge: new SharedKnowledgeStore(),
    });
  });

  function rpc(method: string, params?: Record<string, unknown>, id: number | string = 1) {
    return mcp.handleRequest({ jsonrpc: '2.0', method, params, id });
  }

  function callTool(name: string, args: Record<string, unknown>) {
    return rpc('tools/call', { name, arguments: args });
  }

  function parseResult(res: { result?: unknown }): unknown {
    const content = (res.result as { content: Array<{ text: string }> }).content[0];
    return JSON.parse(content.text);
  }

  describe('eh_send_message', () => {
    it('sends a targeted message', async () => {
      const res = await callTool('eh_send_message', {
        agent_id: 'a1', agent_name: 'Alpha', to_agent_id: 'a2', message: 'Hello Agent B',
      });
      const parsed = parseResult(res) as Record<string, unknown>;
      expect(parsed).toMatchObject({ sent: true, to: 'a2' });
      expect(parsed.messageId).toBeTypeOf('string');
    });

    it('sends a broadcast message', async () => {
      const res = await callTool('eh_send_message', {
        agent_id: 'a1', agent_name: 'Alpha', to_agent_id: '*', message: 'Hello everyone',
      });
      const parsed = parseResult(res) as Record<string, unknown>;
      expect(parsed).toMatchObject({ sent: true, to: 'broadcast' });
    });

    it('validates required params', async () => {
      const res = await callTool('eh_send_message', { agent_id: 'a1' });
      expect(res.error).toBeDefined();
      expect(res.error!.code).toBe(-32602);
    });

    it('rejects a send with no target', async () => {
      const res = await callTool('eh_send_message', { agent_id: 'a1', message: 'Hi' });
      const parsed = parseResult(res) as Record<string, unknown>;
      expect(parsed.sent).toBe(false);
      expect(parsed.error).toContain('to_agent_id');
    });

    it('warns when the target is not connected', async () => {
      const res = await callTool('eh_send_message', {
        agent_id: 'a1', agent_name: 'Alpha', to_agent_id: 'ghost-session', message: 'Hello?',
      });
      const parsed = parseResult(res) as Record<string, unknown>;
      expect(parsed.sent).toBe(true);
      expect(parsed.warning).toContain('Nothing currently matches');
      // Both failure modes are named, because a session ID and a handle are
      // not reliably distinguishable by shape.
      expect(parsed.warning).toContain('eh_claim_handle');
      expect(parsed.warning).toContain('session ID');
      expect(parsed.warning).toContain('eh_list_agents');
    });

    it('routes to an assigned alias', async () => {
      const alias = mcpQueue.ensureAlias('sess-2', '/work/proj', 'claude-code', Date.now());
      const res = await callTool('eh_send_message', {
        agent_id: 'a1', agent_name: 'Alpha', to_agent_id: alias, message: 'Via alias',
      });
      const parsed = parseResult(res) as Record<string, unknown>;
      expect(parsed.sent).toBe(true);
      expect(parsed.to).toBe('sess-2');
    });

    // The bug this guards: handles were resolved only against the sender's own
    // project, so a send from mivaro-mobile to a handle claimed in
    // event-horizon reported "No running agent matches" — breaking the exact
    // cross-project messaging handles exist for.
    it('routes to a handle claimed in a different project', async () => {
      connectAgent('sender');
      mcpQueue.claimHandle('receiver', 'C:/Work/event-horizon', 'eh-dev');

      const res = await callTool('eh_send_message', {
        agent_id: 'sender', agent_name: 'Mivaro', to_agent_id: 'eh-dev',
        message: 'across projects',
      });
      const parsed = parseResult(res) as Record<string, unknown>;
      expect(parsed.sent).toBe(true);
      expect(parsed.to).toBe('receiver');
      expect(parsed.to_alias).toBe('event-horizon::@eh-dev');
      expect(parsed.warning).toBeUndefined();
    });

    it('prefers a handle claimed in the sender\'s own project', async () => {
      connectAgent('sender'); // cwd /work/proj
      mcpQueue.claimHandle('local', '/work/proj', 'reviewer');
      mcpQueue.claimHandle('remote', '/work/other', 'reviewer');

      const res = await callTool('eh_send_message', {
        agent_id: 'sender', to_agent_id: 'reviewer', message: 'hi',
      });
      expect((parseResult(res) as Record<string, unknown>).to).toBe('local');
    });

    it('refuses a handle claimed in several other projects', async () => {
      mcpQueue.claimHandle('a', '/work/one', 'reviewer');
      mcpQueue.claimHandle('b', '/work/two', 'reviewer');

      const res = await callTool('eh_send_message', {
        agent_id: 'sender', to_agent_id: 'reviewer', message: 'hi',
      });
      const parsed = parseResult(res) as Record<string, unknown>;
      expect(parsed.sent).toBe(false);
      expect(parsed.error).toContain('2 projects');
    });

    it('routes to a claimed handle', async () => {
      mcpQueue.claimHandle('sess-2', null, 'ic');
      const res = await callTool('eh_send_message', {
        agent_id: 'a1', agent_name: 'Alpha', to_agent_id: 'ic', message: 'For IC',
      });
      const parsed = parseResult(res) as Record<string, unknown>;
      expect(parsed.sent).toBe(true);
      expect(parsed.to).toBe('sess-2');

      const inbox = parseResult(await callTool('eh_get_messages', { agent_id: 'sess-2' })) as {
        messages: Array<{ message: string }>;
      };
      expect(inbox.messages[0].message).toBe('For IC');
    });
  });

  describe('eh_claim_handle', () => {
    it('claims a handle', async () => {
      const res = await callTool('eh_claim_handle', { agent_id: 'a1', handle: 'Reviewer' });
      const parsed = parseResult(res) as Record<string, unknown>;
      expect(parsed.claimed).toBe(true);
      expect(parsed.handle).toBe('reviewer');
    });

    it('refuses a handle another running agent holds', async () => {
      connectAgent('a1');
      connectAgent('a2');
      await callTool('eh_claim_handle', { agent_id: 'a1', handle: 'reviewer' });
      const res = await callTool('eh_claim_handle', { agent_id: 'a2', handle: 'reviewer' });
      const parsed = parseResult(res) as Record<string, unknown>;
      expect(parsed.claimed).toBe(false);
      expect(parsed.held_by).toBe('a1');
    });

    it('lets a replacement reclaim a stopped agent\'s handle', async () => {
      // 'a1' never connected, so it is not running — its handle is free.
      await callTool('eh_claim_handle', { agent_id: 'a1', handle: 'reviewer' });
      connectAgent('a2');
      const res = await callTool('eh_claim_handle', { agent_id: 'a2', handle: 'reviewer' });
      expect((parseResult(res) as Record<string, unknown>).claimed).toBe(true);
    });

    it('rejects a malformed handle', async () => {
      const res = await callTool('eh_claim_handle', { agent_id: 'a1', handle: 'not a handle' });
      const parsed = parseResult(res) as Record<string, unknown>;
      expect(parsed.claimed).toBe(false);
    });
  });

  describe('eh_get_messages', () => {
    it('returns empty when no messages', async () => {
      const res = await callTool('eh_get_messages', { agent_id: 'a1' });
      const parsed = parseResult(res) as Record<string, unknown>;
      expect(parsed).toMatchObject({ messages: [], count: 0 });
    });

    it('returns unread messages', async () => {
      await callTool('eh_send_message', {
        agent_id: 'a1', agent_name: 'Alpha', to_agent_id: 'a2', message: 'Hello',
      });
      const res = await callTool('eh_get_messages', { agent_id: 'a2' });
      const parsed = parseResult(res) as { messages: Array<Record<string, unknown>>; count: number };
      expect(parsed.count).toBe(1);
      expect(parsed.messages[0]).toMatchObject({
        from: 'Alpha',
        fromAgentId: 'a1',
        message: 'Hello',
        broadcast: false,
      });
    });

    it('marks messages as read (no re-delivery)', async () => {
      await callTool('eh_send_message', {
        agent_id: 'a1', agent_name: 'Alpha', to_agent_id: 'a2', message: 'Once',
      });
      await callTool('eh_get_messages', { agent_id: 'a2' }); // read
      const res = await callTool('eh_get_messages', { agent_id: 'a2' }); // re-read
      const parsed = parseResult(res) as { count: number };
      expect(parsed.count).toBe(0);
    });

    it('delivers broadcasts to multiple agents', async () => {
      await callTool('eh_send_message', {
        agent_id: 'a1', agent_name: 'Alpha', to_agent_id: '*', message: 'Broadcast',
      });
      const resA2 = await callTool('eh_get_messages', { agent_id: 'a2' });
      const resA3 = await callTool('eh_get_messages', { agent_id: 'a3' });
      const parsedA2 = parseResult(resA2) as { count: number; messages: Array<{ broadcast: boolean }> };
      const parsedA3 = parseResult(resA3) as { count: number };
      expect(parsedA2.count).toBe(1);
      expect(parsedA2.messages[0].broadcast).toBe(true);
      expect(parsedA3.count).toBe(1);
    });

    it('does not return own messages', async () => {
      await callTool('eh_send_message', {
        agent_id: 'a1', agent_name: 'Alpha', to_agent_id: '*', message: 'Broadcast',
      });
      const res = await callTool('eh_get_messages', { agent_id: 'a1' });
      const parsed = parseResult(res) as { count: number };
      expect(parsed.count).toBe(0);
    });

    it('reaches a peer message without paging through system noise', async () => {
      const queue = mcpQueue;
      for (let i = 0; i < 300; i++) {
        queue.send('event-horizon', 'Event Horizon', 'a2', `Plan notice ${i}`);
      }
      await callTool('eh_send_message', {
        agent_id: 'a1', agent_name: 'Alpha', to_agent_id: 'a2', message: 'Escalation',
      });

      const res = await callTool('eh_get_messages', { agent_id: 'a2', kind: 'peer' });
      const parsed = parseResult(res) as {
        count: number;
        messages: Array<{ message: string; kind: string }>;
        pending: { peer: number; system: number };
      };
      expect(parsed.count).toBe(1);
      expect(parsed.messages[0].message).toBe('Escalation');
      expect(parsed.messages[0].kind).toBe('peer');
      expect(parsed.pending.system).toBe(300);
    });

    it('caps the response and reports the remainder', async () => {
      const queue = mcpQueue;
      for (let i = 0; i < 120; i++) {
        queue.send('a1', 'Alpha', 'a2', `Message ${i}`);
      }
      const res = await callTool('eh_get_messages', { agent_id: 'a2' });
      const parsed = parseResult(res) as { count: number; pending: { peer: number } };
      expect(parsed.count).toBe(50); // DEFAULT_MESSAGE_LIMIT
      expect(parsed.pending.peer).toBe(70);
    });

    it('honours an explicit limit', async () => {
      const queue = mcpQueue;
      for (let i = 0; i < 10; i++) {
        queue.send('a1', 'Alpha', 'a2', `Message ${i}`);
      }
      const res = await callTool('eh_get_messages', { agent_id: 'a2', limit: 3 });
      const parsed = parseResult(res) as { count: number };
      expect(parsed.count).toBe(3);
    });
  });

  describe('full messaging workflow', () => {
    it('two agents exchange messages', async () => {
      // A sends to B
      await callTool('eh_send_message', {
        agent_id: 'a1', agent_name: 'Alpha', to_agent_id: 'a2', message: 'I moved utils.ts to lib/',
      });

      // B reads
      const res1 = await callTool('eh_get_messages', { agent_id: 'a2' });
      const parsed1 = parseResult(res1) as { messages: Array<{ message: string }> };
      expect(parsed1.messages[0].message).toBe('I moved utils.ts to lib/');

      // B replies
      await callTool('eh_send_message', {
        agent_id: 'a2', agent_name: 'Beta', to_agent_id: 'a1', message: 'Thanks, updated my imports',
      });

      // A reads
      const res2 = await callTool('eh_get_messages', { agent_id: 'a1' });
      const parsed2 = parseResult(res2) as { messages: Array<{ message: string; from: string }> };
      expect(parsed2.messages[0].message).toBe('Thanks, updated my imports');
      expect(parsed2.messages[0].from).toBe('Beta');
    });
  });
});
