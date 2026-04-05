/**
 * Message Queue tests — unit tests for MessageQueue + MCP tool integration.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MessageQueue } from '../messageQueue.js';
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
  });

  describe('getUnread', () => {
    it('returns unread messages for the target agent', () => {
      queue.send('a1', 'Alpha', 'a2', 'Hello from A');
      queue.send('a1', 'Alpha', 'a3', 'Hello to C');
      const msgs = queue.getUnread('a2');
      expect(msgs).toHaveLength(1);
      expect(msgs[0].message).toBe('Hello from A');
    });

    it('marks targeted messages as read after retrieval', () => {
      queue.send('a1', 'Alpha', 'a2', 'Hello');
      expect(queue.getUnread('a2')).toHaveLength(1);
      expect(queue.getUnread('a2')).toHaveLength(0); // already read
    });

    it('does not return messages sent by the same agent', () => {
      queue.send('a1', 'Alpha', '*', 'Broadcast');
      const msgs = queue.getUnread('a1');
      expect(msgs).toHaveLength(0);
    });

    it('returns broadcast messages to all other agents', () => {
      queue.send('a1', 'Alpha', '*', 'Broadcast');
      const msgsA2 = queue.getUnread('a2');
      const msgsA3 = queue.getUnread('a3');
      expect(msgsA2).toHaveLength(1);
      expect(msgsA2[0].message).toBe('Broadcast');
      expect(msgsA3).toHaveLength(1);
    });

    it('does not re-deliver broadcast messages', () => {
      queue.send('a1', 'Alpha', '*', 'Broadcast');
      queue.getUnread('a2'); // first read
      const second = queue.getUnread('a2');
      expect(second).toHaveLength(0);
    });

    it('returns messages in order', () => {
      queue.send('a1', 'Alpha', 'a2', 'First');
      queue.send('a3', 'Gamma', 'a2', 'Second');
      const msgs = queue.getUnread('a2');
      expect(msgs).toHaveLength(2);
      expect(msgs[0].message).toBe('First');
      expect(msgs[1].message).toBe('Second');
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
      const msgs = small.getUnread('a2');
      expect(msgs).toHaveLength(3);
      expect(msgs[0].message).toBe('msg-2');
    });
  });

  describe('clear', () => {
    it('removes all messages', () => {
      queue.send('a1', 'Alpha', 'a2', 'Hello');
      queue.clear();
      expect(queue.getUnread('a2')).toHaveLength(0);
      expect(queue.getUnreadCount('a2')).toBe(0);
    });
  });
});

// ── MCP Tool Integration ────────────────────────────────────────────────────

describe('Messaging MCP tools', () => {
  let mcp: McpServer;

  beforeEach(() => {
    const lockManager = new LockManager(100);
    lockManager.setEnabled(true);
    mcp = new McpServer({
      lockManager,
      agentStateManager: new AgentStateManager(),
      fileActivityTracker: new FileActivityTracker(),
      planBoardManager: new PlanBoardManager(),
      messageQueue: new MessageQueue(),
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
