/** Extract the last folder name from a full path. */
export function folderName(cwd: string): string {
  let normalized = cwd.replace(/\\/g, '/');
  while (normalized.endsWith('/')) normalized = normalized.slice(0, -1);
  return normalized.split('/').pop() || cwd;
}

/** Agent entry for grouping. */
export interface AgentForGroup {
  id: string;
  name: string;
  agentType: string;
  cwd?: string;
}

/** A group of agents sharing a workspace. */
export interface AgentGroup {
  /** Workspace folder name (or "Solo" for ungrouped agents). */
  workspace: string;
  agents: Array<AgentForGroup & { state: string }>;
}

/**
 * Group agents by workspace folder name. Agents without cwd go into "Solo".
 * Groups and agents within each group are sorted alphabetically.
 */
export function groupAgentsByWorkspace(
  agents: AgentForGroup[],
  agentStates: Record<string, string>,
): AgentGroup[] {
  const groups = new Map<string, Array<AgentForGroup & { state: string }>>();

  for (const a of agents) {
    const ws = a.cwd ? folderName(a.cwd) : 'Solo';
    if (!groups.has(ws)) groups.set(ws, []);
    groups.get(ws)!.push({ ...a, state: agentStates[a.id] ?? 'idle' });
  }

  // Sort agents within each group
  for (const arr of groups.values()) {
    arr.sort((a, b) => a.name.localeCompare(b.name));
  }

  // Build sorted array — "Solo" always at the end
  const result: AgentGroup[] = [];
  const sorted = [...groups.entries()].sort(([a], [b]) => {
    if (a === 'Solo') return 1;
    if (b === 'Solo') return -1;
    return a.localeCompare(b);
  });
  for (const [workspace, groupAgents] of sorted) {
    result.push({ workspace, agents: groupAgents });
  }
  return result;
}
