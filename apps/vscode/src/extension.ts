/**
 * VS Code extension entry point — activation and commands.
 */

import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { EventBus, MetricsEngine, AgentStateManager } from '@event-horizon/core';
import type { AgentEvent } from '@event-horizon/core';
import { openUniversePanel } from './webviewProvider';
import { startEventServer, stopEventServer, setFileLockingEnabled, releaseAgentLocks, initMcpServer, fileActivityTracker } from './eventServer';
import { setupCopilotOutputChannel } from './copilotChannel';
import { runSetupClaudeCodeHooks, setupClaudeCodeHooks, hasStaleClaudeCodeHooks, ensureLockScripts } from './setupHooks';
import { setupOpenCodeHooks, hasStaleOpenCodeHooks } from './setupOpenCodeHooks';
import { setupCopilotHooks, hasStaleCopilotHooks } from './setupCopilotHooks';
import { getInstalledSkills, createSkillWatcher } from './skillScanner';
import type { SkillInfo } from './skillScanner';
import { TranscriptWatcher } from './transcriptWatcher';
import { OpenCodeSSEWatcher } from './openCodeSSEWatcher';

const webviewRef: { current: vscode.Webview | null } = { current: null };
let cachedSkills: SkillInfo[] = [];

/** Forward an event to the main webview. */
function broadcastEvent(event: AgentEvent): void {
  webviewRef.current?.postMessage({ type: 'event', payload: event });
}



// ── Nudge running agents to announce themselves ─────────────────────────────

import * as fsp from 'fs/promises';

/**
 * Touch agent config files (read + write identical content) so any
 * already-running agent detects the change and fires a ConfigChange hook.
 * Each running session sends its real session ID, name, and cwd — no
 * fake placeholder planets needed.
 */
async function nudgeRunningAgents(): Promise<void> {
  const home = os.homedir();
  const filesToTouch: string[] = [
    // Claude Code: touching settings.json triggers ConfigChange hook
    path.join(home, '.claude', 'settings.json'),
    // OpenCode: touching the plugin file may trigger a reload
    path.join(home, '.config', 'opencode', 'plugins', 'event-horizon.ts'),
  ];
  for (const filePath of filesToTouch) {
    try {
      const content = await fsp.readFile(filePath, 'utf8');
      await fsp.writeFile(filePath, content, 'utf8');
    } catch { /* file doesn't exist or not writable — skip */ }
  }
}



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

  // Initialize MCP server with runtime dependencies
  initMcpServer({ agentStateManager });

  // ── Status bar — live agent count ──────────────────────────────────────────
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  statusBarItem.command = 'eventHorizon.open';
  statusBarItem.tooltip = 'Event Horizon — Open Universe';
  statusBarItem.text = '$(rocket) 0 agents';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  let statusBarBlinkTimer: ReturnType<typeof setInterval> | null = null;

  function updateStatusBar(): void {
    const agents = agentStateManager.getAllAgents();
    const count = agents.length;
    const waitingAgents = agents.filter((a) => a.state === 'waiting');

    if (waitingAgents.length > 0) {
      // Waiting state — blink amber background on/off every 500ms
      const name = waitingAgents[0].name ?? waitingAgents[0].id;
      const label = waitingAgents.length === 1
        ? `${name} needs input`
        : `${waitingAgents.length} agents need input`;
      statusBarItem.text = `$(bell) ${label}`;
      statusBarItem.tooltip = `Event Horizon — ${label}`;
      // Start blinking background if not already
      if (!statusBarBlinkTimer) {
        const warningBg = new vscode.ThemeColor('statusBarItem.warningBackground');
        let on = true;
        statusBarItem.backgroundColor = warningBg;
        statusBarBlinkTimer = setInterval(() => {
          on = !on;
          statusBarItem.backgroundColor = on ? warningBg : undefined;
        }, 500);
      }
    } else {
      // Normal state — clear warning
      statusBarItem.backgroundColor = undefined;
      if (statusBarBlinkTimer) {
        clearInterval(statusBarBlinkTimer);
        statusBarBlinkTimer = null;
      }
      if (count === 0) {
        statusBarItem.text = '$(rocket) Event Horizon';
        statusBarItem.tooltip = 'Event Horizon — Open Universe';
      } else {
        statusBarItem.text = `$(rocket) ${count} agent${count === 1 ? '' : 's'}`;
        statusBarItem.tooltip = `Event Horizon — ${count} active agent${count === 1 ? '' : 's'}`;
      }
    }
  }
  updateStatusBar();

  // ── Claude Code transcript watchers (per session) ──────────────────────────
  // Maps session ID → active TranscriptWatcher. Watchers provide richer events
  // than hooks alone (waiting ring, token usage, tool details from JSONL).
  const transcriptWatchers = new Map<string, TranscriptWatcher>();

  // ── OpenCode SSE watchers (per session) ────────────────────────────────────
  // NOTE: SSE watchers are currently disabled - hooks provide subagent events
  // via session.created with parentID. Keeping infrastructure for future use.
  const openCodeSSEWatchers = new Map<string, OpenCodeSSEWatcher>();

  // /** Events from OpenCode SSE watcher bypass hooks — route directly to webview. */
  // function onOpenCodeSSEEvent(event: AgentEvent): void {
  //   metricsEngine.process(event);
  //   agentStateManager.apply(event);
  //   if (webviewRef.current) {
  //     webviewRef.current.postMessage({ type: 'event', payload: event });
  //   }
  //   updateBadge(agentStateManager);
  // }

  /** Events from transcript watcher bypass hooks — route directly to webview. */
  function onTranscriptEvent(event: AgentEvent): void {
    // Skip if hooks already emitted this type for this agent recently
    // (transcript events carry fromTranscript=true in payload)
    metricsEngine.process(event);
    agentStateManager.apply(event);
    broadcastEvent(event);
    updateStatusBar();
  }

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

    // When a transcript watcher is active for this Claude Code agent, skip hook
    // events that the watcher covers with better accuracy. Hooks still handle:
    // - agent.spawn / agent.terminate (session lifecycle)
    // - Events for non-Claude agents (Copilot, OpenCode)
    // - The initial Stop event that triggers watcher creation
    if (event.agentType === 'claude-code' && !event.payload?.fromTranscript) {
      const hasWatcher = transcriptWatchers.has(event.agentId);
      if (hasWatcher) {
        const hookOnlyTypes: Set<string> = new Set(['agent.spawn', 'agent.terminate']);
        // Let transcript_path-carrying events through (they start the watcher)
        const hasTranscriptPath = !!(event.payload?.transcriptPath);
        if (!hookOnlyTypes.has(event.type) && !hasTranscriptPath) {
          return; // Transcript watcher handles this event type
        }
      }
    }

    // NOTE: SSE watcher filtering disabled - hooks now provide all subagent events
    // via session.created with parentID. Keeping code commented for future use.
    // if (event.agentType === 'opencode' && !event.payload?.fromSSE) {
    //   const sseWatcher = openCodeSSEWatchers.get(event.agentId);
    //   if (sseWatcher?.isConnected()) {
    //     const sseHandledTypes: Set<string> = new Set(['task.start', 'task.complete', 'agent.waiting']);
    //     const hasServerUrl = !!(event.payload?.serverUrl);
    //     if (sseHandledTypes.has(event.type) && event.payload?.isSubagent && !hasServerUrl) {
    //       return; // SSE watcher handles subagent events
    //     }
    //   }
    // }

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
      // Clean up mapping when subagent terminates
      if (event.type === 'agent.terminate') {
        subagentToParent.delete(event.agentId);
      }
      event = { ...event, agentId: parentId };
    }

    metricsEngine.process(event);
    agentStateManager.apply(event);
    broadcastEvent(event);
    updateStatusBar();

    // Track file activity for MCP eh_file_activity tool
    if (event.type === 'tool.call' && event.payload?.filePath) {
      const toolName = event.payload.toolName as string | undefined;
      const action: 'read' | 'write' | 'edit' =
        toolName === 'Write' || toolName === 'WriteFile' ? 'write' :
        toolName === 'Edit' || toolName === 'MultiEdit' ? 'edit' : 'read';
      fileActivityTracker.record({
        filePath: event.payload.filePath as string,
        agentId: event.agentId,
        agentName: event.agentName,
        action,
        timestamp: event.timestamp,
      });
    }

    // Start transcript watcher for Claude Code agents when we first see a transcript path.
    // The watcher provides richer events (waiting ring, per-turn tokens, tool details)
    // and serves as the primary event source; hooks remain as fallback.
    const transcriptPath = event.payload?.transcriptPath as string | undefined;
    if (transcriptPath && event.agentType === 'claude-code') {
      const sessionId = event.agentId;
      if (!transcriptWatchers.has(sessionId)) {
        const watcher = new TranscriptWatcher(
          transcriptPath,
          event.agentId,
          event.agentName,
          sessionId,
          { onEvent: onTranscriptEvent },
        );
        transcriptWatchers.set(sessionId, watcher);
        watcher.start().catch(() => { /* fallback to hooks */ });
      }
    }

    // NOTE: OpenCode SSE watcher is disabled - hooks now provide subagent events
    // via session.created with parentID. Keeping code for potential future use
    // when OpenCode's SSE endpoint becomes more reliable.
    // const serverUrl = event.payload?.serverUrl as string | undefined;
    // if (serverUrl && event.agentType === 'opencode') {
    //   const sessionId = event.agentId;
    //   if (!openCodeSSEWatchers.has(sessionId)) {
    //     const watcher = new OpenCodeSSEWatcher(
    //       serverUrl,
    //       event.agentId,
    //       event.agentName,
    //       event.payload?.cwd as string | undefined,
    //       { onEvent: onOpenCodeSSEEvent },
    //     );
    //     openCodeSSEWatchers.set(sessionId, watcher);
    //     watcher.start().catch(() => { /* fallback to hooks */ });
    //   }
    // }

    // Clean up transcript watcher when agent terminates
    if (event.type === 'agent.terminate') {
      const watcher = transcriptWatchers.get(event.agentId);
      if (watcher) {
        watcher.destroy();
        transcriptWatchers.delete(event.agentId);
      }

      // Release any file locks held by the terminated agent
      releaseAgentLocks(event.agentId);

      // Also clean up OpenCode SSE watcher
      const sseWatcher = openCodeSSEWatchers.get(event.agentId);
      if (sseWatcher) {
        sseWatcher.destroy();
        openCodeSSEWatchers.delete(event.agentId);
      }
    }

    // Update sidebar badge with active agent count

  }

  const unsubscribeEventBus = eventBus.on(onAgentEvent);

  const ehConfig = vscode.workspace.getConfiguration('eventHorizon');
  const configuredPort = ehConfig.get<number>('port', 28765);
  setFileLockingEnabled(ehConfig.get<boolean>('fileLockingEnabled', false));

  // Re-read file locking setting when changed
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('eventHorizon.fileLockingEnabled')) {
        setFileLockingEnabled(
          vscode.workspace.getConfiguration('eventHorizon').get<boolean>('fileLockingEnabled', false),
        );
      }
    }),
  );

  startEventServer({ onEvent: (event) => eventBus.emit(event) }, configuredPort)
    .then(async () => {
      // Always regenerate lock scripts with the current session token
      await ensureLockScripts();

      // Refresh hooks if the token changed (stale from a previous session)
      const [staleClaude, staleOpenCode, staleCopilot] = await Promise.all([
        hasStaleClaudeCodeHooks(),
        hasStaleOpenCodeHooks(),
        hasStaleCopilotHooks(),
      ]);
      if (staleClaude) await setupClaudeCodeHooks();
      if (staleOpenCode) await setupOpenCodeHooks();
      if (staleCopilot) await setupCopilotHooks();

      // Nudge running agents to announce themselves by touching their config
      // files. This triggers ConfigChange hooks so each running session sends
      // its real session ID, cwd, and name to our HTTP server.
      // For OpenCode, the plugin sends heartbeat session.created events for
      // the first 2 minutes after startup, so agents will be discovered if
      // Event Horizon starts within that window.
      void nudgeRunningAgents();
    })
    .catch(() => {
      // Error already shown to user via showErrorMessage in eventServer
    });
  const copilotDisposable = setupCopilotOutputChannel((event) => eventBus.emit(event));
  context.subscriptions.push(copilotDisposable);

  // ── Skill scanner ─────────────────────────────────────────────────────────
  const workspaceFolderPaths = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
  void getInstalledSkills(workspaceFolderPaths).then((skills) => {
    cachedSkills = skills;
    // Send to webview — if it's not open yet, hydration will pick it up from cachedSkills
    webviewRef.current?.postMessage({ type: 'skills-update', skills });
  });
  const skillWatcherDisposable = createSkillWatcher((skills) => {
    cachedSkills = skills;
    webviewRef.current?.postMessage({ type: 'skills-update', skills });
  });
  context.subscriptions.push(skillWatcherDisposable);

  const rescanSkills = async () => {
    const skills = await getInstalledSkills(workspaceFolderPaths);
    cachedSkills = skills;
    return skills;
  };
  // ── Main universe panel (editor area) ──────────────────────────────────────
  const openUniverse = () => openUniversePanel(
    context, webviewRef, agentStateManager, metricsEngine, () => cachedSkills, rescanSkills,
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('eventHorizon.open', openUniverse)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('eventHorizon.setupClaudeCode', runSetupClaudeCodeHooks)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('eventHorizon.toggleView', () => {
      webviewRef.current?.postMessage({ type: 'toggle-view' });
    })
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
          void vscode.commands.executeCommand('eventHorizon.open');
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
    broadcastEvent(coopEvent);
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

      // Scale delays by number of pairs to prevent ship blizzard with many agents
      // (5 agents = 10 pairs, so we slow down proportionally)
      const pairScale = Math.max(1, pairs.length / 2);

      if (anyActive) {
        // Active burst: single ship (convoys removed — the pair cap keeps it clean)
        emitCoopShip(from, to);
        // Next check in (2–5s) × pairScale
        cooperationTimer = setTimeout(scheduleCoopShip, (2_000 + Math.random() * 3_000) * pairScale);
      } else {
        // Idle heartbeat: single ship, next check in (15–25s) × pairScale
        emitCoopShip(from, to);
        cooperationTimer = setTimeout(scheduleCoopShip, (15_000 + Math.random() * 10_000) * pairScale);
      }
    }, 1_000); // initial 1s tick to be responsive
  }
  scheduleCoopShip();

  context.subscriptions.push({
    dispose: () => {
      if (cooperationTimer) clearTimeout(cooperationTimer);
      if (statusBarBlinkTimer) clearInterval(statusBarBlinkTimer);
      unsubscribeEventBus();
      stopEventServer();
      // Clean up all transcript watchers
      for (const w of transcriptWatchers.values()) w.destroy();
      transcriptWatchers.clear();
      // Clean up all OpenCode SSE watchers
      for (const w of openCodeSSEWatchers.values()) w.destroy();
      openCodeSSEWatchers.clear();
      webviewRef.current = null;
    },
  });
}

export function deactivate(): void {
  stopEventServer();
  webviewRef.current = null;
}
