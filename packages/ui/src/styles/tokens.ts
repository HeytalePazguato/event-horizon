/**
 * Design tokens — centralized color, font, and size constants.
 * Phase G — Design System.
 */

export const colors = {
  bg: {
    primary: '#06090c',
    secondary: '#0a1410',
    panel: '#0c1318',
    overlay: 'rgba(0,0,0,0.75)',
  },
  border: {
    primary: '#1a3020',
    accent: '#2a5a3c',
    active: '#25904a',
    subtle: 'rgba(30,70,45,0.35)',
  },
  text: {
    primary: '#90d898',
    secondary: '#6a9a78',
    dim: '#4a7a58',
    muted: '#3a5a48',
    error: '#c65858',
    bright: '#78b890',
  },
  agent: {
    claude: '#88aaff',
    copilot: '#cc88ff',
    opencode: '#88ffaa',
    cursor: '#44ddcc',
    unknown: '#aaccff',
  },
  state: {
    idle: '#4a8a5a',
    thinking: '#d4a84a',
    tool_use: '#6aa0d4',
    error: '#c65858',
    waiting: '#d4944a',
  },
  led: {
    on: '#30d868',
    off: '#1a3020',
  },
} as const;

export const fonts = {
  mono: 'Consolas, monospace',
  system: 'system-ui, sans-serif',
} as const;

export const sizes = {
  text: {
    xs: 9,
    sm: 11,
    md: 12,
    lg: 14,
    xl: 16,
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
  },
  radius: {
    sm: 2,
    md: 4,
    lg: 6,
  },
} as const;

/** Map agent type string to its theme color. */
export function agentColor(agentType: string): string {
  return (colors.agent as Record<string, string>)[agentType] ?? colors.agent.unknown;
}

/** Map runtime state string to its theme color. */
export function stateColor(state: string): string {
  return (colors.state as Record<string, string>)[state] ?? colors.state.idle;
}
