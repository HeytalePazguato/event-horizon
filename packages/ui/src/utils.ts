/** Extract the last folder name from a full path. */
export function folderName(cwd: string): string {
  let normalized = cwd.replace(/\\/g, '/');
  while (normalized.endsWith('/')) normalized = normalized.slice(0, -1);
  return normalized.split('/').pop() || cwd;
}
