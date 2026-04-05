/**
 * Plan Panel — Kanban-style board showing shared plan tasks.
 * Part of the Operations View (Phase K — Plan Visualization).
 * @event-horizon/ui
 */

import type { FC } from 'react';
import { useMemo } from 'react';
import { colors, fonts, sizes } from '../styles/tokens.js';
import { useCommandCenterStore } from '../store.js';

// ── Task status → visual mapping ────────────────────────────────────────────

export type PlanTaskStatus = 'pending' | 'claimed' | 'in_progress' | 'done' | 'failed' | 'blocked';

export interface PlanTaskView {
  id: string;
  title: string;
  status: PlanTaskStatus;
  assignee: string | null;
  assigneeId: string | null;
  role?: string | null;
  blockedBy: string[];
  notes: Array<{ agentId: string; agentName: string; text: string; ts: number }>;
  retryCount?: number;
  failedReason?: string | null;
  recommendedFor?: string;
}

export interface PlanView {
  loaded: boolean;
  id?: string;
  name?: string;
  status?: 'active' | 'completed' | 'archived';
  sourceFile?: string;
  lastUpdatedAt?: number;
  tasks?: PlanTaskView[];
  strategy?: string;
  maxBudgetUsd?: number | null;
}

export interface PlanSummary {
  id: string;
  name: string;
  status: 'active' | 'completed' | 'archived';
  totalTasks: number;
  doneTasks: number;
  lastUpdatedAt: number;
}

/** Map task status to display color. */
export function taskStatusColor(status: PlanTaskStatus): string {
  switch (status) {
    case 'pending':     return colors.text.dim;
    case 'claimed':     return '#6aa0d4';       // cyan — claimed but not started
    case 'in_progress': return colors.state.thinking;  // gold — active
    case 'done':        return '#40a060';        // green
    case 'failed':      return colors.text.error;
    case 'blocked':     return '#8a6a2a';        // amber-dim
  }
}

/** Map task status to label text. */
function taskStatusLabel(status: PlanTaskStatus): string {
  switch (status) {
    case 'pending':     return 'PENDING';
    case 'claimed':     return 'CLAIMED';
    case 'in_progress': return 'IN PROGRESS';
    case 'done':        return 'DONE';
    case 'failed':      return 'FAILED';
    case 'blocked':     return 'BLOCKED';
  }
}

// Kanban columns in display order
const COLUMNS: { status: PlanTaskStatus; label: string }[] = [
  { status: 'blocked',     label: 'Blocked' },
  { status: 'pending',     label: 'Pending' },
  { status: 'claimed',     label: 'Claimed' },
  { status: 'in_progress', label: 'In Progress' },
  { status: 'done',        label: 'Done' },
  { status: 'failed',      label: 'Failed' },
];

export interface PlanPanelProps {
  plan: PlanView;
}

export const PlanPanel: FC<PlanPanelProps> = ({ plan }) => {
  if (!plan.loaded || !plan.tasks) {
    return (
      <div style={{
        padding: sizes.spacing.xl,
        color: colors.text.dim,
        fontFamily: fonts.mono,
        fontSize: sizes.text.md,
        textAlign: 'center',
        marginTop: 40,
      }}>
        <div style={{ fontSize: sizes.text.xl, marginBottom: sizes.spacing.md, color: colors.text.secondary }}>
          No Plan Loaded
        </div>
        <div style={{ maxWidth: 420, margin: '0 auto', lineHeight: 1.6 }}>
          Use the <code style={{ color: colors.text.primary, background: colors.bg.panel, padding: '1px 4px', borderRadius: 2 }}>
            eh_load_plan
          </code> MCP tool to load a plan markdown file.
          <br />
          Agents can then claim and coordinate tasks.
        </div>
      </div>
    );
  }

  // Group tasks by status
  const columns = useMemo(() => {
    const grouped = new Map<PlanTaskStatus, PlanTaskView[]>();
    for (const col of COLUMNS) grouped.set(col.status, []);
    for (const task of plan.tasks!) {
      const list = grouped.get(task.status);
      if (list) list.push(task);
      else grouped.get('pending')!.push(task); // fallback
    }
    return COLUMNS.map((col) => ({
      ...col,
      tasks: grouped.get(col.status) ?? [],
    }));
  }, [plan.tasks]);

  const showAllColumns = useCommandCenterStore((s) => s.planShowAllColumns);
  const setShowAllColumns = useCommandCenterStore((s) => s.setPlanShowAllColumns);
  const visibleColumns = showAllColumns ? columns : columns.filter((col) => col.tasks.length > 0);

  const totalTasks = plan.tasks!.length;
  const doneTasks = plan.tasks!.filter((t) => t.status === 'done').length;
  const progress = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  return (
    <div style={{ padding: sizes.spacing.lg, fontFamily: fonts.mono, display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: sizes.spacing.md, marginBottom: sizes.spacing.lg, flexShrink: 0 }}>
        <div style={{ fontSize: sizes.text.xl, color: colors.text.primary, fontWeight: 600 }}>
          {plan.name}
        </div>
        {plan.strategy && plan.strategy !== 'manual' && (
          <div style={{
            display: 'inline-block',
            padding: '2px 6px',
            fontSize: 8,
            fontWeight: 600,
            letterSpacing: '0.06em',
            color: '#6aa0d4',
            background: 'rgba(106,160,212,0.1)',
            border: '1px solid rgba(106,160,212,0.3)',
            borderRadius: sizes.radius.sm,
            textTransform: 'uppercase',
          }}>
            {plan.strategy}
          </div>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: sizes.spacing.sm }}>
          <span style={{ fontSize: sizes.text.sm, color: colors.text.dim }}>
            {doneTasks}/{totalTasks} tasks
          </span>
          <button
            type="button"
            onClick={() => setShowAllColumns(!showAllColumns)}
            style={{
              padding: '2px 7px',
              border: `1px solid ${colors.border.primary}`,
              borderRadius: sizes.radius.sm,
              background: showAllColumns ? 'rgba(30,70,45,0.3)' : 'transparent',
              color: showAllColumns ? colors.text.secondary : colors.text.dim,
              fontSize: sizes.text.xs,
              fontFamily: fonts.mono,
              cursor: 'pointer',
            }}
          >
            {showAllColumns ? 'Active Only' : 'All Columns'}
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{
        height: 4,
        background: colors.bg.panel,
        borderRadius: sizes.radius.sm,
        marginBottom: sizes.spacing.lg,
        overflow: 'hidden',
        flexShrink: 0,
      }}>
        <div style={{
          height: '100%',
          width: `${progress}%`,
          background: `linear-gradient(90deg, ${colors.border.active}, #40a060)`,
          borderRadius: sizes.radius.sm,
          transition: 'width 0.3s ease',
        }} />
      </div>

      {/* Column headers — fixed row */}
      <div style={{
        display: 'flex',
        gap: sizes.spacing.md,
        flexShrink: 0,
        marginBottom: sizes.spacing.sm,
      }}>
        {visibleColumns.map((col) => (
          <div key={col.status} style={{
            flex: '1 1 180px',
            minWidth: 160,
            maxWidth: 280,
            display: 'flex',
            alignItems: 'center',
            gap: sizes.spacing.xs,
            padding: `${sizes.spacing.xs}px ${sizes.spacing.sm}px`,
            borderBottom: `2px solid ${taskStatusColor(col.status)}`,
          }}>
            <div style={{
              width: 6, height: 6, borderRadius: 1,
              background: taskStatusColor(col.status),
              boxShadow: `0 0 4px ${taskStatusColor(col.status)}`,
              flexShrink: 0,
            }} />
            <span style={{
              fontSize: sizes.text.sm,
              color: taskStatusColor(col.status),
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}>
              {col.label}
            </span>
            <span style={{
              fontSize: sizes.text.xs,
              color: colors.text.dim,
              marginLeft: 'auto',
            }}>
              {col.tasks.length}
            </span>
          </div>
        ))}
      </div>

      {/* Task cards — scrollable area */}
      <div style={{
        display: 'flex',
        gap: sizes.spacing.md,
        overflowY: 'auto',
        overflowX: 'auto',
        flex: 1,
        minHeight: 0,
      }}>
        {visibleColumns.map((col) => (
          <div key={col.status} style={{
            flex: '1 1 180px',
            minWidth: 160,
            maxWidth: 280,
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: sizes.spacing.xs }}>
              {col.tasks.map((task) => (
                <TaskCard key={task.id} task={task} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── Role tag colors ────────────────────────────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  researcher: '#66ccff', planner: '#ffaa33', implementer: '#88ff88',
  reviewer: '#cc88ff', tester: '#ffcc00', debugger: '#ff6666',
};

// ── Task Card ───────────────────────────────────────────────────────────────

const TaskCard: FC<{ task: PlanTaskView }> = ({ task }) => {
  const statusCol = taskStatusColor(task.status);

  return (
    <div style={{
      padding: `${sizes.spacing.sm}px ${sizes.spacing.md}px`,
      background: colors.bg.secondary,
      border: `1px solid ${colors.border.primary}`,
      borderLeft: `3px solid ${statusCol}`,
      borderRadius: sizes.radius.sm,
      fontSize: sizes.text.sm,
    }}>
      {/* Task ID + title */}
      <div style={{ display: 'flex', gap: sizes.spacing.xs, marginBottom: 2 }}>
        <span style={{ color: colors.text.dim, fontSize: sizes.text.xs, flexShrink: 0 }}>
          {task.id}
        </span>
        <span style={{ color: colors.text.primary, fontSize: sizes.text.sm }}>
          {task.title}
        </span>
        {task.role && (
          <span style={{
            fontSize: 7, textTransform: 'uppercase', fontFamily: 'monospace',
            color: ROLE_COLORS[task.role] ?? '#aaccff',
            border: `1px solid ${(ROLE_COLORS[task.role] ?? '#aaccff')}66`,
            borderRadius: 2, padding: '1px 2px', marginLeft: 4,
          }}>
            {task.role}
          </span>
        )}
      </div>

      {/* Assignee */}
      {task.assignee && (
        <div style={{
          fontSize: sizes.text.xs,
          color: '#6aa0d4',
          marginTop: 2,
        }}>
          {task.assignee}
        </div>
      )}

      {/* Blocked-by deps */}
      {task.status === 'blocked' && task.blockedBy.length > 0 && (
        <div style={{
          fontSize: sizes.text.xs,
          color: '#8a6a2a',
          marginTop: 2,
        }}>
          blocked by: {task.blockedBy.join(', ')}
        </div>
      )}

      {/* Status badge + retry badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: sizes.spacing.xs }}>
        <div style={{
          display: 'inline-block',
          padding: '1px 5px',
          fontSize: 8,
          fontWeight: 600,
          letterSpacing: '0.08em',
          color: statusCol,
          border: `1px solid ${statusCol}`,
          borderRadius: 2,
          opacity: 0.8,
        }}>
          {taskStatusLabel(task.status)}
        </div>
        {(task.retryCount ?? 0) > 0 && (
          <div style={{
            display: 'inline-block',
            padding: '1px 5px',
            fontSize: 8,
            fontWeight: 600,
            letterSpacing: '0.08em',
            color: '#ff8844',
            border: '1px solid #ff8844',
            borderRadius: 2,
            opacity: 0.8,
          }}>
            RETRY x{task.retryCount}
          </div>
        )}
      </div>

      {/* Recommended-for badge */}
      {task.status === 'pending' && task.recommendedFor && (
        <div style={{
          display: 'inline-block',
          padding: '1px 5px',
          fontSize: 8,
          fontWeight: 600,
          letterSpacing: '0.06em',
          color: '#4a8a68',
          border: '1px dotted #4a8a68',
          borderRadius: 2,
          marginTop: 2,
          opacity: 0.85,
        }}>
          REC: {task.recommendedFor}
        </div>
      )}

      {/* Failed reason */}
      {task.status === 'failed' && task.failedReason && (
        <div style={{
          fontSize: sizes.text.xs,
          color: '#a04040',
          marginTop: 2,
          lineHeight: 1.3,
        }}>
          {task.failedReason}
        </div>
      )}

      {/* Notes */}
      {task.notes.length > 0 && (
        <div style={{ marginTop: sizes.spacing.xs }}>
          {task.notes.slice(-2).map((note, i) => (
            <div key={i} style={{
              fontSize: sizes.text.xs,
              color: colors.text.dim,
              borderLeft: `2px solid ${colors.border.primary}`,
              paddingLeft: sizes.spacing.xs,
              marginTop: 2,
            }}>
              <span style={{ color: colors.text.secondary }}>{note.agentName}:</span> {note.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
