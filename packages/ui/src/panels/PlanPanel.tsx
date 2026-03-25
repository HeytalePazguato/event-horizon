/**
 * Plan Panel — Kanban-style board showing shared plan tasks.
 * Part of the Operations View (Phase K — Plan Visualization).
 * @event-horizon/ui
 */

import type { FC } from 'react';
import { useMemo } from 'react';
import { colors, fonts, sizes } from '../styles/tokens.js';

// ── Task status → visual mapping ────────────────────────────────────────────

export type PlanTaskStatus = 'pending' | 'claimed' | 'in_progress' | 'done' | 'failed' | 'blocked';

export interface PlanTaskView {
  id: string;
  title: string;
  status: PlanTaskStatus;
  assignee: string | null;
  assigneeId: string | null;
  blockedBy: string[];
  notes: Array<{ agentId: string; agentName: string; text: string; ts: number }>;
}

export interface PlanView {
  loaded: boolean;
  name?: string;
  sourceFile?: string;
  lastUpdatedAt?: number;
  tasks?: PlanTaskView[];
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
    })).filter((col) => col.tasks.length > 0); // hide empty columns
  }, [plan.tasks]);

  const totalTasks = plan.tasks!.length;
  const doneTasks = plan.tasks!.filter((t) => t.status === 'done').length;
  const progress = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  return (
    <div style={{ padding: sizes.spacing.lg, fontFamily: fonts.mono }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: sizes.spacing.md, marginBottom: sizes.spacing.lg }}>
        <div style={{ fontSize: sizes.text.xl, color: colors.text.primary, fontWeight: 600 }}>
          {plan.name}
        </div>
        <div style={{
          fontSize: sizes.text.sm,
          color: colors.text.dim,
          marginLeft: 'auto',
        }}>
          {doneTasks}/{totalTasks} tasks
        </div>
      </div>

      {/* Progress bar */}
      <div style={{
        height: 4,
        background: colors.bg.panel,
        borderRadius: sizes.radius.sm,
        marginBottom: sizes.spacing.lg,
        overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: `${progress}%`,
          background: `linear-gradient(90deg, ${colors.border.active}, #40a060)`,
          borderRadius: sizes.radius.sm,
          transition: 'width 0.3s ease',
        }} />
      </div>

      {/* Kanban board */}
      <div style={{
        display: 'flex',
        gap: sizes.spacing.md,
        overflowX: 'auto',
        minHeight: 200,
      }}>
        {columns.map((col) => (
          <div key={col.status} style={{
            flex: '1 1 180px',
            minWidth: 160,
            maxWidth: 280,
          }}>
            {/* Column header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: sizes.spacing.xs,
              padding: `${sizes.spacing.xs}px ${sizes.spacing.sm}px`,
              marginBottom: sizes.spacing.sm,
              borderBottom: `2px solid ${taskStatusColor(col.status)}`,
            }}>
              <div style={{
                width: 6,
                height: 6,
                borderRadius: 1,
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

            {/* Task cards */}
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

      {/* Status badge */}
      <div style={{
        display: 'inline-block',
        marginTop: sizes.spacing.xs,
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
