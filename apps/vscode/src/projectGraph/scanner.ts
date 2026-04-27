import * as vscode from 'vscode';
import * as fs from 'fs';
import * as crypto from 'crypto';
import * as path from 'path';
import type { GraphNode, GraphEdge, ProjectGraphStore } from './index.js';
import type { TreeSitterExtractor } from './treeSitterExtractor.js';
import { extractMarkdown } from './markdownExtractor.js';

type RationaleExtractFn = (
  filePath: string,
  source: string,
  resolveByLabel: (label: string) => GraphNode | null,
  repoRoot: string,
) => { nodes: GraphNode[]; edges: GraphEdge[]; contentHash: string };

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts',
]);
const MD_EXTENSIONS = new Set(['.md', '.mdx']);

export interface ScanSummary {
  filesProcessed: number;
  filesSkipped: number;
  nodesCreated: number;
  edgesCreated: number;
  durationMs: number;
}

export class ProjectGraphScanner {
  private store: ProjectGraphStore;
  private extractors: {
    treeSitter: TreeSitterExtractor;
    markdown?: typeof extractMarkdown;
    comment?: RationaleExtractFn;
  };
  private opts: { workspaceFolder: string; maxFiles: number; includeMarkdown: boolean };

  constructor(
    store: ProjectGraphStore,
    extractors: {
      treeSitter: TreeSitterExtractor;
      markdown?: typeof extractMarkdown;
      comment?: RationaleExtractFn;
    },
    opts: { workspaceFolder: string; maxFiles: number; includeMarkdown: boolean },
  ) {
    this.store = store;
    this.extractors = extractors;
    this.opts = opts;
  }

  async scanWorkspace(
    progress?: vscode.Progress<{ message?: string; increment?: number }>,
  ): Promise<ScanSummary> {
    const start = Date.now();
    let filesProcessed = 0;
    let filesSkipped = 0;
    let nodesCreated = 0;
    let edgesCreated = 0;

    // Walk the workspace via Node fs — more reliable than vscode.workspace.findFiles,
    // which has returned 0 results inconsistently from the MCP-server context.
    const allFiles = await walkDir(this.opts.workspaceFolder);
    const matched = allFiles.filter((p) => {
      const ext = path.extname(p).toLowerCase();
      return CODE_EXTENSIONS.has(ext) || MD_EXTENSIONS.has(ext);
    });

    const capped = matched.slice(0, this.opts.maxFiles);
    const increment = capped.length > 0 ? 100 / capped.length : 0;

    for (const filePath of capped) {
      const ext = path.extname(filePath).toLowerCase();

      if (MD_EXTENSIONS.has(ext) && !this.opts.includeMarkdown) {
        filesSkipped++;
        progress?.report({ increment });
        continue;
      }

      progress?.report({ message: path.basename(filePath), increment });

      try {
        const source = await fs.promises.readFile(filePath, 'utf8');
        const contentHash = crypto.createHash('sha256').update(source).digest('hex');

        if (this.store.getFileState(filePath)?.contentHash === contentHash) {
          filesSkipped++;
          continue;
        }

        const extracted = await this.runExtractor(filePath, ext, source);
        if (!extracted) {
          filesSkipped++;
          continue;
        }

        const { nodes, edges, extractorName } = extracted;
        const result = this.store.replaceFileNodes(filePath, extractorName, nodes, edges, contentHash);
        if (result.committed) {
          filesProcessed++;
          nodesCreated += nodes.length;
          edgesCreated += edges.length;
        } else {
          filesSkipped++;
        }
      } catch {
        filesSkipped++;
      }
    }

    return { filesProcessed, filesSkipped, nodesCreated, edgesCreated, durationMs: Date.now() - start };
  }

  async scanFile(filePath: string): Promise<{ committed: boolean; reason?: string }> {
    const ext = path.extname(filePath).toLowerCase();

    if (MD_EXTENSIONS.has(ext) && !this.opts.includeMarkdown) {
      return { committed: false, reason: 'markdown-disabled' };
    }

    let source: string;
    try {
      source = await fs.promises.readFile(filePath, 'utf8');
    } catch (err) {
      return { committed: false, reason: `read-error: ${(err as Error).message}` };
    }

    const contentHash = crypto.createHash('sha256').update(source).digest('hex');
    if (this.store.getFileState(filePath)?.contentHash === contentHash) {
      return { committed: false, reason: 'unchanged' };
    }

    const extracted = await this.runExtractor(filePath, ext, source);
    if (!extracted) {
      return { committed: false, reason: 'no-extractor' };
    }

    const { nodes, edges, extractorName } = extracted;
    const result = this.store.replaceFileNodes(filePath, extractorName, nodes, edges, contentHash);
    return { committed: result.committed, reason: result.reason };
  }

  private async runExtractor(
    filePath: string,
    ext: string,
    source: string,
  ): Promise<{ nodes: GraphNode[]; edges: GraphEdge[]; extractorName: string } | null> {
    const resolveByLabel = (label: string): GraphNode | null =>
      this.store.searchNodes(label, { limit: 1 })[0] ?? null;

    if (CODE_EXTENSIONS.has(ext)) {
      const result = await this.extractors.treeSitter.extract(filePath, source);
      if (result.skipped) return null;
      return { nodes: result.nodes, edges: result.edges, extractorName: 'tree-sitter' };
    }

    if (MD_EXTENSIONS.has(ext)) {
      if (this.extractors.markdown) {
        const result = this.extractors.markdown(filePath, source, resolveByLabel, this.opts.workspaceFolder);
        return { nodes: result.nodes, edges: result.edges, extractorName: 'markdown' };
      }
      if (this.extractors.comment) {
        const result = this.extractors.comment(filePath, source, resolveByLabel, this.opts.workspaceFolder);
        return { nodes: result.nodes, edges: result.edges, extractorName: 'comment' };
      }
    }

    return null;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'out', 'build', 'webview-dist',
  '.next', '.turbo', '.cache', 'coverage', '.vscode-test',
]);

async function walkDir(root: string): Promise<string[]> {
  const out: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.github') {
        // skip dotfiles/dotdirs except .github (workflows)
        continue;
      }
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(path.join(dir, entry.name));
      } else if (entry.isFile()) {
        out.push(path.join(dir, entry.name));
      }
    }
  }

  await walk(root);
  return out;
}
