/**
 * PHP walker for the project-graph tree-sitter extractor.
 *
 * Targets the PHP-only grammar (`tree-sitter-php_only.wasm`), which assumes
 * pure `<?php ... ?>` files — Blade / `.phtml` mixed-mode templates are
 * out of scope and skipped at the scanner level for this iteration.
 *
 * Node coverage: `function_definition`, `class_declaration`,
 * `interface_declaration`, `trait_declaration` (kind=trait),
 * `enum_declaration` (kind=enum), `method_declaration`,
 * `function_call_expression`, `member_call_expression` (incl. nullsafe),
 * `scoped_call_expression`, `namespace_use_declaration`, plus
 * `base_clause` / `class_interface_clause` for extends/implements. PHPDoc
 * block comments immediately preceding a node are attached as
 * `properties.docstring`.
 */

import type { Node as TSNode } from 'web-tree-sitter';
import type { GraphNode } from './index.js';
import type { ExtractionContext } from './treeSitterExtractor.js';

export function walkPhp(root: TSNode, ctx: ExtractionContext): void {
  walkPhpNode(root, ctx, ctx.moduleNode, null);
}

function walkPhpNode(
  node: TSNode,
  ctx: ExtractionContext,
  scope: GraphNode,
  classScope: GraphNode | null,
): void {
  switch (node.type) {
    case 'function_definition': {
      const fn = makePhpFunctionNode(node, ctx, 'function_definition', null);
      if (fn) {
        ctx.pushNode(fn);
        const body = node.childForFieldName('body');
        if (body) walkPhpNode(body, ctx, fn, classScope);
      }
      return;
    }
    case 'class_declaration': {
      const cls = makePhpClassishNode(node, ctx, 'class', 'class');
      if (cls) {
        ctx.pushNode(cls);
        processPhpHeritage(node, ctx, cls);
        const body = node.childForFieldName('body');
        if (body) walkPhpNode(body, ctx, cls, cls);
      }
      return;
    }
    case 'interface_declaration': {
      const iface = makePhpClassishNode(node, ctx, 'interface', 'iface');
      if (iface) {
        ctx.pushNode(iface);
        processPhpHeritage(node, ctx, iface);
        const body = node.childForFieldName('body');
        if (body) walkPhpNode(body, ctx, iface, iface);
      }
      return;
    }
    case 'trait_declaration': {
      const trait = makePhpClassishNode(node, ctx, 'class', 'trait', 'trait');
      if (trait) {
        ctx.pushNode(trait);
        const body = node.childForFieldName('body');
        if (body) walkPhpNode(body, ctx, trait, trait);
      }
      return;
    }
    case 'enum_declaration': {
      const en = makePhpClassishNode(node, ctx, 'class', 'enum', 'enum');
      if (en) {
        ctx.pushNode(en);
        const body = node.childForFieldName('body');
        if (body) walkPhpNode(body, ctx, en, en);
      }
      return;
    }
    case 'method_declaration': {
      const method = makePhpFunctionNode(node, ctx, 'method_declaration', classScope);
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
        if (body) walkPhpNode(body, ctx, method, classScope);
      }
      return;
    }
    case 'namespace_use_declaration': {
      processPhpUseDeclaration(node, ctx);
      return;
    }
    case 'function_call_expression':
    case 'member_call_expression':
    case 'nullsafe_member_call_expression':
    case 'scoped_call_expression': {
      processPhpCall(node, ctx, scope);
      // Walk into arguments so nested calls are captured.
      for (const c of node.namedChildren) if (c) walkPhpNode(c, ctx, scope, classScope);
      return;
    }
  }

  for (const c of node.namedChildren) if (c) walkPhpNode(c, ctx, scope, classScope);
}

function makePhpFunctionNode(
  node: TSNode,
  ctx: ExtractionContext,
  kind: 'function_definition' | 'method_declaration',
  classScope: GraphNode | null,
): GraphNode | null {
  const nameField = node.childForFieldName('name');
  if (!nameField) return null;
  const name = nameField.text;
  const startLine = node.startPosition.row + 1;
  const params = extractPhpParams(node.childForFieldName('parameters'));
  const docstring = extractPhpDocstring(node);

  const properties: Record<string, unknown> = { params, kind };
  if (classScope) {
    properties.parent = classScope.id;
    properties.parentLabel = classScope.label;
  }
  if (docstring) properties.docstring = docstring;

  return {
    id: `php:func:${ctx.relPath}:${startLine}:${name}`,
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

function makePhpClassishNode(
  node: TSNode,
  ctx: ExtractionContext,
  type: 'class' | 'interface',
  idPrefix: 'class' | 'iface' | 'trait' | 'enum',
  kind?: 'trait' | 'enum',
): GraphNode | null {
  const nameField = node.childForFieldName('name');
  if (!nameField) return null;
  const name = nameField.text;
  const startLine = node.startPosition.row + 1;
  const docstring = extractPhpDocstring(node);
  const properties: Record<string, unknown> = {};
  if (kind) properties.kind = kind;
  if (docstring) properties.docstring = docstring;

  return {
    id: `php:${idPrefix}:${ctx.relPath}:${startLine}:${name}`,
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

function processPhpHeritage(decl: TSNode, ctx: ExtractionContext, owner: GraphNode): void {
  for (const child of decl.children) {
    if (!child) continue;
    if (child.type === 'base_clause') {
      // `extends X[, Y, ...]` — for classes this is single, for interfaces multi.
      for (const c of child.namedChildren) {
        if (!c) continue;
        const name = phpQualifiedName(c);
        if (!name) continue;
        const refId = `php:class_ref:${name}`;
        ctx.ensureRef(refId, name, owner.type === 'interface' ? 'interface' : 'class');
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
    } else if (child.type === 'class_interface_clause') {
      // `implements X, Y, Z` — class only.
      for (const c of child.namedChildren) {
        if (!c) continue;
        const name = phpQualifiedName(c);
        if (!name) continue;
        const refId = `php:iface_ref:${name}`;
        ctx.ensureRef(refId, name, 'interface');
        ctx.pushEdge({
          id: `implements:${owner.id}:${name}`,
          sourceId: owner.id,
          targetId: refId,
          relationType: 'implements',
          tag: 'EXTRACTED',
          confidence: 1.0,
          sourceFile: ctx.filePath,
          sourceLocation: owner.sourceLocation,
          createdAt: ctx.now,
        });
      }
    }
  }
}

function processPhpUseDeclaration(node: TSNode, ctx: ExtractionContext): void {
  const startLine = node.startPosition.row + 1;
  for (const child of node.namedChildren) {
    if (!child) continue;
    // Single-line `use Foo\Bar;` and grouped `use Foo\{Bar, Baz};`.
    if (child.type === 'namespace_use_clause' || child.type === 'namespace_use_group_clause') {
      const nameNode = firstChildOfTypes(child, ['qualified_name', 'name', 'namespace_name']);
      if (!nameNode) continue;
      const fullName = nameNode.text;
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
  }
}

function processPhpCall(node: TSNode, ctx: ExtractionContext, scope: GraphNode): void {
  let callee: string | null = null;
  if (node.type === 'function_call_expression') {
    const fn = node.childForFieldName('function');
    if (fn) callee = lastSegmentOfQualifiedName(fn.text);
  } else {
    // member / nullsafe-member / scoped — all expose the called name as `name`.
    const nameField = node.childForFieldName('name');
    if (nameField) callee = nameField.text;
  }
  if (!callee) return;

  const startLine = node.startPosition.row + 1;
  const startCol = node.startPosition.column;
  const refId = `php:func_ref:${callee}`;
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

function extractPhpParams(paramsNode: TSNode | null): string[] {
  if (!paramsNode) return [];
  const out: string[] = [];
  for (const c of paramsNode.namedChildren) {
    if (!c) continue;
    // `simple_parameter`, `variadic_parameter`, `property_promotion_parameter`
    const nameField = c.childForFieldName('name');
    if (nameField) out.push(nameField.text);
    else out.push(c.text.split(/\s/)[0]);
  }
  return out;
}

function extractPhpDocstring(node: TSNode): string | undefined {
  const prev = node.previousSibling;
  if (prev && prev.type === 'comment' && prev.text.startsWith('/**')) {
    return prev.text;
  }
  return undefined;
}

function phpQualifiedName(node: TSNode | null): string | null {
  if (!node) return null;
  // qualified_name nests namespace_name; named_type for newer grammars.
  if (node.type === 'qualified_name' || node.type === 'namespace_name' || node.type === 'name') {
    return node.text;
  }
  const first = node.firstNamedChild;
  if (first) return phpQualifiedName(first);
  return node.text || null;
}

function lastSegmentOfQualifiedName(s: string): string {
  // PHP namespaces use `\` as the separator; we only care about the unqualified
  // function name for the calls graph.
  const idx = s.lastIndexOf('\\');
  return idx === -1 ? s : s.slice(idx + 1);
}

function firstChildOfTypes(node: TSNode, types: string[]): TSNode | null {
  for (const c of node.namedChildren) {
    if (c && types.includes(c.type)) return c;
  }
  return null;
}
