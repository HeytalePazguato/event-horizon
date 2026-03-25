/**
 * Agent-to-agent message queue.
 * In-memory, per-agent inbox with broadcast support.
 * Messages are marked as read after retrieval.
 */

export interface AgentMessage {
  id: string;
  fromAgentId: string;
  fromAgentName: string;
  toAgentId: string; // '*' for broadcast
  message: string;
  timestamp: number;
  read: boolean;
}

export class MessageQueue {
  private messages: AgentMessage[] = [];
  private readonly maxMessages: number;
  private nextId = 1;

  constructor(maxMessages = 1000) {
    this.maxMessages = maxMessages;
  }

  /**
   * Send a message to a specific agent or broadcast to all ('*').
   * Returns the created message.
   */
  send(fromAgentId: string, fromAgentName: string, toAgentId: string, message: string): AgentMessage {
    const msg: AgentMessage = {
      id: `msg-${this.nextId++}`,
      fromAgentId,
      fromAgentName,
      toAgentId,
      message,
      timestamp: Date.now(),
      read: false,
    };

    this.messages.push(msg);

    // Evict oldest messages if over limit
    if (this.messages.length > this.maxMessages) {
      this.messages = this.messages.slice(-this.maxMessages);
    }

    return msg;
  }

  /**
   * Get unread messages for an agent (includes broadcasts).
   * Messages are marked as read after retrieval.
   */
  getUnread(agentId: string): AgentMessage[] {
    const unread = this.messages.filter(
      (m) => !m.read && (m.toAgentId === agentId || m.toAgentId === '*') && m.fromAgentId !== agentId,
    );

    // Mark as read
    for (const m of unread) {
      // For broadcasts, we track per-recipient reads via a separate approach:
      // clone the message for the recipient and mark original only when ALL have read.
      // Simpler: for broadcasts, mark read only for this caller by not mutating the original.
      // We'll use a simple approach: targeted messages get marked read; broadcasts don't
      // (they stay available until evicted). This is pragmatic for 2-3 agents.
      if (m.toAgentId === agentId) {
        m.read = true;
      }
    }

    // For broadcasts, track reads separately to avoid re-delivering
    // Use a set of "agentId:msgId" pairs
    const result = unread.filter((m) => {
      if (m.toAgentId === '*') {
        const key = `${agentId}:${m.id}`;
        if (this.broadcastReads.has(key)) return false;
        this.broadcastReads.add(key);
        return true;
      }
      return true;
    });

    return result.map((m) => ({
      id: m.id,
      fromAgentId: m.fromAgentId,
      fromAgentName: m.fromAgentName,
      toAgentId: m.toAgentId,
      message: m.message,
      timestamp: m.timestamp,
      read: true, // returned as read since the agent is now reading them
    }));
  }

  /** Track which broadcast messages each agent has read. */
  private broadcastReads = new Set<string>();

  /** Get total unread count for an agent (for status indicators). */
  getUnreadCount(agentId: string): number {
    let count = 0;
    for (const m of this.messages) {
      if (m.read || m.fromAgentId === agentId) continue;
      if (m.toAgentId === agentId) {
        count++;
      } else if (m.toAgentId === '*' && !this.broadcastReads.has(`${agentId}:${m.id}`)) {
        count++;
      }
    }
    return count;
  }

  /** Clear all messages. */
  clear(): void {
    this.messages = [];
    this.broadcastReads.clear();
    this.nextId = 1;
  }
}
