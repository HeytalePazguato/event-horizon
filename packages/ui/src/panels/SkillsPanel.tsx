/**
 * Skills tab — shows installed skills for the selected agent.
 * @event-horizon/ui
 */

import type { FC } from 'react';
import { useState, useRef, useEffect } from 'react';
import { useCommandCenterStore } from '../store.js';
import type { SkillInfo } from '../store.js';

const SCOPE_COLORS: Record<string, string> = {
  personal: '#8ac08a',
  project:  '#6ab0d4',
  plugin:   '#cc88ff',
  legacy:   '#b8a060',
};

const SCOPE_LABELS: Record<string, string> = {
  personal: 'Personal',
  project:  'Project',
  plugin:   'Plugin',
  legacy:   'Legacy',
};

const AGENT_TYPE_COLORS: Record<string, string> = {
  'claude-code': '#88aaff',
  'opencode':    '#88ffaa',
  'copilot':     '#cc88ff',
};

const AGENT_TYPE_LABELS: Record<string, string> = {
  'claude-code': 'Claude',
  'opencode':    'OC',
  'copilot':     'Copilot',
};

/** Inline category combobox for move UI. */
const MoveCombobox: FC<{
  value: string;
  onChange: (val: string) => void;
  options: string[];
}> = ({ value, onChange, options }) => {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const filtered = options.filter((o) =>
    !value || o.toLowerCase().includes(value.toLowerCase()),
  );

  return (
    <div ref={wrapperRef} style={{ position: 'relative', flex: 1 }}>
      <div style={{ display: 'flex', gap: 0 }}>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
          onFocus={() => setOpen(true)}
          onClick={(e) => e.stopPropagation()}
          placeholder="none (root)"
          style={{
            flex: 1,
            padding: '2px 6px',
            fontSize: 8,
            background: 'rgba(0,0,0,0.4)',
            border: '1px solid #2a4a3a',
            borderRight: 'none',
            color: '#a0c090',
            outline: 'none',
            fontFamily: 'Consolas, monospace',
            boxSizing: 'border-box',
          }}
        />
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
          style={{
            padding: '0 4px',
            fontSize: 8,
            background: 'rgba(0,0,0,0.4)',
            border: '1px solid #2a4a3a',
            color: '#6a8a7a',
            cursor: 'pointer',
            lineHeight: '16px',
          }}
        >
          {open ? '\u25B2' : '\u25BC'}
        </button>
      </div>
      {open && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          zIndex: 10,
          background: '#0b1a12',
          border: '1px solid #2a4a3a',
          borderTop: 'none',
          maxHeight: 80,
          overflowY: 'auto',
        }}>
          <div
            onClick={(e) => { e.stopPropagation(); onChange(''); setOpen(false); }}
            style={{
              padding: '2px 6px', fontSize: 8, color: '#5a7a62', cursor: 'pointer', fontStyle: 'italic',
            }}
            onMouseEnter={(e) => { (e.target as HTMLDivElement).style.background = 'rgba(50,90,60,0.3)'; }}
            onMouseLeave={(e) => { (e.target as HTMLDivElement).style.background = 'transparent'; }}
          >
            (none — root level)
          </div>
          {filtered.map((opt) => (
            <div
              key={opt}
              onClick={(e) => { e.stopPropagation(); onChange(opt); setOpen(false); }}
              style={{
                padding: '2px 6px', fontSize: 8, color: '#a0c090', cursor: 'pointer',
              }}
              onMouseEnter={(e) => { (e.target as HTMLDivElement).style.background = 'rgba(50,90,60,0.3)'; }}
              onMouseLeave={(e) => { (e.target as HTMLDivElement).style.background = 'transparent'; }}
            >
              {opt}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const SkillCard: FC<{
  skill: SkillInfo;
  expanded: boolean;
  onToggle: () => void;
  onOpen?: (filePath: string) => void;
  onMove?: (filePath: string, newCategory: string) => void;
  onDuplicate?: (filePath: string, newName: string) => void;
  existingCategories: string[];
}> = ({ skill, expanded, onToggle, onOpen, onMove, onDuplicate, existingCategories }) => {
  const scopeColor = SCOPE_COLORS[skill.scope] ?? '#6a7a72';
  const [moving, setMoving] = useState(false);
  const [moveTarget, setMoveTarget] = useState(skill.category ?? '');
  const [duplicating, setDuplicating] = useState(false);
  const [dupName, setDupName] = useState('');

  const canMove = skill.scope !== 'legacy' && skill.scope !== 'plugin';
  const moveChanged = moveTarget !== (skill.category ?? '');

  return (
    <div
      onClick={onToggle}
      style={{
        padding: '4px 6px',
        background: expanded ? 'rgba(50,90,60,0.25)' : 'rgba(0,0,0,0.25)',
        border: `1px solid ${expanded ? '#3a6a4a' : '#1e3328'}`,
        boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.2)',
        cursor: 'pointer',
        marginBottom: 2,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {/* Skill name — with category prefix when present */}
        <span style={{ fontFamily: 'Consolas, monospace', fontSize: 10, fontWeight: 600 }}>
          {skill.category && (
            <span style={{ color: '#6a8a5a' }}>/{skill.category}</span>
          )}
          <span style={{ color: '#8fc08a' }}>/{skill.name}</span>
        </span>
        {/* Scope badge */}
        <span style={{
          fontSize: 8,
          padding: '1px 4px',
          background: `${scopeColor}22`,
          border: `1px solid ${scopeColor}44`,
          color: scopeColor,
          borderRadius: 2,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
        }}>
          {skill.pluginName ? `${SCOPE_LABELS[skill.scope]}:${skill.pluginName}` : SCOPE_LABELS[skill.scope]}
        </span>
        {/* Agent type badges */}
        {skill.agentTypes.map((at) => (
          <span key={at} style={{
            fontSize: 7,
            padding: '1px 3px',
            background: `${AGENT_TYPE_COLORS[at] ?? '#6a7a72'}18`,
            border: `1px solid ${AGENT_TYPE_COLORS[at] ?? '#6a7a72'}44`,
            color: AGENT_TYPE_COLORS[at] ?? '#6a7a72',
            borderRadius: 2,
            letterSpacing: '0.03em',
          }}>
            {AGENT_TYPE_LABELS[at] ?? at}
          </span>
        ))}
        {/* Universal compatibility badge — skill works across all agent types */}
        {skill.agentTypes.includes('claude-code') &&
         skill.agentTypes.includes('opencode') &&
         skill.agentTypes.includes('copilot') && (
          <span style={{
            fontSize: 7,
            padding: '1px 3px',
            background: 'rgba(212,168,68,0.15)',
            border: '1px solid rgba(212,168,68,0.4)',
            color: '#d4a844',
            borderRadius: 2,
            letterSpacing: '0.03em',
            fontWeight: 600,
          }}>
            &#x1F310; Universal
          </span>
        )}
        {skill.userInvocable && (
          <span title="User-invocable" style={{ fontSize: 9, color: '#d4c44a' }}>&#x26A1;</span>
        )}
        {skill.context === 'fork' && (
          <span title="Fork context" style={{ fontSize: 9, color: '#6ab0d4' }}>&#x2442;</span>
        )}
      </div>
      {/* Description */}
      <div style={{
        fontSize: 9,
        color: '#7a9a82',
        marginTop: 2,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        ...(expanded ? {} : { whiteSpace: 'nowrap' as const }),
      }}>
        {skill.description || 'No description'}
      </div>
      {/* Expanded details */}
      {expanded && (
        <div style={{ marginTop: 4, fontSize: 8, color: '#5a7a62', lineHeight: 1.6 }}>
          {skill.model && <div>Model: <span style={{ color: '#a0c090' }}>{skill.model}</span></div>}
          {skill.agent && <div>Agent: <span style={{ color: '#a0c090' }}>{skill.agent}</span></div>}
          {skill.argumentHint && <div>Args: <span style={{ color: '#a0c090' }}>{skill.argumentHint}</span></div>}
          {skill.allowedTools.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, marginTop: 2 }}>
              {skill.allowedTools.map((tool) => (
                <span key={tool} style={{
                  fontSize: 7,
                  padding: '0 3px',
                  background: 'rgba(100,160,120,0.15)',
                  border: '1px solid #2a4a3a',
                  color: '#8ab880',
                  borderRadius: 2,
                }}>
                  {tool}
                </span>
              ))}
            </div>
          )}
          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
            {onOpen && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onOpen(skill.filePath); }}
                style={{
                  padding: '2px 8px',
                  fontSize: 8,
                  border: '1px solid #3a6a4a',
                  background: 'rgba(50,90,60,0.3)',
                  color: '#8fc08a',
                  cursor: 'pointer',
                }}
              >
                Open in Editor
              </button>
            )}
            {canMove && onMove && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setMoving(!moving); setMoveTarget(skill.category ?? ''); setDuplicating(false); }}
                style={{
                  padding: '2px 8px',
                  fontSize: 8,
                  border: `1px solid ${moving ? '#b8a060' : '#4a4a3a'}`,
                  background: moving ? 'rgba(180,160,96,0.15)' : 'transparent',
                  color: moving ? '#b8a060' : '#7a7a62',
                  cursor: 'pointer',
                }}
              >
                {moving ? 'Cancel' : 'Move'}
              </button>
            )}
            {canMove && onDuplicate && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setDuplicating(!duplicating); setDupName(''); setMoving(false); }}
                style={{
                  padding: '2px 8px',
                  fontSize: 8,
                  border: `1px solid ${duplicating ? '#6ab0d4' : '#4a4a3a'}`,
                  background: duplicating ? 'rgba(106,176,212,0.15)' : 'transparent',
                  color: duplicating ? '#6ab0d4' : '#7a7a62',
                  cursor: 'pointer',
                }}
              >
                {duplicating ? 'Cancel' : 'Duplicate'}
              </button>
            )}
          </div>
          {/* Move UI */}
          {moving && onMove && (
            <div
              style={{ marginTop: 4, display: 'flex', gap: 4, alignItems: 'center' }}
              onClick={(e) => e.stopPropagation()}
            >
              <span style={{ fontSize: 7, color: '#6a8a7a', textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0 }}>
                Category:
              </span>
              <MoveCombobox
                value={moveTarget}
                onChange={setMoveTarget}
                options={existingCategories}
              />
              <button
                type="button"
                disabled={!moveChanged}
                onClick={(e) => {
                  e.stopPropagation();
                  onMove(skill.filePath, moveTarget);
                  setMoving(false);
                }}
                style={{
                  padding: '2px 8px',
                  fontSize: 8,
                  border: `1px solid ${moveChanged ? '#50aa70' : '#2a4a3a'}`,
                  background: moveChanged ? 'rgba(50,120,70,0.3)' : 'transparent',
                  color: moveChanged ? '#b0f0c0' : '#4a5a52',
                  cursor: moveChanged ? 'pointer' : 'default',
                  flexShrink: 0,
                }}
              >
                Move
              </button>
            </div>
          )}
          {/* Duplicate UI */}
          {duplicating && onDuplicate && (
            <div
              style={{ marginTop: 4, display: 'flex', gap: 4, alignItems: 'center' }}
              onClick={(e) => e.stopPropagation()}
            >
              <span style={{ fontSize: 7, color: '#6a8a7a', textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0 }}>
                New name:
              </span>
              <input
                type="text"
                value={dupName}
                onChange={(e) => setDupName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                onClick={(e) => e.stopPropagation()}
                placeholder="my-skill-copy"
                style={{
                  flex: 1,
                  padding: '2px 6px',
                  fontSize: 8,
                  background: 'rgba(0,0,0,0.4)',
                  border: '1px solid #2a4a5a',
                  color: '#a0c0d0',
                  outline: 'none',
                  fontFamily: 'Consolas, monospace',
                  boxSizing: 'border-box',
                }}
              />
              <button
                type="button"
                disabled={!dupName}
                onClick={(e) => {
                  e.stopPropagation();
                  onDuplicate(skill.filePath, dupName);
                  setDuplicating(false);
                  setDupName('');
                }}
                style={{
                  padding: '2px 8px',
                  fontSize: 8,
                  border: `1px solid ${dupName ? '#6ab0d4' : '#2a4a3a'}`,
                  background: dupName ? 'rgba(106,176,212,0.2)' : 'transparent',
                  color: dupName ? '#b0e0f0' : '#4a5a52',
                  cursor: dupName ? 'pointer' : 'default',
                  flexShrink: 0,
                }}
              >
                Duplicate
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export interface SkillsPanelProps {
  onOpenSkill?: (filePath: string) => void;
  onCreateSkill?: () => void;
  onOpenMarketplace?: () => void;
  onMoveSkill?: (filePath: string, newCategory: string) => void;
  onDuplicateSkill?: (filePath: string, newName: string) => void;
}

export const SkillsPanel: FC<SkillsPanelProps> = ({ onOpenSkill, onCreateSkill, onOpenMarketplace, onMoveSkill, onDuplicateSkill } = {}) => {
  const skills = useCommandCenterStore((s) => s.skills);
  const selectedAgentType = useCommandCenterStore((s) => s.selectedAgent?.type ?? null);
  const [search, setSearch] = useState('');
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [scopeFilter, setScopeFilter] = useState<string | null>(null);
  const [agentTypeFilter, setAgentTypeFilter] = useState<string | null>(null);

  // When a planet is selected, default to filtering by its agent type
  const effectiveAgentTypeFilter = agentTypeFilter ?? selectedAgentType;

  const filtered = skills.filter((s) => {
    if (scopeFilter && s.scope !== scopeFilter) return false;
    if (effectiveAgentTypeFilter && !s.agentTypes.includes(effectiveAgentTypeFilter as 'claude-code' | 'opencode' | 'copilot')) return false;
    if (search) {
      const q = search.toLowerCase();
      return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q);
    }
    return true;
  });

  if (skills.length === 0) {
    return (
      <div style={{ color: '#4a5a52', fontSize: 10, padding: 6, border: '1px dashed #2a4a3a', textAlign: 'center' }}>
        No skills installed.
        <div style={{ fontSize: 8, marginTop: 4, color: '#3a4a42' }}>
          Add skills to ~/.claude/skills/ or .claude/skills/
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 6, justifyContent: 'center' }}>
          {onCreateSkill && (
            <button
              type="button"
              onClick={onCreateSkill}
              style={{
                padding: '3px 12px',
                fontSize: 9,
                border: '1px solid #3a6a4a',
                background: 'rgba(50,90,60,0.3)',
                color: '#8fc08a',
                cursor: 'pointer',
              }}
            >+ Create Skill</button>
          )}
          {onOpenMarketplace && (
            <button
              type="button"
              onClick={onOpenMarketplace}
              style={{
                padding: '3px 12px',
                fontSize: 9,
                border: '1px solid #4a3a6a',
                background: 'rgba(60,50,90,0.3)',
                color: '#b08afc',
                cursor: 'pointer',
              }}
            >Browse Marketplace</button>
          )}
        </div>
      </div>
    );
  }

  const scopes = Array.from(new Set(skills.map((s) => s.scope)));
  const existingCategories = Array.from(
    new Set(skills.map((s) => s.category).filter((c): c is string => !!c)),
  ).sort();

  return (
    <div>
      {/* Search + scope filters + create */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 4, alignItems: 'center' }}>
        {onCreateSkill && (
          <button
            type="button"
            onClick={onCreateSkill}
            title="Create new skill"
            style={{
              padding: '1px 6px',
              fontSize: 11,
              fontWeight: 700,
              border: '1px solid #3a6a4a',
              background: 'rgba(50,90,60,0.3)',
              color: '#8fc08a',
              cursor: 'pointer',
              lineHeight: '16px',
            }}
          >+</button>
        )}
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setExpandedIndex((prev) => prev === null ? 0 : Math.min((prev ?? 0) + 1, filtered.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setExpandedIndex((prev) => prev === null ? null : Math.max((prev ?? 0) - 1, 0));
            } else if (e.key === 'Escape') {
              setExpandedIndex(null);
            }
          }}
          placeholder="Search skills..."
          style={{
            flex: 1,
            padding: '2px 6px',
            fontSize: 9,
            background: 'rgba(0,0,0,0.3)',
            border: '1px solid #2a4a3a',
            color: '#a0c090',
            outline: 'none',
          }}
        />
        {scopes.length > 1 && scopes.map((scope) => (
          <button
            key={scope}
            type="button"
            onClick={() => setScopeFilter(scopeFilter === scope ? null : scope)}
            style={{
              padding: '1px 5px',
              fontSize: 7,
              border: `1px solid ${scopeFilter === scope ? '#3a6a4a' : '#2a4a3a'}`,
              background: scopeFilter === scope ? 'rgba(50,90,60,0.4)' : 'transparent',
              color: scopeFilter === scope ? '#8fc08a' : '#6a7a72',
              cursor: 'pointer',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            {SCOPE_LABELS[scope] ?? scope}
          </button>
        ))}
      </div>
      {/* Agent type filters */}
      <div style={{ display: 'flex', gap: 3, marginBottom: 4, alignItems: 'center' }}>
        <span style={{ fontSize: 7, color: '#5a6a62', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Agent:</span>
        {(['claude-code', 'opencode', 'copilot'] as const).map((at) => {
          const active = effectiveAgentTypeFilter === at;
          const color = AGENT_TYPE_COLORS[at];
          return (
            <button
              key={at}
              type="button"
              onClick={() => setAgentTypeFilter(effectiveAgentTypeFilter === at ? null : at)}
              style={{
                padding: '1px 5px',
                fontSize: 7,
                border: `1px solid ${active ? color : '#2a4a3a'}`,
                background: active ? `${color}22` : 'transparent',
                color: active ? color : '#6a7a72',
                cursor: 'pointer',
                letterSpacing: '0.03em',
              }}
            >
              {AGENT_TYPE_LABELS[at]}
            </button>
          );
        })}
        {effectiveAgentTypeFilter && (
          <button
            type="button"
            onClick={() => setAgentTypeFilter(null)}
            style={{
              padding: '1px 4px',
              fontSize: 7,
              border: '1px solid #2a4a3a',
              background: 'transparent',
              color: '#6a7a72',
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        )}
      </div>
      {/* Skill list */}
      <div style={{ maxHeight: 85, overflowY: 'auto' }}>
        {filtered.length === 0 ? (
          <div style={{ color: '#4a5a52', fontSize: 9, padding: 4 }}>No matching skills.</div>
        ) : filtered.map((skill, i) => (
          <SkillCard
            key={`${skill.scope}-${skill.name}`}
            skill={skill}
            expanded={expandedIndex === i}
            onToggle={() => setExpandedIndex(expandedIndex === i ? null : i)}
            onOpen={onOpenSkill}
            onMove={onMoveSkill}
            onDuplicate={onDuplicateSkill}
            existingCategories={existingCategories}
          />
        ))}
      </div>
    </div>
  );
};
