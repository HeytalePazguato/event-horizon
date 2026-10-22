/**
 * Serve shared-knowledge digests in place of repeat file reads.
 *
 * When an agent is about to Read a file that the team put into shared
 * knowledge, the PreToolUse hook can deny the read with the stored digest as
 * the reason, so the agent gets the summary without spending the tokens.
 *
 * Deny ONCE, then allow. Claude Code's Edit tool refuses to edit a file that
 * has not been read in the session, so a permanent deny would make the file
 * uneditable. The denial says to run Read again for the full contents, and
 * that retry goes through. An agent is intercepted at most once per file per
 * version of the knowledge entry.
 *
 * Never intercepted: secret paths, files changed on disk after the knowledge
 * entry was written (the digest may be stale), and anything when the feature
 * is turned off.
 */

import * as path from 'path';

export interface KnowledgeLike {
  key: string;
  value: string;
  updatedAt: number;
  validUntil?: number;
}

export interface ReadInterceptorDeps {
  /** Workspace knowledge entries to match file paths against. */
  entries: () => KnowledgeLike[];
  /** Last-modified time of a file, or null if it cannot be read. */
  mtimeMs: (filePath: string) => number | null;
  isSecretPath: (filePath: string) => boolean;
  enabled: () => boolean;
  platform?: NodeJS.Platform;
  now?: () => number;
}

export interface PreToolUseHookOutput {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse';
    permissionDecision: 'deny';
    permissionDecisionReason: string;
  };
}

const READ_TOOLS = new Set(['Read', 'ReadFile']);

export class ReadInterceptor {
  /** agentId|path|entryVersion already served a digest. */
  private readonly served = new Set<string>();

  constructor(private readonly deps: ReadInterceptorDeps) {}

  private normalize(p: string): string {
    const n = path.normalize(p).split('\\').join('/');
    return (this.deps.platform ?? process.platform) === 'win32' ? n.toLowerCase() : n;
  }

  /** The hook output to deny this read with, or null to let it through. */
  decide(agentId: string, filePath: string, toolName: string | undefined): PreToolUseHookOutput | null {
    if (!toolName || !READ_TOOLS.has(toolName)) return null;
    if (!this.deps.enabled() || !agentId || !filePath) return null;
    if (this.deps.isSecretPath(filePath)) return null;

    const now = (this.deps.now ?? Date.now)();
    const target = this.normalize(filePath);
    const entry = this.deps.entries().find((e) =>
      (e.validUntil === undefined || e.validUntil > now) && this.normalize(e.key) === target);
    if (!entry) return null;

    // The digest describes the file as it was when stored; a later edit makes it stale.
    const mtime = this.deps.mtimeMs(filePath);
    if (mtime === null || mtime > entry.updatedAt) return null;

    const servedKey = `${agentId}|${target}|${entry.updatedAt}`;
    if (this.served.has(servedKey)) return null; // the retry, or a later read: let it through
    this.served.add(servedKey);

    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          `[Event Horizon] ${filePath} is in your team's shared knowledge, so here is its summary instead of a full read. `
          + 'If you need the full contents (for example to edit it), run Read again on the same path and it will go through.\n\n'
          + entry.value,
      },
    };
  }
}
