/**
 * Design tokens helper function tests.
 * Phase H — Test Coverage.
 */

import { describe, it, expect } from 'vitest';
import { agentColor, stateColor, colors } from '../styles/tokens.js';

// ── agentColor ──────────────────────────────────────────────────────────────

describe('agentColor', () => {
  it('returns correct color for claude', () => {
    expect(agentColor('claude')).toBe(colors.agent.claude);
  });

  it('returns correct color for copilot', () => {
    expect(agentColor('copilot')).toBe(colors.agent.copilot);
  });

  it('returns correct color for opencode', () => {
    expect(agentColor('opencode')).toBe(colors.agent.opencode);
  });

  it('returns correct color for cursor', () => {
    expect(agentColor('cursor')).toBe(colors.agent.cursor);
  });

  it('returns correct color for unknown', () => {
    expect(agentColor('unknown')).toBe(colors.agent.unknown);
  });

  it('returns unknown fallback for unrecognized agent type', () => {
    expect(agentColor('nonexistent-agent')).toBe(colors.agent.unknown);
  });

  it('returns unknown fallback for empty string', () => {
    expect(agentColor('')).toBe(colors.agent.unknown);
  });
});

// ── stateColor ──────────────────────────────────────────────────────────────

describe('stateColor', () => {
  it('returns correct color for idle', () => {
    expect(stateColor('idle')).toBe(colors.state.idle);
  });

  it('returns correct color for thinking', () => {
    expect(stateColor('thinking')).toBe(colors.state.thinking);
  });

  it('returns correct color for tool_use', () => {
    expect(stateColor('tool_use')).toBe(colors.state.tool_use);
  });

  it('returns correct color for error', () => {
    expect(stateColor('error')).toBe(colors.state.error);
  });

  it('returns correct color for waiting', () => {
    expect(stateColor('waiting')).toBe(colors.state.waiting);
  });

  it('returns idle fallback for unrecognized state', () => {
    expect(stateColor('nonexistent-state')).toBe(colors.state.idle);
  });

  it('returns idle fallback for empty string', () => {
    expect(stateColor('')).toBe(colors.state.idle);
  });
});
