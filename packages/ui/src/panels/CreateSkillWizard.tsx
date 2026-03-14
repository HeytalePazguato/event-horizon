/**
 * Create Skill wizard — guided form to create a new SKILL.md file.
 * @event-horizon/ui
 *
 * Supported SKILL.md frontmatter fields:
 *   name, description, user-invocable, disable-model-invocation, argument-hint
 * Unsupported (NOT part of the spec): allowed-tools, model, context, agent
 */

import type { FC } from 'react';
import { useState, useRef, useEffect } from 'react';
import { useCommandCenterStore } from '../store.js';

export interface CreateSkillRequest {
  name: string;
  description: string;
  scope: 'personal' | 'project';
  category: string;
  userInvocable: boolean;
  disableModelInvocation: boolean;
  argumentHint: string;
}

const TEMPLATES: Array<{ label: string; desc: string; apply: () => Partial<CreateSkillRequest> }> = [
  { label: 'Blank', desc: 'Empty skill', apply: () => ({}) },
  { label: 'Code Review', desc: 'Review changed files', apply: () => ({ name: 'code-review', description: 'Review code changes and suggest improvements', category: 'development' }) },
  { label: 'Test Runner', desc: 'Run tests and report', apply: () => ({ name: 'run-tests', description: 'Run the project test suite and report results', category: 'development' }) },
  { label: 'Documentation', desc: 'Generate/update docs', apply: () => ({ name: 'update-docs', description: 'Generate or update documentation for changed files', category: 'documentation' }) },
];

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '4px 8px',
  fontSize: 10,
  background: 'rgba(0,0,0,0.4)',
  border: '1px solid #2a4a3a',
  color: '#a0c090',
  outline: 'none',
  fontFamily: 'Consolas, monospace',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  fontSize: 8,
  color: '#6a8a7a',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: 2,
  display: 'block',
};

const sectionStyle: React.CSSProperties = {
  marginBottom: 8,
};

function buildSkillPath(scope: 'personal' | 'project', category: string, name: string): string {
  const base = scope === 'personal' ? '~/.claude/skills/' : '.claude/skills/';
  const cat = category ? `${category}/` : '';
  return `${base}${cat}${name}/SKILL.md`;
}

function generateSkillMd(req: CreateSkillRequest): string {
  const lines: string[] = ['---'];
  if (req.name) lines.push(`name: ${req.name}`);
  if (req.description) lines.push(`description: "${req.description}"`);
  lines.push(`user-invocable: ${req.userInvocable}`);
  if (req.disableModelInvocation) lines.push('disable-model-invocation: true');
  if (req.argumentHint) lines.push(`argument-hint: "${req.argumentHint}"`);
  lines.push('---');
  lines.push('');
  lines.push('<!-- Write your skill instructions here -->');
  lines.push('');
  return lines.join('\n');
}

const EMPTY_FORM: CreateSkillRequest = {
  name: '',
  description: '',
  scope: 'project',
  category: '',
  userInvocable: true,
  disableModelInvocation: false,
  argumentHint: '',
};

/** Combobox — dropdown with existing options + free text input. */
const CategoryCombobox: FC<{
  value: string;
  onChange: (val: string) => void;
  options: string[];
}> = ({ value, onChange, options }) => {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
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
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: 0 }}>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
          onFocus={() => setOpen(true)}
          placeholder="none (root level)"
          style={{ ...inputStyle, borderRight: 'none', flex: 1 }}
        />
        <button
          type="button"
          onClick={() => setOpen(!open)}
          style={{
            padding: '0 6px',
            fontSize: 10,
            background: 'rgba(0,0,0,0.4)',
            border: '1px solid #2a4a3a',
            color: '#6a8a7a',
            cursor: 'pointer',
            lineHeight: '20px',
          }}
        >
          {open ? '\u25B2' : '\u25BC'}
        </button>
      </div>
      {open && filtered.length > 0 && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          zIndex: 10,
          background: '#0b1a12',
          border: '1px solid #2a4a3a',
          borderTop: 'none',
          maxHeight: 100,
          overflowY: 'auto',
        }}>
          {/* Option to clear / use root level */}
          <div
            onClick={() => { onChange(''); setOpen(false); }}
            style={{
              padding: '3px 8px',
              fontSize: 9,
              color: value === '' ? '#90d898' : '#5a7a62',
              cursor: 'pointer',
              fontStyle: 'italic',
              background: value === '' ? 'rgba(50,90,60,0.2)' : 'transparent',
            }}
            onMouseEnter={(e) => { (e.target as HTMLDivElement).style.background = 'rgba(50,90,60,0.3)'; }}
            onMouseLeave={(e) => { (e.target as HTMLDivElement).style.background = value === '' ? 'rgba(50,90,60,0.2)' : 'transparent'; }}
          >
            (none — root level)
          </div>
          {filtered.map((opt) => (
            <div
              key={opt}
              onClick={() => { onChange(opt); setOpen(false); }}
              style={{
                padding: '3px 8px',
                fontSize: 9,
                color: value === opt ? '#90d898' : '#a0c090',
                cursor: 'pointer',
                background: value === opt ? 'rgba(50,90,60,0.2)' : 'transparent',
              }}
              onMouseEnter={(e) => { (e.target as HTMLDivElement).style.background = 'rgba(50,90,60,0.3)'; }}
              onMouseLeave={(e) => { (e.target as HTMLDivElement).style.background = value === opt ? 'rgba(50,90,60,0.2)' : 'transparent'; }}
            >
              {opt}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const CreateSkillWizard: FC<{
  onClose: () => void;
  onCreate: (req: CreateSkillRequest) => void;
}> = ({ onClose, onCreate }) => {
  const [form, setForm] = useState<CreateSkillRequest>({ ...EMPTY_FORM });
  const [step, setStep] = useState<'template' | 'edit' | 'preview'>('template');

  // Derive existing category folders from installed skills
  const skills = useCommandCenterStore((s) => s.skills);
  const existingCategories = Array.from(
    new Set(skills.map((s) => s.category).filter((c): c is string => !!c)),
  ).sort();

  const update = <K extends keyof CreateSkillRequest>(key: K, value: CreateSkillRequest[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const applyTemplate = (tmpl: typeof TEMPLATES[number]) => {
    setForm({ ...EMPTY_FORM, ...tmpl.apply() });
    setStep('edit');
  };

  const nameValid = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(form.name);
  const categoryValid = !form.category || /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(form.category);
  const canCreate = nameValid && categoryValid && form.name.length > 0;

  const skillPath = buildSkillPath(form.scope, form.category, form.name);

  return (
    <div style={{ padding: 2 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#90d898', letterSpacing: '0.04em' }}>
          {step === 'template' ? 'Choose Template' : step === 'edit' ? 'Configure Skill' : 'Preview'}
        </span>
        <button type="button" onClick={onClose} style={{
          background: 'none', border: '1px solid #2a4a3a', color: '#6a7a72', cursor: 'pointer', fontSize: 10, padding: '1px 6px',
        }}>{'\u2715'}</button>
      </div>

      {/* Step 1: Template */}
      {step === 'template' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          {TEMPLATES.map((t) => (
            <button
              key={t.label}
              type="button"
              onClick={() => applyTemplate(t)}
              style={{
                padding: '8px 6px',
                background: 'rgba(0,0,0,0.3)',
                border: '1px solid #2a4a3a',
                color: '#8fc08a',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <div style={{ fontSize: 10, fontWeight: 600 }}>{t.label}</div>
              <div style={{ fontSize: 8, color: '#5a7a62', marginTop: 2 }}>{t.desc}</div>
            </button>
          ))}
        </div>
      )}

      {/* Step 2: Edit */}
      {step === 'edit' && (
        <>
          <div style={sectionStyle}>
            <label style={labelStyle}>Name (kebab-case)</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => update('name', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              placeholder="my-skill"
              style={{ ...inputStyle, borderColor: form.name && !nameValid ? '#c65858' : '#2a4a3a' }}
            />
          </div>

          <div style={sectionStyle}>
            <label style={labelStyle}>Description</label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => update('description', e.target.value)}
              placeholder="What this skill does"
              style={inputStyle}
            />
          </div>

          <div style={sectionStyle}>
            <label style={labelStyle}>Category (optional folder)</label>
            <CategoryCombobox
              value={form.category}
              onChange={(val) => update('category', val)}
              options={existingCategories}
            />
            {form.category && !categoryValid && (
              <div style={{ fontSize: 7, color: '#c65858', marginTop: 2 }}>Must be kebab-case (a-z, 0-9, hyphens)</div>
            )}
            <div style={{ fontSize: 7, color: '#4a6a52', marginTop: 2 }}>
              Groups skills into folders. Leave empty for root level.
            </div>
          </div>

          <div style={sectionStyle}>
            <label style={labelStyle}>Scope</label>
            <select
              value={form.scope}
              onChange={(e) => update('scope', e.target.value as 'personal' | 'project')}
              style={{ ...inputStyle, padding: '3px 4px' }}
            >
              <option value="project">Project (.claude/skills/)</option>
              <option value="personal">Personal (~/.claude/skills/)</option>
            </select>
          </div>

          <div style={{ display: 'flex', gap: 12, ...sectionStyle }}>
            <label style={{ fontSize: 9, color: '#7a9a82', display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="checkbox" checked={form.userInvocable} onChange={(e) => update('userInvocable', e.target.checked)} />
              User-invocable
            </label>
            <label style={{ fontSize: 9, color: '#7a9a82', display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="checkbox" checked={form.disableModelInvocation} onChange={(e) => update('disableModelInvocation', e.target.checked)} />
              Disable auto-invoke
            </label>
          </div>

          <div style={sectionStyle}>
            <label style={labelStyle}>Argument hint (optional)</label>
            <input type="text" value={form.argumentHint} onChange={(e) => update('argumentHint', e.target.value)} placeholder="e.g. [file-path]" style={inputStyle} />
          </div>

          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setStep('template')} style={{
              padding: '3px 10px', fontSize: 9, border: '1px solid #2a4a3a', background: 'transparent', color: '#6a7a72', cursor: 'pointer',
            }}>Back</button>
            <button type="button" onClick={() => setStep('preview')} disabled={!canCreate} style={{
              padding: '3px 10px', fontSize: 9, border: `1px solid ${canCreate ? '#3a6a4a' : '#2a4a3a'}`,
              background: canCreate ? 'rgba(50,90,60,0.35)' : 'transparent',
              color: canCreate ? '#8fc08a' : '#4a5a52', cursor: canCreate ? 'pointer' : 'default',
            }}>Preview</button>
          </div>
        </>
      )}

      {/* Step 3: Preview */}
      {step === 'preview' && (
        <>
          <pre style={{
            fontSize: 9,
            color: '#8ab880',
            background: 'rgba(0,0,0,0.4)',
            border: '1px solid #2a4a3a',
            padding: 6,
            whiteSpace: 'pre-wrap',
            fontFamily: 'Consolas, monospace',
            maxHeight: 180,
            overflowY: 'auto',
            marginBottom: 8,
          }}>
            {generateSkillMd(form)}
          </pre>

          <div style={{ fontSize: 8, color: '#5a7a62', marginBottom: 8 }}>
            Will create: <span style={{ color: '#8ab880' }}>{skillPath}</span>
          </div>

          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setStep('edit')} style={{
              padding: '3px 10px', fontSize: 9, border: '1px solid #2a4a3a', background: 'transparent', color: '#6a7a72', cursor: 'pointer',
            }}>Back</button>
            <button type="button" onClick={() => onCreate(form)} style={{
              padding: '3px 12px', fontSize: 9, border: '1px solid #50aa70',
              background: 'rgba(50,120,70,0.4)', color: '#b0f0c0', cursor: 'pointer',
              fontWeight: 600,
            }}>Create Skill</button>
          </div>
        </>
      )}
    </div>
  );
};

export { generateSkillMd, buildSkillPath };
