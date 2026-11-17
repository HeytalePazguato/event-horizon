import * as fsp from 'fs/promises';
import * as path from 'path';

export const MAX_PLAN_FILE_BYTES = 1_048_576;

export type PlanPathResult = { ok: true; absPath: string } | { ok: false; error: string };

const norm = (p: string): string => (process.platform === 'win32' ? p.toLowerCase() : p);

function isInside(realFolder: string, realFile: string): boolean {
  const rel = path.relative(norm(realFolder), norm(realFile));
  // Compare whole segments: a sibling entry named `..foo` is inside, `..` / `..\x` is not.
  const escapes = rel === '..' || rel.startsWith('..' + path.sep);
  return rel !== '' && !escapes && !path.isAbsolute(rel);
}

async function exists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve a user-supplied plan path to a real absolute path contained in one
 * of the workspace folders. Symlinks are resolved before the containment check.
 */
export async function resolvePlanPath(input: string, workspaceFolders: string[]): Promise<PlanPathResult> {
  if (!input || !input.trim()) return { ok: false, error: 'Plan path is empty' };
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return { ok: false, error: 'No workspace folders are open; cannot resolve plan path' };
  }
  if (path.extname(input).toLowerCase() !== '.md') {
    return { ok: false, error: 'Plan file must have a .md extension' };
  }

  let candidates: string[];
  if (path.isAbsolute(input)) {
    candidates = [path.normalize(input)];
  } else {
    candidates = workspaceFolders.map((f) => path.resolve(f, input));
  }

  let found: string | null = null;
  for (const c of candidates) {
    if (await exists(c)) { found = c; break; }
  }
  if (!found) return { ok: false, error: `Plan file not found: ${input}` };

  let realFile: string;
  try {
    realFile = await fsp.realpath(found);
  } catch {
    return { ok: false, error: `Plan file not found: ${input}` };
  }

  let contained = false;
  for (const f of workspaceFolders) {
    try {
      const realFolder = await fsp.realpath(f);
      if (isInside(realFolder, realFile)) { contained = true; break; }
    } catch { /* unreadable folder — skip */ }
  }
  if (!contained) return { ok: false, error: 'Plan path is outside the workspace folders' };

  if (path.extname(realFile).toLowerCase() !== '.md') {
    return { ok: false, error: 'Plan file must have a .md extension (symlink target is not .md)' };
  }

  let stat;
  try {
    stat = await fsp.stat(realFile);
  } catch {
    return { ok: false, error: `Plan file not found: ${input}` };
  }
  if (!stat.isFile()) return { ok: false, error: 'Plan path is not a regular file' };
  if (stat.size > MAX_PLAN_FILE_BYTES) {
    return { ok: false, error: `Plan file too large (${stat.size} bytes; max ${MAX_PLAN_FILE_BYTES})` };
  }

  return { ok: true, absPath: realFile };
}

/** Read a plan file previously validated by resolvePlanPath. */
export async function readPlanFile(absPath: string): Promise<string> {
  const stat = await fsp.stat(absPath);
  if (stat.size > MAX_PLAN_FILE_BYTES) {
    throw new Error(`Plan file too large (${stat.size} bytes; max ${MAX_PLAN_FILE_BYTES})`);
  }
  return fsp.readFile(absPath, 'utf8');
}
