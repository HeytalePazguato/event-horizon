// OpenCode v1 plugin: forwards OpenCode events to the Event Horizon server.
import { send, sendFinal, checkLock, randomSuffix } from '../shared/transport';

interface UrlLike {
  href?: string;
  pathname?: string;
}

type PathLike = string | UrlLike | null | undefined;

interface PluginContext {
  project?: { id?: string | number; path?: PathLike; directory?: PathLike; worktree?: PathLike } | null;
  directory?: PathLike;
  worktree?: PathLike;
  serverUrl?: string | UrlLike | null;
}

interface ToolInput {
  tool?: string;
  sessionID?: string;
  callID?: string;
  parentID?: string;
  input?: { file_path?: unknown; path?: unknown } | null;
}

interface PermissionInput {
  tool?: unknown;
  permission?: unknown;
  granted?: unknown;
}

type Hooks = Record<string, (input: never) => Promise<void>>;

function resolvePath(v: PathLike): string | undefined {
  if (!v) return undefined;
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && v.href) {
    // file:///C:/path or file:///home/path
    try {
      return new URL(v.href).pathname.replace(/^\/([A-Z]:)/, '$1');
    } catch {
      // fall through to the manual strip
    }
    return v.href.replace(/^file:\/\/\//, '').replace(/^file:\/\//, '');
  }
  if (typeof v === 'object' && v.pathname) return v.pathname;
  return String(v);
}

const FILE_TOOLS = ['read', 'write', 'edit', 'patch', 'file_read', 'file_write', 'file_edit'];

export default async function EventHorizon(
  { project, directory, worktree, serverUrl }: PluginContext,
): Promise<Hooks> {
  // Use project.id when available, but always append a unique suffix so
  // multiple OpenCode instances in the same project get separate planets.
  const base = project?.id ? String(project.id) : 'opencode';
  const uid = Date.now().toString(36) + randomSuffix();
  const sessionId = base + '-' + uid;

  // Resolve cwd: worktree/directory may be strings, URL objects, or absent.
  const cwd = resolvePath(worktree)
    || resolvePath(directory)
    || resolvePath(project?.path)
    || resolvePath(project?.directory)
    || resolvePath(project?.worktree)
    || (typeof process !== 'undefined' && process.cwd ? process.cwd() : undefined);
  const cwdFolder = cwd ? String(cwd).replace(/\\/g, '/').split('/').pop() : undefined;
  const agentName = cwdFolder ? 'OpenCode (' + cwdFolder + ')' : 'OpenCode';
  // OpenCode's internal server URL, used by Event Horizon for SSE subagent tracking
  const opencodeServerUrl = typeof serverUrl === 'object' && serverUrl?.href
    ? serverUrl.href
    : (typeof serverUrl === 'string' ? serverUrl : undefined);

  send('session.created', { sessionId, agentName, cwd, payload: {}, serverUrl: opencodeServerUrl });

  // Re-send session.created every 30s as a heartbeat so Event Horizon can
  // discover this agent even if it started after OpenCode. EH deduplicates spawns.
  const heartbeatInterval = setInterval(() => {
    send('session.created', { sessionId, agentName, cwd, payload: { heartbeat: true }, serverUrl: opencodeServerUrl });
  }, 30000);

  // Send session.deleted when OpenCode exits (Ctrl+C, exit command, etc.)
  const onExit = (): void => {
    clearInterval(heartbeatInterval);
    sendFinal('session.deleted', { sessionId, agentName, cwd, payload: {} });
  };
  process.on('beforeExit', onExit);
  process.on('SIGINT', onExit);
  process.on('SIGTERM', onExit);

  return {
    event: async ({ event }: { event?: { type?: string } & Record<string, unknown> }) => {
      send(event?.type ?? 'unknown', {
        sessionId,
        agentName,
        cwd,
        payload: event ?? {},
      });
    },
    'tool.execute.before': async (input: ToolInput) => {
      const toolName = String(input?.tool || '');
      const fp = input?.input?.file_path || input?.input?.path;
      const parentID = input?.sessionID !== input?.parentID ? input?.parentID : undefined;
      send('tool.execute.before', {
        sessionId,
        agentName,
        cwd,
        payload: {
          toolName,
          sessionID: input?.sessionID,
          callID: input?.callID,
          filePath: fp ? String(fp) : undefined,
          parentID,
        },
      });
      // Check file lock for any tool that accesses files
      if (FILE_TOOLS.includes(toolName.toLowerCase()) && fp) {
        await checkLock(String(fp), sessionId, agentName);
      }
    },
    'tool.execute.after': async (input: ToolInput) => {
      const fp = input?.input?.file_path || input?.input?.path;
      send('tool.execute.after', {
        sessionId,
        agentName,
        cwd,
        payload: {
          toolName: input?.tool,
          sessionID: input?.sessionID,
          callID: input?.callID,
          filePath: fp ? String(fp) : undefined,
        },
      });
      // Locks are NOT released here: they auto-expire via the 30s TTL,
      // and each tool.execute.before refreshes the TTL.
    },
    'permission.asked': async (input: PermissionInput) => {
      send('permission.asked', {
        sessionId,
        agentName,
        cwd,
        payload: { tool: input?.tool, permission: input?.permission },
      });
    },
    'permission.replied': async (input: PermissionInput) => {
      send('permission.replied', {
        sessionId,
        agentName,
        cwd,
        payload: { tool: input?.tool, granted: input?.granted },
      });
    },
  };
}
