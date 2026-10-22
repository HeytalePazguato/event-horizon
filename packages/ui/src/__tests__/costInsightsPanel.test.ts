/**
 * Cost panel tests — actionable recommendations, the In knowledge state for
 * duplicate reads, and status feedback. (That the panel never calls the host
 * directly is checked by grep in the task's verify step: this package's tests
 * have no Node APIs.)
 */

import { describe, it, expect, vi } from 'vitest';
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Recommendation } from '@event-horizon/core';
import {
  CostInsightsPanel,
  RecommendationRow,
  isInKnowledge,
  samePath,
  duplicateReadRecommendation,
  type CostInsightsData,
} from '../panels/CostInsightsPanel.js';

const FILE = 'C:/repo/src/auth.ts';

const insights: CostInsightsData = {
  cacheHitRatio: 0.5,
  cacheHitByAgent: { a1: 0.5 },
  compactionFrequency: {},
  highPressureAgents: [],
  duplicateReads: [{ file: FILE, agents: ['a1', 'a2', 'a3'], estimatedWasteTokens: 1200 }],
  anomalies: [],
  modelEfficiency: {},
};

const dupRec: Recommendation = {
  id: `dup:${FILE}`, kind: 'duplicate-read', severity: 'info',
  text: `3 agents read ${FILE}`, action: { kind: 'add-to-knowledge', filePath: FILE },
};
const anomalyRec: Recommendation = {
  id: 'anomaly:t4', kind: 'cost-anomaly', severity: 'warn',
  text: 'Task t4 cost $5.00 (8.3x average)', action: { kind: 'open-task', taskId: 't4' },
};

/** Render a hook-free component and collect every <button> in the element tree. */
function buttons(node: ReactNode): ReactElement<{ onClick?: () => void; disabled?: boolean; children?: ReactNode }>[] {
  const found: ReactElement<{ onClick?: () => void; disabled?: boolean; children?: ReactNode }>[] = [];
  const walk = (n: ReactNode): void => {
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (!isValidElement(n)) return;
    const el = n as ReactElement<{ children?: ReactNode }>;
    if (el.type === 'button') found.push(el as never);
    if (typeof el.type === 'function') { walk((el.type as (p: unknown) => ReactNode)(el.props) as ReactNode); return; }
    walk(el.props.children);
  };
  walk(node);
  return found;
}

// React 19 types a component's return as ReactNode | Promise<ReactNode>; these are synchronous.
const renderRow = (props: Parameters<typeof RecommendationRow>[0]) => RecommendationRow(props) as ReactNode;
const html = (props: Parameters<typeof CostInsightsPanel>[0]) => renderToStaticMarkup(createElement(CostInsightsPanel, props));

describe('RecommendationRow', () => {
  it('renders a button for the action and calls back once with the recommendation', () => {
    const onAction = vi.fn();
    const [button] = buttons(renderRow({ rec: anomalyRec, onAction }));
    expect(button.props.children).toBe('Open task');
    button.props.onClick!();
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith(anomalyRec);
  });

  it('labels each action kind', () => {
    const label = (action: Recommendation['action']) => buttons(renderRow({ rec: { ...dupRec, action }, onAction: () => {} }))[0]?.props.children;
    expect(label({ kind: 'add-to-knowledge', filePath: '/x' })).toBe('Add to Shared Knowledge');
    expect(label({ kind: 'focus-agent', agentId: 'a' })).toBe('Show agent');
    expect(label({ kind: 'open-file', filePath: '/x' })).toBe('Open file');
    expect(label({ kind: 'broadcast', message: 'hi' })).toBe('Tell all agents');
  });

  it('shows no button for a recommendation without an action, or without a handler', () => {
    expect(buttons(renderRow({ rec: { ...anomalyRec, action: null }, onAction: () => {} }))).toHaveLength(0);
    expect(buttons(renderRow({ rec: anomalyRec }))).toHaveLength(0);
  });

  it('replaces the button with In knowledge once the file is in shared knowledge', () => {
    const tree = renderRow({ rec: dupRec, onAction: () => {}, knowledgeKeys: new Set([FILE]) });
    expect(buttons(tree)).toHaveLength(0);
    expect(renderToStaticMarkup(tree as ReactElement)).toContain('In knowledge');
  });

  it('disables the button while the action is pending and shows the result after', () => {
    const pending = renderRow({ rec: anomalyRec, onAction: () => {}, status: { state: 'pending', message: '' } });
    expect(buttons(pending)[0].props.disabled).toBe(true);
    expect(renderToStaticMarkup(pending as ReactElement)).toContain('Working');
    const failed = renderToStaticMarkup(renderRow({ rec: anomalyRec, onAction: () => {}, status: { state: 'error', message: 'Could not read src/x.ts.' } }) as ReactElement);
    expect(failed).toContain('Could not read src/x.ts.');
  });
});

describe('CostInsightsPanel', () => {
  it('renders recommendations as actionable rows, not bare text', () => {
    const out = html({ insights, recommendations: [dupRec, anomalyRec], onRecommendationAction: () => {} });
    expect(out.match(/data-testid="recommendation"/g)).toHaveLength(2);
    expect(out).toContain('Open task');
  });

  it('keeps the duplicate-read row after the file is added and marks it', () => {
    const out = html({ insights, recommendations: [], onRecommendationAction: () => {}, knowledgeKeys: new Set([FILE]) });
    expect(out).toContain(FILE);
    expect(out).toContain('data-testid="in-knowledge-mark"');
  });

  it('matches knowledge keys written with backslashes and a different drive-letter case', () => {
    const out = html({ insights, recommendations: [], knowledgeKeys: new Set(['c:\\repo\\src\\auth.ts']) });
    expect(out).toContain('data-testid="in-knowledge-mark"');
  });
});

describe('path helpers', () => {
  it('compares Windows paths regardless of separator and drive case', () => {
    expect(samePath('C:/repo/a.ts', 'c:\\repo\\a.ts')).toBe(true);
    expect(samePath('/home/u/a.ts', '/home/u/A.ts')).toBe(false);
    expect(isInKnowledge('/x', undefined)).toBe(false);
  });

  it('builds a duplicate-read recommendation with the analyzer id format', () => {
    expect(duplicateReadRecommendation(FILE)).toMatchObject({ id: `dup:${FILE}`, action: { kind: 'add-to-knowledge', filePath: FILE } });
  });
});
