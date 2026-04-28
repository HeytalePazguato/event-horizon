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
  '.php', '.py', '.cs',
]);
const MD_EXTENSIONS = new Set(['.md', '.mdx']);

/**
 * Filename patterns that mark a file as bundled / minified / auto-generated.
 * Matched against the basename (case-insensitive). These typically explode
 * the graph with thousands of useless nodes for vendor code the user didn't
 * write — `dropzone.min.js` and friends.
 */
const SKIP_FILE_PATTERNS: RegExp[] = [
  /\.min\.(js|mjs|css)$/i,
  /\.bundle\.js$/i,
  /\.bundled\.js$/i,
  /\.umd\.js$/i,
  /-min\.js$/i,
  /\.generated\.cs$/i,
  /\.designer\.cs$/i,
  /\.pyc$/i,
];

/**
 * Default file-size cap (KB). Files larger than this are skipped with a
 * `tooLarge` reason. Tunable via the `eventHorizon.projectGraph.maxFileSizeKb`
 * setting. 256 KB comfortably fits hand-written source while excluding
 * inline-bundled vendor scripts (which are typically multiple MB).
 */
const DEFAULT_MAX_FILE_SIZE_KB = 256;

/** First-line length above which a file is treated as minified output. */
const MINIFIED_FIRST_LINE_THRESHOLD = 1000;

export interface ScanSummary {
  filesProcessed: number;
  filesSkipped: number;
  nodesCreated: number;
  edgesCreated: number;
  durationMs: number;
  /** First error encountered during extraction — surfaces silent failures (e.g. WASM load). */
  firstError?: string;
  /** Files in the workspace that matched the glob; helps spot 'no files found' cases. */
  filesMatched: number;
  /** Per-cause skip counters so we can pinpoint why files weren't processed. */
  skipReasons?: {
    hashMatch: number;
    noExtractor: number;
    notCommitted: number;
    mdDisabled: number;
    error: number;
    /** Filename matched a vendor / minified / generated pattern (`*.min.js`, `*.designer.cs`, etc.). */
    minified: number;
    /** File size exceeded the `projectGraph.maxFileSizeKb` cap. */
    tooLarge: number;
  };
  /** The directory the walker actually rooted at — surfaces wrong-folder bugs. undefined when no workspace was open. */
  rootScanned?: string | undefined;
  /** Whether vscode.workspace.workspaceFolders was non-empty at scan time. */
  workspaceFoldersAvailable?: boolean;
}

export class ProjectGraphScanner {
  private storeResolver: () => ProjectGraphStore | null;
  private extractors: {
    treeSitter: TreeSitterExtractor;
    markdown?: typeof extractMarkdown;
    comment?: RationaleExtractFn;
  };
  private opts: { workspaceFolder: string; maxFiles: number; includeMarkdown: boolean };

  /**
   * @param storeOrResolver Either a concrete store (for tests) or a
   *   `() => ProjectGraphStore | null` resolver (for the extension host
   *   wired through `ProjectGraphLifecycle`). When the resolver returns
   *   `null` the scanner returns a clean ScanSummary with an explanatory
   *   `firstError` instead of crashing.
   */
  constructor(
    storeOrResolver: ProjectGraphStore | (() => ProjectGraphStore | null),
    extractors: {
      treeSitter: TreeSitterExtractor;
      markdown?: typeof extractMarkdown;
      comment?: RationaleExtractFn;
    },
    opts: { workspaceFolder: string; maxFiles: number; includeMarkdown: boolean },
  ) {
    this.storeResolver =
      typeof storeOrResolver === 'function'
        ? storeOrResolver
        : (): ProjectGraphStore | null => storeOrResolver;
    this.extractors = extractors;
    this.opts = opts;
  }

  async scanWorkspace(
    progress?: vscode.Progress<{ message?: string; increment?: number }>,
    opts?: { force?: boolean; clearFirst?: boolean },
  ): Promise<ScanSummary> {
    const start = Date.now();
    let filesProcessed = 0;
    let filesSkipped = 0;
    let nodesCreated = 0;
    let edgesCreated = 0;
    let firstError: string | undefined;
    const skipReasons = {
      hashMatch: 0,
      noExtractor: 0,
      notCommitted: 0,
      mdDisabled: 0,
      error: 0,
      minified: 0,
      tooLarge: 0,
    };

    // Resolve the workspace at scan time. If workspace.workspaceFolders is empty
    // (the dev host window has no folder open, or VS Code launched on a single
    // file), refuse to scan — falling back to process.cwd() lands on VS Code's
    // own install directory in dev hosts and bundled extension dirs in packaged
    // installs, indexing files that have nothing to do with the user's project.
    const liveFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!liveFolder) {
      return {
        filesProcessed: 0,
        filesSkipped: 0,
        nodesCreated: 0,
        edgesCreated: 0,
        durationMs: Date.now() - start,
        filesMatched: 0,
        skipReasons,
        rootScanned: undefined,
        workspaceFoldersAvailable: false,
        firstError: 'No workspace folder open. Use File → Open Folder in this window before running /eh:optimize-context.',
      } as ScanSummary;
    }
    const root = liveFolder;

    // Resolve the active per-project graph store. With the lifecycle in place
    // this is non-null whenever workspaceFolders[0] is set, but we re-check
    // here so an out-of-band lifecycle close (rare) still produces a clean
    // error instead of a TypeError.
    const store = this.storeResolver();
    if (!store) {
      return {
        filesProcessed: 0,
        filesSkipped: 0,
        nodesCreated: 0,
        edgesCreated: 0,
        durationMs: Date.now() - start,
        filesMatched: 0,
        skipReasons,
        rootScanned: root,
        workspaceFoldersAvailable: !!liveFolder,
        firstError:
          'Project graph DB not open for this workspace. Reload the window and re-run the build.',
      } as ScanSummary;
    }

    if (opts?.clearFirst) {
      // Wipe all rows so a polluted graph (e.g. wrong workspace folder) gets reset.
      store.clearAll();
    }

    // Read the size cap from VS Code config. Bounded so a typo can't disable
    // the cap entirely (0/negative → fallback to default).
    const cfgMaxKb = vscode.workspace.getConfiguration('eventHorizon').get<number>('projectGraph.maxFileSizeKb', DEFAULT_MAX_FILE_SIZE_KB);
    const maxFileSizeBytes = (cfgMaxKb && cfgMaxKb > 0 ? cfgMaxKb : DEFAULT_MAX_FILE_SIZE_KB) * 1024;

    const allFiles = await walkDir(root);
    const matched = allFiles.filter((p) => {
      const ext = path.extname(p).toLowerCase();
      const base = path.basename(p);
      // Drop files whose basename matches a vendor / minified / generated
      // pattern before the extension check even runs.
      if (SKIP_FILE_PATTERNS.some((re) => re.test(base))) return false;
      return CODE_EXTENSIONS.has(ext) || MD_EXTENSIONS.has(ext);
    });

    const capped = matched.slice(0, this.opts.maxFiles);
    const increment = capped.length > 0 ? 100 / capped.length : 0;

    for (const filePath of capped) {
      const ext = path.extname(filePath).toLowerCase();

      if (MD_EXTENSIONS.has(ext) && !this.opts.includeMarkdown) {
        filesSkipped++;
        skipReasons.mdDisabled++;
        progress?.report({ increment });
        continue;
      }

      progress?.report({ message: path.basename(filePath), increment });

      try {
        // Size cap first: stat is cheaper than readFile, and large files
        // (inline-bundled vendor scripts in the multi-MB range) are exactly
        // the ones we don't want hashing or parsing.
        const stat = await fs.promises.stat(filePath);
        if (stat.size > maxFileSizeBytes) {
          filesSkipped++;
          skipReasons.tooLarge++;
          continue;
        }

        const source = await fs.promises.readFile(filePath, 'utf8');

        // Minified-bundle heuristic: if the first non-empty line is wider
        // than MINIFIED_FIRST_LINE_THRESHOLD chars, the file is almost
        // certainly minified output that slipped past the filename and
        // size filters.
        const firstLineEnd = source.search(/\S.*$/m);
        if (firstLineEnd >= 0) {
          const newlineIdx = source.indexOf('\n', firstLineEnd);
          const firstNonEmptyLineLen = (newlineIdx === -1 ? source.length : newlineIdx) - firstLineEnd;
          if (firstNonEmptyLineLen > MINIFIED_FIRST_LINE_THRESHOLD) {
            filesSkipped++;
            skipReasons.minified++;
            continue;
          }
        }

        const contentHash = crypto.createHash('sha256').update(source).digest('hex');

        if (!opts?.force && store.getFileState(filePath)?.contentHash === contentHash) {
          filesSkipped++;
          skipReasons.hashMatch++;
          continue;
        }

        const extracted = await this.runExtractor(store, filePath, ext, source);
        if (!extracted) {
          filesSkipped++;
          skipReasons.noExtractor++;
          continue;
        }

        const { nodes, edges, extractorName } = extracted;
        const result = store.replaceFileNodes(filePath, extractorName, nodes, edges, contentHash);
        if (result.committed) {
          filesProcessed++;
          nodesCreated += nodes.length;
          edgesCreated += edges.length;
        } else {
          filesSkipped++;
          skipReasons.notCommitted++;
          if (!firstError && result.reason) firstError = `${path.basename(filePath)}: ${result.reason}`;
        }
      } catch (err) {
        filesSkipped++;
        skipReasons.error++;
        if (!firstError) firstError = `${path.basename(filePath)}: ${(err as Error).message ?? String(err)}`;
      }
    }

    return {
      filesProcessed,
      filesSkipped,
      nodesCreated,
      edgesCreated,
      durationMs: Date.now() - start,
      filesMatched: capped.length,
      firstError,
      skipReasons,
      rootScanned: root,
      workspaceFoldersAvailable: !!liveFolder,
    } as ScanSummary;
  }

  async scanFile(filePath: string): Promise<{ committed: boolean; reason?: string }> {
    const ext = path.extname(filePath).toLowerCase();

    if (MD_EXTENSIONS.has(ext) && !this.opts.includeMarkdown) {
      return { committed: false, reason: 'markdown-disabled' };
    }

    const store = this.storeResolver();
    if (!store) {
      return { committed: false, reason: 'no-workspace' };
    }

    let source: string;
    try {
      source = await fs.promises.readFile(filePath, 'utf8');
    } catch (err) {
      return { committed: false, reason: `read-error: ${(err as Error).message}` };
    }

    const contentHash = crypto.createHash('sha256').update(source).digest('hex');
    if (store.getFileState(filePath)?.contentHash === contentHash) {
      return { committed: false, reason: 'unchanged' };
    }

    const extracted = await this.runExtractor(store, filePath, ext, source);
    if (!extracted) {
      return { committed: false, reason: 'no-extractor' };
    }

    const { nodes, edges, extractorName } = extracted;
    const result = store.replaceFileNodes(filePath, extractorName, nodes, edges, contentHash);
    return { committed: result.committed, reason: result.reason };
  }

  private async runExtractor(
    store: ProjectGraphStore,
    filePath: string,
    ext: string,
    source: string,
  ): Promise<{ nodes: GraphNode[]; edges: GraphEdge[]; extractorName: string } | null> {
    const resolveByLabel = (label: string): GraphNode | null =>
      store.searchNodes(label, { limit: 1 })[0] ?? null;

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
  // JS / TS ecosystem
  'node_modules', 'dist', 'out', 'build', 'webview-dist',
  '.next', '.turbo', '.cache', 'coverage', '.vscode-test',
  // VCS
  '.git',
  // PHP / Composer
  'vendor',
  // Python
  '__pycache__', '.venv', 'venv', '.tox', '.pytest_cache', '.mypy_cache',
  // .NET / NuGet
  'bin', 'obj', 'packages',
  // Generic build / vendor
  'target',
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
