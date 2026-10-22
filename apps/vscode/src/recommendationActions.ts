/**
 * Executes the action attached to a Cost panel recommendation.
 *
 * The webview only reports which action the user clicked; everything with an
 * effect happens here, in the extension host. Navigation actions (focus an
 * agent, open a plan task) are sent back to the webview as messages.
 */

import * as path from 'path';
import type { RecommendationAction } from '@event-horizon/core';

export interface ActionResult {
  ok: boolean;
  message: string;
  /** Knowledge key written by add-to-knowledge, so the UI can show the entry as added. */
  knowledgeKey?: string;
}

export interface RecommendationActionDeps {
  workspaceRoot?: string;
  readFile: (absPath: string) => Promise<string>;
  /** Digest + pointer for a file; null when the secret scanner rejects it. */
  buildDigest: (absPath: string, content: string) => Promise<string | null>;
  writeKnowledge: (key: string, value: string) => void;
  openFile: (absPath: string) => Promise<void>;
  broadcast: (message: string) => void;
  postToWebview: (message: Record<string, unknown>) => void;
}

function resolvePath(filePath: string, root: string | undefined): string {
  return path.isAbsolute(filePath) || !root ? filePath : path.join(root, filePath);
}

export async function dispatchRecommendationAction(action: RecommendationAction, deps: RecommendationActionDeps): Promise<ActionResult> {
  switch (action.kind) {
    case 'add-to-knowledge': {
      const absPath = resolvePath(action.filePath, deps.workspaceRoot);
      let content: string;
      try {
        content = await deps.readFile(absPath);
      } catch {
        return { ok: false, message: `Could not read ${action.filePath}.` };
      }
      const digest = await deps.buildDigest(absPath, content);
      if (digest === null) {
        return { ok: false, message: `${path.basename(absPath)} looks like it contains secrets, so it was not added to shared knowledge.` };
      }
      deps.writeKnowledge(absPath, digest);
      return { ok: true, message: `Added a summary of ${path.basename(absPath)} to shared knowledge.`, knowledgeKey: absPath };
    }
    case 'open-file': {
      const absPath = resolvePath(action.filePath, deps.workspaceRoot);
      try {
        await deps.openFile(absPath);
        return { ok: true, message: `Opened ${path.basename(absPath)}.` };
      } catch {
        return { ok: false, message: `Could not open ${action.filePath}.` };
      }
    }
    case 'broadcast':
      deps.broadcast(action.message);
      return { ok: true, message: 'Sent to every connected agent.' };
    case 'focus-agent':
      deps.postToWebview({ type: 'focus-agent', agentId: action.agentId });
      return { ok: true, message: 'Showing the agent.' };
    case 'open-task':
      deps.postToWebview({ type: 'open-plan-task', taskId: action.taskId });
      return { ok: true, message: `Showing task ${action.taskId}.` };
  }
}
