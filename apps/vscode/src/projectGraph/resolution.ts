/**
 * Phase 12 — Post-scan resolution pass.
 *
 * The per-file extractor creates an INFERRED placeholder node for every
 * call whose target couldn't be resolved at extraction time (cross-file
 * calls, unresolved imports, etc.). After the full workspace has been
 * scanned, this pass walks the placeholders and merges each one into its
 * EXTRACTED counterpart when the qualified ID + the existing
 * `member_of` / `imports` / `extends` edges identify exactly one
 * canonical match.
 *
 * Resolution rules in priority order:
 *
 *   1. Qualified `func_ref:Foo.bar`
 *        → match an EXTRACTED function `bar` whose `member_of` edge
 *          points at a class node labelled `Foo`. Single match → merge.
 *   2. `func_ref:this.bar` (or `:this.bar`-suffixed across language
 *      prefixes — `php:func_ref:this.bar`, `py:func_ref:self.bar`, etc.)
 *        → find the call edge's source scope. Walk to its enclosing
 *          class via `member_of`. If that class has an EXTRACTED `bar`
 *          member, merge.
 *   3. `func_ref:base.bar` / `func_ref:super.bar`
 *        → walk the enclosing class's `extends` edge. Merge if the
 *          parent class has an EXTRACTED `bar` member.
 *   4. Bare `func_ref:bar` with `properties.callerFile = F`
 *        → look at `F`'s outgoing `imports` edges. If exactly one
 *          imported module owns an EXTRACTED `bar`, merge.
 *   5. Bare `func_ref:bar` with no qualifier or unresolved imports
 *        → fall through to "exactly one EXTRACTED `bar` exists in the
 *          whole graph". If true, merge. Otherwise the placeholder
 *          stays — honest about the ambiguity.
 *
 * Generic-name guard: even rule 5's "exactly one" path refuses to merge
 * for names that are commonly identical across unrelated files (`init`,
 * `process`, `handle`, etc.). Those names accidentally co-locating in a
 * single-match graph today would silently become wrong tomorrow as soon
 * as a second `init` appeared.
 *
 * The pass is idempotent: running it twice produces the same final
 * graph state because all merge candidates from the second run are
 * already gone.
 */

import type { ProjectGraphStore } from './store.js';
import type { GraphNode, GraphEdge } from './types.js';

const GENERIC_NAMES = new Set([
  'init', 'process', 'handle', 'get', 'set', 'value', 'update',
  'delete', 'add', 'run', 'parse', 'build', 'main', 'start', 'stop',
  'create', 'exec', 'apply', 'load', 'save', 'render', 'reset',
]);

/** Strip language prefix and `func_ref:` so we can inspect the qualified payload. */
function stripPrefix(id: string): { prefix: string; payload: string } | null {
  // Match optional language prefix: `php:`, `py:`, `cs:`, then `func_ref:<payload>`.
  const m = id.match(/^(?:([a-z]+):)?func_ref:(.+)$/);
  if (!m) return null;
  return { prefix: m[1] ?? '', payload: m[2] };
}

/** Split `Foo.bar` → { receiver: "Foo", bare: "bar" }; `bar` → { receiver: undefined, bare: "bar" }. */
function splitQualified(payload: string): { receiver?: string; bare: string } {
  const dot = payload.lastIndexOf('.');
  if (dot < 0) return { bare: payload };
  return { receiver: payload.slice(0, dot), bare: payload.slice(dot + 1) };
}

export interface ResolutionResult {
  merged: number;
  unresolved: number;
  totalRefs: number;
}

export function runResolution(store: ProjectGraphStore): ResolutionResult {
  // Snapshot the inputs we need so subsequent merges don't invalidate
  // ongoing iteration. listNodes pulls via SQL — small (placeholders are
  // <10% of nodes typically) and a single shot is enough.
  const allNodes = store.allNodes();
  const allEdges = store.allEdges();

  const refs: GraphNode[] = [];
  const extractedByLabel = new Map<string, GraphNode[]>();
  for (const n of allNodes) {
    if (n.type !== 'function') continue;
    if (n.tag === 'INFERRED' && n.id.includes('func_ref:')) {
      refs.push(n);
    } else if (n.tag === 'EXTRACTED') {
      const list = extractedByLabel.get(n.label) ?? [];
      list.push(n);
      extractedByLabel.set(n.label, list);
    }
  }

  // Index member_of edges: function-id → enclosing-class-id.
  const memberOf = new Map<string, string>();
  // Reverse index class-id → function-id-set, used for "does class Foo have method bar?"
  const classMembers = new Map<string, GraphNode[]>();
  // Track class label → class node so we can resolve `Foo.bar` from a label.
  const classByLabel = new Map<string, GraphNode[]>();
  // Reverse imports: file → imported module-ref ids.
  const fileImports = new Map<string, string[]>();
  // Index extends edges: class-id → parent-class-id.
  const extendsOf = new Map<string, string>();

  const nodeById = new Map<string, GraphNode>();
  for (const n of allNodes) {
    nodeById.set(n.id, n);
    if (n.type === 'class') {
      const list = classByLabel.get(n.label) ?? [];
      list.push(n);
      classByLabel.set(n.label, list);
    }
  }

  for (const e of allEdges) {
    if (e.relationType === 'member_of') {
      memberOf.set(e.sourceId, e.targetId);
      const list = classMembers.get(e.targetId) ?? [];
      const fn = nodeById.get(e.sourceId);
      if (fn) list.push(fn);
      classMembers.set(e.targetId, list);
    } else if (e.relationType === 'extends') {
      extendsOf.set(e.sourceId, e.targetId);
    } else if (e.relationType === 'imports' && e.sourceFile) {
      const list = fileImports.get(e.sourceFile) ?? [];
      list.push(e.targetId);
      fileImports.set(e.sourceFile, list);
    }
  }

  // Pre-index: for each ref, find the call edges that point at it. We
  // need them to discover the calling scope (for `this.bar` resolution).
  const refIncomingEdges = new Map<string, GraphEdge[]>();
  for (const e of allEdges) {
    if (e.relationType !== 'calls') continue;
    const arr = refIncomingEdges.get(e.targetId) ?? [];
    arr.push(e);
    refIncomingEdges.set(e.targetId, arr);
  }

  let merged = 0;
  for (const ref of refs) {
    const stripped = stripPrefix(ref.id);
    if (!stripped) continue;
    const { receiver, bare } = splitQualified(stripped.payload);

    let target: GraphNode | undefined;

    // Rule 1: qualified `Foo.bar` → look up class "Foo" with a member "bar".
    if (receiver && receiver !== 'this' && receiver !== 'self' && receiver !== 'base' && receiver !== 'super') {
      const classes = classByLabel.get(receiver) ?? [];
      const candidates: GraphNode[] = [];
      for (const cls of classes) {
        const members = classMembers.get(cls.id) ?? [];
        for (const m of members) {
          if (m.label === bare && m.tag === 'EXTRACTED') candidates.push(m);
        }
      }
      if (candidates.length === 1) target = candidates[0];
    }

    // Rule 2: `this.bar` / `self.bar` → walk caller scope's member_of.
    else if (receiver === 'this' || receiver === 'self') {
      const incoming = refIncomingEdges.get(ref.id) ?? [];
      for (const ce of incoming) {
        const callerScopeId = ce.sourceId;
        // The caller might be a function — walk to its enclosing class.
        const enclosingClass = memberOf.get(callerScopeId);
        if (!enclosingClass) continue;
        const members = classMembers.get(enclosingClass) ?? [];
        const match = members.find((m) => m.label === bare && m.tag === 'EXTRACTED');
        if (match) {
          target = match;
          break;
        }
      }
    }

    // Rule 3: `base.bar` / `super.bar` → walk enclosing class's extends.
    else if (receiver === 'base' || receiver === 'super') {
      const incoming = refIncomingEdges.get(ref.id) ?? [];
      for (const ce of incoming) {
        const enclosingClass = memberOf.get(ce.sourceId);
        if (!enclosingClass) continue;
        // The extends edge points at a class_ref; we need to resolve
        // that ref to a real class node by label first.
        const parentRefId = extendsOf.get(enclosingClass);
        if (!parentRefId) continue;
        const parentRef = nodeById.get(parentRefId);
        if (!parentRef) continue;
        const realParents = classByLabel.get(parentRef.label) ?? [];
        for (const realParent of realParents) {
          const members = classMembers.get(realParent.id) ?? [];
          const match = members.find((m) => m.label === bare && m.tag === 'EXTRACTED');
          if (match) {
            target = match;
            break;
          }
        }
        if (target) break;
      }
    }

    // Rules 4 + 5: bare callee. Try import-scoped match first; fall
    // through to "exactly one" with the generic-name guard.
    else if (!receiver) {
      // Generic-name guard: don't even try the global-uniqueness merge
      // for names that commonly co-locate by accident.
      if (GENERIC_NAMES.has(bare)) continue;

      // Try import-scoped resolution: if the ref records a callerFile,
      // see if exactly one of that file's imports owns an EXTRACTED bar.
      const callerFile = (ref.properties as Record<string, unknown> | undefined)?.callerFile as string | undefined;
      if (callerFile) {
        const imports = fileImports.get(callerFile) ?? [];
        const importedModules = imports.map((id) => nodeById.get(id)).filter(Boolean) as GraphNode[];
        const importedFiles = new Set(importedModules.map((m) => m.sourceFile).filter(Boolean) as string[]);
        const candidates = (extractedByLabel.get(bare) ?? []).filter(
          (n) => n.sourceFile && importedFiles.has(n.sourceFile),
        );
        if (candidates.length === 1) target = candidates[0];
      }

      // Fallback: exactly one EXTRACTED match in the entire graph.
      if (!target) {
        const candidates = extractedByLabel.get(bare) ?? [];
        if (candidates.length === 1) target = candidates[0];
      }
    }

    if (target) {
      store.mergeNodes(ref.id, target.id);
      merged++;
    }
  }

  return { merged, unresolved: refs.length - merged, totalRefs: refs.length };
}
