/**
 * VS Code extension entry point — activation and commands.
 */

import * as vscode from 'vscode';
import { EventBus, MetricsEngine, AgentStateManager } from '@event-horizon/core';
import type { AgentEvent } from '@event-horizon/core';
import { createWebviewProvider } from './webviewProvider';
import { startEventServer, stopEventServer } from './eventServer';
import { setupCopilotOutputChannel } from './copilotChannel';
import { runSetupClaudeCodeHooks, setupClaudeCodeHooks, hasStaleClaudeCodeHooks } from './setupHooks';
import { setupOpenCodeHooks, hasStaleOpenCodeHooks } from './setupOpenCodeHooks';
import { setupCopilotHooks, hasStaleCopilotHooks } from './setupCopilotHooks';

const webviewRef: { current: vscode.Webview | null } = { current: null };

// ── Workspace-aware cooperation detection ────────────────────────────────────

/** Normalize a path for cross-platform comparison. */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase();
}

/**
 * Returns true if two cwd paths share a workspace folder or one is a parent of the other.
 * Uses VS Code's workspace folders as the authority for multi-root workspaces.
 */
function areAgentsCooperating(cwdA: string, cwdB: string): boolean {
  const normA = normalizePath(cwdA);
  const normB = normalizePath(cwdB);

  // Exact match
  if (normA === normB) return true;

  // One is nested inside the other
  if (normA.startsWith(normB + '/') || normB.startsWith(normA + '/')) return true;

  // Both fall under the same VS Code workspace folder
  const folders = vscode.workspace.workspaceFolders;
  if (folders) {
    for (const folder of folders) {
      const normFolder = normalizePath(folder.uri.fsPath);
      const normFolderSlash = normFolder.endsWith('/') ? normFolder : normFolder + '/';
      if ((normA === normFolder || normA.startsWith(normFolderSlash)) &&
          (normB === normFolder || normB.startsWith(normFolderSlash))) return true;
    }
  }

  return false;
}

export function activate(context: vscode.ExtensionContext): void {
  const eventBus = new EventBus();
  const metricsEngine = new MetricsEngine();
  const agentStateManager = new AgentStateManager();

  // ── Copilot subagent session tracking ──────────────────────────────────────
  // Copilot SubagentStart/SubagentStop use the subagent's session_id, not the
  // parent's. We remap subagent events to the parent so they appear as moons
  // on the parent planet instead of spawning a separate planet.
  const subagentToParent = new Map<string, string>();
  let lastRunSubagentParent: string | null = null;

  function onAgentEvent(event: AgentEvent): void {
    // Inject workspace cwd if the agent/event doesn't provide one
    if (!event.payload?.cwd) {
      const primaryFolder = vscode.workspace.workspaceFolders?.[0];
      if (primaryFolder) {
        event = { ...event, payload: { ...event.payload, cwd: primaryFolder.uri.fsPath } };
      }
    }

    // Track parent→subagent relationship for Copilot:
    // 1) PreToolUse with tool_name "runSubagent" = parent is about to spawn
    if (event.type === 'tool.call' && event.payload?.toolName === 'runSubagent') {
      lastRunSubagentParent = event.agentId;
    }
    // 2) SubagentStart: map the subagent session to the parent
    if (event.payload?.isSubagent && event.payload?.subagentSessionId && lastRunSubagentParent) {
      subagentToParent.set(String(event.payload.subagentSessionId), lastRunSubagentParent);
      lastRunSubagentParent = null;
    }

    // Remap subagent events to the parent agent
    const parentId = subagentToParent.get(event.agentId);
    if (parentId) {
      // Subagent permission/waiting events should not affect the parent —
      // the parent's own session fires PermissionRequest when IT needs input.
      if (event.type === 'agent.waiting') return;
      event = { ...event, agentId: parentId };
    }

    metricsEngine.process(event);
    agentStateManager.apply(event);
    if (webviewRef.current) {
      webviewRef.current.postMessage({ type: 'event', payload: event });
    }
  }

  const unsubscribeEventBus = eventBus.on(onAgentEvent);

  startEventServer({ onEvent: (event) => eventBus.emit(event) })
    .then(async () => {
      // Auto-refresh hooks with new session token if they exist from a previous session
      const [staleClaude, staleOpenCode, staleCopilot] = await Promise.all([
        hasStaleClaudeCodeHooks(),
        hasStaleOpenCodeHooks(),
        hasStaleCopilotHooks(),
      ]);
      if (staleClaude) await setupClaudeCodeHooks();
      if (staleOpenCode) await setupOpenCodeHooks();
      if (staleCopilot) await setupCopilotHooks();
    })
    .catch(() => {
      // Error already shown to user via showErrorMessage in eventServer
    });
  const copilotDisposable = setupCopilotOutputChannel((event) => eventBus.emit(event));
  context.subscriptions.push(copilotDisposable);

  const provider = createWebviewProvider(context, webviewRef, agentStateManager, metricsEngine);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('eventHorizon.universe', provider, {
      webviewOptions: { retainContextWhenHidden: true }, // 2.2 — keep WebGL context alive when panel is hidden
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('eventHorizon.open', () => {
      vscode.commands.executeCommand('eventHorizon.universe.focus');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('eventHorizon.setupClaudeCode', runSetupClaudeCodeHooks)
  );

  // Show one-time welcome notification on first install
  const hasShownWelcome = context.globalState.get<boolean>('welcomeShown');
  if (!hasShownWelcome) {
    void context.globalState.update('welcomeShown', true);
    void vscode.window
      .showInformationMessage(
        'Event Horizon installed! Connect your AI agents to see them appear as planets.',
        'Connect Claude Code',
        'Show Demo',
      )
      .then((choice) => {
        if (choice === 'Connect Claude Code') {
          void vscode.commands.executeCommand('eventHorizon.setupClaudeCode');
        } else if (choice === 'Show Demo') {
          void vscode.commands.executeCommand('eventHorizon.universe.focus');
        }
      });
  }

  // ── Cooperation ship spawner ──────────────────────────────────────────────
  // Ship frequency adapts to agent activity:
  //   Idle:   heartbeat — one ship every 15–25 seconds
  //   Active: burst — 1–3 ships every 2–5 seconds
  const ACTIVE_STATES = new Set(['thinking', 'error']);
  let cooperationTimer: ReturnType<typeof setTimeout> | null = null;

  function emitCoopShip(fromId: string, toId: string) {
    const fromAgent = agentStateManager.getAgent(fromId);
    const coopEvent: AgentEvent = {
      id: `coop-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      agentId: fromId,
      agentName: fromAgent?.name ?? fromId,
      agentType: (fromAgent?.type ?? 'unknown') as AgentEvent['agentType'],
      type: 'data.transfer',
      timestamp: Date.now(),
      payload: { toAgentId: toId, payloadSize: 1, cooperation: true },
    };
    webviewRef.current?.postMessage({ type: 'event', payload: coopEvent });
  }

  function scheduleCoopShip() {
    // Base tick — check state and decide delay
    cooperationTimer = setTimeout(() => {
      cooperationTimer = null;
      if (!webviewRef.current) { scheduleCoopShip(); return; }

      const agents = agentStateManager.getAllAgents();
      const agentsWithCwd = agents.filter((a) => a.cwd);
      if (agentsWithCwd.length < 2) {
        // No pairs possible — slow poll
        cooperationTimer = setTimeout(scheduleCoopShip, 5_000);
        return;
      }

      // Find cooperating pairs
      const pairs: Array<[string, string]> = [];
      for (let i = 0; i < agentsWithCwd.length; i++) {
        for (let j = i + 1; j < agentsWithCwd.length; j++) {
          if (areAgentsCooperating(agentsWithCwd[i].cwd!, agentsWithCwd[j].cwd!)) {
            pairs.push([agentsWithCwd[i].id, agentsWithCwd[j].id]);
          }
        }
      }
      if (pairs.length === 0) {
        cooperationTimer = setTimeout(scheduleCoopShip, 5_000);
        return;
      }

      // Determine if any agent in any pair is active
      const anyActive = pairs.some(([a, b]) => {
        const sa = agentStateManager.getAgent(a);
        const sb = agentStateManager.getAgent(b);
        return (sa && ACTIVE_STATES.has(sa.state)) || (sb && ACTIVE_STATES.has(sb.state));
      });

      // Pick a random pair and direction
      const [pairA, pairB] = pairs[Math.floor(Math.random() * pairs.length)];
      const [from, to] = Math.random() < 0.5 ? [pairA, pairB] : [pairB, pairA];

      if (anyActive) {
        // Active burst: 1–3 ships in a staggered convoy
        const shipCount = 1 + Math.floor(Math.random() * 3); // 1, 2, or 3
        emitCoopShip(from, to);
        for (let i = 1; i < shipCount; i++) {
          // Stagger convoy ships by 300–800ms
          setTimeout(() => {
            if (webviewRef.current) emitCoopShip(from, to);
          }, i * (300 + Math.random() * 500));
        }
        // Next check in 2–5 seconds
        cooperationTimer = setTimeout(scheduleCoopShip, 2_000 + Math.random() * 3_000);
      } else {
        // Idle heartbeat: single ship, next check in 15–25 seconds
        emitCoopShip(from, to);
        cooperationTimer = setTimeout(scheduleCoopShip, 15_000 + Math.random() * 10_000);
      }
    }, 1_000); // initial 1s tick to be responsive
  }
  scheduleCoopShip();

  context.subscriptions.push({
    dispose: () => {
      if (cooperationTimer) clearTimeout(cooperationTimer);
      unsubscribeEventBus();
      stopEventServer();
      webviewRef.current = null;
    },
  });
}

export function deactivate(): void {
  stopEventServer();
  webviewRef.current = null;
}
