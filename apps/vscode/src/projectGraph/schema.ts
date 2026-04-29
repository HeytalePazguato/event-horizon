/**
 * Project Graph schema — code & knowledge graph tables.
 * Lives alongside the existing events/knowledge schema in EventHorizonDB.
 *
 * - graph_nodes: typed entities (function, class, module, doc_section, ...)
 * - graph_edges: typed relations between nodes (calls, imports, references, ...)
 * - graph_file_state: per-file extraction state for hash-based skip
 * - graph_nodes_fts: FTS5 virtual table for substring/keyword search
 */

export const GRAPH_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS graph_nodes (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  type TEXT NOT NULL,
  source_file TEXT,
  source_location TEXT,
  properties TEXT NOT NULL DEFAULT '{}',
  tag TEXT NOT NULL DEFAULT 'EXTRACTED',
  confidence REAL NOT NULL DEFAULT 1.0,
  workspace TEXT,
  content_hash TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_type ON graph_nodes(type);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_file ON graph_nodes(source_file);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_workspace ON graph_nodes(workspace);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_label ON graph_nodes(label);

CREATE TABLE IF NOT EXISTS graph_edges (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  tag TEXT NOT NULL DEFAULT 'EXTRACTED',
  confidence REAL NOT NULL DEFAULT 1.0,
  source_file TEXT,
  source_location TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_graph_edges_source ON graph_edges(source_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_target ON graph_edges(target_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_relation ON graph_edges(relation_type);

CREATE TABLE IF NOT EXISTS graph_file_state (
  source_file TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL,
  last_extracted INTEGER NOT NULL,
  extractor TEXT NOT NULL,
  node_count INTEGER NOT NULL DEFAULT 0
);

CREATE VIRTUAL TABLE IF NOT EXISTS graph_nodes_fts USING fts5(
  id, label, type, properties,
  content=graph_nodes, content_rowid=rowid
);
`;

/**
 * Idempotent DROP for the four graph tables. Used once during the upgrade
 * from v3.0.0-dev (graph stored in the global EventHorizonDB) to v3.0.0
 * release (graph stored per-project at `<workspace>/.eh/graph.db`).
 *
 * Safe to run on a DB that doesn't have these tables — the `IF EXISTS`
 * clauses make every statement a no-op when the table is absent.
 */
export const GRAPH_SCHEMA_DROP_SQL = `
DROP TABLE IF EXISTS graph_nodes_fts;
DROP TABLE IF EXISTS graph_file_state;
DROP TABLE IF EXISTS graph_edges;
DROP TABLE IF EXISTS graph_nodes;
`;
