/**
 * Cost recommendations with a concrete action attached.
 *
 * Recommendations used to be plain strings, so the Cost panel could only show
 * them. Each one now carries what to do about it; the webview posts the action
 * back to the extension host, which executes it. The UI never performs the
 * action itself.
 */

export type RecommendationAction =
  /** Store a digest of the file in shared knowledge so agents stop re-reading it. */
  | { kind: 'add-to-knowledge'; filePath: string }
  /** Send a message to every connected agent. */
  | { kind: 'broadcast'; message: string }
  | { kind: 'open-file'; filePath: string }
  /** Select the agent in the universe and command center. */
  | { kind: 'focus-agent'; agentId: string }
  /** Reveal the task in the plan panel. */
  | { kind: 'open-task'; taskId: string };

export type RecommendationKind = 'duplicate-read' | 'low-cache-hit' | 'compaction-pressure' | 'cost-anomaly';

export interface Recommendation {
  /** Stable across refreshes (e.g. `dup:<file>`), so UI state can key on it. */
  id: string;
  kind: RecommendationKind;
  severity: 'info' | 'warn';
  text: string;
  action: RecommendationAction | null;
}

const ACTION_KINDS = new Set<RecommendationAction['kind']>(['add-to-knowledge', 'broadcast', 'open-file', 'focus-agent', 'open-task']);

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** Validate an action received over the webview boundary. */
export function isRecommendationAction(v: unknown): v is RecommendationAction {
  if (!v || typeof v !== 'object') return false;
  const a = v as Record<string, unknown>;
  if (typeof a.kind !== 'string' || !ACTION_KINDS.has(a.kind as RecommendationAction['kind'])) return false;
  switch (a.kind) {
    case 'add-to-knowledge':
    case 'open-file':
      return nonEmpty(a.filePath);
    case 'broadcast':
      return nonEmpty(a.message);
    case 'focus-agent':
      return nonEmpty(a.agentId);
    case 'open-task':
      return nonEmpty(a.taskId);
    default:
      return false;
  }
}
