/**
 * Project Graph store — CRUD over graph_nodes, graph_edges, graph_file_state.
 *
 * Wraps a sql.js Database. The schema (`GRAPH_SCHEMA_SQL`) must already be
 * applied — `EventHorizonDB.init()` does this and exposes a store via
 * `getProjectGraphStore()`.
 *
 * Notable behaviors:
 * - upsertNode / upsertEdge use INSERT OR REPLACE keyed on id.
 * - graph_nodes_fts is an external-content FTS5 index — sync is manual:
 *   we delete the prior index entry (using the special `'delete'` insert)
 *   before each replace and insert the new entry afterwards. If FTS5 is
 *   unavailable (older sql.js builds), all sync calls are skipped silently
 *   and searchNodes falls back to LIKE.
 * - replaceFileNodes runs atomically per-file with a "shrink guard": if the
 *   new node count would be less than half the existing count it aborts
 *   without committing (the extractor probably crashed mid-file). Pass
 *   `force: true` to bypass.
 * - Edge cascade is app-level: when nodes are removed for a file, edges
 *   referencing those nodes are removed too.
 */

import type { Database, SqlValue } from 'sql.js';
import type {
  GraphNode,
  GraphEdge,
  GraphFileState,
  GraphNodeType,
  GraphTag,
  RelationType,
} from './index.js';

interface ExistingFtsRow {
  rowid: number;
  id: string;
  label: string;
  type: string;
  properties: string;
}

export class ProjectGraphStore {
  private db: Database;
  private ftsAvailable: boolean;
  private onMutate?: () => void;

  /**
   * @param db sql.js database with `GRAPH_SCHEMA_SQL` already applied.
   * @param onMutate Optional callback fired after every write (upsert/delete/clear).
   *   Used by `ProjectGraphDB` to flag the wrapping DB as dirty so the auto-save
   *   loop knows to flush. Existing call sites (where the global EventHorizonDB
   *   tracked dirty via event ingestion) can omit this argument.
   */
  constructor(db: Database, onMutate?: () => void) {
    this.db = db;
    this.ftsAvailable = this.detectFts();
    this.onMutate = onMutate;
  }

  private detectFts(): boolean {
    try {
      const res = this.db.exec(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='graph_nodes_fts'`,
      );
      return res.length > 0 && res[0].values.length > 0;
    } catch {
      return false;
    }
  }

  // ── Node CRUD ──────────────────────────────────────────────────────────

  upsertNode(node: GraphNode): void {
    const existing = this.readFtsRowByNodeId(node.id);
    if (existing) this.deleteFtsRow(existing);

    const propertiesJson = JSON.stringify(node.properties ?? {});
    this.db.run(
      `INSERT OR REPLACE INTO graph_nodes
       (id, label, type, source_file, source_location, properties, tag, confidence, workspace, content_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        node.id,
        node.label,
        node.type,
        node.sourceFile ?? null,
        node.sourceLocation ?? null,
        propertiesJson,
        node.tag,
        node.confidence,
        node.workspace ?? null,
        node.contentHash ?? null,
        node.createdAt,
        node.updatedAt,
      ],
    );

    this.insertFtsRow(node, propertiesJson);
    this.onMutate?.();
  }

  upsertEdge(edge: GraphEdge): void {
    this.db.run(
      `INSERT OR REPLACE INTO graph_edges
       (id, source_id, target_id, relation_type, tag, confidence, source_file, source_location, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        edge.id,
        edge.sourceId,
        edge.targetId,
        edge.relationType,
        edge.tag,
        edge.confidence,
        edge.sourceFile ?? null,
        edge.sourceLocation ?? null,
        edge.createdAt,
      ],
    );
    this.onMutate?.();
  }

  // ── Per-file atomic replace with shrink guard ──────────────────────────

  replaceFileNodes(
    file: string,
    extractor: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
    contentHash: string,
    opts?: { force?: boolean },
  ): { committed: boolean; deleted: number; reason?: string } {
    const existingNodes = this.getNodesByFile(file);
    const existingCount = existingNodes.length;

    if (
      existingCount > 0 &&
      nodes.length < existingCount * 0.5 &&
      !opts?.force
    ) {
      return { committed: false, deleted: 0, reason: 'shrink-guard' };
    }

    this.db.exec('BEGIN TRANSACTION');
    try {
      const existingIds = existingNodes.map((n) => n.id);

      // Drop FTS entries for the prior nodes.
      for (const n of existingNodes) {
        this.deleteFtsRow({
          rowid: this.lookupRowid(n.id) ?? -1,
          id: n.id,
          label: n.label,
          type: n.type,
          properties: JSON.stringify(n.properties ?? {}),
        });
      }

      // Delete prior nodes for this file.
      this.db.run(`DELETE FROM graph_nodes WHERE source_file = ?`, [file]);

      // Cascade-delete edges referencing those nodes (app-level join).
      if (existingIds.length > 0) {
        const placeholders = existingIds.map(() => '?').join(',');
        this.db.run(
          `DELETE FROM graph_edges
           WHERE source_id IN (${placeholders})
              OR target_id IN (${placeholders})`,
          [...existingIds, ...existingIds],
        );
      }
      // Also drop edges whose source_file matches (e.g. edges authored by
      // this file targeting nodes that live elsewhere).
      this.db.run(`DELETE FROM graph_edges WHERE source_file = ?`, [file]);

      // Insert new nodes + sync FTS.
      for (const node of nodes) {
        const propertiesJson = JSON.stringify(node.properties ?? {});
        this.db.run(
          `INSERT OR REPLACE INTO graph_nodes
           (id, label, type, source_file, source_location, properties, tag, confidence, workspace, content_hash, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            node.id,
            node.label,
            node.type,
            node.sourceFile ?? null,
            node.sourceLocation ?? null,
            propertiesJson,
            node.tag,
            node.confidence,
            node.workspace ?? null,
            node.contentHash ?? null,
            node.createdAt,
            node.updatedAt,
          ],
        );
        this.insertFtsRow(node, propertiesJson);
      }

      // Insert new edges.
      for (const edge of edges) {
        this.db.run(
          `INSERT OR REPLACE INTO graph_edges
           (id, source_id, target_id, relation_type, tag, confidence, source_file, source_location, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            edge.id,
            edge.sourceId,
            edge.targetId,
            edge.relationType,
            edge.tag,
            edge.confidence,
            edge.sourceFile ?? null,
            edge.sourceLocation ?? null,
            edge.createdAt,
          ],
        );
      }

      // Update file state.
      this.db.run(
        `INSERT OR REPLACE INTO graph_file_state
         (source_file, content_hash, last_extracted, extractor, node_count)
         VALUES (?, ?, ?, ?, ?)`,
        [file, contentHash, Date.now(), extractor, nodes.length],
      );

      this.db.exec('COMMIT');
      this.onMutate?.();
      return { committed: true, deleted: existingCount };
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        /* rollback best-effort */
      }
      throw err;
    }
  }

  deleteFile(file: string): void {
    const nodes = this.getNodesByFile(file);
    const ids = nodes.map((n) => n.id);

    this.db.exec('BEGIN TRANSACTION');
    try {
      for (const n of nodes) {
        this.deleteFtsRow({
          rowid: this.lookupRowid(n.id) ?? -1,
          id: n.id,
          label: n.label,
          type: n.type,
          properties: JSON.stringify(n.properties ?? {}),
        });
      }
      this.db.run(`DELETE FROM graph_nodes WHERE source_file = ?`, [file]);
      if (ids.length > 0) {
        const placeholders = ids.map(() => '?').join(',');
        this.db.run(
          `DELETE FROM graph_edges
           WHERE source_id IN (${placeholders})
              OR target_id IN (${placeholders})`,
          [...ids, ...ids],
        );
      }
      this.db.run(`DELETE FROM graph_edges WHERE source_file = ?`, [file]);
      this.db.run(`DELETE FROM graph_file_state WHERE source_file = ?`, [file]);
      this.db.exec('COMMIT');
      this.onMutate?.();
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        /* rollback best-effort */
      }
      throw err;
    }
  }

  // ── Reads ──────────────────────────────────────────────────────────────

  getFileState(file: string): GraphFileState | null {
    const stmt = this.db.prepare(
      `SELECT source_file, content_hash, last_extracted, extractor, node_count
       FROM graph_file_state WHERE source_file = ?`,
    );
    stmt.bind([file]);
    const found = stmt.step();
    const row = found ? stmt.getAsObject() : null;
    stmt.free();
    if (!row) return null;
    return {
      sourceFile: row['source_file'] as string,
      contentHash: row['content_hash'] as string,
      lastExtracted: row['last_extracted'] as number,
      extractor: row['extractor'] as string,
      nodeCount: row['node_count'] as number,
    };
  }

  getNodesByFile(file: string): GraphNode[] {
    const stmt = this.db.prepare(
      `SELECT * FROM graph_nodes WHERE source_file = ? ORDER BY created_at ASC`,
    );
    stmt.bind([file]);
    const nodes: GraphNode[] = [];
    while (stmt.step()) nodes.push(rowToNode(stmt.getAsObject()));
    stmt.free();
    return nodes;
  }

  getNodeById(id: string): GraphNode | null {
    const stmt = this.db.prepare(`SELECT * FROM graph_nodes WHERE id = ?`);
    stmt.bind([id]);
    const found = stmt.step();
    const row = found ? stmt.getAsObject() : null;
    stmt.free();
    return row ? rowToNode(row) : null;
  }

  getEdges(opts: {
    sourceId?: string;
    targetId?: string;
    relationType?: string;
    limit?: number;
  } = {}): GraphEdge[] {
    const conditions: string[] = [];
    const params: SqlValue[] = [];

    if (opts.sourceId) {
      conditions.push('source_id = ?');
      params.push(opts.sourceId);
    }
    if (opts.targetId) {
      conditions.push('target_id = ?');
      params.push(opts.targetId);
    }
    if (opts.relationType) {
      conditions.push('relation_type = ?');
      params.push(opts.relationType);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = opts.limit ?? 1000;
    const sql = `SELECT * FROM graph_edges ${where} ORDER BY created_at ASC LIMIT ?`;

    const stmt = this.db.prepare(sql);
    stmt.bind([...params, limit]);

    const edges: GraphEdge[] = [];
    while (stmt.step()) edges.push(rowToEdge(stmt.getAsObject()));
    stmt.free();
    return edges;
  }

  searchNodes(
    query: string,
    opts: { type?: string; tag?: string; limit?: number } = {},
  ): GraphNode[] {
    const limit = opts.limit ?? 50;

    if (this.ftsAvailable && query.trim().length > 0) {
      try {
        const stmt = this.db.prepare(
          `SELECT n.*
           FROM graph_nodes n
           JOIN graph_nodes_fts fts ON n.rowid = fts.rowid
           WHERE graph_nodes_fts MATCH ?
           ORDER BY rank
           LIMIT ?`,
        );
        stmt.bind([query, limit * 4]);
        const results: GraphNode[] = [];
        while (stmt.step()) results.push(rowToNode(stmt.getAsObject()));
        stmt.free();
        return applyNodeFilters(results, opts).slice(0, limit);
      } catch {
        // FTS query parse error — fall through to LIKE.
      }
    }

    // Fallback: LIKE search on label.
    const like = `%${query}%`;
    const stmt = this.db.prepare(
      `SELECT * FROM graph_nodes WHERE label LIKE ? OR id LIKE ? LIMIT ?`,
    );
    stmt.bind([like, like, limit * 4]);
    const results: GraphNode[] = [];
    while (stmt.step()) results.push(rowToNode(stmt.getAsObject()));
    stmt.free();
    return applyNodeFilters(results, opts).slice(0, limit);
  }

  getStats(): { nodeCount: number; edgeCount: number; fileCount: number } {
    const nodeCount = countOf(this.db, 'graph_nodes');
    const edgeCount = countOf(this.db, 'graph_edges');
    const fileCount = countOf(this.db, 'graph_file_state');
    return { nodeCount, edgeCount, fileCount };
  }

  getTrackedFiles(): string[] {
    const stmt = this.db.prepare(`SELECT source_file FROM graph_file_state`);
    const files: string[] = [];
    while (stmt.step()) files.push(stmt.getAsObject()['source_file'] as string);
    stmt.free();
    return files;
  }

  listNodes(opts: { type?: GraphNodeType; tag?: GraphTag; offset: number; limit: number }): { nodes: GraphNode[]; total: number } {
    const conditions: string[] = [];
    const params: SqlValue[] = [];
    if (opts.type) { conditions.push('type = ?'); params.push(opts.type); }
    if (opts.tag) { conditions.push('tag = ?'); params.push(opts.tag); }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countStmt = this.db.prepare(`SELECT COUNT(*) as c FROM graph_nodes ${where}`);
    if (params.length > 0) countStmt.bind(params);
    const countFound = countStmt.step();
    const total = countFound ? ((countStmt.getAsObject()['c'] as number) ?? 0) : 0;
    countStmt.free();

    const stmt = this.db.prepare(`SELECT * FROM graph_nodes ${where} ORDER BY created_at ASC LIMIT ? OFFSET ?`);
    stmt.bind([...params, opts.limit, opts.offset]);
    const nodes: GraphNode[] = [];
    while (stmt.step()) nodes.push(rowToNode(stmt.getAsObject()));
    stmt.free();
    return { nodes, total };
  }

  /** Drop every row from every graph table. Used by force rebuilds to recover
   *  from polluted scans (e.g. wrong workspace folder). FTS5 rows are removed
   *  via the special 'delete-all' command when available. */
  clearAll(): void {
    this.db.run(`DELETE FROM graph_nodes`);
    this.db.run(`DELETE FROM graph_edges`);
    this.db.run(`DELETE FROM graph_file_state`);
    if (this.ftsAvailable) {
      try {
        this.db.run(`INSERT INTO graph_nodes_fts(graph_nodes_fts) VALUES('delete-all')`);
      } catch { /* FTS rebuild on next insert */ }
    }
    this.onMutate?.();
  }

  deleteNode(id: string): void {
    const existing = this.readFtsRowByNodeId(id);
    if (existing) this.deleteFtsRow(existing);
    this.db.run(`DELETE FROM graph_nodes WHERE id = ?`, [id]);
    this.onMutate?.();
  }

  deleteEdge(id: string): void {
    this.db.run(`DELETE FROM graph_edges WHERE id = ?`, [id]);
    this.onMutate?.();
  }

  // ── FTS sync helpers ───────────────────────────────────────────────────

  private lookupRowid(nodeId: string): number | null {
    const stmt = this.db.prepare(`SELECT rowid FROM graph_nodes WHERE id = ?`);
    stmt.bind([nodeId]);
    const found = stmt.step();
    const rowid = found ? (stmt.getAsObject()['rowid'] as number) : null;
    stmt.free();
    return rowid;
  }

  private readFtsRowByNodeId(nodeId: string): ExistingFtsRow | null {
    const stmt = this.db.prepare(
      `SELECT rowid, id, label, type, properties FROM graph_nodes WHERE id = ?`,
    );
    stmt.bind([nodeId]);
    const found = stmt.step();
    if (!found) {
      stmt.free();
      return null;
    }
    const row = stmt.getAsObject();
    stmt.free();
    return {
      rowid: row['rowid'] as number,
      id: row['id'] as string,
      label: row['label'] as string,
      type: row['type'] as string,
      properties: row['properties'] as string,
    };
  }

  private deleteFtsRow(row: ExistingFtsRow): void {
    if (!this.ftsAvailable || row.rowid < 0) return;
    try {
      this.db.run(
        `INSERT INTO graph_nodes_fts(graph_nodes_fts, rowid, id, label, type, properties)
         VALUES('delete', ?, ?, ?, ?, ?)`,
        [row.rowid, row.id, row.label, row.type, row.properties],
      );
    } catch {
      /* FTS sync best-effort */
    }
  }

  private insertFtsRow(node: GraphNode, propertiesJson: string): void {
    if (!this.ftsAvailable) return;
    const rowid = this.lookupRowid(node.id);
    if (rowid === null) return;
    try {
      this.db.run(
        `INSERT INTO graph_nodes_fts(rowid, id, label, type, properties)
         VALUES(?, ?, ?, ?, ?)`,
        [rowid, node.id, node.label, node.type, propertiesJson],
      );
    } catch {
      /* FTS sync best-effort */
    }
  }
}

// ── Row mappers ──────────────────────────────────────────────────────────

function rowToNode(row: Record<string, SqlValue>): GraphNode {
  let properties: Record<string, unknown>;
  try {
    properties = JSON.parse((row['properties'] as string) ?? '{}');
  } catch {
    properties = {};
  }
  return {
    id: row['id'] as string,
    label: row['label'] as string,
    type: row['type'] as GraphNodeType,
    sourceFile: (row['source_file'] as string) ?? undefined,
    sourceLocation: (row['source_location'] as string) ?? undefined,
    properties,
    tag: row['tag'] as GraphTag,
    confidence: row['confidence'] as number,
    workspace: (row['workspace'] as string) ?? undefined,
    contentHash: (row['content_hash'] as string) ?? undefined,
    createdAt: row['created_at'] as number,
    updatedAt: row['updated_at'] as number,
  };
}

function rowToEdge(row: Record<string, SqlValue>): GraphEdge {
  return {
    id: row['id'] as string,
    sourceId: row['source_id'] as string,
    targetId: row['target_id'] as string,
    relationType: row['relation_type'] as RelationType,
    tag: row['tag'] as GraphTag,
    confidence: row['confidence'] as number,
    sourceFile: (row['source_file'] as string) ?? undefined,
    sourceLocation: (row['source_location'] as string) ?? undefined,
    createdAt: row['created_at'] as number,
  };
}

function applyNodeFilters(
  nodes: GraphNode[],
  opts: { type?: string; tag?: string },
): GraphNode[] {
  let out = nodes;
  if (opts.type) out = out.filter((n) => n.type === opts.type);
  if (opts.tag) out = out.filter((n) => n.tag === opts.tag);
  return out;
}

function countOf(db: Database, table: string): number {
  const res = db.exec(`SELECT COUNT(*) FROM ${table}`);
  if (res.length === 0) return 0;
  return res[0].values[0][0] as number;
}
