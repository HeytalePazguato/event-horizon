// OpenCode v2 plugin: forwards OpenCode events to the Event Horizon server.
// v2 loads a plain `{ id, setup }` default export; `setup` may return a cleanup
// function, which v2 calls when the plugin's scope closes (quit, reload).
// No import of OpenCode's plugin package: the literal shape is all the loader checks.
import { send, sendFinal, checkLock, randomSuffix } from '../shared/transport';

interface Disposable {
  dispose?: () => unknown;
}

interface ToolHookInput {
  tool?: string;
  sessionID?: string;
  agent?: string;
  messageID?: string;
  id?: string;
  callID?: string;
  status?: string;
  input?: { path?: unknown; filePath?: unknown; file_path?: unknown } | null;
}

interface PermissionHookInput {
  sessionID?: string;
  agent?: string;
  action?: unknown;
  resources?: unknown;
  source?: unknown;
  effect?: string;
}

interface OpenCodeEvent {
  type?: string;
  [key: string]: unknown;
}

/** The slice of the v2 promise-plugin context this plugin uses. Every member is optional on purpose. */
interface PluginContext {
  location?: {
    directory?: string;
    project?: { id?: string | number; worktree?: string; directory?: string } | null;
  } | null;
  tool?: {
    hook?: (name: 'execute.before' | 'execute.after', fn: (input: ToolHookInput) => Promise<void>) => Promise<Disposable>;
  };
  permission?: {
    hook?: (name: 'evaluate', fn: (input: PermissionHookInput) => Promise<void>) => Promise<Disposable>;
  };
  event?: {
    subscribe?: (opts: { signal: AbortSignal }) => AsyncIterable<OpenCodeEvent>;
  };
}

const FILE_TOOLS = ['read', 'write', 'edit', 'patch', 'apply_patch', 'file_read', 'file_write', 'file_edit'];

function filePathOf(input: ToolHookInput): string | undefined {
  const fp = input?.input?.path || input?.input?.filePath || input?.input?.file_path;
  return fp ? String(fp) : undefined;
}

export default {
  id: 'event-horizon',
  async setup(ctx: PluginContext): Promise<() => void> {
    // Use project.id when available, but always append a unique suffix so
    // multiple OpenCode instances in the same project get separate planets.
    const project = ctx?.location?.project;
    const base = project?.id ? String(project.id) : 'opencode';
    const uid = Date.now().toString(36) + randomSuffix();
    const sessionId = base + '-' + uid;

    const cwd = ctx?.location?.directory
      || project?.worktree
      || project?.directory
      || (typeof process !== 'undefined' && process.cwd ? process.cwd() : undefined);
    const cwdFolder = cwd ? String(cwd).replace(/\\/g, '/').split('/').pop() : undefined;
    const agentName = cwdFolder ? 'OpenCode (' + cwdFolder + ')' : 'OpenCode';

    send('session.created', { sessionId, agentName, cwd, payload: {} });

    // Re-send session.created every 30s as a heartbeat so Event Horizon can
    // discover this agent even if it started after OpenCode. EH deduplicates spawns.
    const heartbeatInterval = setInterval(() => {
      send('session.created', { sessionId, agentName, cwd, payload: { heartbeat: true } });
    }, 30000);

    const disposables: Disposable[] = [];
    const register = async (hook: (() => Promise<Disposable> | undefined) | undefined): Promise<void> => {
      try {
        const d = await hook?.();
        if (d) disposables.push(d);
      } catch {
        // A missing or changed API must never crash OpenCode.
      }
    };

    await register(() => ctx?.tool?.hook?.('execute.before', async (input) => {
      const toolName = String(input?.tool || '');
      const fp = filePathOf(input);
      send('tool.execute.before', {
        sessionId,
        agentName,
        cwd,
        payload: {
          toolName,
          sessionID: input?.sessionID,
          callID: input?.id ?? input?.callID,
          filePath: fp,
        },
      });
      // v2 denies a tool call when execute.before throws, so checkLock's
      // "is locked by" error is deliberately left to propagate.
      if (FILE_TOOLS.includes(toolName.toLowerCase()) && fp) {
        await checkLock(fp, sessionId, agentName);
      }
    }));

    await register(() => ctx?.tool?.hook?.('execute.after', async (input) => {
      send('tool.execute.after', {
        sessionId,
        agentName,
        cwd,
        payload: {
          toolName: input?.tool,
          sessionID: input?.sessionID,
          callID: input?.id ?? input?.callID,
          filePath: filePathOf(input),
          status: input?.status,
        },
      });
      // Locks are NOT released here: they auto-expire via the 30s TTL,
      // and each tool.execute.before refreshes the TTL.
    }));

    // evaluate runs for every permission check, including ones that resolve to
    // allow. Only an "ask" outcome means OpenCode is waiting on the user.
    await register(() => ctx?.permission?.hook?.('evaluate', async (input) => {
      send(input?.effect === 'ask' ? 'permission.asked' : 'permission.evaluated', {
        sessionId,
        agentName,
        cwd,
        payload: {
          tool: input?.action,
          permission: input?.action,
          resources: input?.resources,
          effect: input?.effect,
          sessionID: input?.sessionID,
        },
      });
    }));

    // Forward every bus event, so session.execution.*, session.idle and
    // session.deleted reach Event Horizon; the connector decides what they mean.
    const controller = new AbortController();
    void (async () => {
      try {
        if (!ctx?.event?.subscribe) return;
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          send(event?.type ?? 'unknown', {
            sessionId,
            agentName,
            cwd,
            payload: event ?? {},
          });
        }
      } catch {
        // Stream closed or unsupported: nothing to forward.
      }
    })();

    return () => {
      controller.abort();
      clearInterval(heartbeatInterval);
      for (const d of disposables) {
        try {
          void Promise.resolve(d.dispose?.()).catch(() => {});
        } catch {
          // ignore
        }
      }
      sendFinal('session.deleted', { sessionId, agentName, cwd, payload: {} });
    };
  },
};
