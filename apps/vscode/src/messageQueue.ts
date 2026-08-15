/**
 * Agent-to-agent message queue.
 * In-memory, per-agent inbox with broadcast support.
 *
 * Two kinds of traffic share the queue. The kind records who sent a message,
 * not how important it is:
 *   - 'peer'   — sent by another EH-connected agent session via
 *                eh_send_message. Content is unconstrained: findings, shared
 *                context, questions, coordination.
 *   - 'system' — notices Event Horizon generates itself (plan discovery,
 *                worker failures, role instructions)
 *
 * They are separated because their volumes differ by orders of magnitude:
 * system notices are machine-generated and can bury peer traffic entirely.
 * Retrieval therefore returns peer messages first and reports how much it held
 * back instead of dumping the whole inbox. Only the messages actually returned
 * are marked read, so a filtered read can never swallow mail nobody saw.
 *
 * Session IDs are opaque and unreadable, so agents get two friendlier
 * addresses. Both are permanent: nothing here expires, and an idle agent keeps
 * its address for as long as it lives, however long that is.
 *
 *   - an alias, assigned automatically the first time Event Horizon sees a
 *     session: `<project>-<runtime>-<hhmmss>`, e.g. `event-horizon-claude-143022`.
 *     Unique by construction (the clock disambiguates sessions that are
 *     otherwise identical), readable, and fixed for the session's whole life.
 *     It costs the agent nothing — no call, no cooperation.
 *   - a handle, claimed by the agent itself: `<project>::@name`, e.g.
 *     `event-horizon::@csp`. The one address that survives a restart, because
 *     the replacement session can claim the same name and collect everything
 *     queued for it. Aliases can't do this — a restarted session is a new
 *     session, and gets a new timestamp.
 */

export type MessageKind = 'peer' | 'system';

export interface AgentMessage {
  id: string;
  fromAgentId: string;
  fromAgentName: string;
  toAgentId: string; // '*' for broadcast
  /** Stable workspace+name route, or null when the target could not be resolved. */
  toAlias: string | null;
  kind: MessageKind;
  message: string;
  timestamp: number;
  read: boolean;
}

export interface SendOptions {
  /** Defaults to 'system' for messages from Event Horizon itself, 'peer' otherwise. */
  kind?: MessageKind;
  /** Stable route for the recipient, so delivery survives a session restart. */
  toAlias?: string | null;
}

export interface ClaimHandleResult {
  ok: boolean;
  /** The full route (`workspace::@handle`) when the claim succeeded. */
  route?: string;
  /** The normalized handle that was granted. */
  handle?: string;
  /** Why the claim failed. */
  error?: string;
  /** Agent currently holding the handle, when the claim was refused. */
  heldBy?: string;
}

export interface GetUnreadOptions {
  /** 'all' (default) returns both kinds, peer first. */
  kind?: MessageKind | 'all';
  /** Only messages from this sender ID. */
  fromAgentId?: string;
  /** Drop messages from this sender ID (e.g. 'event-horizon'). */
  excludeFrom?: string;
  /** Max messages to return. Defaults to DEFAULT_MESSAGE_LIMIT. */
  limit?: number;
}

export interface UnreadResult {
  messages: AgentMessage[];
  /** Still-unread messages this call held back, by kind. */
  pending: { peer: number; system: number };
}

/** Default cap on a single eh_get_messages read — keeps tool output bounded. */
export const DEFAULT_MESSAGE_LIMIT = 50;

/** The reserved sender ID used by Event Horizon's own notices. */
export const SYSTEM_SENDER_ID = 'event-horizon';

/**
 * Build a readable, unique alias for a session: `<project>-<runtime>-<hhmmss>`.
 *
 * The clock is what makes it unique. Connectors report a constant name per
 * runtime — every Claude Code session is called 'Claude Code' — so project and
 * runtime alone collide across a fleet. Seconds separate sessions started at
 * different times; `dedupe` appends milliseconds for the rare same-second tie.
 */
export function buildAgentAlias(
  cwd: string | null | undefined,
  runtime: string | null | undefined,
  startedAt: number,
  dedupe = false,
): string {
  const project = projectNameOf(cwd);
  const rt = shortRuntime(runtime);
  const d = new Date(startedAt);
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  const clock = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
    + (dedupe ? pad(d.getMilliseconds(), 3) : '');
  return `${project}-${rt}-${clock}`;
}

/** Last path segment of the workspace, normalized for use inside an alias. */
function projectNameOf(cwd: string | null | undefined): string {
  const normalized = normalizeWorkspace(cwd);
  const segment = normalized.split('/').filter(Boolean).pop() ?? '';
  const cleaned = segment.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'workspace';
}

/** 'claude-code' → 'claude'. Keeps aliases short without losing the runtime. */
function shortRuntime(runtime: string | null | undefined): string {
  const value = (runtime ?? 'agent').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return value.replace(/-code$/, '').replace(/^-+|-+$/g, '') || 'agent';
}

/** Build the route for a claimed handle. Handles are namespaced by project. */
export function buildHandleRoute(
  cwd: string | null | undefined,
  handle: string,
): string {
  return `${projectNameOf(cwd)}::@${handle.trim().toLowerCase()}`;
}

/** Handles are used in prompts and tool args — keep them short and unsurprising. */
const HANDLE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,31}$/;

/** Normalize a handle, or return null when it isn't usable as one. */
export function normalizeHandle(raw: string): string | null {
  const handle = raw.trim().toLowerCase();
  return HANDLE_PATTERN.test(handle) ? handle : null;
}

function normalizeWorkspace(cwd: string | null | undefined): string {
  return (cwd ?? '')
    .trim()
    .split('\\').join('/')
    .replace(/\/+$/, '')
    .toLowerCase();
}

export class MessageQueue {
  private messages: AgentMessage[] = [];
  private readonly maxMessages: number;
  private nextId = 1;

  /** Track which broadcast messages each agent has read ("agentId:msgId"). */
  private broadcastReads = new Set<string>();

  /** agentId → its assigned alias. Written once, never changed or removed. */
  private aliasByAgent = new Map<string, string>();
  /** alias → agentId. Unique by construction, so no ambiguity is possible. */
  private aliasOwner = new Map<string, string>();
  /** handle route → the agent holding it. */
  private handleOwner = new Map<string, string>();
  /** agentId → the handle route it holds. */
  private handleByAgent = new Map<string, string>();

  /** Notified whenever handle ownership changes, so the host can persist it. */
  private onHandlesChanged: (() => void) | null = null;

  constructor(maxMessages = 1000) {
    this.maxMessages = maxMessages;
  }

  /**
   * Assign this session's alias the first time we see it, and never touch it
   * again. Called on every event, so it must be cheap and idempotent: an agent
   * idling for hours or days keeps the address it was given on arrival.
   *
   * Returns the alias the agent holds.
   */
  ensureAlias(
    agentId: string,
    cwd: string | null | undefined,
    runtime: string | null | undefined,
    startedAt: number,
  ): string {
    const existing = this.aliasByAgent.get(agentId);
    if (existing) return existing;

    let alias = buildAgentAlias(cwd, runtime, startedAt);
    if (this.aliasOwner.has(alias)) {
      // Same project, same runtime, same second — go to milliseconds, then to
      // a counter, so an alias is never handed to two sessions.
      alias = buildAgentAlias(cwd, runtime, startedAt, true);
      for (let n = 2; this.aliasOwner.has(alias); n++) {
        alias = `${buildAgentAlias(cwd, runtime, startedAt, true)}-${n}`;
      }
    }

    this.aliasByAgent.set(agentId, alias);
    this.aliasOwner.set(alias, agentId);
    return alias;
  }

  /**
   * Claim a project-unique handle — the one address that survives a restart.
   *
   * A handle is refused only while another *live* agent holds it. Liveness is
   * the caller's to judge; when the previous holder is gone, its replacement
   * takes the name over and inherits everything queued for it. Nothing is
   * released on a timer or on idle.
   */
  claimHandle(
    agentId: string,
    cwd: string | null | undefined,
    rawHandle: string,
    isLive: (agentId: string) => boolean = () => true,
  ): ClaimHandleResult {
    const handle = normalizeHandle(rawHandle);
    if (!handle) {
      return {
        ok: false,
        error: 'Handle must be 1-32 chars, start alphanumeric, and use only letters, digits, dot, dash, or underscore.',
      };
    }

    const route = buildHandleRoute(cwd, handle);
    const currentOwner = this.handleOwner.get(route);
    if (currentOwner && currentOwner !== agentId && isLive(currentOwner)) {
      return {
        ok: false,
        error: `Handle "${handle}" is held by another running agent in this project.`,
        heldBy: currentOwner,
      };
    }

    const previous = this.handleByAgent.get(agentId);
    if (previous && previous !== route) this.handleOwner.delete(previous);
    this.handleOwner.set(route, agentId);
    this.handleByAgent.set(agentId, route);
    this.onHandlesChanged?.();
    return { ok: true, route, handle };
  }

  /**
   * Register a callback fired whenever handle ownership changes.
   *
   * Handles were memory-only, so restarting Event Horizon silently voided every
   * one of them. Agent session IDs outlive an extension restart, so persisting
   * the map and restoring it on activation puts each agent's address back
   * without the agent having to notice anything happened.
   */
  setOnHandlesChanged(fn: (() => void) | null): void {
    this.onHandlesChanged = fn;
  }

  /** Handle ownership in a form the host can persist. */
  serializeHandles(): Array<{ route: string; agentId: string }> {
    return [...this.handleOwner].map(([route, agentId]) => ({ route, agentId }));
  }

  /**
   * Restore persisted handle ownership. Does not fire the change callback —
   * this is loading what was already saved, not a new claim.
   */
  restoreHandles(entries: ReadonlyArray<{ route: string; agentId: string }> | undefined): void {
    if (!entries) return;
    for (const entry of entries) {
      if (!entry?.route || !entry?.agentId) continue;
      // A route names exactly one holder; last write wins, as when claiming.
      this.handleOwner.set(entry.route, entry.agentId);
      this.handleByAgent.set(entry.agentId, entry.route);
    }
  }

  /** The alias assigned to an agent, if it has been seen. */
  getAlias(agentId: string): string | null {
    return this.aliasByAgent.get(agentId) ?? null;
  }

  /** The handle route an agent holds, if any. */
  getHandleRoute(agentId: string): string | null {
    return this.handleByAgent.get(agentId) ?? null;
  }

  /** The bare handle an agent holds, if any. */
  getHandle(agentId: string): string | null {
    const route = this.handleByAgent.get(agentId);
    return route ? route.split('::@')[1] ?? null : null;
  }

  /** The agent a route belongs to, or null when the route is unknown. */
  getRouteOwner(route: string): string | null {
    return this.handleOwner.get(route) ?? this.aliasOwner.get(route) ?? null;
  }

  /**
   * Find holders of a bare handle in any project.
   *
   * Handles are claimed per project so two projects can each have a "reviewer",
   * but messaging is explicitly cross-project — the sender is usually in a
   * different workspace than the recipient and has no idea which project the
   * handle was claimed in. Resolving only against the sender's own project made
   * every cross-project send by handle fail with "no running agent matches",
   * which is precisely the case handles exist for.
   *
   * Returns every match so the caller can refuse rather than guess when a
   * handle is used in more than one project.
   */
  findHandleHolders(bareHandle: string): Array<{ agentId: string; route: string }> {
    const wanted = bareHandle.trim().toLowerCase().replace(/^@/, '');
    if (!wanted) return [];
    const suffix = `::@${wanted}`;
    const holders: Array<{ agentId: string; route: string }> = [];
    for (const [route, agentId] of this.handleOwner) {
      if (route.endsWith(suffix)) holders.push({ agentId, route });
    }
    return holders;
  }

  /**
   * Send a message to a specific agent or broadcast to all ('*').
   * Returns the created message.
   */
  send(
    fromAgentId: string,
    fromAgentName: string,
    toAgentId: string,
    message: string,
    options: SendOptions = {},
  ): AgentMessage {
    const msg: AgentMessage = {
      id: `msg-${this.nextId++}`,
      fromAgentId,
      fromAgentName,
      toAgentId,
      toAlias: options.toAlias
        ?? (toAgentId === '*'
          ? null
          : this.handleByAgent.get(toAgentId) ?? this.aliasByAgent.get(toAgentId) ?? null),
      kind: options.kind ?? (fromAgentId === SYSTEM_SENDER_ID ? 'system' : 'peer'),
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
   * True when this message is addressed to the given agent — by session ID, by
   * an alias the agent currently owns, or as a broadcast it has not read yet.
   * Never matches the sender's own messages.
   */
  private isAddressedTo(msg: AgentMessage, agentId: string): boolean {
    if (msg.fromAgentId === agentId) return false;
    if (msg.toAgentId === agentId) return true;
    if (msg.toAgentId === '*') return !this.broadcastReads.has(`${agentId}:${msg.id}`);
    // Route delivery. Aliases map to one session for life; a handle goes to
    // whoever holds it now, which is how mail reaches a restarted agent.
    if (msg.toAlias && this.getRouteOwner(msg.toAlias) === agentId) return true;

    // Late resolution. A message sent to a name that didn't resolve was stored
    // with the raw target and no route, and would never be delivered even once
    // the name became resolvable — it just sat in the queue forever. Retry the
    // lookup at read time so a handle claimed later, or one that failed to
    // resolve because of a bug, still reaches its owner.
    if (!msg.toAlias) {
      if (this.getRouteOwner(msg.toAgentId) === agentId) return true;
      const holders = this.findHandleHolders(msg.toAgentId);
      if (holders.length === 1 && holders[0].agentId === agentId) return true;
    }
    return false;
  }

  /**
   * Get unread messages for an agent (includes broadcasts).
   *
   * Returns peer messages oldest-first (conversations read in order), then
   * system notices newest-first (older notices are stale), capped by `limit`.
   * Only the returned messages are marked read; `pending` reports what is still
   * waiting so a filtered read never hides mail silently.
   */
  getUnread(agentId: string, options: GetUnreadOptions = {}): UnreadResult {
    const kind = options.kind ?? 'all';
    const limit = Math.max(0, options.limit ?? DEFAULT_MESSAGE_LIMIT);

    // Order by position in the queue, not by timestamp: several messages can
    // land in the same millisecond, which would make the sort arbitrary.
    const addressed: Array<{ msg: AgentMessage; seq: number }> = [];
    this.messages.forEach((msg, seq) => {
      if (!msg.read && this.isAddressedTo(msg, agentId)) addressed.push({ msg, seq });
    });

    const matches = addressed.filter(({ msg }) => {
      if (kind !== 'all' && msg.kind !== kind) return false;
      if (options.fromAgentId && msg.fromAgentId !== options.fromAgentId) return false;
      if (options.excludeFrom && msg.fromAgentId === options.excludeFrom) return false;
      return true;
    });

    const peer = matches
      .filter(({ msg }) => msg.kind === 'peer')
      .sort((a, b) => a.seq - b.seq);
    const system = matches
      .filter(({ msg }) => msg.kind === 'system')
      .sort((a, b) => b.seq - a.seq);

    const selected = [...peer, ...system].slice(0, limit).map(({ msg }) => msg);
    const delivered = new Set(selected.map((m) => m.id));

    for (const m of selected) {
      if (m.toAgentId === '*') {
        this.broadcastReads.add(`${agentId}:${m.id}`);
      } else {
        m.read = true;
      }
    }

    const pending = { peer: 0, system: 0 };
    for (const { msg } of addressed) {
      if (delivered.has(msg.id)) continue;
      pending[msg.kind] += 1;
    }

    return {
      messages: selected.map((m) => ({ ...m, read: true })),
      pending,
    };
  }

  /** Get total unread count for an agent (for status indicators). */
  getUnreadCount(agentId: string): number {
    let count = 0;
    for (const m of this.messages) {
      if (m.read) continue;
      if (this.isAddressedTo(m, agentId)) count++;
    }
    return count;
  }

  /**
   * Summarize what is waiting, without marking anything read.
   *
   * Backs the prompt-submit notice: an agent is told it has mail at the start
   * of a turn, and decides for itself whether to spend a tool call reading it.
   * Peeking must never consume, or the notice would eat the very message it is
   * announcing.
   */
  summarizeUnread(agentId: string): { peer: number; system: number; senders: string[] } {
    let peer = 0;
    let system = 0;
    const senders = new Set<string>();
    for (const m of this.messages) {
      if (m.read || !this.isAddressedTo(m, agentId)) continue;
      if (m.kind === 'peer') {
        peer++;
        senders.add(m.fromAgentName || m.fromAgentId);
      } else {
        system++;
      }
    }
    return { peer, system, senders: [...senders] };
  }

  /**
   * True when the agent already has an unread message from this sender.
   * Used to suppress repeat system notices that nobody has picked up yet.
   */
  hasUnreadFrom(toAgentId: string, fromAgentId: string): boolean {
    return this.messages.some(
      (m) => !m.read && m.fromAgentId === fromAgentId && this.isAddressedTo(m, toAgentId),
    );
  }

  /** Clear all messages. */
  clear(): void {
    this.messages = [];
    this.broadcastReads.clear();
    this.aliasByAgent.clear();
    this.aliasOwner.clear();
    this.handleOwner.clear();
    this.handleByAgent.clear();
    this.nextId = 1;
  }
}
