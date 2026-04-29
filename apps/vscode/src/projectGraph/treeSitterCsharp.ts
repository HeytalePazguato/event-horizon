/**
 * C# walker for the project-graph tree-sitter extractor.
 *
 * Node coverage: `method_declaration`, `class_declaration`,
 * `interface_declaration`, `struct_declaration` (kind=struct),
 * `record_declaration` (kind=record), `enum_declaration` (kind=enum),
 * `using_directive` (imports edge), `invocation_expression` (calls edge),
 * and `base_list` for extends/implements (first entry is the base class
 * when the declaration is a class; subsequent entries are interfaces).
 * `///` XML doc comments preceding a node are attached as
 * `properties.docstring`.
 */

import type { Node as TSNode } from 'web-tree-sitter';
import type { GraphNode } from './index.js';
import type { ExtractionContext } from './treeSitterExtractor.js';

export function walkCsharp(root: TSNode, ctx: ExtractionContext): void {
  walkCsNode(root, ctx, ctx.moduleNode, null);
}

function walkCsNode(
  node: TSNode,
  ctx: ExtractionContext,
  scope: GraphNode,
  classScope: GraphNode | null,
): void {
  switch (node.type) {
    case 'class_declaration': {
      const cls = makeCsClassishNode(node, ctx, 'class', 'class');
      if (cls) {
        ctx.pushNode(cls);
        processCsBaseList(node, ctx, cls, /*isClass=*/ true);
        const body = node.childForFieldName('body') ?? findFirstBody(node);
        if (body) walkCsNode(body, ctx, cls, cls);
      }
      return;
    }
    case 'interface_declaration': {
      const iface = makeCsClassishNode(node, ctx, 'interface', 'iface');
      if (iface) {
        ctx.pushNode(iface);
        processCsBaseList(node, ctx, iface, /*isClass=*/ false);
        const body = node.childForFieldName('body') ?? findFirstBody(node);
        if (body) walkCsNode(body, ctx, iface, iface);
      }
      return;
    }
    case 'struct_declaration': {
      const cls = makeCsClassishNode(node, ctx, 'class', 'struct', 'struct');
      if (cls) {
        ctx.pushNode(cls);
        processCsBaseList(node, ctx, cls, /*isClass=*/ true);
        const body = node.childForFieldName('body') ?? findFirstBody(node);
        if (body) walkCsNode(body, ctx, cls, cls);
      }
      return;
    }
    case 'record_declaration': {
      const cls = makeCsClassishNode(node, ctx, 'class', 'record', 'record');
      if (cls) {
        ctx.pushNode(cls);
        processCsBaseList(node, ctx, cls, /*isClass=*/ true);
        const body = node.childForFieldName('body') ?? findFirstBody(node);
        if (body) walkCsNode(body, ctx, cls, cls);
      }
      return;
    }
    case 'enum_declaration': {
      const cls = makeCsClassishNode(node, ctx, 'class', 'enum', 'enum');
      if (cls) {
        ctx.pushNode(cls);
        // Enums don't have base lists worth tracking; skip.
      }
      return;
    }
    case 'method_declaration': {
      const method = makeCsMethodNode(node, ctx, classScope);
      if (method) {
        ctx.pushNode(method);
        if (classScope) {
          ctx.pushEdge({
            id: `member_of:${method.id}:${classScope.id}`,
            sourceId: method.id,
            targetId: classScope.id,
            relationType: 'member_of',
            tag: 'EXTRACTED',
            confidence: 1.0,
            sourceFile: ctx.filePath,
            sourceLocation: method.sourceLocation,
            createdAt: ctx.now,
          });
        }
        const body = node.childForFieldName('body');
        if (body) walkCsNode(body, ctx, method, classScope);
      }
      return;
    }
    case 'using_directive': {
      processCsUsing(node, ctx);
      return;
    }
    case 'invocation_expression': {
      processCsInvocation(node, ctx, scope);
      for (const c of node.namedChildren) if (c) walkCsNode(c, ctx, scope, classScope);
      return;
    }
  }

  for (const c of node.namedChildren) if (c) walkCsNode(c, ctx, scope, classScope);
}

function makeCsClassishNode(
  node: TSNode,
  ctx: ExtractionContext,
  type: 'class' | 'interface',
  idPrefix: 'class' | 'iface' | 'struct' | 'record' | 'enum',
  kind?: 'struct' | 'record' | 'enum',
): GraphNode | null {
  const nameField = node.childForFieldName('name');
  if (!nameField) return null;
  const name = nameField.text;
  const startLine = node.startPosition.row + 1;
  const docstring = extractCsDocstring(node);

  const properties: Record<string, unknown> = {};
  if (kind) properties.kind = kind;
  if (docstring) properties.docstring = docstring;

  return {
    id: `cs:${idPrefix}:${ctx.relPath}:${startLine}:${name}`,
    label: name,
    type,
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

function makeCsMethodNode(
  node: TSNode,
  ctx: ExtractionContext,
  classScope: GraphNode | null,
): GraphNode | null {
  const nameField = node.childForFieldName('name');
  if (!nameField) return null;
  const name = nameField.text;
  const startLine = node.startPosition.row + 1;
  const params = extractCsParams(node.childForFieldName('parameters'));
  const docstring = extractCsDocstring(node);

  const properties: Record<string, unknown> = { params, kind: 'method_declaration' };
  if (classScope) {
    properties.parent = classScope.id;
    properties.parentLabel = classScope.label;
  }
  if (docstring) properties.docstring = docstring;

  return {
    id: `cs:method:${ctx.relPath}:${startLine}:${name}`,
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

function processCsBaseList(decl: TSNode, ctx: ExtractionContext, owner: GraphNode, isClass: boolean): void {
  // base_list is the `: A, B, C` clause. For a class, the first entry is the
  // base class (extends), the rest are interfaces (implements). For an
  // interface, every entry is another interface (extends).
  const bases = findFirstChildOfType(decl, 'base_list');
  if (!bases) return;
  let firstSeen = false;
  for (const c of bases.namedChildren) {
    if (!c) continue;
    const name = csTypeName(c);
    if (!name) continue;
    let relation: 'extends' | 'implements';
    if (!isClass) {
      // interface → interface
      relation = 'extends';
    } else if (!firstSeen) {
      relation = 'extends';
      firstSeen = true;
    } else {
      relation = 'implements';
    }
    const refPrefix = relation === 'extends' && isClass ? 'class_ref' : 'iface_ref';
    const refId = `cs:${refPrefix}:${name}`;
    ctx.ensureRef(refId, name, relation === 'implements' || !isClass ? 'interface' : 'class');
    ctx.pushEdge({
      id: `${relation}:${owner.id}:${name}`,
      sourceId: owner.id,
      targetId: refId,
      relationType: relation,
      tag: 'EXTRACTED',
      confidence: 1.0,
      sourceFile: ctx.filePath,
      sourceLocation: owner.sourceLocation,
      createdAt: ctx.now,
    });
  }
}

function processCsUsing(node: TSNode, ctx: ExtractionContext): void {
  const startLine = node.startPosition.row + 1;
  // `using X.Y.Z;` — the namespace path is an identifier-or-qualified-name
  // child of the directive.
  const target = firstNamedChildOfTypes(node, ['qualified_name', 'identifier', 'name_equals', 'alias_qualified_name']);
  if (!target) return;
  const fullName = target.text;
  const refId = `module_ref:${fullName}`;
  ctx.ensureRef(refId, fullName, 'module', { sourceFile: fullName });
  ctx.pushEdge({
    id: `import:${ctx.moduleNode.id}:${startLine}:${fullName}`,
    sourceId: ctx.moduleNode.id,
    targetId: refId,
    relationType: 'imports',
    tag: 'EXTRACTED',
    confidence: 1.0,
    sourceFile: ctx.filePath,
    sourceLocation: String(startLine),
    createdAt: ctx.now,
  });
}

function processCsInvocation(node: TSNode, ctx: ExtractionContext, scope: GraphNode): void {
  const fn = node.childForFieldName('function') ?? node.firstNamedChild;
  if (!fn) return;
  const callee = csInvocationName(fn);
  if (!callee) return;
  const startLine = node.startPosition.row + 1;
  const startCol = node.startPosition.column;
  const refId = `cs:func_ref:${callee}`;
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

function extractCsParams(paramsNode: TSNode | null): string[] {
  if (!paramsNode) return [];
  const out: string[] = [];
  for (const c of paramsNode.namedChildren) {
    if (!c) continue;
    // `parameter` has `name` field (identifier).
    const nameField = c.childForFieldName('name') ?? findFirstChildOfType(c, 'identifier');
    if (nameField) out.push(nameField.text);
  }
  return out;
}

function extractCsDocstring(node: TSNode): string | undefined {
  // C# XML doc comments are sequences of `///` line comments preceding the
  // declaration. Tree-sitter exposes them as `comment` nodes whose text
  // starts with `///`. Walk previous siblings until we hit a non-comment.
  const lines: string[] = [];
  let prev = node.previousSibling;
  while (prev && prev.type === 'comment' && prev.text.startsWith('///')) {
    lines.unshift(prev.text);
    prev = prev.previousSibling;
  }
  return lines.length > 0 ? lines.join('\n') : undefined;
}

function csTypeName(node: TSNode | null): string | null {
  if (!node) return null;
  if (node.type === 'identifier' || node.type === 'qualified_name') return node.text;
  if (node.type === 'generic_name') {
    const name = firstNamedChildOfTypes(node, ['identifier']);
    if (name) return name.text;
  }
  if (node.type === 'predefined_type') return node.text;
  const first = node.firstNamedChild;
  if (first) return csTypeName(first);
  return node.text || null;
}

function csInvocationName(node: TSNode): string | null {
  if (node.type === 'identifier') return node.text;
  if (node.type === 'member_access_expression') {
    const name = node.childForFieldName('name');
    if (name) return name.text;
  }
  if (node.type === 'generic_name') {
    const name = firstNamedChildOfTypes(node, ['identifier']);
    if (name) return name.text;
  }
  if (node.type === 'qualified_name') {
    return node.text.split('.').pop() ?? node.text;
  }
  const first = node.firstNamedChild;
  if (first) return csInvocationName(first);
  return null;
}

function findFirstChildOfType(node: TSNode, type: string): TSNode | null {
  for (const c of node.namedChildren) {
    if (c && c.type === type) return c;
  }
  return null;
}

function firstNamedChildOfTypes(node: TSNode, types: string[]): TSNode | null {
  for (const c of node.namedChildren) {
    if (c && types.includes(c.type)) return c;
  }
  return null;
}

function findFirstBody(node: TSNode): TSNode | null {
  // Some C# declarations expose their body via `body` field; others (record
  // with primary constructor, partial declarations) put the block as the
  // last named child. Defensive lookup.
  for (const c of node.namedChildren) {
    if (c && (c.type === 'declaration_list' || c.type === 'block' || c.type === 'class_body' || c.type === 'interface_body')) {
      return c;
    }
  }
  return null;
}
