/**
 * Watches plan markdown files on disk and reports external edits.
 * Self-writes are filtered by content hash.
 */

import { createHash } from 'node:crypto';
import * as path from 'node:path';
import * as vscode from 'vscode';

export interface WatchHandle {
  onDidChange(cb: () => void): void;
  onDidDelete(cb: () => void): void;
  onDidCreate(cb: () => void): void;
  dispose(): void;
}

export type WatchFactory = (absPath: string) => WatchHandle;

export interface PlanFileWatcherDeps {
  factory: WatchFactory;
  readFile: (p: string) => Promise<string>;
  getSelfWriteHash: (planId: string) => string | null;
  onContent: (planId: string, markdown: string) => void;
  onMissing: (planId: string) => void;
  debounceMs?: number;
}

interface Entry {
  absPath: string;
  handle: WatchHandle;
  timer: ReturnType<typeof setTimeout> | null;
  generation: number;
}

export class PlanFileWatcher {
  private readonly entries = new Map<string, Entry>();
  private readonly debounceMs: number;

  constructor(private readonly deps: PlanFileWatcherDeps) {
    this.debounceMs = deps.debounceMs ?? 300;
  }

  watch(planId: string, absPath: string): void {
    this.unwatch(planId);
    const handle = this.deps.factory(absPath);
    const entry: Entry = { absPath, handle, timer: null, generation: 0 };
    this.entries.set(planId, entry);
    const schedule = (): void => {
      if (this.entries.get(planId) !== entry) return;
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = setTimeout(() => {
        entry.timer = null;
        void this.process(planId, entry);
      }, this.debounceMs);
    };
    handle.onDidChange(schedule);
    handle.onDidCreate(schedule);
    handle.onDidDelete(() => {
      if (this.entries.get(planId) !== entry) return;
      if (entry.timer) { clearTimeout(entry.timer); entry.timer = null; }
      entry.generation++;
      this.deps.onMissing(planId);
    });
  }

  unwatch(planId: string): void {
    const entry = this.entries.get(planId);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.generation++;
    this.entries.delete(planId);
    entry.handle.dispose();
  }

  disposeAll(): void {
    for (const id of [...this.entries.keys()]) this.unwatch(id);
  }

  private async process(planId: string, entry: Entry): Promise<void> {
    const gen = ++entry.generation;
    let content: string;
    try {
      content = await this.deps.readFile(entry.absPath);
    } catch {
      if (this.entries.get(planId) === entry && entry.generation === gen) this.deps.onMissing(planId);
      return;
    }
    if (this.entries.get(planId) !== entry || entry.generation !== gen) return;
    const hash = createHash('sha256').update(content).digest('hex');
    if (hash === this.deps.getSelfWriteHash(planId)) return;
    this.deps.onContent(planId, content);
  }
}

export const vscodeWatchFactory: WatchFactory = (absPath) => {
  const pattern = new vscode.RelativePattern(path.dirname(absPath), path.basename(absPath));
  const w = vscode.workspace.createFileSystemWatcher(pattern);
  return {
    onDidChange: (cb) => { w.onDidChange(() => cb()); },
    onDidDelete: (cb) => { w.onDidDelete(() => cb()); },
    onDidCreate: (cb) => { w.onDidCreate(() => cb()); },
    dispose: () => w.dispose(),
  };
};
