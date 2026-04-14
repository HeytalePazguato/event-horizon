/**
 * Plan Panel — Kanban-style board showing shared plan tasks.
 * Part of the Operations View (Phase K — Plan Visualization).
 * @event-horizon/ui
 */

import type { FC } from 'react';
import { useMemo, useState } from 'react';
import { colors, fonts, sizes } from '../styles/tokens.js';
import { useCommandCenterStore } from '../store.js';
import { DependencyPanel } from './DependencyPanel.js';

// ── Task status → visual mapping ────────────────────────────────────────────

export type PlanTaskStatus = 'pending' | 'claimed' | 'in_progress' | 'done' | 'failed' | 'blocked';

export type TaskComplexity = 'low' | 'medium' | 'high';
export type VerificationStatus = 'pending' | 'passed' | 'failed';

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
  acceptanceCriteria?: string | null;
  verifyCommand?: string | null;
  complexity?: TaskComplexity | null;
  modelTier?: string | null;
  verificationStatus?: VerificationStatus | null;
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

export interface TaskExecutionEvent {
  id: string;
  type: string;
  agentId: string;
  agentName?: string;
  timestamp: number;
  payload?: Record<string, unknown>;
}

export interface PlanPanelProps {
  plan: PlanView;
  /** Trigger an execution drill-down (Phase 4.5). Posts message to extension which queries the DB. */
  onViewExecution?: (taskId: string, agentId: string, claimTime: number, completeTime: number) => void;
  /** Events returned for the most recent drill-down request. */
  taskExecution?: { taskId: string; events: TaskExecutionEvent[] } | null;
  /** Close the execution modal. */
  onCloseExecution?: () => void;
}

type PlanViewMode = 'kanban' | 'dependencies';

export const PlanPanel: FC<PlanPanelProps> = ({ plan, onViewExecution, taskExecution, onCloseExecution }) => {
  const [viewMode, setViewMode] = useState<PlanViewMode>('kanban');

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
          {/* View mode toggle */}
          <div style={{ display: 'flex', border: `1px solid ${colors.border.primary}`, borderRadius: sizes.radius.sm, overflow: 'hidden' }}>
            <button type="button" onClick={() => setViewMode('kanban')} style={{
              padding: '2px 7px', border: 'none', fontSize: sizes.text.xs, fontFamily: fonts.mono, cursor: 'pointer',
              background: viewMode === 'kanban' ? 'rgba(30,70,45,0.3)' : 'transparent',
              color: viewMode === 'kanban' ? colors.text.secondary : colors.text.dim,
            }}>Kanban</button>
            <button type="button" onClick={() => setViewMode('dependencies')} style={{
              padding: '2px 7px', border: 'none', borderLeft: `1px solid ${colors.border.primary}`, fontSize: sizes.text.xs, fontFamily: fonts.mono, cursor: 'pointer',
              background: viewMode === 'dependencies' ? 'rgba(30,70,45,0.3)' : 'transparent',
              color: viewMode === 'dependencies' ? colors.text.secondary : colors.text.dim,
            }}>Dependencies</button>
          </div>
          {viewMode === 'kanban' && (
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
          )}
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

      {viewMode === 'kanban' ? (
        /* CSS Grid — single grid ensures headers and cards share exact same column widths */
        <div style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'auto',
          display: 'grid',
          gridTemplateColumns: `repeat(${visibleColumns.length}, minmax(160px, 1fr))`,
          gridTemplateRows: 'auto 1fr',
          gap: `0 ${sizes.spacing.md}px`,
          alignContent: 'start',
        }}>
          {/* Column headers — row 1 */}
          {visibleColumns.map((col) => (
            <div key={`h-${col.status}`} style={{
              display: 'flex',
              alignItems: 'center',
              gap: sizes.spacing.xs,
              padding: `${sizes.spacing.xs}px ${sizes.spacing.sm}px`,
              borderBottom: `2px solid ${taskStatusColor(col.status)}`,
              position: 'sticky',
              top: 0,
              zIndex: 1,
              background: colors.bg.primary,
              marginBottom: sizes.spacing.sm,
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

          {/* Task cards — row 2, one column per status */}
          {visibleColumns.map((col) => (
            <div key={`c-${col.status}`} style={{ display: 'flex', flexDirection: 'column', gap: sizes.spacing.xs, minWidth: 0 }}>
              {col.tasks.map((task) => (
                <TaskCard key={task.id} task={task} onViewExecution={onViewExecution} />
              ))}
            </div>
          ))}
        </div>
      ) : (
        /* Dependencies DAG view */
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          <DependencyPanel plan={plan} />
        </div>
      )}

      {/* Execution Replay Modal (Phase 4.5) */}
      {taskExecution && (
        <ExecutionReplayModal
          taskId={taskExecution.taskId}
          events={taskExecution.events}
          onClose={() => onCloseExecution?.()}
        />
      )}
    </div>
  );
};

// ── Execution Replay Modal ─────────────────────────────────────────────────

const ExecutionReplayModal: FC<{ taskId: string; events: TaskExecutionEvent[]; onClose: () => void }> = ({ taskId, events, onClose }) => {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.7)', zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 40,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: colors.bg.primary,
          border: `1px solid ${colors.border.active}`,
          borderRadius: sizes.radius.md,
          width: '80%', maxWidth: 900, maxHeight: '85vh',
          display: 'flex', flexDirection: 'column',
          fontFamily: fonts.mono,
        }}
      >
        {/* Header */}
        <div style={{
          padding: sizes.spacing.md,
          borderBottom: `1px solid ${colors.border.primary}`,
          display: 'flex', alignItems: 'center', gap: sizes.spacing.md,
        }}>
          <span style={{ color: colors.text.primary, fontSize: sizes.text.md, fontWeight: 600 }}>
            Execution Replay — Task {taskId}
          </span>
          <span style={{ color: colors.text.dim, fontSize: sizes.text.sm, marginLeft: 'auto' }}>
            {events.length} events
          </span>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent', border: `1px solid ${colors.border.primary}`,
              color: colors.text.dim, padding: '2px 8px', cursor: 'pointer',
              borderRadius: sizes.radius.sm, fontFamily: fonts.mono, fontSize: sizes.text.sm,
            }}
          >
            ✕ Close
          </button>
        </div>
        {/* Event list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: sizes.spacing.md }}>
          {events.length === 0 ? (
            <div style={{ color: colors.text.dim, textAlign: 'center', padding: sizes.spacing.xl }}>
              No events recorded for this task&apos;s execution window.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${colors.border.primary}`, position: 'sticky', top: 0, background: colors.bg.primary }}>
                  <th style={{ textAlign: 'left', padding: '4px 6px', color: colors.text.dim, fontSize: sizes.text.xs }}>Time</th>
                  <th style={{ textAlign: 'left', padding: '4px 6px', color: colors.text.dim, fontSize: sizes.text.xs }}>Type</th>
                  <th style={{ textAlign: 'left', padding: '4px 6px', color: colors.text.dim, fontSize: sizes.text.xs }}>Detail</th>
                </tr>
              </thead>
              <tbody>
                {events.map((evt) => {
                  const detail = formatEventDetail(evt);
                  return (
                    <tr key={evt.id} style={{ borderBottom: `1px solid ${colors.border.primary}30` }}>
                      <td style={{ padding: '3px 6px', fontSize: sizes.text.xs, color: colors.text.dim, whiteSpace: 'nowrap' }}>
                        {new Date(evt.timestamp).toLocaleTimeString()}
                      </td>
                      <td style={{ padding: '3px 6px', fontSize: sizes.text.xs, color: '#88c0ff' }}>
                        {evt.type}
                      </td>
                      <td style={{ padding: '3px 6px', fontSize: sizes.text.xs, color: colors.text.secondary }}>
                        {detail}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

function formatEventDetail(evt: TaskExecutionEvent): string {
  const p = evt.payload ?? {};
  if (evt.type === 'tool.call') return `${(p.toolName as string) ?? (p.tool as string) ?? 'unknown'} ${p.filePath ? '— ' + (p.filePath as string) : ''}`;
  if (evt.type === 'tool.result') return (p.toolName as string) ?? '';
  if (evt.type === 'file.read' || evt.type === 'file.write') return (p.filePath as string) ?? (p.file as string) ?? '';
  if (evt.type === 'task.complete' || evt.type === 'task.fail') return (p.note as string) ?? evt.type;
  return JSON.stringify(p).slice(0, 80);
}

// ── Role tag colors ────────────────────────────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  researcher: '#66ccff', planner: '#ffaa33', implementer: '#88ff88',
  reviewer: '#cc88ff', tester: '#ffcc00', debugger: '#ff6666',
};

// ── Complexity colors ──────────────────────────────────────────────────────

const COMPLEXITY_COLORS: Record<string, string> = {
  low: '#40a060',     // green
  medium: '#cc8833',  // amber
  high: '#cc4444',    // red
};

// ── Verification status icons ──────────────────────────────────────────────

function verificationIcon(status: VerificationStatus | null | undefined): { symbol: string; color: string } {
  switch (status) {
    case 'passed':  return { symbol: '\u2713', color: '#40a060' };  // checkmark
    case 'failed':  return { symbol: '\u2717', color: '#cc4444' };  // X
    case 'pending': return { symbol: '\u2014', color: colors.text.dim };  // dash
    default:        return { symbol: '', color: '' };
  }
}

// ── Task Card ───────────────────────────────────────────────────────────────

const TaskCard: FC<{ task: PlanTaskView; onViewExecution?: PlanPanelProps['onViewExecution'] }> = ({ task, onViewExecution }) => {
  const statusCol = taskStatusColor(task.status);
  const [showAcceptance, setShowAcceptance] = useState(false);
  const canDrillDown = (task.status === 'done' || task.status === 'failed') && !!onViewExecution && !!task.assigneeId;

  return (
    <div style={{
      padding: `${sizes.spacing.sm}px ${sizes.spacing.md}px`,
      background: colors.bg.secondary,
      border: `1px solid ${colors.border.primary}`,
      borderLeft: `3px solid ${statusCol}`,
      borderRadius: sizes.radius.sm,
      fontSize: sizes.text.sm,
      minWidth: 0,
      overflowWrap: 'anywhere',
      wordBreak: 'break-word',
    }}>
      {/* Task ID + title */}
      <div style={{ display: 'flex', gap: sizes.spacing.xs, marginBottom: 2, minWidth: 0, flexWrap: 'wrap' }}>
        <span style={{ color: colors.text.dim, fontSize: sizes.text.xs, wordBreak: 'break-all', minWidth: 0 }}>
          {task.id}
        </span>
        <span style={{ color: colors.text.primary, fontSize: sizes.text.sm, minWidth: 0, flex: '1 1 auto' }}>
          {task.title}
        </span>
      </div>

      {/* Role pill + complexity dot + model tier + verification status */}
      {(task.role || task.complexity || task.modelTier || task.verificationStatus) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2, flexWrap: 'wrap' }}>
          {task.role && (
            <span style={{
              display: 'inline-block',
              fontSize: 8, fontWeight: 600, textTransform: 'uppercase', fontFamily: 'monospace',
              letterSpacing: '0.06em',
              color: ROLE_COLORS[task.role] ?? '#aaccff',
              background: `${(ROLE_COLORS[task.role] ?? '#aaccff')}15`,
              border: `1px solid ${(ROLE_COLORS[task.role] ?? '#aaccff')}44`,
              borderRadius: 8, padding: '1px 6px',
            }}>
              {task.role}
            </span>
          )}
          {task.complexity && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }} title={`Complexity: ${task.complexity}`}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%',
                background: COMPLEXITY_COLORS[task.complexity] ?? colors.text.dim,
                boxShadow: `0 0 3px ${COMPLEXITY_COLORS[task.complexity] ?? colors.text.dim}`,
                display: 'inline-block',
              }} />
              <span style={{ fontSize: 7, color: COMPLEXITY_COLORS[task.complexity] ?? colors.text.dim, fontWeight: 600, textTransform: 'uppercase' }}>
                {task.complexity}
              </span>
            </span>
          )}
          {task.modelTier && (
            <span style={{
              fontSize: 7, color: colors.text.dim, fontFamily: 'monospace',
              background: `${colors.text.dim}15`,
              padding: '0 4px', borderRadius: 2,
            }}>
              {task.modelTier}
            </span>
          )}
          {task.verificationStatus && (() => {
            const v = verificationIcon(task.verificationStatus);
            return (
              <span style={{
                fontSize: 9, fontWeight: 700, color: v.color,
              }} title={`Verification: ${task.verificationStatus}`}>
                {v.symbol}
              </span>
            );
          })()}
        </div>
      )}

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

      {/* Acceptance criteria (collapsible) */}
      {task.acceptanceCriteria && (
        <div style={{ marginTop: sizes.spacing.xs }}>
          <button
            type="button"
            onClick={() => setShowAcceptance(!showAcceptance)}
            style={{
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              fontSize: sizes.text.xs, color: colors.text.dim, fontFamily: fonts.mono,
              display: 'flex', alignItems: 'center', gap: 2,
            }}
          >
            <span style={{ fontSize: 7, transform: showAcceptance ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', display: 'inline-block' }}>{'\u25B6'}</span>
            Accept
          </button>
          {showAcceptance && (
            <div style={{
              fontSize: sizes.text.xs,
              color: colors.text.secondary,
              marginTop: 2,
              paddingLeft: sizes.spacing.sm,
              borderLeft: `2px solid ${colors.border.active}`,
              lineHeight: 1.4,
            }}>
              {task.acceptanceCriteria}
            </div>
          )}
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

      {/* View Execution drill-down (Phase 4.5) — only for done/failed tasks */}
      {canDrillDown && (
        <button
          type="button"
          onClick={() => {
            // Use claim time = first note ts (earliest activity), complete time = last note ts (latest)
            const tss = task.notes.map((n) => n.ts).filter((n) => typeof n === 'number');
            const claimTime = tss.length > 0 ? Math.min(...tss) - 60_000 : Date.now() - 24 * 60 * 60 * 1000;
            const completeTime = tss.length > 0 ? Math.max(...tss) + 60_000 : Date.now();
            onViewExecution!(task.id, task.assigneeId!, claimTime, completeTime);
          }}
          style={{
            marginTop: sizes.spacing.xs,
            padding: '2px 6px',
            background: 'transparent',
            border: `1px solid ${colors.border.primary}`,
            borderRadius: sizes.radius.sm,
            color: colors.text.secondary,
            fontSize: sizes.text.xs,
            fontFamily: fonts.mono,
            cursor: 'pointer',
          }}
          title="Show all events from this task's execution window"
        >
          ▶ View Execution
        </button>
      )}
    </div>
  );
};
