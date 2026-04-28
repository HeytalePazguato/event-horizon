/**
 * Project Graph — typed code/knowledge graph stored in SQLite.
 *
 * - Nodes: functions, classes, modules, doc sections, rationales, agent activity, knowledge.
 * - Edges: calls, imports, extends, implements, references, touched, authored, rationale_for.
 * - Tags distinguish high-confidence EXTRACTED facts from INFERRED or AMBIGUOUS material.
 */

export type GraphNodeType =
  | 'function'
  | 'class'
  | 'module'
  | 'interface'
  | 'concept'
  | 'doc_section'
  | 'rationale'
  | 'agent_activity'
  | 'knowledge';

export type GraphTag = 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS';

export type RelationType =
  | 'calls'
  | 'imports'
  | 'extends'
  | 'implements'
  | 'references'
  | 'touched'
  | 'authored'
  | 'rationale_for';

export interface GraphNode {
  id: string;
  label: string;
  type: GraphNodeType;
  sourceFile?: string;
  sourceLocation?: string;
  properties: Record<string, unknown>;
  tag: GraphTag;
  confidence: number;
  workspace?: string;
  contentHash?: string;
  createdAt: number;
  updatedAt: number;
}

export interface GraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relationType: RelationType;
  tag: GraphTag;
  confidence: number;
  sourceFile?: string;
  sourceLocation?: string;
  createdAt: number;
}

export interface GraphFileState {
  sourceFile: string;
  contentHash: string;
  lastExtracted: number;
  extractor: string;
  nodeCount: number;
}

export { ProjectGraphStore } from './store.js';
export { ProjectGraphDB } from './projectGraphDb.js';
export { ProjectGraphLifecycle } from './lifecycle.js';
export { GRAPH_SCHEMA_SQL, GRAPH_SCHEMA_DROP_SQL } from './schema.js';
