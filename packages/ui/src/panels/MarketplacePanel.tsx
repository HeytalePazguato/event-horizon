/**
 * Skills Marketplace browser — browse, search, and add marketplace sources.
 * @event-horizon/ui
 *
 * Supports two marketplace types:
 * - 'browse': opens the marketplace URL in the user's browser
 * - 'api': renders inline search results (SkillHub)
 */

import type { FC } from 'react';
import { useState } from 'react';
import { useCommandCenterStore } from '../store.js';
import type { MarketplaceEntry, MarketplaceSkillResult } from '../store.js';

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

const TYPE_COLORS: Record<string, string> = {
  api: '#6ab0d4',
  browse: '#cc88ff',
};

const MarketplaceCard: FC<{
  entry: MarketplaceEntry;
  isDefault: boolean;
  onBrowse: (url: string) => void;
  onSearch: (url: string, query: string) => void;
  onRemove: (url: string) => void;
  searchResults?: MarketplaceSkillResult[];
  searchLoading?: boolean;
  onInstallSkill?: (result: MarketplaceSkillResult) => void;
}> = ({ entry, isDefault, onBrowse, onSearch, onRemove, searchResults, searchLoading, onInstallSkill }) => {
  const [query, setQuery] = useState('');

  return (
    <div style={{
      padding: '6px 8px',
      background: 'rgba(0,0,0,0.25)',
      border: '1px solid #1e3328',
      marginBottom: 4,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 600, color: '#8fc08a', flex: 1 }}>
          {entry.name}
        </span>
        <span style={{
          fontSize: 7,
          padding: '0 4px',
          background: `${TYPE_COLORS[entry.type] ?? '#6a7a72'}22`,
          border: `1px solid ${TYPE_COLORS[entry.type] ?? '#6a7a72'}44`,
          color: TYPE_COLORS[entry.type] ?? '#6a7a72',
          borderRadius: 2,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}>
          {entry.type}
        </span>
        {!isDefault && (
          <button
            type="button"
            onClick={() => onRemove(entry.url)}
            title="Remove marketplace"
            style={{
              background: 'none',
              border: '1px solid #4a2a2a',
              color: '#a06060',
              cursor: 'pointer',
              fontSize: 8,
              padding: '0 4px',
              lineHeight: '14px',
            }}
          >
            &#x2715;
          </button>
        )}
      </div>
      <div style={{ fontSize: 8, color: '#5a7a62', marginTop: 2, wordBreak: 'break-all' }}>
        {entry.url}
      </div>

      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
        {entry.type === 'api' ? (
          <>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && query.trim()) onSearch(entry.url, query.trim()); }}
              placeholder="Search skills..."
              style={{ ...inputStyle, flex: 1, padding: '2px 6px', fontSize: 9 }}
            />
            <button
              type="button"
              onClick={() => { if (query.trim()) onSearch(entry.url, query.trim()); }}
              disabled={!query.trim()}
              style={{
                padding: '2px 8px',
                fontSize: 8,
                border: `1px solid ${query.trim() ? '#3a6a4a' : '#2a4a3a'}`,
                background: query.trim() ? 'rgba(50,90,60,0.3)' : 'transparent',
                color: query.trim() ? '#8fc08a' : '#4a5a52',
                cursor: query.trim() ? 'pointer' : 'default',
              }}
            >
              Search
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => onBrowse(entry.url)}
            style={{
              padding: '2px 10px',
              fontSize: 8,
              border: '1px solid #3a6a4a',
              background: 'rgba(50,90,60,0.3)',
              color: '#8fc08a',
              cursor: 'pointer',
            }}
          >
            Open in Browser
          </button>
        )}
      </div>

      {/* Search results (API marketplaces) */}
      {searchLoading && (
        <div style={{ fontSize: 8, color: '#6a8a7a', marginTop: 4, fontStyle: 'italic' }}>
          Searching...
        </div>
      )}
      {searchResults && searchResults.length > 0 && (
        <div style={{ marginTop: 4, maxHeight: 120, overflowY: 'auto' }}>
          {searchResults.map((result) => (
            <div key={result.url} style={{
              padding: '3px 6px',
              background: 'rgba(0,0,0,0.2)',
              border: '1px solid #1a2a22',
              marginBottom: 2,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 9, fontWeight: 600, color: '#8ab880', flex: 1 }}>
                  {result.name}
                </span>
                <span style={{ fontSize: 7, color: '#5a7a62' }}>{result.author}</span>
              </div>
              <div style={{ fontSize: 8, color: '#6a8a6a', marginTop: 1 }}>
                {result.description}
              </div>
              <div style={{ display: 'flex', gap: 4, marginTop: 3 }}>
                <button
                  type="button"
                  onClick={() => onBrowse(result.url)}
                  style={{
                    padding: '1px 6px',
                    fontSize: 7,
                    border: '1px solid #2a4a3a',
                    background: 'transparent',
                    color: '#6a8a7a',
                    cursor: 'pointer',
                  }}
                >
                  View
                </button>
                {onInstallSkill && (
                  <button
                    type="button"
                    onClick={() => onInstallSkill(result)}
                    style={{
                      padding: '1px 6px',
                      fontSize: 7,
                      border: '1px solid #3a6a4a',
                      background: 'rgba(50,90,60,0.3)',
                      color: '#8fc08a',
                      cursor: 'pointer',
                    }}
                  >
                    Install
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {searchResults && searchResults.length === 0 && !searchLoading && (
        <div style={{ fontSize: 8, color: '#5a6a52', marginTop: 4 }}>
          No results found.
        </div>
      )}
    </div>
  );
};

export interface MarketplacePanelProps {
  onClose: () => void;
  onBrowse: (url: string) => void;
  onSearch: (marketplaceUrl: string, query: string) => void;
  onInstallSkill?: (result: MarketplaceSkillResult) => void;
  searchResults?: MarketplaceSkillResult[];
  searchLoading?: boolean;
  searchSource?: string;
}

export const MarketplacePanel: FC<MarketplacePanelProps> = ({
  onClose,
  onBrowse,
  onSearch,
  onInstallSkill,
  searchResults,
  searchLoading,
  searchSource,
}) => {
  const marketplaces = useCommandCenterStore((s) => s.registeredMarketplaces);
  const addMarketplace = useCommandCenterStore((s) => s.addMarketplace);
  const removeMarketplace = useCommandCenterStore((s) => s.removeMarketplace);

  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newType, setNewType] = useState<'browse' | 'api'>('browse');

  const handleAdd = () => {
    if (!newName.trim() || !newUrl.trim()) return;
    let url = newUrl.trim();
    if (!/^https?:\/\//.test(url)) url = 'https://' + url;
    addMarketplace({ name: newName.trim(), url, type: newType });
    setNewName('');
    setNewUrl('');
    setNewType('browse');
    setShowAdd(false);
  };

  // Default marketplace URLs (cannot be removed)
  const defaultUrls = new Set([
    'https://www.skillhub.club/',
    'https://skillsmp.com',
    'https://github.com/anthropics/skills',
    'https://mcpmarket.com/tools/skills',
  ]);

  return (
    <div style={{ padding: 2 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#90d898', letterSpacing: '0.04em' }}>
          Skills Marketplace
        </span>
        <button type="button" onClick={onClose} style={{
          background: 'none', border: '1px solid #2a4a3a', color: '#6a7a72', cursor: 'pointer', fontSize: 10, padding: '1px 6px',
        }}>&#x2715;</button>
      </div>

      <div style={{ fontSize: 8, color: '#5a7a62', marginBottom: 8 }}>
        Browse skills from registered marketplaces. API sources support inline search; others open in your browser.
      </div>

      {/* Marketplace list */}
      <div style={{ maxHeight: 'min(340px, 55vh)', overflowY: 'auto', marginBottom: 8 }}>
        {marketplaces.map((entry) => (
          <MarketplaceCard
            key={entry.url}
            entry={entry}
            isDefault={defaultUrls.has(entry.url)}
            onBrowse={onBrowse}
            onSearch={onSearch}
            onRemove={removeMarketplace}
            searchResults={searchSource === entry.url ? searchResults : undefined}
            searchLoading={searchSource === entry.url ? searchLoading : undefined}
            onInstallSkill={onInstallSkill}
          />
        ))}
      </div>

      {/* Add marketplace */}
      {!showAdd ? (
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          style={{
            width: '100%',
            padding: '4px 8px',
            fontSize: 9,
            border: '1px dashed #3a6a4a',
            background: 'transparent',
            color: '#6a8a7a',
            cursor: 'pointer',
            textAlign: 'center',
          }}
        >
          + Add Marketplace
        </button>
      ) : (
        <div style={{
          padding: 6,
          border: '1px solid #2a4a3a',
          background: 'rgba(0,0,0,0.2)',
        }}>
          <div style={{ marginBottom: 4 }}>
            <label style={labelStyle}>Name</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="My Marketplace"
              style={{ ...inputStyle, fontSize: 9, padding: '2px 6px' }}
            />
          </div>
          <div style={{ marginBottom: 4 }}>
            <label style={labelStyle}>URL</label>
            <input
              type="text"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://example.com/skills"
              style={{ ...inputStyle, fontSize: 9, padding: '2px 6px' }}
            />
          </div>
          <div style={{ marginBottom: 6 }}>
            <label style={labelStyle}>Type</label>
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value as 'browse' | 'api')}
              style={{ ...inputStyle, fontSize: 9, padding: '2px 4px' }}
            >
              <option value="browse">Browse (opens in browser)</option>
              <option value="api">API (inline search)</option>
            </select>
          </div>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setShowAdd(false)} style={{
              padding: '2px 8px', fontSize: 8, border: '1px solid #2a4a3a', background: 'transparent', color: '#6a7a72', cursor: 'pointer',
            }}>Cancel</button>
            <button
              type="button"
              onClick={handleAdd}
              disabled={!newName.trim() || !newUrl.trim()}
              style={{
                padding: '2px 10px',
                fontSize: 8,
                border: `1px solid ${newName.trim() && newUrl.trim() ? '#3a6a4a' : '#2a4a3a'}`,
                background: newName.trim() && newUrl.trim() ? 'rgba(50,90,60,0.3)' : 'transparent',
                color: newName.trim() && newUrl.trim() ? '#8fc08a' : '#4a5a52',
                cursor: newName.trim() && newUrl.trim() ? 'pointer' : 'default',
              }}
            >Add</button>
          </div>
        </div>
      )}
    </div>
  );
};
