/**
 * VS Code extension entry point — activation and commands.
 */

import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { EventBus, MetricsEngine, AgentStateManager } from '@event-horizon/core';
import type { AgentEvent } from '@event-horizon/core';
import { openUniversePanel } from './webviewProvider';
import { startEventServer, stopEventServer, setFileLockingEnabled, releaseAgentLocks, initMcpServer, fileActivityTracker, lockManager, planBoardManager, messageQueue, roleManager, agentProfiler, sharedKnowledge, spawnRegistry, sessionStore, heartbeatManager, budgetManager, traceStore, modelTierManager, tokenAnalyzer, setAuthToken, getAuthToken, wsBroadcast, setEventSearchEngine } from './eventServer';
import { EventSearchEngine } from './eventSearch';
import type { PlanBoard } from './planBoard';
import { setupCopilotOutputChannel } from './copilotChannel';
import { runSetupClaudeCodeHooks, setupClaudeCodeHooks, isClaudeCodeHooksInstalled, registerMcpServer, ensureLockScripts } from './setupHooks';
import { setupOpenCodeHooks, isOpenCodeHooksInstalled, registerOpenCodeMcpServer } from './setupOpenCodeHooks';
import { setupCopilotHooks, isCopilotHooksInstalled, registerCopilotMcpServer } from './setupCopilotHooks';
import { setupCursorHooks, isCursorHooksInstalled, registerCursorMcpServer } from './setupCursorHooks';
import { getInstalledSkills, createSkillWatcher } from './skillScanner';
import type { SkillInfo } from './skillScanner';
import { TranscriptWatcher } from './transcriptWatcher';
import { OpenCodeSSEWatcher } from './openCodeSSEWatcher';
import { ensureBundledSkills } from './bundledSkills';
import { EventHorizonDB } from './persistence';
import { deriveEventCategory } from '@event-horizon/core';
import { CrossAgentCorrelator } from './crossAgentCorrelator';

const webviewRef: { current: vscode.Webview | null } = { current: null };
let cachedSkills: SkillInfo[] = [];
let ehDatabase: EventHorizonDB | null = null;
const crossAgentCorrelator = new CrossAgentCorrelator();

/** Access the persistence database (if enabled). Used by webviewProvider for event replay. */
export function getDatabase(): EventHorizonDB | null {
  return ehDatabase;
}

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
  return p.split('\\').join('/').toLowerCase();
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
  let ratingPromptShown = context.globalState.get<boolean>('ratingPromptShown') ?? false;

  // Initialize MCP server with runtime dependencies
  initMcpServer({ agentStateManager, metricsEngine });

  // Restore plans from globalState (survives window reload)
  // Migration: old single-plan 'planBoard' → new multi-plan 'planBoards'
  const savedPlans = context.globalState.get<PlanBoard[]>('planBoards');
  const legacyPlan = context.globalState.get<PlanBoard>('planBoard');
  if (savedPlans && savedPlans.length > 0) {
    planBoardManager.restore(savedPlans);
  } else if (legacyPlan && legacyPlan.tasks?.length > 0) {
    // Migrate old single plan — add an id if missing
    if (!(legacyPlan as PlanBoard).id) {
      (legacyPlan as PlanBoard).id = 'legacy-plan';
      (legacyPlan as PlanBoard).status = 'active';
    }
    planBoardManager.restore([legacyPlan]);
    void context.globalState.update('planBoard', undefined); // clean up old key
  }

  // Restore roles and agent profiles from globalState
  const savedRoles = context.globalState.get<ReturnType<typeof roleManager.serialize>>('agentRoles');
  if (savedRoles) roleManager.restore(savedRoles);

  const savedProfiles = context.globalState.get<ReturnType<typeof agentProfiler.serialize>>('agentProfiles');
  if (savedProfiles) {
    // Migrate stale records: fix 'unknown' agent types and -1 costs
    for (const rec of savedProfiles) {
      if (rec.agentType === 'unknown') {
        const id = rec.agentId.toLowerCase();
        if (id.includes('claude')) rec.agentType = 'claude-code';
        else if (id.includes('opencode') || id.includes('crush')) rec.agentType = 'opencode';
        else if (id.includes('copilot')) rec.agentType = 'copilot';
        else if (id.includes('cursor')) rec.agentType = 'cursor';
      }
      if (rec.estimatedCostUsd < 0) rec.estimatedCostUsd = 0;
      if (rec.inputTokens < 0) rec.inputTokens = 0;
      if (rec.outputTokens < 0) rec.outputTokens = 0;
    }
    agentProfiler.restore(savedProfiles);
    // Persist the cleaned-up data
    void context.globalState.update('agentProfiles', agentProfiler.serialize());
  }

  // Restore model tier stats from globalState
  const savedModelTiers = context.globalState.get<ReturnType<typeof modelTierManager.serialize>>('modelTierStats');
  if (savedModelTiers) modelTierManager.restore(savedModelTiers);

  // Restore shared knowledge from globalState
  const savedKnowledge = context.globalState.get<ReturnType<typeof sharedKnowledge.serializeWorkspace>>('sharedKnowledge');
  if (savedKnowledge) sharedKnowledge.restoreWorkspace(savedKnowledge);

  // ── Initialize SQLite persistence ──
  const persistenceEnabled = vscode.workspace.getConfiguration('eventHorizon').get<boolean>('persistence.enabled', true);
  if (persistenceEnabled) {
    const dbDir = context.globalStorageUri.fsPath;
    const dbPath = path.join(dbDir, 'event-horizon.db');
    (async () => {
      try {
        await vscode.workspace.fs.createDirectory(context.globalStorageUri);
        // Try loading existing DB from disk
        let dbData: Uint8Array | undefined;
        try {
          dbData = await vscode.workspace.fs.readFile(vscode.Uri.file(dbPath));
        } catch { /* no existing DB — will create new */ }
        ehDatabase = await EventHorizonDB.create(dbData);

        // Prune old events on startup
        const retentionDays = vscode.workspace.getConfiguration('eventHorizon').get<number>('persistence.retentionDays', 30);
        const pruned = ehDatabase.pruneEvents(retentionDays * 24 * 60 * 60 * 1000);
        if (pruned > 0) {
          console.log(`[Event Horizon] Pruned ${pruned} events older than ${retentionDays} days`);
        }

        // Auto-save DB to disk every 60 seconds
        const dbSaveInterval = setInterval(() => {
          if (ehDatabase) {
            try {
              const data = ehDatabase.save();
              void vscode.workspace.fs.writeFile(vscode.Uri.file(dbPath), data);
            } catch { /* save failed — will retry next interval */ }
          }
        }, 60_000);
        context.subscriptions.push({ dispose: () => clearInterval(dbSaveInterval) });

        // Wire event search engine into MCP server now that DB is ready
        const eventSearchEngine = new EventSearchEngine(ehDatabase);
        setEventSearchEngine(eventSearchEngine);

        console.log(`[Event Horizon] Persistence initialized at ${dbPath} (${ehDatabase.getEventCount()} stored events)`);
      } catch (err) {
        console.error('[Event Horizon] Failed to initialize persistence:', err);
      }
    })();
  }

  // Auto-seed workspace knowledge from project instruction files on first activation.
  // Scans all workspace folders + immediate subdirectories for CLAUDE.md, .cursorrules, AGENTS.md, etc.
  // Only seeds entries that don't already exist — never overwrites user edits.
  void (async () => {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return;

    // Instruction file basenames to look for
    const INSTRUCTION_BASENAMES = new Set(['claude.md', 'agents.md', '.cursorrules', 'copilot-instructions.md', '.copilot-instructions.md']);
    const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', '.git', '.next', 'build', 'coverage', '__pycache__', '.venv', 'venv']);
    const MAX_DEPTH = 4;

    // Recursively scan for instruction files
    const candidatePaths: Array<{ filePath: string; label: string }> = [];

    async function scanDir(dir: string, rootPath: string, depth: number): Promise<void> {
      if (depth > MAX_DEPTH) return;
      try {
        const entries = await fsp.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isFile()) {
            if (INSTRUCTION_BASENAMES.has(entry.name.toLowerCase())) {
              const rel = path.relative(rootPath, fullPath).replace(/\\/g, '/');
              candidatePaths.push({ filePath: fullPath, label: rel });
            }
          } else if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
            // Allow dotdirs like .claude, .github but skip .git
            await scanDir(fullPath, rootPath, depth + 1);
          }
        }
      } catch { /* permission error or similar — skip */ }
    }

    for (const folder of folders) {
      await scanDir(folder.uri.fsPath, folder.uri.fsPath, 0);
    }

    // Read all found files and seed knowledge
    const foundFiles: Array<{ label: string; content: string }> = [];
    for (const { filePath, label } of candidatePaths) {
      try {
        const content = await fsp.readFile(filePath, 'utf8');
        if (content.trim()) foundFiles.push({ label, content });
      } catch { /* not found */ }
    }

    if (foundFiles.length === 0) return;

    // Extract sections from each file
    const allSections: string[] = [];
    for (const { label, content } of foundFiles) {
      const lines = content.split(/\r?\n/);
      let currentSection = '';
      let currentBody: string[] = [];
      let fileSectionCount = 0;

      for (const line of lines) {
        const heading = line.match(/^#{1,3}\s+(.+)/);
        if (heading) {
          if (currentSection && currentBody.length > 0) {
            allSections.push(`**${currentSection}** (${label}): ${currentBody.join(' ').slice(0, 250)}`);
            fileSectionCount++;
          }
          currentSection = heading[1].trim();
          currentBody = [];
        } else if (line.trim() && !line.startsWith('```') && !line.startsWith('<!--')) {
          currentBody.push(line.trim());
        }
      }
      if (currentSection && currentBody.length > 0) {
        allSections.push(`**${currentSection}** (${label}): ${currentBody.join(' ').slice(0, 250)}`);
        fileSectionCount++;
      }
      // For files without headings (like .cursorrules, copilot-instructions.md), seed the whole content
      if (fileSectionCount === 0 && content.trim()) {
        allSections.push(`**${label}**: ${content.trim().slice(0, 400)}`);
      }
    }

    if (allSections.length > 0) {
      sharedKnowledge.write(
        'project-instructions',
        `Auto-imported from ${foundFiles.length} instruction file${foundFiles.length > 1 ? 's' : ''} (${foundFiles.map((f) => f.label).join(', ')}):\n${allSections.slice(0, 20).join('\n')}`,
        'workspace',
        'Event Horizon',
        'system',
      );
    }

    // Extract commands sections from any CLAUDE.md
    for (const { label, content } of foundFiles) {
      if (!label.includes('CLAUDE')) continue;
      const commandsMatch = content.match(/## Commands\n([\s\S]*?)(?=\n## |\n$)/);
      if (commandsMatch && sharedKnowledge.read('project-commands').length === 0) {
        sharedKnowledge.write('project-commands', commandsMatch[1].trim().slice(0, 500), 'workspace', 'Event Horizon', 'system');
      }
      const archMatch = content.match(/## Architecture\n([\s\S]*?)(?=\n## |\n$)/);
      if (archMatch && sharedKnowledge.read('project-architecture').length === 0) {
        sharedKnowledge.write('project-architecture', archMatch[1].trim().slice(0, 500), 'workspace', 'Event Horizon', 'system');
      }
    }
  })();

  // Persist shared knowledge on change
  sharedKnowledge.onChange(() => {
    void context.globalState.update('sharedKnowledge', sharedKnowledge.serializeWorkspace());
    // Broadcast knowledge to webview
    const entries = sharedKnowledge.getAllEntries();
    webviewRef.current?.postMessage({ type: 'knowledge-update', workspace: entries.workspace, plan: entries.plan });
  });

  /** Serialize a PlanBoard to the webview plan-update format. */
  function planToView(board: PlanBoard) {
    return {
      loaded: true as const,
      id: board.id,
      name: board.name,
      status: board.status,
      sourceFile: board.sourceFile,
      lastUpdatedAt: board.lastUpdatedAt,
      strategy: board.strategy,
      maxBudgetUsd: board.maxBudgetUsd,
      tasks: board.tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        assignee: t.assigneeName ?? t.assignee,
        assigneeId: t.assignee,
        blockedBy: t.blockedBy,
        notes: t.notes,
        role: t.role,
        retryCount: t.retryCount ?? 0,
        failedReason: t.failedReason ?? null,
        acceptanceCriteria: t.acceptanceCriteria ?? null,
        verifyCommand: t.verifyCommand ?? null,
        complexity: t.complexity ?? null,
        modelTier: t.modelTier ?? null,
        verificationStatus: t.verificationStatus ?? null,
      })),
    };
  }

  // Track plan statuses so we can detect completion transitions
  const prevPlanStatuses = new Map<string, string>();

  // Forward plan changes to webview + persist to globalState + sync checkboxes to file
  planBoardManager.onChange((_boards, changedPlanId) => {
    // Persist all plans to globalState
    void context.globalState.update('planBoards', planBoardManager.serialize());
    void context.globalState.update('modelTierStats', modelTierManager.serialize());

    // Write back checkbox status for the changed plan
    if (changedPlanId) {
      const sync = planBoardManager.getSourceFileSync(changedPlanId);
      if (sync && sync.sourceFile !== 'inline') {
        void fsp.readFile(sync.sourceFile, 'utf8').then((content) => {
          let updated = content;
          for (const [taskId, isDone] of sync.taskStatuses) {
            const escapedId = taskId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const re = new RegExp(`^(\\s*- \\[)[ xX](\\]\\s+${escapedId}\\s)`, 'gm');
            updated = updated.replace(re, `$1${isDone ? 'x' : ' '}$2`);
          }
          if (updated !== content) return fsp.writeFile(sync.sourceFile, updated, 'utf8');
        }).catch(() => {});
      }
    }

    if (!webviewRef.current) return;
    const allPlans = planBoardManager.getAllPlans();
    webviewRef.current.postMessage({
      type: 'plans-update',
      plans: allPlans.map((p) => ({
        id: p.id, name: p.name, status: p.status,
        totalTasks: p.tasks.length,
        doneTasks: p.tasks.filter((t) => t.status === 'done').length,
        lastUpdatedAt: p.lastUpdatedAt,
      })),
      // Send the changed plan in full so the Kanban updates
      activePlan: changedPlanId ? planToView(planBoardManager.getPlan(changedPlanId)!) : undefined,
    });

    // Detect plan completion transition → send synthesis beams
    if (changedPlanId) {
      const board = planBoardManager.getPlan(changedPlanId);
      if (board) {
        const prevStatus = prevPlanStatuses.get(changedPlanId);
        if (board.status === 'completed' && prevStatus !== 'completed' && board.orchestratorAgentId) {
          const workerIds = [...new Set(board.tasks.filter(t => t.assignee && t.assignee !== board.orchestratorAgentId).map(t => t.assignee!))];
          webviewRef.current.postMessage({
            type: 'plan-completed',
            orchestratorAgentId: board.orchestratorAgentId,
            workerAgentIds: workerIds,
          });
        }
        prevPlanStatuses.set(changedPlanId, board.status);

        // Broadcast orchestrator agent IDs
        const orchIds: Record<string, boolean> = {};
        for (const p of allPlans) {
          if (p.orchestratorAgentId && p.status === 'active') {
            orchIds[p.orchestratorAgentId] = true;
          }
        }
        webviewRef.current.postMessage({ type: 'orchestrator-update', orchestratorAgentIds: orchIds });
      }
    }
  });

  // Record completed tasks for agent profiling
  planBoardManager.onTaskComplete((task, planId) => {
    if (!task.assignee) return;
    const agent = agentStateManager.getAgent(task.assignee);
    const metrics = metricsEngine.getMetrics(task.assignee);

    // Derive agent type: try state manager first, then infer from agent ID pattern
    let agentType = agent?.type ?? 'unknown';
    if (agentType === 'unknown') {
      const id = task.assignee.toLowerCase();
      if (id.includes('claude')) agentType = 'claude-code';
      else if (id.includes('opencode') || id.includes('crush')) agentType = 'opencode';
      else if (id.includes('copilot')) agentType = 'copilot';
      else if (id.includes('cursor')) agentType = 'cursor';
    }

    agentProfiler.recordTask({
      taskId: task.id,
      planId,
      agentId: task.assignee,
      agentType,
      agentName: task.assigneeName ?? task.assignee,
      role: task.role,
      claimedAt: task.claimedAt ?? Date.now(),
      completedAt: Date.now(),
      status: task.status === 'done' ? 'done' : 'failed',
      durationMs: task.claimedAt ? Date.now() - task.claimedAt : 0,
      inputTokens: metrics?.inputTokens ?? 0,
      outputTokens: metrics?.outputTokens ?? 0,
      estimatedCostUsd: metrics?.estimatedCostUsd ?? 0,
      toolCalls: metrics?.toolCalls ?? 0,
      errorCount: metrics?.errorCount ?? 0,
    });
    void context.globalState.update('agentProfiles', agentProfiler.serialize());
  });

  // Send role instructions when a task with a role is claimed
  planBoardManager.onTaskClaim((task, _planId) => {
    if (!task.role || !task.assignee) return;
    const instructions = roleManager.getInstructionsForRole(task.role);
    const skills = roleManager.getSkillsForRole(task.role);
    const role = roleManager.getRole(task.role);
    if (!instructions && skills.length === 0) return;
    const parts: string[] = [];
    if (role) parts.push(`**Role assigned: ${role.name}**`);
    if (instructions) parts.push(instructions);
    if (skills.length > 0) parts.push(`Recommended skills: ${skills.map(s => '/' + s.replace('eh-', 'eh:')).join(', ')}`);
    messageQueue.send('event-horizon', 'Event Horizon', task.assignee, parts.join('\n\n'));
  });

  // Persist role changes
  roleManager.onChange(() => {
    void context.globalState.update('agentRoles', roleManager.serialize());
    // Forward to webview
    if (webviewRef.current) {
      webviewRef.current.postMessage({
        type: 'roles-update',
        roles: roleManager.getAllRoles(),
        assignments: roleManager.getAllAssignments(),
        profiles: agentProfiler.getAllProfiles(),
      });
    }
  });

  // Restore session store from globalState
  const savedSessions = context.globalState.get<Record<string, string>>('sessionStore');
  if (savedSessions) sessionStore.restore(savedSessions);

  // Restore budget state from globalState
  const savedBudget = context.globalState.get<ReturnType<typeof budgetManager.serialize>>('budgetState');
  if (savedBudget) budgetManager.restore(savedBudget);

  // Apply budget warning threshold from settings
  const budgetThreshold = vscode.workspace.getConfiguration('eventHorizon').get<number>('budgetWarningThreshold', 0.8);
  budgetManager.setWarningThreshold(budgetThreshold);

  // Set budget limits from plan metadata when plans load
  planBoardManager.onChange((boards) => {
    for (const board of boards.values()) {
      if (board.maxBudgetUsd != null && board.maxBudgetUsd > 0) {
        budgetManager.setLimit(board.id, board.maxBudgetUsd);
      }
    }
    void context.globalState.update('budgetState', budgetManager.serialize());
  });

  // Wire showBudgetRequest callback — will be passed to MCP server via initMcpServer deps
  // The MCP server is already initialized above, so we set the callback on the deps directly
  import('./eventServer.js').then((es) => {
    const mcp = es._getMcpServer();
    if (mcp) {
      (mcp as unknown as { deps: Record<string, unknown> }).deps.showBudgetRequest = async (planId: string, currentLimit: number, requestedAmount: number, reason: string) => {
        const answer = await vscode.window.showInformationMessage(
          `Budget increase requested for plan "${planId}": $${currentLimit.toFixed(2)} -> $${requestedAmount.toFixed(2)}. Reason: ${reason}`,
          'Yes', 'No',
        );
        return answer === 'Yes';
      };
    }
  }).catch(() => { /* ignore */ });

  // ── Heartbeat checking interval ──────────────────────────────────────────
  const heartbeatCheckInterval = setInterval(() => {
    const allBeats = heartbeatManager.getAll();
    if (allBeats.length === 0) return;

    // Update agent states with heartbeat status
    for (const beat of allBeats) {
      const agent = agentStateManager.getAgent(beat.agentId);
      if (agent) {
        // Directly modify the heartbeatStatus on the agent state
        const current = agentStateManager.getAgent(beat.agentId);
        if (current && current.heartbeatStatus !== beat.status) {
          // Use a lightweight update — set on the object directly
          (current as { heartbeatStatus: string }).heartbeatStatus = beat.status;
        }
      }
    }

    // Forward heartbeat statuses to webview
    if (webviewRef.current) {
      const heartbeats: Record<string, string> = {};
      for (const beat of allBeats) {
        heartbeats[beat.agentId] = beat.status;
      }
      webviewRef.current.postMessage({ type: 'heartbeat-update', heartbeats });
    }
  }, 30_000);
  context.subscriptions.push({ dispose: () => clearInterval(heartbeatCheckInterval) });

  // ── Periodic trace broadcast (every 5s) ────────────────────────────────────
  const traceBroadcastInterval = setInterval(() => {
    if (!webviewRef.current) return;
    if (traceStore.size === 0) return;
    const spans = traceStore.getSpans(undefined, undefined, 100);
    const aggregate = traceStore.getAggregate();
    webviewRef.current.postMessage({
      type: 'traces-update',
      spans,
      aggregate,
    });
  }, 5_000);
  context.subscriptions.push({ dispose: () => clearInterval(traceBroadcastInterval) });

  // ── Status bar — live agent count ──────────────────────────────────────────
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  statusBarItem.command = 'eventHorizon.focusWaitingAgent';
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
      const waitingNames = waitingAgents.map((a) => a.name ?? a.id).join(', ');
      statusBarItem.tooltip = `Event Horizon — Waiting: ${waitingNames}\nClick to focus agent terminal`;
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

  // ── Transcript-based smart lock release ────────────────────────────────────
  // Track last locked file per agent for smart release: when an agent writes to
  // a DIFFERENT file, release the previous lock automatically.
  const lastLockedFileByAgent = new Map<string, string>();

  /** Events from transcript watcher bypass hooks — route directly to webview. */
  function onTranscriptEvent(event: AgentEvent): void {
    // Skip if hooks already emitted this type for this agent recently
    // (transcript events carry fromTranscript=true in payload)
    metricsEngine.process(event);
    agentStateManager.apply(event);
    broadcastEvent(event);
    updateStatusBar();

    // Smart lock release: agent idle (end_turn) → release all locks
    if (event.type === 'agent.idle') {
      lockManager.releaseAll(event.agentId);
      lastLockedFileByAgent.delete(event.agentId);
    }

    // Smart lock release: agent writes to a different file → release previous lock
    if (event.type === 'tool.call' && event.payload?.filePath) {
      const filePath = event.payload.filePath as string;
      const toolName = event.payload.toolName as string | undefined;
      const isWrite = toolName === 'Write' || toolName === 'WriteFile' || toolName === 'Edit' || toolName === 'MultiEdit';
      if (isWrite) {
        const lastFile = lastLockedFileByAgent.get(event.agentId);
        if (lastFile && lastFile !== filePath) {
          lockManager.release(lastFile, event.agentId);
        }
        lastLockedFileByAgent.set(event.agentId, filePath);
      }
    }
  }

  // ── Copilot subagent session tracking ──────────────────────────────────────
  // Copilot SubagentStart/SubagentStop use the subagent's session_id, not the
  // parent's. We remap subagent events to the parent so they appear as moons
  // on the parent planet instead of spawning a separate planet.
  const subagentToParent = new Map<string, string>();
  let lastRunSubagentParent: string | null = null;

  function onAgentEvent(event: AgentEvent): void {
    // Feed event to TokenAnalyzer for cost insights
    tokenAnalyzer.onEvent(event);

    // ── Persist event to SQLite (verbatim, MemPalace principle) ──
    if (ehDatabase) {
      try {
        const workspace = (event.payload?.cwd as string)
          ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const category = deriveEventCategory(event.type);
        ehDatabase.insertEvent(event, workspace, category);

        // Track agent sessions
        if (event.type === 'agent.spawn') {
          ehDatabase.upsertSession({
            agentId: event.agentId,
            agentName: event.agentName,
            agentType: event.agentType,
            sessionStart: event.timestamp,
            cwd: (event.payload?.cwd as string) ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
            totalTokensIn: 0, totalTokensOut: 0, totalCostUsd: 0, eventCount: 1,
          });
        } else if (event.type === 'agent.terminate' || event.type === 'agent.idle') {
          // Update session end + stats on terminate/idle
          const sessions = ehDatabase.getSessions();
          const session = sessions.find((s) => s.agentId === event.agentId && !s.sessionEnd);
          if (session) {
            ehDatabase.upsertSession({
              ...session,
              sessionEnd: event.type === 'agent.terminate' ? event.timestamp : undefined,
              totalTokensIn: session.totalTokensIn + ((event.payload?.inputTokens as number) ?? 0),
              totalTokensOut: session.totalTokensOut + ((event.payload?.outputTokens as number) ?? 0),
              totalCostUsd: session.totalCostUsd + ((event.payload?.costUsd as number) ?? 0),
              eventCount: session.eventCount + 1,
            });
          }
        }
      } catch { /* persistence failure should never block event processing */ }
    }

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
    wsBroadcast(event);
    updateStatusBar();

    // ── Rate extension prompt (one-time, after 2+ agents connect) ──
    if (event.type === 'agent.spawn' && !ratingPromptShown) {
      const agents = agentStateManager.getAllAgents();
      if (agents.length >= 2 && !context.globalState.get<boolean>('ratingPromptShown')) {
        ratingPromptShown = true;
        void context.globalState.update('ratingPromptShown', true);
        void vscode.window.showInformationMessage(
          'Event Horizon: You\'re running multiple agents! If the extension is useful, a rating on the Marketplace helps others find it.',
          'Rate it',
          'Maybe later'
        ).then((choice) => {
          if (choice === 'Rate it') {
            void vscode.env.openExternal(vscode.Uri.parse(
              'https://marketplace.visualstudio.com/items?itemName=HeytalePazguato.event-horizon-vscode&ssr=false#review-details'
            ));
          }
        });
      }
    }

    // ── Trace span tracking ──
    const runId = event.agentId; // session_id for correlation
    if (event.type === 'tool.call') {
      const toolName = (event.payload?.toolName as string) ?? 'unknown';
      traceStore.startSpan('tool_call', toolName, event.agentId, runId, {
        toolName,
        filePath: event.payload?.filePath,
        isSkill: event.payload?.isSkill,
      });
    } else if (event.type === 'tool.result') {
      const toolName = (event.payload?.toolName as string) ?? 'unknown';
      const spanId = traceStore.findInflight(event.agentId, 'tool_call', toolName);
      if (spanId) traceStore.endSpan(spanId, { result: 'completed' });
    } else if (event.type === 'task.start') {
      const taskName = (event.payload?.taskId as string) ?? 'task';
      traceStore.startSpan('task', taskName, event.agentId, runId, {
        isSubagent: event.payload?.isSubagent,
      });
    } else if (event.type === 'task.complete' || event.type === 'task.fail') {
      const taskName = (event.payload?.taskId as string) ?? 'task';
      const spanId = traceStore.findInflight(event.agentId, 'task', taskName);
      if (spanId) traceStore.endSpan(spanId, { status: event.type === 'task.complete' ? 'completed' : 'failed' });
    } else if (event.type === 'agent.spawn') {
      traceStore.startSpan('agent_session', event.agentName, event.agentId, runId, {
        agentType: event.agentType,
        cwd: event.payload?.cwd,
      });
    } else if (event.type === 'agent.idle' || event.type === 'agent.terminate') {
      const spanId = traceStore.findInflight(event.agentId, 'agent_session', event.agentName);
      if (spanId) traceStore.endSpan(spanId, { reason: event.type });
    }

    // ── Compaction event forwarding ──
    if (event.payload?.hookType === 'context_compaction') {
      webviewRef.current?.postMessage({
        type: 'compaction-event',
        agentId: event.agentId,
        preTokens: event.payload.preTokens,
        postTokens: event.payload.postTokens,
        timestamp: event.timestamp,
      });
    }

    // ── MCP server data forwarding (on agent spawn with mcp_servers) ──
    if (event.type === 'agent.spawn' && event.payload?.mcpServers) {
      webviewRef.current?.postMessage({
        type: 'mcp-servers-update',
        agentId: event.agentId,
        servers: event.payload.mcpServers,
      });
    }

    // Focus-on-interaction: auto-focus terminal when agent enters waiting state
    if (event.type === 'agent.waiting') {
      const focusSetting = vscode.workspace.getConfiguration('eventHorizon').get<string>('spawnTerminalFocus', 'focus-on-interaction');
      if (focusSetting === 'focus-on-interaction') {
        const terminal = spawnRegistry.findTerminalForAgent(event.agentId);
        if (terminal) {
          terminal.show(true); // preserveFocus=true to not steal keyboard focus
        }
      }
    }

    // Auto-discovery: notify newly joined agents about active plans
    if (event.type === 'agent.spawn') {
      const activePlans = planBoardManager.getAllPlans().filter((p) => p.status === 'active');
      if (activePlans.length === 1) {
        const plan = activePlans[0];
        const done = plan.tasks.filter((t) => t.status === 'done').length;
        const pending = plan.tasks.filter((t) => t.status === 'pending').length;
        messageQueue.send(
          'event-horizon', 'Event Horizon', event.agentId,
          `A shared plan "${plan.name}" is active (${done}/${plan.tasks.length} done, ${pending} pending). ` +
          'Use eh_get_plan to see tasks and eh_claim_task to claim work.',
        );
      } else if (activePlans.length > 1) {
        messageQueue.send(
          'event-horizon', 'Event Horizon', event.agentId,
          `${activePlans.length} active plans available. Use eh_list_plans to see them and eh_get_plan with a plan_id to view tasks.`,
        );
      }
    }

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

    // Feed file events to cross-agent correlator for wormhole detection
    if (event.type === 'file.read' || event.type === 'file.write') {
      crossAgentCorrelator.onEvent(event);
    }

    // Record heartbeat on any event (agent is clearly alive if sending events)
    heartbeatManager.beat(event.agentId);

    // Track cost events for budget management
    if (event.payload?.costUsd && typeof event.payload.costUsd === 'number') {
      const activePlans = planBoardManager.getAllPlans().filter((p) => p.status === 'active');
      for (const plan of activePlans) {
        const isAgentInPlan = plan.tasks.some((t) => t.assignee === event.agentId);
        if (isAgentInPlan) {
          const tokens = ((event.payload.inputTokens as number) ?? 0) + ((event.payload.outputTokens as number) ?? 0);
          budgetManager.recordCost(plan.id, event.agentId, event.payload.costUsd as number, tokens);
          void context.globalState.update('budgetState', budgetManager.serialize());

          // Check budget and warn/pause
          if (budgetManager.isExceeded(plan.id)) {
            void vscode.window.showWarningMessage(
              `Budget exceeded for plan "${plan.name}". Agent ${event.agentName} auto-paused.`,
            );
            // Forward budget-exceeded to webview
            webviewRef.current?.postMessage({
              type: 'budget-exceeded',
              planId: plan.id,
              agentId: event.agentId,
            });
          } else if (budgetManager.isWarning(plan.id)) {
            const summary = budgetManager.getRemaining(plan.id);
            void vscode.window.showWarningMessage(
              `Budget warning for plan "${plan.name}": ${Math.round(summary.percentUsed * 100)}% used ($${summary.spent.toFixed(2)} of $${summary.limit.toFixed(2)}).`,
            );
          }
        }
      }
    }

    // Parse Copilot transcript on Stop events for richer metrics (tokens, cost)
    if (event.agentType === 'copilot' && event.type === 'agent.idle') {
      const copilotTranscript = event.payload?.transcriptPath as string | undefined;
      if (copilotTranscript) {
        void fsp.readFile(copilotTranscript, 'utf8').then((raw) => {
          try {
            const data = JSON.parse(raw) as Record<string, unknown>;
            // Extract usage/cost from transcript if available
            const usage = data.usage as Record<string, number> | undefined;
            const turns = (data.turns ?? data.messages) as Array<Record<string, unknown>> | undefined;
            if (usage || turns) {
              let totalInput = usage?.input_tokens ?? 0;
              let totalOutput = usage?.output_tokens ?? 0;
              // Aggregate from turns if top-level usage is missing
              if (!usage && turns) {
                for (const turn of turns) {
                  const u = turn.usage as Record<string, number> | undefined;
                  if (u) {
                    totalInput += u.input_tokens ?? 0;
                    totalOutput += u.output_tokens ?? 0;
                  }
                }
              }
              if (totalInput > 0 || totalOutput > 0) {
                const tokenEvent: AgentEvent = {
                  id: `copilot-tokens-${Date.now()}`,
                  agentId: event.agentId,
                  agentName: event.agentName,
                  agentType: 'copilot',
                  type: 'agent.idle',
                  timestamp: Date.now(),
                  payload: { inputTokens: totalInput, outputTokens: totalOutput, fromTranscript: true },
                };
                metricsEngine.process(tokenEvent);
                broadcastEvent(tokenEvent);
              }
            }
          } catch { /* invalid JSON — skip */ }
        }).catch(() => { /* file not accessible */ });
      }
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

  // Forward cost insights to webview every 30 seconds
  // Read context window size from settings
  const contextWindowSetting = vscode.workspace.getConfiguration('eventHorizon').get<number>('contextGauge.windowSize', 200000);
  tokenAnalyzer.setContextWindowSize(contextWindowSetting);

  const costInsightsInterval = setInterval(() => {
    const insights = tokenAnalyzer.getInsights();
    const recommendations = tokenAnalyzer.getRecommendations();
    const contextLayers = tokenAnalyzer.getContextLayers();
    webviewRef.current?.postMessage({ type: 'cost-insights-update', insights, recommendations, contextLayers });

    // Log duplicate read warnings
    for (const dup of insights.duplicateReads) {
      if (dup.agents.length > 2) {
        console.log(`[Event Horizon] ${dup.agents.length} agents read ${dup.file} — consider adding to shared knowledge`);
      }
    }
  }, 30_000);
  context.subscriptions.push({ dispose: () => clearInterval(costInsightsInterval) });

  // Broadcast wormhole connections every 15 seconds (cross-agent correlation)
  const wormholeInterval = setInterval(() => {
    crossAgentCorrelator.prune();
    const activeWormholes = crossAgentCorrelator.getActiveWormholes();
    webviewRef.current?.postMessage({ type: 'wormhole-update', data: { wormholes: activeWormholes } });
  }, 15_000);
  context.subscriptions.push({ dispose: () => clearInterval(wormholeInterval) });

  const ehConfig = vscode.workspace.getConfiguration('eventHorizon');
  const configuredPort = ehConfig.get<number>('port', 28765);
  setFileLockingEnabled(ehConfig.get<boolean>('fileLockingEnabled', false));

  // Set default worktree isolation from config
  spawnRegistry.setDefaultIsolation(ehConfig.get<boolean>('worktreeIsolation', false) ? 'worktree' : 'none');

  // Re-read settings when changed
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('eventHorizon.fileLockingEnabled')) {
        setFileLockingEnabled(
          vscode.workspace.getConfiguration('eventHorizon').get<boolean>('fileLockingEnabled', false),
        );
      }
      if (e.affectsConfiguration('eventHorizon.worktreeIsolation')) {
        const enabled = vscode.workspace.getConfiguration('eventHorizon').get<boolean>('worktreeIsolation', false);
        spawnRegistry.setDefaultIsolation(enabled ? 'worktree' : 'none');
      }
      if (e.affectsConfiguration('eventHorizon.budgetWarningThreshold')) {
        budgetManager.setWarningThreshold(
          vscode.workspace.getConfiguration('eventHorizon').get<number>('budgetWarningThreshold', 0.8),
        );
      }
    }),
  );

  // Restore auth token from globalState so hooks/MCP configs stay valid across restarts
  const savedToken = context.globalState.get<string>('eventServerToken');
  if (savedToken) {
    setAuthToken(savedToken);
  }

  startEventServer({ onEvent: (event) => eventBus.emit(event) }, configuredPort)
    .then(async (actualPort) => {
      // Persist the auth token (may be restored or newly generated)
      void context.globalState.update('eventServerToken', getAuthToken());
      // If the port changed (fallback), update the port reference for hooks
      if (actualPort !== configuredPort) {
        // Update the in-memory port so hooks point to the right port
        void vscode.workspace.getConfiguration('eventHorizon').update('port', actualPort, vscode.ConfigurationTarget.Global);
      }
      // Always regenerate lock scripts with the current session token
      await ensureLockScripts();

      // Auto-update all installed hooks/plugins/MCP configs on every activation.
      // Token is now stable (persisted in globalState), so this just ensures
      // hooks stay current when the extension upgrades or new features are added.
      const [hasClaude, hasOpenCode, hasCopilot, hasCursor] = await Promise.all([
        isClaudeCodeHooksInstalled(),
        isOpenCodeHooksInstalled(),
        isCopilotHooksInstalled(),
        isCursorHooksInstalled(),
      ]);
      if (hasClaude) { await setupClaudeCodeHooks(); await registerMcpServer(); }
      if (hasOpenCode) { await setupOpenCodeHooks(); await registerOpenCodeMcpServer(); }
      if (hasCopilot) { await setupCopilotHooks(); await registerCopilotMcpServer(); }
      if (hasCursor) { await setupCursorHooks(); await registerCursorMcpServer(); }

      // ── Agent CLI auto-detection ──
      // Scan PATH for installed agent CLIs without configured hooks and offer one-click setup.
      const autoDetectEnabled = vscode.workspace.getConfiguration('eventHorizon').get<boolean>('autoDetect.enabled', true);
      if (autoDetectEnabled) {
        const { AgentDetector } = await import('./agentDetector.js');
        const detector = new AgentDetector({
          isClaudeCodeHooksInstalled,
          isOpenCodeHooksInstalled,
          isCopilotHooksInstalled,
          isCursorHooksInstalled,
          copilotExtensionInstalled: !!vscode.extensions.getExtension('GitHub.copilot'),
        });
        const unconfigured = await detector.detectUnconfigured();
        if (unconfigured.length > 0) {
          const names = unconfigured.map((a) => a.name).join(', ');
          void vscode.window.showInformationMessage(
            `Event Horizon detected ${names} ${unconfigured.length === 1 ? 'is' : 'are'} installed but ${unconfigured.length === 1 ? 'has' : 'have'} no EH hooks configured. Set up hooks to start visualizing?`,
            'Configure',
            'Dismiss',
          ).then(async (choice) => {
            if (choice !== 'Configure') return;
            const picks = await vscode.window.showQuickPick(
              unconfigured.map((a) => ({ label: a.name, picked: true, agent: a })),
              { canPickMany: true, placeHolder: 'Select agents to configure hooks for' },
            );
            if (!picks || picks.length === 0) return;
            for (const pick of picks) {
              try {
                if (pick.agent.type === 'claude-code') { await setupClaudeCodeHooks(); await registerMcpServer(); }
                else if (pick.agent.type === 'opencode') { await setupOpenCodeHooks(); await registerOpenCodeMcpServer(); }
                else if (pick.agent.type === 'cursor') { await setupCursorHooks(); await registerCursorMcpServer(); }
                else if (pick.agent.type === 'copilot') { await setupCopilotHooks(); await registerCopilotMcpServer(); }
              } catch (err) {
                void vscode.window.showWarningMessage(`Event Horizon: failed to configure ${pick.agent.name} — ${String(err)}`);
              }
            }
            void vscode.window.showInformationMessage(`Event Horizon: configured ${picks.length} agent(s).`);
          });
        }
      }

      // Write bundled skills to ~/.claude/skills/
      await ensureBundledSkills();

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
  // ── Context optimization trigger ──────────────────────────────────────────
  const contextOptThreshold = vscode.workspace.getConfiguration('eventHorizon').get<number>('contextOptimizer.threshold', 3000);
  const CONTEXT_OPT_FILES = ['CLAUDE.md', '.cursorrules', 'copilot-instructions.md', '.copilot-instructions.md', '.github/copilot-instructions.md', 'AGENTS.md'];
  let contextOptShownThisSession = false;

  // Scan all workspace folders, collect large files, show ONE notification
  void (async () => {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || contextOptShownThisSession) return;

    const largeFiles: Array<{ name: string; tokens: number; lines: number }> = [];
    for (const folder of folders) {
      for (const fname of CONTEXT_OPT_FILES) {
        try {
          const content = await fsp.readFile(path.join(folder.uri.fsPath, fname), 'utf8');
          const lines = content.split('\n').length;
          const estimatedTokens = Math.round(content.length / 4);
          if (estimatedTokens > contextOptThreshold || lines > 200) {
            largeFiles.push({ name: `${path.basename(folder.uri.fsPath)}/${fname}`, tokens: estimatedTokens, lines });
          }
        } catch { /* not found */ }
      }
    }

    if (largeFiles.length > 0) {
      contextOptShownThisSession = true;
      const totalTokens = largeFiles.reduce((s, f) => s + f.tokens, 0);
      const summary = largeFiles.length === 1
        ? `${largeFiles[0].name} is ~${largeFiles[0].tokens.toLocaleString()} tokens`
        : `${largeFiles.length} instruction files total ~${totalTokens.toLocaleString()} tokens`;
      const action = await vscode.window.showInformationMessage(
        `${summary} — every spawned agent pays this at startup. Run the Context Optimizer?`,
        'Optimize',
        'Dismiss',
      );
      if (action === 'Optimize') {
        const terminal = vscode.window.createTerminal({ name: `EH: Context Optimizer` });
        terminal.show();
        terminal.sendText(`claude -p "Please run /eh:optimize-context to analyze and optimize the instruction files in this workspace."`, true);
      }
    }
  })();

  // Watch for saves — show notification only once per session
  const contextOptWatcher = vscode.workspace.onDidSaveTextDocument(async (doc) => {
    if (contextOptShownThisSession) return;
    const fileName = path.basename(doc.uri.fsPath);
    if (!CONTEXT_OPT_FILES.includes(fileName)) return;
    try {
      const content = await fsp.readFile(doc.uri.fsPath, 'utf8');
      const estimatedTokens = Math.round(content.length / 4);
      if (estimatedTokens > contextOptThreshold || content.split('\n').length > 200) {
        contextOptShownThisSession = true;
        const action = await vscode.window.showInformationMessage(
          `${fileName} is ~${estimatedTokens.toLocaleString()} tokens — Run the Context Optimizer?`,
          'Optimize',
          'Dismiss',
        );
        if (action === 'Optimize') {
          const terminal = vscode.window.createTerminal({ name: `EH: Context Optimizer` });
          terminal.show();
          terminal.sendText(`claude -p "Please run /eh:optimize-context to analyze and optimize the instruction files in this workspace."`, true);
        }
      }
    } catch { /* ignore */ }
  });
  context.subscriptions.push(contextOptWatcher);

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

  // ── Export data command ──────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('eventHorizon.exportData', async () => {
      if (!ehDatabase) {
        void vscode.window.showWarningMessage('Event Horizon: persistence is disabled. Enable eventHorizon.persistence.enabled to use export.');
        return;
      }
      // Step 1: pick format
      const format = await vscode.window.showQuickPick(
        [
          { label: 'Events (JSON)', detail: 'All persisted events as JSON array', id: 'events-json' },
          { label: 'Events (CSV)', detail: 'Events with summary columns: id, type, agentId, agentType, timestamp, payload', id: 'events-csv' },
          { label: 'Agent Sessions (JSON)', detail: 'Session history with token usage and cost', id: 'sessions-json' },
        ] as const,
        { placeHolder: 'Choose export format' }
      );
      if (!format) return;

      // Step 2: pick date range
      const range = await vscode.window.showQuickPick(
        [
          { label: 'Last 24 hours', ms: 24 * 60 * 60 * 1000 },
          { label: 'Last 7 days', ms: 7 * 24 * 60 * 60 * 1000 },
          { label: 'Last 30 days', ms: 30 * 24 * 60 * 60 * 1000 },
          { label: 'All time', ms: 0 },
        ] as const,
        { placeHolder: 'Choose date range' }
      );
      if (!range) return;

      // Step 3: save dialog
      const ext = format.id.endsWith('csv') ? 'csv' : 'json';
      const defaultName = `event-horizon-${format.id}-${new Date().toISOString().slice(0, 10)}.${ext}`;
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(defaultName),
        filters: ext === 'csv' ? { 'CSV': ['csv'] } : { 'JSON': ['json'] },
      });
      if (!uri) return;

      // Step 4: query + serialize
      try {
        const since = range.ms > 0 ? Date.now() - range.ms : undefined;
        let content: string;
        if (format.id === 'sessions-json') {
          const sessions = ehDatabase.getSessions(since);
          content = JSON.stringify(sessions, null, 2);
        } else {
          const events = ehDatabase.queryEvents({ since, limit: 100_000 });
          if (format.id === 'events-csv') {
            // CSV: id,type,agentId,agentType,timestamp,payload
            const escape = (s: string) => `"${s.replace(/"/g, '""')}"`;
            const header = 'id,type,agentId,agentType,timestamp,payload\n';
            const rows = events.map((e) => [
              escape(e.id),
              escape(e.type),
              escape(e.agentId),
              escape(e.agentType),
              String(e.timestamp),
              escape(JSON.stringify(e.payload ?? {})),
            ].join(','));
            content = header + rows.join('\n');
          } else {
            content = JSON.stringify(events, null, 2);
          }
        }
        await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
        const choice = await vscode.window.showInformationMessage(
          `Event Horizon: exported ${format.label} to ${uri.fsPath}`,
          'Open File',
        );
        if (choice === 'Open File') {
          void vscode.commands.executeCommand('vscode.open', uri);
        }
      } catch (err) {
        void vscode.window.showErrorMessage(`Event Horizon: export failed — ${String(err)}`);
      }
    })
  );

  // ── Focus waiting agent terminal ──────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('eventHorizon.focusWaitingAgent', async () => {
      const agents = agentStateManager.getAllAgents();
      const waitingAgents = agents.filter((a) => a.state === 'waiting');

      if (waitingAgents.length === 0) {
        // No waiting agents — open Universe panel
        void vscode.commands.executeCommand('eventHorizon.open');
        return;
      }

      if (waitingAgents.length === 1) {
        const terminal = spawnRegistry.findTerminalForAgent(waitingAgents[0].id);
        if (terminal) {
          terminal.show();
        } else {
          void vscode.commands.executeCommand('eventHorizon.open');
        }
        return;
      }

      // Multiple waiting agents — show QuickPick
      const items = waitingAgents.map((a) => ({
        label: a.name ?? a.id,
        description: `${a.type} — ${a.state}`,
        agentId: a.id,
      }));
      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a waiting agent to focus',
      });
      if (picked) {
        const terminal = spawnRegistry.findTerminalForAgent(picked.agentId);
        if (terminal) {
          terminal.show();
        } else {
          void vscode.commands.executeCommand('eventHorizon.open');
        }
      }
    })
  );

  // Focus-on-interaction is handled in onAgentEvent when agent enters waiting state.


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

  // Persist session store on plan changes (tasks with session info)
  planBoardManager.onTaskComplete((_task, _planId) => {
    void context.globalState.update('sessionStore', sessionStore.serialize());
  });

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
      // Clean up spawn registry
      spawnRegistry.dispose();
      // Close persistence DB (save handled by deactivate)
      if (ehDatabase) {
        try { ehDatabase.close(); ehDatabase = null; } catch { /* best effort */ }
      }
      webviewRef.current = null;
    },
  });
}

export function deactivate(): void {
  // Close persistence DB — interval saves already persisted data to disk
  if (ehDatabase) {
    try { ehDatabase.close(); ehDatabase = null; } catch { /* best effort */ }
  }
  stopEventServer();
  webviewRef.current = null;
}
