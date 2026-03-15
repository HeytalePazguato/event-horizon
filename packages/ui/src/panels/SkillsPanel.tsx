/**
 * Skills tab — shows installed skills for the selected agent.
 * @event-horizon/ui
 */

import type { FC } from 'react';
import { useState, useEffect } from 'react';
import { useCommandCenterStore } from '../store.js';
import type { SkillInfo } from '../store.js';
import { DEFAULT_VISUAL_SETTINGS } from '../store.js';

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

/** Resolve agent type color from store settings with fallback to defaults. */
function getAgentTypeColor(agentType: string): string {
  const vs = useCommandCenterStore.getState().visualSettings;
  return (vs as Record<string, { color: string }>)[agentType]?.color
    ?? (DEFAULT_VISUAL_SETTINGS as Record<string, { color: string }>)[agentType]?.color
    ?? '#6a7a72';
}

const AGENT_TYPE_LABELS: Record<string, string> = {
  'claude-code': 'Claude',
  'opencode':    'OpenCode',
  'copilot':     'Copilot',
};

/** Inline category combobox for move UI. */

const SkillCard: FC<{
  skill: SkillInfo;
  expanded: boolean;
  onToggle: () => void;
  onOpen?: (filePath: string) => void;
  onMove?: (filePath: string, newCategory: string) => void;
  onDuplicate?: (filePath: string, newName: string) => void;
}> = ({ skill, expanded, onToggle, onOpen, onMove, onDuplicate }) => {
  const scopeColor = SCOPE_COLORS[skill.scope] ?? '#6a7a72';
  const [duplicating, setDuplicating] = useState(false);
  const [dupName, setDupName] = useState('');

  const canMove = skill.scope !== 'legacy' && skill.scope !== 'plugin';
  /** Skill is in a category subfolder that breaks agent discovery. */
  const isInSubfolder = !!skill.category;

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
            background: `${getAgentTypeColor(at)}18`,
            border: `1px solid ${getAgentTypeColor(at)}44`,
            color: getAgentTypeColor(at),
            borderRadius: 2,
            letterSpacing: '0.03em',
          }}>
            {AGENT_TYPE_LABELS[at] ?? at}
          </span>
        ))}
        {skill.userInvocable && (
          <span title="User-invocable" style={{ fontSize: 9, color: '#d4c44a' }}>&#x26A1;</span>
        )}
        {skill.context === 'fork' && (
          <span title="Fork context" style={{ fontSize: 9, color: '#6ab0d4' }}>&#x2442;</span>
        )}
        {/* Metadata category badge */}
        {skill.metadataCategory && (
          <span style={{
            fontSize: 7,
            padding: '1px 3px',
            background: 'rgba(180,140,60,0.15)',
            border: '1px solid rgba(180,140,60,0.35)',
            color: '#c8a848',
            borderRadius: 2,
          }}>
            {skill.metadataCategory}
          </span>
        )}
        {/* Tags */}
        {skill.tags?.map((tag) => (
          <span key={tag} style={{
            fontSize: 7,
            padding: '1px 3px',
            background: 'rgba(120,160,200,0.12)',
            border: '1px solid rgba(120,160,200,0.3)',
            color: '#80a8c8',
            borderRadius: 2,
          }}>
            {tag}
          </span>
        ))}
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
            {canMove && isInSubfolder && onMove && (
              <button
                type="button"
                title="Skill is in a category subfolder — agents can't discover it. Move to root."
                onClick={(e) => { e.stopPropagation(); onMove(skill.filePath, ''); setDuplicating(false); }}
                style={{
                  padding: '2px 8px',
                  fontSize: 8,
                  border: '1px solid #b86040',
                  background: 'rgba(180,96,64,0.15)',
                  color: '#d88860',
                  cursor: 'pointer',
                }}
              >
                Move to Root
              </button>
            )}
            {canMove && onDuplicate && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setDuplicating(!duplicating); setDupName(''); }}
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
          {/* Move to Root warning for skills in subfolders */}
          {isInSubfolder && (
            <div style={{ marginTop: 4, fontSize: 7, color: '#d88860', lineHeight: 1.4 }}>
              &#x26A0; In subfolder <span style={{ color: '#c8a848' }}>/{skill.category}</span> — agents can&apos;t discover this skill. Use <span style={{ color: '#80a8c8' }}>metadata.category</span> in SKILL.md instead.
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
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [scopeFilter, setScopeFilter] = useState<string | null>(null);
  const [activeAgentFilters, setActiveAgentFilters] = useState<Set<string>>(new Set(['claude-code', 'opencode', 'copilot']));

  // Debounce search input by 150ms
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 150);
    return () => clearTimeout(timer);
  }, [search]);

  const toggleAgentFilter = (at: string) => {
    setActiveAgentFilters((prev) => {
      const next = new Set(prev);
      if (next.has(at)) next.delete(at);
      else next.add(at);
      return next;
    });
  };

  const filtered = skills.filter((s) => {
    if (scopeFilter && s.scope !== scopeFilter) return false;
    // Skill must be compatible with at least one active agent type
    if (activeAgentFilters.size === 0) return false;
    if (!s.agentTypes.some((at) => activeAgentFilters.has(at))) return false;
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
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
      {/* Agent type filters (multi-select toggle) */}
      <div style={{ display: 'flex', gap: 3, marginBottom: 4, alignItems: 'center' }}>
        <span style={{ fontSize: 7, color: '#5a6a62', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Agent:</span>
        {(['claude-code', 'opencode', 'copilot'] as const).map((at) => {
          const active = activeAgentFilters.has(at);
          const color = getAgentTypeColor(at);
          return (
            <button
              key={at}
              type="button"
              onClick={() => toggleAgentFilter(at)}
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
          />
        ))}
      </div>
    </div>
  );
};
