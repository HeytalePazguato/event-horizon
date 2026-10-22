/**
 * Utility function tests.
 */

import { describe, it, expect } from 'vitest';
import { groupAgentsByWorkspace, folderName } from '../utils.js';
import { formatCost } from '../utils/formatters.js';

describe('formatCost', () => {
  it('renders negative values (no data) as an em dash', () => {
    expect(formatCost(-1)).toBe('—');
  });

  it('renders zero as $0.00', () => {
    expect(formatCost(0)).toBe('$0.00');
  });

  it('renders measured values with a $ prefix and no tilde', () => {
    expect(formatCost(4.1)).toBe('$4.10');
    expect(formatCost(4.1, { estimated: false })).toBe('$4.10');
  });

  it('prefixes estimated values with a tilde', () => {
    expect(formatCost(4.1, { estimated: true })).toBe('~$4.10');
  });

  it('keeps the precision tiers for small and large values', () => {
    expect(formatCost(0.005)).toBe('$0.0050');
    expect(formatCost(25.67)).toBe('$25.7');
    expect(formatCost(25.67, { estimated: true })).toBe('~$25.7');
  });
});

describe('folderName', () => {
  it('extracts folder from unix path', () => {
    expect(folderName('/home/user/projects/event-horizon')).toBe('event-horizon');
  });

  it('extracts folder from windows path', () => {
    expect(folderName('C:\\Users\\user\\projects\\my-app')).toBe('my-app');
  });

  it('handles trailing slashes', () => {
    expect(folderName('/home/user/projects/app/')).toBe('app');
  });
});

describe('groupAgentsByWorkspace', () => {
  it('groups agents with same cwd', () => {
    const agents = [
      { id: '1', name: 'Claude', agentType: 'claude-code', cwd: '/home/user/event-horizon' },
      { id: '2', name: 'OpenCode', agentType: 'opencode', cwd: '/home/user/event-horizon' },
    ];
    const groups = groupAgentsByWorkspace(agents, { '1': 'thinking', '2': 'idle' });
    expect(groups).toHaveLength(1);
    expect(groups[0].workspace).toBe('event-horizon');
    expect(groups[0].agents).toHaveLength(2);
    expect(groups[0].agents[0].state).toBe('thinking');
  });

  it('separates agents with different cwd', () => {
    const agents = [
      { id: '1', name: 'Claude', agentType: 'claude-code', cwd: '/a/project-a' },
      { id: '2', name: 'Copilot', agentType: 'copilot', cwd: '/b/project-b' },
    ];
    const groups = groupAgentsByWorkspace(agents, {});
    expect(groups).toHaveLength(2);
    expect(groups[0].workspace).toBe('project-a');
    expect(groups[1].workspace).toBe('project-b');
  });

  it('puts agents without cwd in Solo group at the end', () => {
    const agents = [
      { id: '1', name: 'Solo Agent', agentType: 'unknown' },
      { id: '2', name: 'Claude', agentType: 'claude-code', cwd: '/app' },
    ];
    const groups = groupAgentsByWorkspace(agents, {});
    expect(groups).toHaveLength(2);
    expect(groups[0].workspace).toBe('app');
    expect(groups[1].workspace).toBe('Solo');
  });

  it('returns empty array for no agents', () => {
    expect(groupAgentsByWorkspace([], {})).toEqual([]);
  });

  it('sorts agents alphabetically within groups', () => {
    const agents = [
      { id: '1', name: 'Zephyr', agentType: 'unknown', cwd: '/app' },
      { id: '2', name: 'Alpha', agentType: 'unknown', cwd: '/app' },
    ];
    const groups = groupAgentsByWorkspace(agents, {});
    expect(groups[0].agents[0].name).toBe('Alpha');
    expect(groups[0].agents[1].name).toBe('Zephyr');
  });

  it('defaults state to idle when not in agentStates', () => {
    const agents = [{ id: '1', name: 'Agent', agentType: 'unknown', cwd: '/app' }];
    const groups = groupAgentsByWorkspace(agents, {});
    expect(groups[0].agents[0].state).toBe('idle');
  });
});
