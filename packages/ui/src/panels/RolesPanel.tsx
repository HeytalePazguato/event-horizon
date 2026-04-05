/**
 * Roles Panel — displays agent roles, assignments, and performance profiles.
 * Part of the Operations View.
 * @event-horizon/ui
 */

import { useState, type FC } from 'react';
import { createPortal } from 'react-dom';
import { colors, fonts, sizes, agentColor } from '../styles/tokens.js';
import { useCommandCenterStore } from '../store.js';

const TOOLTIP_STYLE: React.CSSProperties = {
  position: 'fixed',
  top: 8,
  right: 12,
  width: 220,
  background: 'linear-gradient(180deg, #0d1e16 0%, #070f0a 100%)',
  border: '1px solid #2a5a3c',
  boxShadow: '0 4px 16px rgba(0,0,0,0.75)',
  padding: '8px 10px',
  fontFamily: 'Consolas, monospace',
  zIndex: 9999,
  pointerEvents: 'none',
  clipPath: 'polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%)',
};

// ── Types ──────────────────────────────────────────────────────────────────

export interface RoleDefinition {
  id: string;
  name: string;
  description: string;
  skills: string[];
  instructions: string;
  builtIn: boolean;
}

export interface RoleAssignment {
  roleId: string;
  agentType: string | null;
  agentId: string | null;
}

export interface RoleStats {
  total: number;
  completed: number;
  failed: number;
  avgDurationMs: number;
  avgCostUsd: number;
  avgTokens: number;
  successRate: number;
}

export interface AgentTypeProfile {
  agentType: string;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  overallSuccessRate: number;
  avgDurationMs: number;
  avgCostUsd: number;
  byRole: Record<string, RoleStats>;
  lastUpdated: number;
}

export interface AgentSummary {
  id: string;
  name: string;
  type: string;
}

export interface RolesPanelProps {
  roles: RoleDefinition[];
  assignments: RoleAssignment[];
  profiles: AgentTypeProfile[];
  agents?: AgentSummary[];
  onAssignRole?: (roleId: string, agentType: string) => void;
  onCreateRole?: (role: { id: string; name: string; description: string; skills: string[]; instructions: string }) => void;
  onEditRole?: (role: { id: string; name: string; description: string; skills: string[]; instructions: string }) => void;
  onDeleteRole?: (roleId: string) => void;
}

// ── Role color palette ─────────────────────────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  orchestrator: '#ffd700',
  researcher: '#66ccff',
  planner: '#ffaa33',
  implementer: '#88ff88',
  reviewer: '#cc88ff',
  tester: '#ffcc00',
  debugger: '#ff6666',
};

function roleColor(roleId: string): string {
  return ROLE_COLORS[roleId] ?? '#aaccff';
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatCost(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

function rateColor(rate: number): string {
  if (rate >= 0.8) return '#40a060';
  if (rate >= 0.5) return '#d4a84a';
  return colors.text.error;
}

// ── Component ──────────────────────────────────────────────────────────────

const formInputStyle: React.CSSProperties = {
  background: '#0d1a12',
  border: '1px solid #1a3020',
  color: '#c0d0c0',
  fontSize: sizes.text.sm,
  fontFamily: 'monospace',
  padding: '4px 6px',
  borderRadius: 2,
  width: '100%',
  boxSizing: 'border-box',
};

export const RolesPanel: FC<RolesPanelProps> = ({ roles, assignments, profiles, agents = [], onCreateRole, onEditRole, onDeleteRole }) => {
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [hoveredTooltip, setHoveredTooltip] = useState<string | null>(null);
  const [formId, setFormId] = useState('');
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formSkillsList, setFormSkillsList] = useState<string[]>([]);
  const [skillSearch, setSkillSearch] = useState('');
  const [formInstructions, setFormInstructions] = useState('');

  const availableSkills = useCommandCenterStore((s) => s.skills);

  const startEditing = (role: RoleDefinition) => {
    setEditingRoleId(role.id);
    setFormId(role.id);
    setFormName(role.name);
    setFormDescription(role.description);
    setFormSkillsList([...role.skills]);
    setSkillSearch('');
    setFormInstructions(role.instructions);
    setShowCreateForm(true);
  };

  const resetForm = () => {
    setFormId(''); setFormName(''); setFormDescription('');
    setFormSkillsList([]); setSkillSearch(''); setFormInstructions('');
    setEditingRoleId(null); setShowCreateForm(false);
  };

  // Build assignment lookup: roleId → agentType
  const assignmentMap = new Map<string, string>();
  for (const a of assignments) {
    if (a.agentType) assignmentMap.set(a.roleId, a.agentType);
  }

  const selectedRole = selectedRoleId ? roles.find((r) => r.id === selectedRoleId) : null;

  return (
    <div style={{
      padding: sizes.spacing.lg,
      fontFamily: fonts.mono,
      maxWidth: '100%',
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      overflow: 'hidden',
    }}>
      {/* ── Fixed section: header + form ──────────────────────────────── */}
      <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: sizes.spacing.lg, marginBottom: sizes.spacing.lg }}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: sizes.spacing.xs,
        }}>
          <div style={{
            fontSize: sizes.text.xs,
            color: '#4a8a5a',
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}>
            Roles &amp; Profiles
          </div>
          {onCreateRole && (
            <button
              type="button"
              onClick={() => { if (showCreateForm) resetForm(); else setShowCreateForm(true); }}
              style={{
                width: 18,
                height: 18,
                border: `1px solid ${showCreateForm ? colors.border.accent : '#1a3020'}`,
                borderRadius: 2,
                background: showCreateForm ? 'rgba(30,70,45,0.3)' : 'transparent',
                color: showCreateForm ? '#90d898' : '#4a8a5a',
                fontSize: 13,
                fontFamily: 'monospace',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0,
                lineHeight: 1,
              }}
              onMouseEnter={() => setHoveredTooltip(showCreateForm ? 'Cancel' : 'Create role')}
              onMouseLeave={() => setHoveredTooltip(null)}
            >
              {showCreateForm ? '\u00d7' : '+'}
            </button>
          )}
        </div>
        <div style={{
          height: 1,
          background: `linear-gradient(90deg, ${colors.border.accent}, transparent)`,
        }} />
      </div>

      {/* ── Create Role Form ───────────────────────────────────────────── */}
      {showCreateForm && onCreateRole && (
        <div style={{
          padding: sizes.spacing.sm,
          border: `1px solid ${colors.border.primary}`,
          borderRadius: sizes.radius.sm,
          background: colors.bg.secondary,
          display: 'flex',
          flexDirection: 'column',
          gap: sizes.spacing.xs,
        }}>
          <div style={{ fontSize: sizes.text.sm, color: '#4a8a5a', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            {editingRoleId ? `Edit Role: ${editingRoleId}` : 'New Role'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <label style={{ fontSize: sizes.text.xs, color: '#667766', fontFamily: 'monospace', minWidth: 70, textAlign: 'right', flexShrink: 0 }}>ID</label>
            <input
              type="text"
              placeholder="e.g. architect"
              value={formId}
              onChange={(e) => setFormId(e.target.value)}
              disabled={!!editingRoleId}
              style={{ ...formInputStyle, opacity: editingRoleId ? 0.5 : 1 }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <label style={{ fontSize: sizes.text.xs, color: '#667766', fontFamily: 'monospace', minWidth: 70, textAlign: 'right', flexShrink: 0 }}>Name</label>
            <input
              type="text"
              placeholder="e.g. Architect"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              style={formInputStyle}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
            <label style={{ fontSize: sizes.text.xs, color: '#667766', fontFamily: 'monospace', minWidth: 70, textAlign: 'right', flexShrink: 0, paddingTop: 4 }}>Description</label>
            <textarea
              placeholder="What this role specializes in"
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
              rows={2}
              style={{ ...formInputStyle, resize: 'vertical' }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
            <label style={{ fontSize: sizes.text.xs, color: '#667766', fontFamily: 'monospace', minWidth: 70, textAlign: 'right', flexShrink: 0, paddingTop: 4 }}>Skills</label>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
              {/* Selected skill tags */}
              {formSkillsList.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                  {formSkillsList.map((skill) => (
                    <span key={skill} style={{
                      fontSize: sizes.text.xs,
                      fontFamily: 'monospace',
                      background: '#1a3020',
                      border: '1px solid #2a4a35',
                      borderRadius: 2,
                      padding: '1px 4px',
                      color: '#90d898',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 2,
                    }}>
                      {skill}
                      <button
                        type="button"
                        onClick={() => setFormSkillsList((prev) => prev.filter((s) => s !== skill))}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#6a9a78',
                          cursor: 'pointer',
                          padding: 0,
                          fontSize: sizes.text.xs,
                          fontFamily: 'monospace',
                          lineHeight: 1,
                        }}
                      >
                        {'\u00d7'}
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {/* Search input */}
              <input
                type="text"
                placeholder="Search skills..."
                value={skillSearch}
                onChange={(e) => setSkillSearch(e.target.value)}
                style={formInputStyle}
              />
              {/* Dropdown of matching skills */}
              {skillSearch.trim() !== '' && (() => {
                const filtered = availableSkills
                  .map((s) => s.name)
                  .filter((name) => !formSkillsList.includes(name) && name.toLowerCase().includes(skillSearch.toLowerCase()));
                return filtered.length > 0 ? (
                  <div style={{
                    maxHeight: 80,
                    overflowY: 'auto',
                    background: '#0d1a12',
                    border: '1px solid #1a3020',
                    borderRadius: 2,
                  }}>
                    {filtered.map((name) => (
                      <div
                        key={name}
                        onClick={() => {
                          setFormSkillsList((prev) => [...prev, name]);
                          setSkillSearch('');
                        }}
                        style={{
                          padding: '3px 6px',
                          fontSize: sizes.text.xs,
                          fontFamily: 'monospace',
                          color: '#c0d0c0',
                          cursor: 'pointer',
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = '#1a3020'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                      >
                        {name}
                      </div>
                    ))}
                  </div>
                ) : null;
              })()}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
            <label style={{ fontSize: sizes.text.xs, color: '#667766', fontFamily: 'monospace', minWidth: 70, textAlign: 'right', flexShrink: 0, paddingTop: 4 }}>Instructions</label>
            <textarea
              placeholder="Markdown instructions sent to the agent"
              value={formInstructions}
              onChange={(e) => setFormInstructions(e.target.value)}
              rows={3}
              style={{ ...formInputStyle, resize: 'vertical' }}
            />
          </div>
          <button
            type="button"
            disabled={!formId.trim() || !formName.trim()}
            onClick={() => {
              const roleData = {
                id: formId.trim(),
                name: formName.trim(),
                description: formDescription.trim(),
                skills: formSkillsList,
                instructions: formInstructions.trim(),
              };
              if (editingRoleId && onEditRole) {
                onEditRole(roleData);
              } else if (onCreateRole) {
                onCreateRole(roleData);
              }
              resetForm();
            }}
            style={{
              padding: '4px 10px',
              border: `1px solid ${!formId.trim() || !formName.trim() ? '#1a3020' : colors.border.accent}`,
              borderRadius: 2,
              background: !formId.trim() || !formName.trim() ? 'transparent' : 'rgba(30,70,45,0.2)',
              color: !formId.trim() || !formName.trim() ? '#3a5a48' : '#90d898',
              fontSize: sizes.text.xs,
              fontFamily: 'monospace',
              cursor: !formId.trim() || !formName.trim() ? 'default' : 'pointer',
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              alignSelf: 'flex-end',
            }}
          >
            {editingRoleId ? 'Save' : 'Create'}
          </button>
        </div>
      )}

      </div>{/* end fixed section */}

      {/* ── Scrollable section: agent summary + roles + profiles ────────── */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: sizes.spacing.lg }}>

      {/* ── Agent Role Summary ──────────────────────────────────────────── */}
      {(() => {
        const selectedAgentId = useCommandCenterStore.getState().selectedAgentId;
        // Build reverse lookup: agentType → roleIds[]
        const typeToRoles = new Map<string, string[]>();
        for (const a of assignments) {
          if (!a.agentType) continue;
          const list = typeToRoles.get(a.agentType) ?? [];
          list.push(a.roleId);
          typeToRoles.set(a.agentType, list);
        }

        if (selectedAgentId) {
          // Show roles for selected agent
          const agent = agents.find((a) => a.id === selectedAgentId);
          if (agent) {
            const agentRoles = typeToRoles.get(agent.type) ?? [];
            return (
              <div style={{ padding: `${sizes.spacing.sm}px ${sizes.spacing.md}px`, background: 'rgba(15,30,20,0.6)', border: `1px solid ${colors.border.primary}`, borderRadius: sizes.radius.sm }}>
                <div style={{ fontSize: sizes.text.sm, color: colors.text.secondary, marginBottom: 4 }}>
                  Roles for <span style={{ color: colors.text.primary }}>{agent.name}</span> <span style={{ color: colors.text.dim }}>({agent.type})</span>
                </div>
                {agentRoles.length === 0 ? (
                  <div style={{ fontSize: sizes.text.xs, color: colors.text.dim, fontStyle: 'italic' }}>No roles assigned yet</div>
                ) : (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {agentRoles.map((rid) => {
                      const role = roles.find((r) => r.id === rid);
                      return (
                        <span key={rid} style={{
                          fontSize: sizes.text.xs, padding: '2px 8px', borderRadius: 2,
                          background: `${roleColor(rid)}15`, border: `1px solid ${roleColor(rid)}`,
                          color: roleColor(rid), fontWeight: 600,
                        }}>
                          {role?.name ?? rid}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }
        }

        // All agents summary
        if (agents.length === 0) {
          return (
            <div style={{ padding: `${sizes.spacing.sm}px ${sizes.spacing.md}px`, background: 'rgba(15,30,20,0.6)', border: `1px solid ${colors.border.primary}`, borderRadius: sizes.radius.sm }}>
              <div style={{ fontSize: sizes.text.xs, color: colors.text.dim, fontStyle: 'italic' }}>No agents connected</div>
            </div>
          );
        }

        const agentsWithRoles = agents.filter((a) => (typeToRoles.get(a.type)?.length ?? 0) > 0);
        const agentsWithoutRoles = agents.filter((a) => (typeToRoles.get(a.type)?.length ?? 0) === 0);

        return (
          <div style={{ padding: `${sizes.spacing.sm}px ${sizes.spacing.md}px`, background: 'rgba(15,30,20,0.6)', border: `1px solid ${colors.border.primary}`, borderRadius: sizes.radius.sm }}>
            <div style={{ fontSize: sizes.text.sm, color: colors.text.secondary, marginBottom: 6 }}>
              Agent Assignments <span style={{ color: colors.text.dim }}>({agents.length} agent{agents.length !== 1 ? 's' : ''})</span>
            </div>
            {agentsWithRoles.length === 0 ? (
              <div style={{ fontSize: sizes.text.xs, color: colors.text.dim, fontStyle: 'italic' }}>No roles assigned yet — assign roles below or use the orchestrator to auto-assign</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {agentsWithRoles.map((agent) => {
                  const agentRoles = typeToRoles.get(agent.type) ?? [];
                  return (
                    <div key={agent.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: sizes.text.xs }}>
                      <span style={{ color: colors.text.primary, minWidth: 80 }}>{agent.name}</span>
                      <span style={{ color: colors.text.dim }}>→</span>
                      {agentRoles.map((rid) => (
                        <span key={rid} style={{
                          padding: '1px 6px', borderRadius: 2,
                          background: `${roleColor(rid)}15`, border: `1px solid ${roleColor(rid)}55`,
                          color: roleColor(rid), fontSize: 9, fontWeight: 600,
                        }}>
                          {roles.find((r) => r.id === rid)?.name ?? rid}
                        </span>
                      ))}
                    </div>
                  );
                })}
                {agentsWithoutRoles.length > 0 && (
                  <div style={{ fontSize: sizes.text.xs, color: colors.text.dim, marginTop: 2 }}>
                    {agentsWithoutRoles.length} agent{agentsWithoutRoles.length !== 1 ? 's' : ''} without roles: {agentsWithoutRoles.map((a) => a.name).join(', ')}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Roles Grid ─────────────────────────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: sizes.spacing.sm,
      }}>
        {[...roles].sort((a, b) => {
          // Orchestrator always first (highest hierarchy)
          if (a.id === 'orchestrator') return -1;
          if (b.id === 'orchestrator') return 1;
          // Built-in roles before custom
          if (a.builtIn !== b.builtIn) return a.builtIn ? -1 : 1;
          return 0;
        }).map((role) => {
          const assigned = assignmentMap.get(role.id);
          const isSelected = selectedRoleId === role.id;
          const isEditing = editingRoleId === role.id;
          const rc = roleColor(role.id);

          return (
            <div
              key={role.id}
              onClick={() => setSelectedRoleId(isSelected ? null : role.id)}
              style={{
                padding: sizes.spacing.sm,
                background: isSelected ? 'rgba(30,70,45,0.2)' : colors.bg.secondary,
                border: isEditing
                  ? '2px solid #ffaa33'
                  : role.builtIn
                    ? `1px solid ${isSelected ? colors.border.accent : colors.border.primary}`
                    : `1px dashed ${isSelected ? colors.border.accent : colors.border.primary}`,
                boxShadow: isEditing ? '0 0 6px rgba(255,170,51,0.3)' : undefined,
                borderRadius: sizes.radius.sm,
                cursor: 'pointer',
                transition: 'border-color 0.15s ease',
              }}
            >
              {/* Role name + color dot */}
              <div style={{ display: 'flex', alignItems: 'center', gap: sizes.spacing.xs, marginBottom: 2 }}>
                <div style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: rc,
                  boxShadow: `0 0 4px ${rc}`,
                  flexShrink: 0,
                }} />
                <span style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: colors.text.primary,
                  flex: 1,
                }}>
                  {role.name}
                </span>
                {onEditRole && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); startEditing(role); }}
                    style={{
                      width: 14,
                      height: 14,
                      border: '1px solid #1a3020',
                      borderRadius: 2,
                      background: 'transparent',
                      color: '#4a8a5a',
                      fontSize: sizes.text.xs,
                      fontFamily: 'monospace',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: 0,
                      lineHeight: 1,
                      flexShrink: 0,
                    }}
                    onMouseEnter={() => setHoveredTooltip(`Edit ${role.name}`)}
                    onMouseLeave={() => setHoveredTooltip(null)}
                  >
                    {'\u270E'}
                  </button>
                )}
                {!role.builtIn && onDeleteRole && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onDeleteRole(role.id); }}
                    style={{
                      width: 14,
                      height: 14,
                      border: '1px solid #1a3020',
                      borderRadius: 2,
                      background: 'transparent',
                      color: '#6a4040',
                      fontSize: sizes.text.sm,
                      fontFamily: 'monospace',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: 0,
                      lineHeight: 1,
                      flexShrink: 0,
                    }}
                    onMouseEnter={() => setHoveredTooltip(`Delete ${role.name}`)}
                    onMouseLeave={() => setHoveredTooltip(null)}
                  >
                    {'\u00d7'}
                  </button>
                )}
              </div>

              {/* Description */}
              <div style={{
                fontSize: sizes.text.sm,
                color: '#667766',
                lineHeight: 1.3,
                marginBottom: sizes.spacing.xs,
              }}>
                {role.description}
              </div>

              {/* Bottom row: assigned badge + skill count */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                {assigned ? (
                  <span style={{
                    fontSize: sizes.text.xs,
                    color: agentColor(assigned),
                    border: `1px solid ${agentColor(assigned)}44`,
                    borderRadius: 2,
                    padding: '1px 3px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}>
                    {assigned}
                  </span>
                ) : (
                  <span style={{
                    fontSize: sizes.text.xs,
                    color: colors.text.muted,
                    fontStyle: 'italic',
                  }}>
                    unassigned
                  </span>
                )}
                <span style={{
                  fontSize: sizes.text.xs,
                  color: colors.text.dim,
                }}>
                  {role.skills.length} skill{role.skills.length !== 1 ? 's' : ''}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Selected Role Detail ───────────────────────────────────────── */}
      {selectedRole && (
        <div style={{
          padding: sizes.spacing.sm,
          border: `1px solid ${colors.border.primary}`,
          borderRadius: sizes.radius.sm,
          background: colors.bg.secondary,
        }}>
          <div style={{
            fontSize: sizes.text.xs,
            color: '#4a8a5a',
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            marginBottom: sizes.spacing.xs,
          }}>
            Recommended for: {selectedRole.name}
          </div>

          {profiles.length === 0 ? (
            <div style={{ fontSize: sizes.text.xs, color: colors.text.muted }}>
              No agent performance data available yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: sizes.spacing.xs }}>
              {profiles
                .map((profile) => {
                  const roleStats = profile.byRole[selectedRole.id];
                  return { profile, roleStats };
                })
                .sort((a, b) => {
                  // Agents with role data rank higher; then by success rate
                  const aRate = a.roleStats?.successRate ?? -1;
                  const bRate = b.roleStats?.successRate ?? -1;
                  return bRate - aRate;
                })
                .map(({ profile, roleStats }) => (
                  <div key={profile.agentType} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: sizes.spacing.sm,
                    padding: `${sizes.spacing.xs}px 0`,
                    borderBottom: `1px solid ${colors.border.primary}`,
                  }}>
                    <span style={{
                      fontSize: sizes.text.sm,
                      fontWeight: 600,
                      color: agentColor(profile.agentType),
                      minWidth: 60,
                      textTransform: 'uppercase',
                    }}>
                      {profile.agentType}
                    </span>
                    {roleStats ? (
                      <>
                        {/* Mini success rate bar */}
                        <div style={{
                          width: 40,
                          height: 4,
                          background: colors.bg.panel,
                          borderRadius: 1,
                          overflow: 'hidden',
                          flexShrink: 0,
                        }}>
                          <div style={{
                            width: `${Math.round(roleStats.successRate * 100)}%`,
                            height: '100%',
                            background: rateColor(roleStats.successRate),
                            borderRadius: 1,
                          }} />
                        </div>
                        <span style={{ fontSize: sizes.text.xs, color: rateColor(roleStats.successRate), minWidth: 28 }}>
                          {Math.round(roleStats.successRate * 100)}%
                        </span>
                        <span style={{ fontSize: sizes.text.xs, color: colors.text.dim }}>
                          {roleStats.total} tasks | avg {formatDuration(roleStats.avgDurationMs)}
                        </span>
                      </>
                    ) : (
                      <span style={{ fontSize: sizes.text.xs, color: colors.text.muted, fontStyle: 'italic' }}>
                        no data for this role
                      </span>
                    )}
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {/* ── Agent Profiles Section ─────────────────────────────────────── */}
      {profiles.length > 0 && (
        <div>
          <div style={{
            fontSize: sizes.text.xs,
            color: '#4a8a5a',
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            marginBottom: sizes.spacing.sm,
          }}>
            Agent Performance
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: sizes.spacing.md }}>
            {profiles.map((profile) => {
              const roleEntries = Object.entries(profile.byRole);

              return (
                <div key={profile.agentType} style={{
                  padding: sizes.spacing.sm,
                  border: `1px solid ${colors.border.primary}`,
                  borderRadius: sizes.radius.sm,
                  background: colors.bg.secondary,
                }}>
                  {/* Agent type name */}
                  <div style={{
                    fontSize: sizes.text.sm,
                    fontWeight: 600,
                    color: agentColor(profile.agentType),
                    textTransform: 'uppercase',
                    marginBottom: sizes.spacing.xs,
                  }}>
                    {profile.agentType}
                  </div>

                  {/* Overall success rate bar */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: sizes.spacing.sm, marginBottom: sizes.spacing.xs }}>
                    <div style={{
                      flex: 1,
                      height: 6,
                      background: colors.bg.panel,
                      borderRadius: 1,
                      overflow: 'hidden',
                    }}>
                      <div style={{
                        width: `${Math.round(profile.overallSuccessRate * 100)}%`,
                        height: '100%',
                        background: rateColor(profile.overallSuccessRate),
                        borderRadius: 1,
                        transition: 'width 0.3s ease',
                      }} />
                    </div>
                    <span style={{
                      fontSize: sizes.text.xs,
                      fontWeight: 600,
                      color: rateColor(profile.overallSuccessRate),
                      minWidth: 28,
                      textAlign: 'right',
                    }}>
                      {Math.round(profile.overallSuccessRate * 100)}%
                    </span>
                  </div>

                  {/* Stats line */}
                  <div style={{
                    fontSize: sizes.text.xs,
                    color: colors.text.dim,
                    marginBottom: sizes.spacing.sm,
                  }}>
                    {profile.totalTasks} tasks | avg {formatDuration(profile.avgDurationMs)} | avg {formatCost(profile.avgCostUsd)}
                  </div>

                  {/* Role breakdown */}
                  {roleEntries.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {roleEntries.map(([roleId, stats]) => (
                        <div key={roleId} style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: sizes.spacing.xs,
                        }}>
                          {/* Role color dot */}
                          <div style={{
                            width: 4,
                            height: 4,
                            borderRadius: '50%',
                            background: roleColor(roleId),
                            flexShrink: 0,
                          }} />
                          <span style={{
                            fontSize: sizes.text.xs,
                            color: colors.text.secondary,
                            minWidth: 50,
                          }}>
                            {roleId}
                          </span>
                          {/* Mini bar */}
                          <div style={{
                            width: 30,
                            height: 3,
                            background: colors.bg.panel,
                            borderRadius: 1,
                            overflow: 'hidden',
                            flexShrink: 0,
                          }}>
                            <div style={{
                              width: `${Math.round(stats.successRate * 100)}%`,
                              height: '100%',
                              background: rateColor(stats.successRate),
                              borderRadius: 1,
                            }} />
                          </div>
                          <span style={{
                            fontSize: sizes.text.xs,
                            color: colors.text.dim,
                          }}>
                            {Math.round(stats.successRate * 100)}% ({stats.total})
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      </div>{/* end scrollable section */}
      {hoveredTooltip && createPortal(
        <div style={TOOLTIP_STYLE}>
          <div style={{ fontSize: 11, color: '#6a9a78' }}>{hoveredTooltip}</div>
        </div>,
        document.body,
      )}
    </div>
  );
};
