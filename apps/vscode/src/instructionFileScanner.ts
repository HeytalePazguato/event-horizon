/**
 * Instruction File Scanner — discovers workspace instruction files and seeds them
 * into the SharedKnowledgeStore as tiered, auto-sourced entries.
 *
 * Picked up:
 *   - CLAUDE.md, AGENTS.md (root-level agent instructions)           → tier L1
 *   - .cursorrules                                                    → tier L1
 *   - copilot-instructions.md, .github/copilot-instructions.md       → tier L1
 *   - .claude/rules/**\/*.md (path-scoped rules)                      → tier L2
 *
 * All entries written via `writeIfNotUserAuthored`, so they never overwrite
 * user- or agent-authored knowledge with the same key.
 */

import * as vscode from 'vscode';
import type { SharedKnowledgeStore, KnowledgeTier } from './sharedKnowledge.js';

export type InstructionKind = 'claude' | 'agents' | 'cursorrules' | 'copilot' | 'rule';

export interface ScannedFile {
  /** Absolute filesystem path. */
  absPath: string;
  /** Workspace-root-relative label with forward slashes. Used as the stable entry key suffix. */
  relLabel: string;
  /** File contents (truncated to MAX_CONTENT_CHARS). */
  content: string;
  /** Assigned knowledge tier. */
  tier: KnowledgeTier;
  /** Detected file kind. */
  kind: InstructionKind;
  /** Workspace folder index the file was discovered under. */
  folderIndex: number;
}

export const INCLUDE_GLOB =
  '{**/CLAUDE.md,**/AGENTS.md,**/.cursorrules,**/copilot-instructions.md,**/.github/copilot-instructions.md,**/.claude/rules/**/*.md}';

export const EXCLUDE_GLOB =
  '{**/node_modules/**,**/dist/**,**/out/**,**/.git/**,**/build/**,**/coverage/**,**/.next/**,**/.venv/**}';

const MAX_CONTENT_CHARS = 4000;
const MAX_FILES_PER_FOLDER = 50;

/** Stable entry key for a scanned file (prefix guarantees we never collide with user/agent keys). */
export function keyForScannedFile(file: ScannedFile): string {
  return `auto:${file.relLabel}`;
}

/** Classify a file by path. */
function classify(relPath: string): { kind: InstructionKind; tier: KnowledgeTier } {
  const lower = relPath.toLowerCase().replace(/\\/g, '/');
  if (lower.includes('/.claude/rules/')) return { kind: 'rule', tier: 'L2' };
  if (lower.endsWith('.cursorrules')) return { kind: 'cursorrules', tier: 'L1' };
  if (lower.endsWith('agents.md')) return { kind: 'agents', tier: 'L1' };
  if (lower.endsWith('copilot-instructions.md')) return { kind: 'copilot', tier: 'L1' };
  return { kind: 'claude', tier: 'L1' };
}

/** Scan a single file URI into a ScannedFile (or null if empty/unreadable). */
export async function scanFileUri(uri: vscode.Uri, folderIndex: number, rootPath: string): Promise<ScannedFile | null> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const raw = new TextDecoder('utf-8').decode(bytes);
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const relLabel = relativePath(rootPath, uri.fsPath);
    const { kind, tier } = classify(relLabel);
    return {
      absPath: uri.fsPath,
      relLabel,
      content: raw.length > MAX_CONTENT_CHARS ? raw.slice(0, MAX_CONTENT_CHARS) + '\n…[truncated]' : raw,
      tier,
      kind,
      folderIndex,
    };
  } catch {
    return null;
  }
}

function relativePath(root: string, abs: string): string {
  const normRoot = root.replace(/\\/g, '/').replace(/\/+$/, '');
  const normAbs = abs.replace(/\\/g, '/');
  if (normAbs.startsWith(normRoot + '/')) return normAbs.slice(normRoot.length + 1);
  return normAbs;
}

/**
 * Scan all instruction files across the given workspace folders.
 */
export async function scanInstructionFiles(
  folders: readonly vscode.WorkspaceFolder[],
): Promise<ScannedFile[]> {
  if (folders.length === 0) return [];

  const results: ScannedFile[] = [];
  for (let i = 0; i < folders.length; i++) {
    const folder = folders[i];
    const include = new vscode.RelativePattern(folder, INCLUDE_GLOB);
    const exclude = new vscode.RelativePattern(folder, EXCLUDE_GLOB);
    const uris = await vscode.workspace.findFiles(include, exclude, MAX_FILES_PER_FOLDER);

    for (const uri of uris) {
      const file = await scanFileUri(uri, i, folder.uri.fsPath);
      if (file) results.push(file);
    }
  }

  // De-duplicate by absPath (some globs can overlap, e.g. /copilot-instructions.md vs /.github/copilot-instructions.md are distinct but defensive).
  const seen = new Set<string>();
  return results.filter((f) => {
    if (seen.has(f.absPath)) return false;
    seen.add(f.absPath);
    return true;
  });
}

/**
 * Write scanned files into the shared knowledge store. Never overwrites user- or agent-authored entries.
 * Returns the list of keys actually written (as opposed to skipped because a user/agent entry exists).
 */
export function writeEntriesToStore(
  store: SharedKnowledgeStore,
  files: readonly ScannedFile[],
): string[] {
  const writtenKeys: string[] = [];
  for (const file of files) {
    const key = keyForScannedFile(file);
    const entry = store.writeIfNotUserAuthored(
      key,
      file.content,
      'workspace',
      'Event Horizon',
      'system',
      undefined,
      undefined,
      file.tier,
    );
    if (entry && entry.source === 'auto' && entry.value === file.content) {
      writtenKeys.push(key);
    }
  }
  return writtenKeys;
}

/**
 * Remove a previously-auto-seeded entry by its scanned relLabel. Honors ownership — delete is
 * performed as the 'system' author so it never touches user or agent entries because their keys
 * won't match the 'auto:' prefix.
 */
export function deleteScannedEntry(store: SharedKnowledgeStore, relLabel: string): boolean {
  return store.delete(`auto:${relLabel}`, 'workspace', 'system');
}
