/**
 * Tool breakdown label tests.
 *
 * The bug: labels sat in a fixed 50px box with no overflow handling, so a name
 * like `mcp__event-horizon__eh_list_agents` rendered on top of the bar chart.
 * The label is now clipped, and MCP names are shortened to the part that
 * actually identifies the tool.
 */

import { describe, it, expect } from 'vitest';
import { shortenToolName } from '../panels/OverviewPanel.js';

describe('shortenToolName', () => {
  it('strips the mcp server prefix', () => {
    expect(shortenToolName('mcp__event-horizon__eh_list_agents')).toBe('eh_list_agents');
  });

  it('handles a server name containing underscores', () => {
    expect(shortenToolName('mcp__my_server__do_thing')).toBe('do_thing');
  });

  it('keeps a tool name that has underscores of its own', () => {
    expect(shortenToolName('mcp__event-horizon__eh_send_message')).toBe('eh_send_message');
  });

  it('leaves ordinary tool names untouched', () => {
    for (const name of ['Bash', 'Edit', 'Read', 'Grep', 'Write', 'ToolSearch', 'AskUserQuestion']) {
      expect(shortenToolName(name)).toBe(name);
    }
  });

  it('leaves a non-matching mcp-ish name alone rather than mangling it', () => {
    expect(shortenToolName('mcp__nodoubleunderscore')).toBe('mcp__nodoubleunderscore');
  });

  it('never returns empty for a non-empty input', () => {
    for (const name of ['mcp__a__b', 'Bash', 'x']) {
      expect(shortenToolName(name).length).toBeGreaterThan(0);
    }
  });
});
