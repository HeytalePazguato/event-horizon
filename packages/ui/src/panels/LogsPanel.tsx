/**
 * Full-height Logs panel for Operations view.
 * Filterable, searchable, auto-scrolling event log.
 * @event-horizon/ui
 */

import type { FC } from 'react';
import { useState, useRef, useEffect, useMemo } from 'react';
import { useCommandCenterStore } from '../store.js';
import type { LogEntry } from '../store.js';

const EVENT_TYPES = ['agent.spawn', 'agent.terminate', 'task.start', 'task.complete', 'tool.call', 'tool.result', 'file.read', 'file.write', 'agent.error', 'data.transfer'];

export interface PersistedSearchResult {
  id: string;
  type: string;
  agentId: string;
  agentName?: string;
  agentType?: string;
  timestamp: number;
  payload?: Record<string, unknown>;
}

export interface LogsPanelProps {
  /** Callback to trigger a persistence-backed search (queries the SQLite DB via webview message). */
  onPersistedSearch?: (query: string, opts?: { agentId?: string; type?: string; since?: number }) => void;
  /** Results from the last persisted search — when non-null, replaces live feed. */
  persistedResults?: PersistedSearchResult[] | null;
  /** Callback to clear persisted search and return to live mode. */
  onClearPersistedSearch?: () => void;
}

export const LogsPanel: FC<LogsPanelProps> = ({ onPersistedSearch, persistedResults, onClearPersistedSearch }) => {
  const allLogs = useCommandCenterStore((s) => s.logs);
  const selectedAgentId = useCommandCenterStore((s) => s.selectedAgentId);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());
  const [pinBottom, setPinBottom] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const isPersistedMode = persistedResults != null;

  // Filter logs
  const filteredLogs = useMemo(() => {
    let logs = selectedAgentId ? allLogs.filter((l) => l.agentId === selectedAgentId) : allLogs;
    if (typeFilter.size > 0) logs = logs.filter((l) => typeFilter.has(l.type));
    if (search) {
      const q = search.toLowerCase();
      logs = logs.filter((l) =>
        l.agentName.toLowerCase().includes(q) ||
        l.type.toLowerCase().includes(q) ||
        (l.skillName?.toLowerCase().includes(q) ?? false)
      );
    }
    return logs;
  }, [allLogs, selectedAgentId, typeFilter, search]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (pinBottom && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filteredLogs.length, pinBottom]);

  const toggleTypeFilter = (type: string) => {
    setTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const copyLog = (entry: LogEntry) => {
    void navigator.clipboard.writeText(JSON.stringify(entry, null, 2)).catch(() => {});
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: 'Consolas, monospace' }}>
      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', flexShrink: 0, flexWrap: 'wrap' }}>
        {/* Search — local filter on type/Enter triggers persisted DB search */}
        <input
          type="text"
          placeholder={onPersistedSearch ? 'Search (Enter = DB search)' : 'Search logs...'}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && onPersistedSearch && search.trim().length > 0) {
              onPersistedSearch(search.trim(), {
                agentId: selectedAgentId ?? undefined,
                type: typeFilter.size === 1 ? Array.from(typeFilter)[0] : undefined,
              });
            }
          }}
          style={{
            padding: '4px 8px',
            border: `1px solid ${isPersistedMode ? '#3870c0' : '#1e4030'}`,
            borderRadius: 2,
            background: isPersistedMode ? '#0a1828' : '#0a1810',
            color: '#90b088',
            fontSize: 12,
            fontFamily: 'Consolas, monospace',
            width: 200,
            outline: 'none',
          }}
        />
        {isPersistedMode && (
          <button
            type="button"
            onClick={() => { setSearch(''); onClearPersistedSearch?.(); }}
            style={{
              padding: '2px 8px', border: '1px solid #3870c0', borderRadius: 2,
              background: '#0a1828', color: '#88aacc', fontSize: 11,
              fontFamily: 'Consolas, monospace', cursor: 'pointer',
            }}
            title="Return to live log feed"
          >
            ✕ Clear search ({persistedResults?.length ?? 0} results)
          </button>
        )}

        {/* Type filter chips */}
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
          {EVENT_TYPES.map((t) => {
            const active = typeFilter.has(t);
            const short = t.split('.').pop() ?? t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => toggleTypeFilter(t)}
                style={{
                  padding: '2px 6px',
                  border: `1px solid ${active ? '#25904a' : '#1a3020'}`,
                  borderRadius: 2,
                  background: active ? '#1a3828' : 'transparent',
                  color: active ? '#60d080' : '#3a6a48',
                  fontSize: 12,
                  fontFamily: 'Consolas, monospace',
                  cursor: 'pointer',
                }}
              >
                {short}
              </button>
            );
          })}
        </div>

        {/* Pin toggle */}
        <button
          type="button"
          onClick={() => setPinBottom((p) => !p)}
          style={{
            marginLeft: 'auto',
            padding: '2px 8px',
            border: `1px solid ${pinBottom ? '#25904a' : '#1a3020'}`,
            borderRadius: 2,
            background: pinBottom ? '#1a3828' : 'transparent',
            color: pinBottom ? '#60d080' : '#3a6a48',
            fontSize: 12,
            fontFamily: 'Consolas, monospace',
            cursor: 'pointer',
          }}
        >
          Auto-scroll
        </button>

        <span style={{ fontSize: 12, color: isPersistedMode ? '#88aacc' : '#4a6a58' }}>
          {isPersistedMode ? `${persistedResults?.length ?? 0} search results` : `${filteredLogs.length} entries`}
        </span>
      </div>

      {/* Log entries — show persisted results when search is active, else live filtered logs */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {isPersistedMode ? (
          (persistedResults?.length ?? 0) === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: '#3a5a48', fontSize: 11 }}>
              No persisted events match &quot;{search}&quot;.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #1a3020', position: 'sticky', top: 0, background: '#080e0a', zIndex: 1 }}>
                  <th style={{ textAlign: 'left', padding: '4px 8px', color: '#88aacc', fontSize: 12, fontWeight: 600 }}>Time</th>
                  <th style={{ textAlign: 'left', padding: '4px 8px', color: '#88aacc', fontSize: 12, fontWeight: 600 }}>Agent</th>
                  <th style={{ textAlign: 'left', padding: '4px 8px', color: '#88aacc', fontSize: 12, fontWeight: 600 }}>Event</th>
                  <th style={{ textAlign: 'left', padding: '4px 8px', color: '#88aacc', fontSize: 12, fontWeight: 600 }}>Payload</th>
                </tr>
              </thead>
              <tbody>
                {persistedResults!.map((evt) => (
                  <tr
                    key={evt.id}
                    onClick={() => void navigator.clipboard.writeText(JSON.stringify(evt, null, 2)).catch(() => {})}
                    title="Click to copy"
                    style={{ borderBottom: '1px solid rgba(30,60,80,0.3)', cursor: 'pointer' }}
                  >
                    <td style={{ padding: '3px 8px', fontSize: 12, color: '#88aacc', whiteSpace: 'nowrap' }}>{new Date(evt.timestamp).toLocaleString()}</td>
                    <td style={{ padding: '3px 8px', fontSize: 12, color: '#aaccdd' }}>{evt.agentName ?? evt.agentId}</td>
                    <td style={{ padding: '3px 8px', fontSize: 12, color: '#88c0ff' }}>{evt.type}</td>
                    <td style={{ padding: '3px 8px', fontSize: 11, color: '#6680aa', maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {evt.payload ? JSON.stringify(evt.payload).slice(0, 80) : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : filteredLogs.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: '#3a5a48', fontSize: 11 }}>
            No log entries{search || typeFilter.size > 0 ? ' matching filters' : ' yet'}.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1a3020', position: 'sticky', top: 0, background: '#080e0a', zIndex: 1 }}>
                <th style={{ textAlign: 'left', padding: '4px 8px', color: '#4a7a58', fontSize: 12, fontWeight: 600 }}>Time</th>
                <th style={{ textAlign: 'left', padding: '4px 8px', color: '#4a7a58', fontSize: 12, fontWeight: 600 }}>Agent</th>
                <th style={{ textAlign: 'left', padding: '4px 8px', color: '#4a7a58', fontSize: 12, fontWeight: 600 }}>Event</th>
                <th style={{ textAlign: 'left', padding: '4px 8px', color: '#4a7a58', fontSize: 12, fontWeight: 600 }}>Skill</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.map((entry) => (
                <tr
                  key={entry.id}
                  onClick={() => copyLog(entry)}
                  title="Click to copy"
                  style={{ borderBottom: '1px solid rgba(30,60,40,0.2)', cursor: 'pointer' }}
                >
                  <td style={{ padding: '3px 8px', fontSize: 12, color: '#4a8a6a', whiteSpace: 'nowrap' }}>{entry.ts}</td>
                  <td style={{ padding: '3px 8px', fontSize: 12, color: '#8ab880' }}>{entry.agentName}</td>
                  <td style={{ padding: '3px 8px', fontSize: 12, color: entry.skillName ? '#44ddff' : '#a0c090' }}>{entry.type}</td>
                  <td style={{ padding: '3px 8px', fontSize: 12, color: '#44ddff' }}>{entry.skillName ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
