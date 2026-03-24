/**
 * Shared store types used across slices.
 * Phase E — Store Split.
 */

export interface LogEntry {
  id: string;
  ts: string;
  agentId: string;
  agentName: string;
  type: string;
  skillName?: string;
}

export interface SkillInfo {
  name: string;
  description: string;
  scope: 'personal' | 'project' | 'plugin' | 'legacy';
  filePath: string;
  userInvocable: boolean;
  disableModelInvocation: boolean;
  allowedTools: string[];
  model: string | null;
  context: 'inline' | 'fork';
  agent: string | null;
  argumentHint: string | null;
  pluginName: string | null;
  category: string | null;
  agentTypes: Array<'claude-code' | 'opencode' | 'copilot'>;
  metadataCategory: string | null;
  tags: string[];
}

export interface MarketplaceEntry {
  name: string;
  url: string;
  type: 'browse' | 'api';
}

export interface MarketplaceSkillResult {
  name: string;
  description: string;
  author: string;
  url: string;
  source: string;
}

export interface AgentVisualConfig {
  color: string;
  sizeMult: number;
}

export type VisualAgentType = 'claude-code' | 'copilot' | 'opencode' | 'cursor' | 'unknown';
export type VisualSettings = Record<VisualAgentType, AgentVisualConfig>;

export const DEFAULT_VISUAL_SETTINGS: VisualSettings = {
  'claude-code': { color: '#88aaff', sizeMult: 1.35 },
  'copilot':     { color: '#cc88ff', sizeMult: 0.72 },
  'opencode':    { color: '#88ffaa', sizeMult: 1.0 },
  'cursor':      { color: '#44ddcc', sizeMult: 0.92 },
  'unknown':     { color: '#aaccff', sizeMult: 1.12 },
};

export const DEFAULT_MARKETPLACES: MarketplaceEntry[] = [
  { name: 'SkillHub', url: 'https://www.skillhub.club/', type: 'api' },
  { name: 'SkillsMP', url: 'https://skillsmp.com', type: 'browse' },
  { name: 'Anthropic Official', url: 'https://github.com/anthropics/skills', type: 'browse' },
  { name: 'MCP Market', url: 'https://mcpmarket.com/tools/skills', type: 'browse' },
];

export interface FileAgentActivity {
  agentId: string;
  agentName: string;
  agentType: string;
  cwd?: string;
  reads: number;
  writes: number;
  errors: number;
  lastTs: number;
}

export interface FileActivity {
  path: string;
  name: string;
  agents: Record<string, FileAgentActivity>;
  totalOps: number;
  agentCount: number;
  hasErrors: boolean;
  lastTs: number;
}

export interface ToastEntry {
  instanceId: string;
  achievementId: string;
}

export interface SingularityStats {
  planetsSwallowed: number;
  astronautsConsumed: number;
  ufosConsumed: number;
  cowsAbducted: number;
  shipsObserved: number;
  agentsSeen: number;
  eventsWitnessed: number;
  errorsWitnessed: number;
  totalTokens: number;
  totalCostUsd: number;
  firstEventAt: number;
}

export const EMPTY_SINGULARITY_STATS: SingularityStats = {
  planetsSwallowed: 0, astronautsConsumed: 0, ufosConsumed: 0, cowsAbducted: 0,
  shipsObserved: 0, agentsSeen: 0, eventsWitnessed: 0, errorsWitnessed: 0,
  totalTokens: -1, totalCostUsd: -1, firstEventAt: 0,
};

export interface TimelineEntry {
  ts: number;
  agentId: string;
  agentName: string;
  agentType: string;
  kind: 'state' | 'file' | 'tool' | 'error';
  label: string;
}

export interface CreateSkillRequest {
  name: string;
  description: string;
  scope: 'personal' | 'project';
  context: 'inline' | 'fork';
  userInvocable: boolean;
  allowedTools: string[];
}
