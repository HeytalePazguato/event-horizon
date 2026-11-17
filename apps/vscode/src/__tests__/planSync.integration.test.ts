/**
 * End-to-end plan-file sync + token-cost test.
 *
 * Wires the real PlanBoardManager, PlanFileWatcher (fake, manually triggered
 * WatchFactory), PlanWriteBack (real fs, short timers), PlanEditAuthority,
 * LockManager and McpServer together the same way extension.ts does.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { AgentStateManager } from '@event-horizon/core';
import { McpServer, FileActivityTracker } from '../mcpServer.js';
import { LockManager } from '../lockManager.js';
import { PlanBoardManager } from '../planBoard.js';
import { MessageQueue } from '../messageQueue.js';
import { RoleManager } from '../roleManager.js';
import { AgentProfiler } from '../agentProfiler.js';
import { SharedKnowledgeStore } from '../sharedKnowledge.js';
import { PlanFileWatcher, type WatchHandle } from '../planFileWatcher.js';
import { PlanWriteBack } from '../planWriteBack.js';
import { PlanEditAuthority } from '../planEditAuthority.js';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const ORCH = 'orchestrator';
const W1 = 'worker-1';
const W2 = 'worker-2';
const REL = 'docs/plan.md';

/** 10 phases x 10 tasks. Tasks x.5..x.10 depend on the previous task; x.1..x.4 are free. */
function generatePlan(): string {
  const lines: string[] = ['# Big Sync Plan', '', '<!-- strategy: manual -->', ''];
  for (let p = 1; p <= 10; p++) {
    lines.push(`### Phase ${p} — Area ${p}`);
    for (let n = 1; n <= 10; n++) {
      const id = `${p}.${n}`;
      lines.push(`- [ ] ${id} Implement component ${id} of area ${p} [role: implementer]`);
      if (n >= 5) lines.push(`  - depends: ${p}.${n - 1}`);
      lines.push(`  - **Files**: \`src/area${p}/component${n}.ts\` (create), \`src/area${p}/__tests__/component${n}.test.ts\` (create)`);
      lines.push(`  - **Do**: Build component ${id} with input validation, error handling and structured logging; wire it into the area ${p} index and keep the public surface minimal.`);
      lines.push(`  - **Accept**: Component ${id} exports a typed factory, rejects invalid input, and has unit tests covering the happy path and two failure modes.`);
      lines.push(`  - **Verify**: \`cd packages/area${p} && pnpm vitest run src/__tests__/component${n}.test.ts\``);
      lines.push('  <!-- complexity: medium -->');
      lines.push('  <!-- model: sonnet -->');
    }
    lines.push('');
  }
  return lines.join('\n');
}

describe('plan file sync: end to end + token cost', () => {
  const ws = vscode.workspace as unknown as { workspaceFolders: Array<{ uri: { fsPath: string } }> };
  const prevFolders = ws.workspaceFolders;

  let tmp: string;
  let planPath: string;
  let pbm: PlanBoardManager;
  let server: McpServer;
  let mq: MessageQueue;
  let authority: PlanEditAuthority;
  let watcher: PlanFileWatcher;
  let writeBack: PlanWriteBack;
  let fireChange: (() => void) | null;
  let writes: number;
  let contentCalls: number;
  let cancelling: string[];

  async function t(name: string, args: Record<string, unknown>): Promise<Json> {
    const res = await server.handleRequest({ jsonrpc: '2.0', method: 'tools/call', params: { name, arguments: args }, id: 1 });
    if (res.error) return { __error: res.error.message };
    return JSON.parse((res.result as { content: Array<{ text: string }> }).content[0].text) as Json;
  }

  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  async function waitFor(cond: () => boolean, ms = 2000): Promise<void> {
    const start = Date.now();
    while (!cond()) {
      if (Date.now() - start > ms) throw new Error('waitFor timed out');
      await sleep(5);
    }
  }
  /** Fire the fake fs change and wait for the watcher debounce + read to settle. */
  async function fireAndSettle(): Promise<void> {
    fireChange!();
    await sleep(60);
  }

  beforeEach(async () => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'eh-sync-int-')));
    fs.mkdirSync(path.join(tmp, 'docs'));
    planPath = path.join(tmp, 'docs', 'plan.md');
    fs.writeFileSync(planPath, generatePlan());
    ws.workspaceFolders = [{ uri: { fsPath: tmp } }];

    writes = 0;
    contentCalls = 0;
    cancelling = [];
    fireChange = null;

    pbm = new PlanBoardManager();
    mq = new MessageQueue();
    authority = new PlanEditAuthority();
    const lockManager = new LockManager(100);
    authority = new PlanEditAuthority((p) => lockManager.normalizePath(p));
    lockManager.setOwnershipRule(authority.ownershipRuleFor(() => pbm.getAllPlans()));

    const sendFromEH = (to: string, text: string): void => { mq.send('event-horizon', 'Event Horizon', to, text); };

    watcher = new PlanFileWatcher({
      factory: (): WatchHandle => ({
        onDidChange: (cb) => { fireChange = cb; },
        onDidCreate: () => {},
        onDidDelete: () => {},
        dispose: () => {},
      }),
      readFile: (p) => fsp.readFile(p, 'utf8'),
      getSelfWriteHash: (id) => pbm.getPlan(id)?.lastSelfWriteHash ?? null,
      onContent: (id, markdown) => {
        contentCalls++;
        const board = pbm.getPlan(id);
        if (!board) return;
        const editor = authority.lastWriter(board.sourceFile);
        const result = pbm.applyFileChange(id, markdown, editor);
        if (!result.applied && result.reason === 'not-orchestrator' && board.orchestratorAgentId) {
          sendFromEH(board.orchestratorAgentId, `Plan file sync rejected: edit by non-orchestrator ${editor}`);
        }
      },
      onMissing: (id) => pbm.markSourceMissing(id, true),
      debounceMs: 10,
    });
    writeBack = new PlanWriteBack({
      readFile: (p) => fsp.readFile(p, 'utf8'),
      writeFile: async (p, s) => { writes++; await fsp.writeFile(p, s, 'utf8'); },
      isLockedByOther: (p) => lockManager.query(p, '__eh_writeback__').allowed === false,
      setSelfWriteHash: (id, hash) => pbm.setSelfWriteHash(id, hash),
      coalesceMs: 20,
      retryMs: 20,
    });

    pbm.onChange((_b, changedPlanId) => {
      if (!changedPlanId) return;
      const board = pbm.getPlan(changedPlanId);
      const sync = pbm.getSourceFileSync(changedPlanId);
      if (board && sync && !board.sourceMissing && sync.sourceFile && sync.sourceFile !== 'inline') {
        writeBack.schedule(changedPlanId, sync.sourceFile, sync.taskStatuses);
      }
    });
    pbm.onTaskCancelling((task, planId) => {
      cancelling.push(task.id);
      if (!task.assignee) return;
      const planName = pbm.getPlan(planId)?.name ?? planId;
      sendFromEH(task.assignee,
        `Task ${task.id} in plan ${planName} was cancelled by the orchestrator (${task.cancelReason ?? 'no reason given'}). ` +
        `Stop work, then call eh_update_task(task_id: ${task.id}, status: 'aborted').`);
    });

    server = new McpServer({
      lockManager, agentStateManager: new AgentStateManager(), fileActivityTracker: new FileActivityTracker(),
      planBoardManager: pbm, messageQueue: mq, roleManager: new RoleManager(), agentProfiler: new AgentProfiler(),
      sharedKnowledge: new SharedKnowledgeStore(),
      onPlanLoaded: (id, abs) => { if (abs && abs !== 'inline') watcher.watch(id, abs); },
      onPlanClosed: (id) => watcher.unwatch(id),
    });
  });

  afterEach(() => {
    watcher.disposeAll();
    writeBack.dispose();
    ws.workspaceFolders = prevFolders;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('syncs edits, preserves claims, handles cancellation and self-writes, and cuts token cost', async () => {
    // ── Load by path ────────────────────────────────────────────────────────
    const markdown = fs.readFileSync(planPath, 'utf8');
    const loadArgs = { agent_id: ORCH, file_path: REL };
    const loaded = await t('eh_load_plan', loadArgs);
    expect(loaded.loaded).toBe(true);
    expect(loaded.watching).toBe(true);
    expect(loaded.taskCount).toBe(100);
    expect(fireChange).not.toBeNull();
    const planId = loaded.plan_id as string;

    // ── Claims + notes with two workers ─────────────────────────────────────
    const claims: Array<[string, string]> = [[W1, '1.1'], [W1, '2.1'], [W2, '3.1'], [W2, '4.1']];
    for (const [agent, task] of claims) {
      expect((await t('eh_claim_task', { agent_id: agent, task_id: task, plan_id: planId })).claimed).toBe(true);
      const up = await t('eh_update_task', { agent_id: agent, task_id: task, plan_id: planId, status: 'in_progress', note: `working on ${task}` });
      expect(up.updated).toEqual([task]);
    }

    // ── Token cost: full (pre-change shape) vs compact ──────────────────────
    const before = pbm.getPlan(planId)!;
    const revBefore = before.revision;
    const oldFull = JSON.stringify({
      loaded: true,
      plan_id: before.id,
      name: before.name,
      status: before.status,
      sourceFile: before.sourceFile,
      tasks: before.tasks.map((x) => ({
        id: x.id, title: x.title, description: x.description, status: x.status,
        assignee: x.assignee, assigneeName: x.assigneeName, claimedAt: x.claimedAt, completedAt: x.completedAt,
        blockedBy: x.blockedBy, role: x.role, notes: x.notes, retryCount: x.retryCount, maxRetries: x.maxRetries,
        failedReason: x.failedReason, acceptanceCriteria: x.acceptanceCriteria, verifyCommand: x.verifyCommand,
        complexity: x.complexity, modelTier: x.modelTier, verificationStatus: x.verificationStatus,
      })),
    }).length;
    const compactRes = await t('eh_get_plan', { agent_id: W1, plan_id: planId });
    expect(compactRes.tasks).toHaveLength(100);
    const compactLen = JSON.stringify(compactRes).length;

    // ── Orchestrator edits the file on disk ─────────────────────────────────
    let edited = markdown;
    for (const id of ['5.2', '6.2', '7.2']) {
      edited = edited.replace(`- [ ] ${id} Implement component ${id} of area`, `- [ ] ${id} RENAMED component ${id} of area`);
    }
    // Delete claimed task 4.1's block (its line + indented body, up to the next task)
    const lines = edited.split('\n');
    const start = lines.findIndex((l) => l.startsWith('- [ ] 4.1 '));
    let end = start + 1;
    while (end < lines.length && !/^- \[[ xX]\]/.test(lines[end]) && !/^#{1,3}\s/.test(lines[end])) end++;
    lines.splice(start, end - start);
    edited = lines.join('\n').replace(/\n*$/, '\n');
    for (let n = 1; n <= 5; n++) edited += `- [ ] 11.${n} Added task ${n} [role: implementer]\n`;
    expect(edited).not.toContain('4.1 Implement');

    fs.writeFileSync(planPath, edited);
    authority.recordWrite(ORCH, planPath);
    await fireAndSettle();
    expect(contentCalls).toBe(1);

    const after = pbm.getPlan(planId)!;
    const byId = (id: string) => after.tasks.find((x) => x.id === id);
    // claims + notes preserved
    expect(byId('1.1')).toMatchObject({ status: 'in_progress', assignee: W1 });
    expect(byId('2.1')).toMatchObject({ status: 'in_progress', assignee: W1 });
    expect(byId('3.1')).toMatchObject({ status: 'in_progress', assignee: W2 });
    expect(byId('1.1')!.notes.map((n) => n.text)).toContain('working on 1.1');
    expect(byId('3.1')!.notes.map((n) => n.text)).toContain('working on 3.1');
    // 5 added, 3 titles updated
    for (let n = 1; n <= 5; n++) expect(byId(`11.${n}`)).toBeDefined();
    expect(after.tasks).toHaveLength(105); // 100 + 5 added; 4.1 is kept while cancelling
    for (const id of ['5.2', '6.2', '7.2']) expect(byId(id)!.title).toContain('RENAMED');
    // deleted claimed task is cancelling, assignee notified
    expect(byId('4.1')!.status).toBe('cancelling');
    expect(cancelling).toEqual(['4.1']);
    const w2msgs = mq.getUnread(W2).messages;
    expect(w2msgs.some((m) => m.message.includes('4.1') && m.message.includes('aborted'))).toBe(true);

    // ── Delta since the pre-edit revision ───────────────────────────────────
    const deltaRes = await t('eh_get_plan', { agent_id: W1, plan_id: planId, since_revision: revBefore });
    expect(deltaRes.tasks.map((x: Json) => x.id).sort()).toEqual(
      ['11.1', '11.2', '11.3', '11.4', '11.5', '4.1', '5.2', '6.2', '7.2'].sort(),
    );
    const deltaLen = JSON.stringify(deltaRes).length;
    expect((await t('eh_get_plan', { agent_id: W1, plan_id: planId, since_revision: after.revision })).unchanged).toBe(true);

    // ── Assignee confirms the abort: task removed ───────────────────────────
    const abort = await t('eh_update_task', { agent_id: W2, task_id: '4.1', plan_id: planId, status: 'aborted' });
    expect(abort.updated).toEqual(['4.1']);
    expect(pbm.getPlan(planId)!.tasks.find((x) => x.id === '4.1')).toBeUndefined();

    // Let any write-back triggered by the merge/abort settle, then reset counters
    await sleep(80);
    const writesBeforeDone = writes;
    const contentBeforeDone = contentCalls;

    // ── Done writes [x] to disk exactly once; no re-merge ───────────────────
    const done = await t('eh_update_task', { agent_id: W1, task_id: '1.1', plan_id: planId, status: 'done', note: 'finished' });
    expect(done.updated).toEqual(['1.1']);
    await waitFor(() => writes > writesBeforeDone);
    await sleep(40);
    expect(writes).toBe(writesBeforeDone + 1);
    const disk = fs.readFileSync(planPath, 'utf8');
    expect(disk).toMatch(/^- \[x\] 1\.1 /m);
    expect(disk).toMatch(/^- \[ \] 2\.1 /m);

    const revBeforeSelf = pbm.getPlan(planId)!.revision;
    await fireAndSettle(); // watcher sees our own write
    expect(contentCalls).toBe(contentBeforeDone); // filtered by self-write hash
    expect(pbm.getPlan(planId)!.revision).toBe(revBeforeSelf);
    expect(writes).toBe(writesBeforeDone + 1);

    // ── Non-orchestrator edit is rejected ───────────────────────────────────
    const revBeforeBad = pbm.getPlan(planId)!.revision;
    fs.writeFileSync(planPath, fs.readFileSync(planPath, 'utf8') + '- [ ] 12.1 Sneaky task from a worker\n');
    authority.recordWrite(W1, planPath);
    await fireAndSettle();
    expect(contentCalls).toBe(contentBeforeDone + 1);
    expect(pbm.getPlan(planId)!.tasks.find((x) => x.id === '12.1')).toBeUndefined();
    expect(pbm.getPlan(planId)!.revision).toBe(revBeforeBad);
    expect(mq.getUnread(ORCH).messages.some((m) => m.message.includes('rejected'))).toBe(true);

    // ── Request size: path vs inline content ────────────────────────────────
    const pathReq = JSON.stringify({ name: 'eh_load_plan', arguments: loadArgs }).length;
    const inlineReq = JSON.stringify({ name: 'eh_load_plan', arguments: { agent_id: ORCH, content: markdown } }).length;

    console.log(
      `[plan-sync token cost] old full eh_get_plan=${oldFull} chars, compact eh_get_plan=${compactLen} chars ` +
      `(${((compactLen / oldFull) * 100).toFixed(1)}%), since_revision delta=${deltaLen} chars ` +
      `(${((deltaLen / oldFull) * 100).toFixed(1)}%), eh_load_plan request by path=${pathReq} chars vs inline=${inlineReq} chars ` +
      `(${((pathReq / inlineReq) * 100).toFixed(2)}%)`,
    );

    expect(compactLen).toBeLessThanOrEqual(oldFull * 0.35);
    expect(deltaLen).toBeLessThanOrEqual(oldFull * 0.10);
    expect(pathReq).toBeLessThanOrEqual(inlineReq * 0.02);
  });
});
