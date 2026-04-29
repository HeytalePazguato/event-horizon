/**
 * Python walker for the project-graph tree-sitter extractor.
 *
 * Node coverage: `function_definition` (with `properties.async = true` for
 * `async def`), `class_definition`, `decorated_definition` (decorators
 * attached as `properties.decorators`), `import_statement` and
 * `import_from_statement` (one `imports` edge per imported name), `call`
 * (calls edge). Triple-quoted string as the first body statement of a
 * function/class becomes `properties.docstring`. `# TODO:`, `# FIXME:`,
 * `# WHY:` line comments produce a `rationale` node with a `rationale_for`
 * edge to the nearest enclosing function/class.
 */

import type { Node as TSNode } from 'web-tree-sitter';
import type { GraphNode } from './index.js';
import type { ExtractionContext } from './treeSitterExtractor.js';

const RATIONALE_MARKERS = /^\s*#\s*(TODO|FIXME|WHY|HACK|XXX)[:\s]/i;

interface ScopeRange {
  startLine: number; // 1-indexed
  endLine: number; // 1-indexed, inclusive
  node: GraphNode;
}

export function walkPython(root: TSNode, ctx: ExtractionContext, source: string): void {
  const ranges: ScopeRange[] = [];
  walkPyNode(root, ctx, ctx.moduleNode, null, ranges);
  scanPyRationale(source, ctx, ranges);
}

function walkPyNode(
  node: TSNode,
  ctx: ExtractionContext,
  scope: GraphNode,
  classScope: GraphNode | null,
  ranges: ScopeRange[],
): void {
  switch (node.type) {
    case 'function_definition': {
      const fn = makePyFunctionNode(node, ctx, false);
      if (fn) {
        ctx.pushNode(fn);
        if (classScope) {
          ctx.pushEdge({
            id: `member_of:${fn.id}:${classScope.id}`,
            sourceId: fn.id,
            targetId: classScope.id,
            relationType: 'member_of',
            tag: 'EXTRACTED',
            confidence: 1.0,
            sourceFile: ctx.filePath,
            sourceLocation: fn.sourceLocation,
            createdAt: ctx.now,
          });
        }
        ranges.push({
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          node: fn,
        });
        const body = node.childForFieldName('body');
        if (body) walkPyNode(body, ctx, fn, classScope, ranges);
      }
      return;
    }
    case 'class_definition': {
      const cls = makePyClassNode(node, ctx);
      if (cls) {
        ctx.pushNode(cls);
        ranges.push({
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          node: cls,
        });
        processPyClassHeritage(node, ctx, cls);
        const body = node.childForFieldName('body');
        // Functions defined directly in this class body get a member_of
        // edge to the class via the classScope arg.
        if (body) walkPyNode(body, ctx, cls, cls, ranges);
      }
      return;
    }
    case 'decorated_definition': {
      // Wraps a function_definition or class_definition. Pull out the
      // decorators, attach them to the inner node's properties.
      const decorators = extractPyDecorators(node);
      const innerFn = firstChildOfType(node, 'function_definition');
      const innerCls = firstChildOfType(node, 'class_definition');
      if (innerFn) {
        const fn = makePyFunctionNode(innerFn, ctx, false, decorators);
        if (fn) {
          ctx.pushNode(fn);
          if (classScope) {
            ctx.pushEdge({
              id: `member_of:${fn.id}:${classScope.id}`,
              sourceId: fn.id,
              targetId: classScope.id,
              relationType: 'member_of',
              tag: 'EXTRACTED',
              confidence: 1.0,
              sourceFile: ctx.filePath,
              sourceLocation: fn.sourceLocation,
              createdAt: ctx.now,
            });
          }
          ranges.push({
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            node: fn,
          });
          const body = innerFn.childForFieldName('body');
          if (body) walkPyNode(body, ctx, fn, classScope, ranges);
        }
        return;
      }
      if (innerCls) {
        const cls = makePyClassNode(innerCls, ctx, decorators);
        if (cls) {
          ctx.pushNode(cls);
          ranges.push({
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            node: cls,
          });
          processPyClassHeritage(innerCls, ctx, cls);
          const body = innerCls.childForFieldName('body');
          if (body) walkPyNode(body, ctx, cls, cls, ranges);
        }
        return;
      }
      // Fall through if neither shape — defensive.
      break;
    }
    case 'import_statement': {
      processPyImport(node, ctx, false);
      return;
    }
    case 'import_from_statement': {
      processPyImport(node, ctx, true);
      return;
    }
    case 'call': {
      processPyCall(node, ctx, scope);
      for (const c of node.namedChildren) if (c) walkPyNode(c, ctx, scope, classScope, ranges);
      return;
    }
  }

  for (const c of node.namedChildren) if (c) walkPyNode(c, ctx, scope, classScope, ranges);
}

/**
 * Source-text rationale pass — tree-sitter-python's `comment` nodes don't
 * always surface in `namedChildren` because comments are extras. Scanning
 * the source by line is simpler and language-version-proof. Each match
 * attaches to the deepest enclosing function/class (by line range), or
 * to the module when no function/class encloses the line.
 */
function scanPyRationale(source: string, ctx: ExtractionContext, ranges: ScopeRange[]): void {
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!RATIONALE_MARKERS.test(line)) continue;
    const lineNum = i + 1;
    // Pick the smallest range (= deepest scope) that contains this line.
    let scope: GraphNode = ctx.moduleNode;
    let bestSpan = Infinity;
    for (const r of ranges) {
      if (r.startLine <= lineNum && lineNum <= r.endLine) {
        const span = r.endLine - r.startLine;
        if (span < bestSpan) {
          bestSpan = span;
          scope = r.node;
        }
      }
    }
    const rationaleId = `py:rationale:${ctx.relPath}:${lineNum}`;
    const trimmed = line.replace(/^\s*#\s*/, '').trim();
    ctx.pushNode({
      id: rationaleId,
      label: trimmed.slice(0, 80),
      type: 'rationale',
      sourceFile: ctx.filePath,
      sourceLocation: String(lineNum),
      properties: { text: line.trim() },
      tag: 'INFERRED',
      confidence: 0.7,
      contentHash: ctx.contentHash,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });
    ctx.pushEdge({
      id: `rationale_for:${rationaleId}:${scope.id}`,
      sourceId: rationaleId,
      targetId: scope.id,
      relationType: 'rationale_for',
      tag: 'INFERRED',
      confidence: 0.7,
      sourceFile: ctx.filePath,
      sourceLocation: String(lineNum),
      createdAt: ctx.now,
    });
  }
}

function makePyFunctionNode(
  node: TSNode,
  ctx: ExtractionContext,
  _placeholder: boolean,
  decorators?: string[],
): GraphNode | null {
  const nameField = node.childForFieldName('name');
  if (!nameField) return null;
  const name = nameField.text;
  const startLine = node.startPosition.row + 1;
  const params = extractPyParams(node.childForFieldName('parameters'));
  const isAsync = nodeHasAsync(node);
  const docstring = extractPyDocstring(node);

  const properties: Record<string, unknown> = { params, kind: 'function_definition' };
  if (isAsync) properties.async = true;
  if (decorators && decorators.length > 0) properties.decorators = decorators;
  if (docstring) properties.docstring = docstring;

  return {
    id: `py:func:${ctx.relPath}:${startLine}:${name}`,
    label: name,
    type: 'function',
    sourceFile: ctx.filePath,
    sourceLocation: String(startLine),
    properties,
    tag: 'EXTRACTED',
    confidence: 1.0,
    contentHash: ctx.contentHash,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  };
}

function makePyClassNode(
  node: TSNode,
  ctx: ExtractionContext,
  decorators?: string[],
): GraphNode | null {
  const nameField = node.childForFieldName('name');
  if (!nameField) return null;
  const name = nameField.text;
  const startLine = node.startPosition.row + 1;
  const docstring = extractPyDocstring(node);

  const properties: Record<string, unknown> = {};
  if (decorators && decorators.length > 0) properties.decorators = decorators;
  if (docstring) properties.docstring = docstring;

  return {
    id: `py:class:${ctx.relPath}:${startLine}:${name}`,
    label: name,
    type: 'class',
    sourceFile: ctx.filePath,
    sourceLocation: String(startLine),
    properties,
    tag: 'EXTRACTED',
    confidence: 1.0,
    contentHash: ctx.contentHash,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  };
}

function processPyClassHeritage(decl: TSNode, ctx: ExtractionContext, owner: GraphNode): void {
  // Python `class Foo(Base, Mixin):` exposes its bases via the `superclasses`
  // field, which is an `argument_list` containing identifier / attribute nodes.
  const supers = decl.childForFieldName('superclasses');
  if (!supers) return;
  for (const c of supers.namedChildren) {
    if (!c) continue;
    const name = pyAttributeName(c);
    if (!name) continue;
    const refId = `py:class_ref:${name}`;
    ctx.ensureRef(refId, name, 'class');
    ctx.pushEdge({
      id: `extends:${owner.id}:${name}`,
      sourceId: owner.id,
      targetId: refId,
      relationType: 'extends',
      tag: 'EXTRACTED',
      confidence: 1.0,
      sourceFile: ctx.filePath,
      sourceLocation: owner.sourceLocation,
      createdAt: ctx.now,
    });
  }
}

function processPyImport(node: TSNode, ctx: ExtractionContext, isFromImport: boolean): void {
  const startLine = node.startPosition.row + 1;
  const fromModule = isFromImport ? node.childForFieldName('module_name')?.text : undefined;
  // Each imported name produces its own edge so downstream queries can see
  // exactly which symbols were brought in.
  for (const c of node.namedChildren) {
    if (!c) continue;
    if (c.type === 'aliased_import') {
      const inner = c.firstNamedChild;
      if (inner && (inner.type === 'dotted_name' || inner.type === 'identifier')) {
        emitPyImport(ctx, ctx.moduleNode, inner.text, fromModule, startLine);
      }
      continue;
    }
    if (c.type === 'dotted_name' || c.type === 'identifier') {
      // import_from_statement also has the from-module as a child; skip it.
      if (isFromImport && c === node.childForFieldName('module_name')) continue;
      emitPyImport(ctx, ctx.moduleNode, c.text, fromModule, startLine);
    }
    if (c.type === 'wildcard_import' && fromModule) {
      emitPyImport(ctx, ctx.moduleNode, '*', fromModule, startLine);
    }
  }
}

function emitPyImport(
  ctx: ExtractionContext,
  source: GraphNode,
  name: string,
  fromModule: string | undefined,
  startLine: number,
): void {
  const fullPath = fromModule ? `${fromModule}.${name}` : name;
  const refId = `module_ref:${fullPath}`;
  ctx.ensureRef(refId, fullPath, 'module', { sourceFile: fullPath });
  const properties = fromModule ? { from: fromModule, name } : { name };
  void properties; // currently not stored in the edge; kept for future expansion
  ctx.pushEdge({
    id: `import:${source.id}:${startLine}:${fullPath}`,
    sourceId: source.id,
    targetId: refId,
    relationType: 'imports',
    tag: 'EXTRACTED',
    confidence: 1.0,
    sourceFile: ctx.filePath,
    sourceLocation: String(startLine),
    createdAt: ctx.now,
  });
}

function processPyCall(node: TSNode, ctx: ExtractionContext, scope: GraphNode): void {
  const fn = node.childForFieldName('function');
  if (!fn) return;
  const callee = pyAttributeName(fn);
  if (!callee) return;
  const startLine = node.startPosition.row + 1;
  const startCol = node.startPosition.column;
  const refId = `py:func_ref:${callee}`;
  ctx.ensureRef(refId, callee, 'function');
  ctx.pushEdge({
    id: `call:${scope.id}:${startLine}:${startCol}:${callee}`,
    sourceId: scope.id,
    targetId: refId,
    relationType: 'calls',
    tag: 'EXTRACTED',
    confidence: 1.0,
    sourceFile: ctx.filePath,
    sourceLocation: String(startLine),
    createdAt: ctx.now,
  });
}

function extractPyParams(paramsNode: TSNode | null): string[] {
  if (!paramsNode) return [];
  const out: string[] = [];
  for (const c of paramsNode.namedChildren) {
    if (!c) continue;
    if (c.type === 'identifier') out.push(c.text);
    else if (c.type === 'typed_parameter' || c.type === 'default_parameter' || c.type === 'typed_default_parameter') {
      const name = firstChildOfType(c, 'identifier');
      if (name) out.push(name.text);
    } else if (c.type === 'list_splat_pattern' || c.type === 'dictionary_splat_pattern') {
      const name = firstChildOfType(c, 'identifier');
      if (name) out.push((c.type === 'list_splat_pattern' ? '*' : '**') + name.text);
    }
  }
  return out;
}

function extractPyDocstring(defNode: TSNode): string | undefined {
  const body = defNode.childForFieldName('body');
  if (!body) return undefined;
  const first = body.firstNamedChild;
  if (!first || first.type !== 'expression_statement') return undefined;
  const expr = first.firstNamedChild;
  if (!expr || expr.type !== 'string') return undefined;
  return expr.text;
}

function extractPyDecorators(decorated: TSNode): string[] {
  const out: string[] = [];
  for (const c of decorated.namedChildren) {
    if (!c || c.type !== 'decorator') continue;
    // Decorator children: `@`, `expression`. Drop the leading `@` from text.
    const expr = c.namedChildren.find((x) => x !== null);
    if (expr) {
      out.push(expr.text);
    } else {
      out.push(c.text.replace(/^@/, '').trim());
    }
  }
  return out;
}

function nodeHasAsync(fn: TSNode): boolean {
  for (const c of fn.children) {
    if (c && c.type === 'async') return true;
  }
  return false;
}

function pyAttributeName(node: TSNode | null): string | null {
  if (!node) return null;
  if (node.type === 'identifier') return node.text;
  if (node.type === 'attribute') {
    const attr = node.childForFieldName('attribute');
    if (attr) return attr.text;
  }
  if (node.type === 'call') {
    const fn = node.childForFieldName('function');
    if (fn) return pyAttributeName(fn);
  }
  if (node.type === 'subscript') {
    const value = node.childForFieldName('value');
    if (value) return pyAttributeName(value);
  }
  const first = node.firstNamedChild;
  if (first) return pyAttributeName(first);
  return null;
}

function firstChildOfType(node: TSNode, type: string): TSNode | null {
  for (const c of node.namedChildren) {
    if (c && c.type === type) return c;
  }
  return null;
}
