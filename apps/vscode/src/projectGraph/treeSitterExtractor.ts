/**
 * Tree-sitter extractor for TypeScript / JavaScript / TSX / JSX source files.
 *
 * Walks the parsed AST and emits typed graph nodes (module, function, class,
 * interface) plus relations (imports, calls, extends, implements). Targets that
 * cannot be resolved within the file (imported modules, called functions defined
 * elsewhere, extended classes) are emitted as INFERRED placeholder ref nodes so
 * a later pass can reconcile them with their real definitions.
 *
 * Lazy-loaded so the WASM runtime is only paid for when graph extraction
 * actually runs (project graph builds are user-initiated, never on activation).
 */

import * as path from 'path';
import * as fs from 'fs';
import { createHash } from 'node:crypto';
import type {
  Language as TSLanguage,
  Node as TSNode,
  Parser as TSParser,
} from 'web-tree-sitter';
import type { GraphEdge, GraphNode, GraphNodeType, RelationType } from './index.js';
import { walkPhp } from './treeSitterPhp.js';
import { walkPython } from './treeSitterPython.js';
import { walkCsharp } from './treeSitterCsharp.js';

const MAX_FILE_BYTES = 1024 * 1024; // 1 MB

export type TreeSitterLanguageKey =
  | 'typescript'
  | 'tsx'
  | 'javascript'
  | 'php'
  | 'python'
  | 'csharp';

export interface ExtractResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  contentHash: string;
  skipped?: boolean;
}

/**
 * Resolve the path to a tree-sitter WASM binary.
 *
 * Tried in order:
 *   1. Alongside the compiled extension output (`<out>/<file>`) — populated by
 *      `copy-tree-sitter-wasm.mjs` and shipped in the VSIX.
 *   2. `node_modules/<pkg>/<file>` via `require.resolve` — used in dev (tsc)
 *      and unit tests (vitest) where node_modules is reachable.
 *   3. The bare filename — last-resort fallback.
 */
function locateWasm(file: string): string {
  // Compiled location is `apps/vscode/out/projectGraph/treeSitterExtractor.js`,
  // so __dirname is .../out/projectGraph/ — but copy-tree-sitter-wasm.mjs writes
  // the WASMs to .../out/. Check the parent dir first.
  const oneUp = path.join(__dirname, '..', file);
  if (fs.existsSync(oneUp)) return oneUp;
  const nearby = path.join(__dirname, file);
  if (fs.existsSync(nearby)) return nearby;
  try {
    if (file === 'tree-sitter.wasm') {
      return require.resolve(`web-tree-sitter/${file}`);
    }
    if (file === 'tree-sitter-typescript.wasm' || file === 'tree-sitter-tsx.wasm') {
      return require.resolve(`tree-sitter-typescript/${file}`);
    }
    if (file === 'tree-sitter-javascript.wasm') {
      return require.resolve(`tree-sitter-javascript/${file}`);
    }
    // PHP ships two grammars (full PHP w/ HTML embedding, and PHP-only). We
    // use the PHP-only one and rename it on copy; in dev/test, fall back to
    // resolving the upstream filename.
    if (file === 'tree-sitter-php.wasm') {
      return require.resolve(`tree-sitter-php/tree-sitter-php_only.wasm`);
    }
    if (file === 'tree-sitter-python.wasm') {
      return require.resolve(`tree-sitter-python/${file}`);
    }
    if (file === 'tree-sitter-c-sharp.wasm') {
      return require.resolve(`tree-sitter-c-sharp/tree-sitter-c_sharp.wasm`);
    }
  } catch {
    /* fall through */
  }
  return file;
}

export function detectLanguage(filePath: string): TreeSitterLanguageKey | null {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.ts' || ext === '.mts' || ext === '.cts') return 'typescript';
  if (ext === '.tsx') return 'tsx';
  if (ext === '.jsx' || ext === '.mjs' || ext === '.cjs' || ext === '.js') return 'javascript';
  if (ext === '.php') return 'php';
  if (ext === '.py') return 'python';
  if (ext === '.cs') return 'csharp';
  return null;
}

function wasmFileFor(key: TreeSitterLanguageKey): string {
  switch (key) {
    case 'typescript': return 'tree-sitter-typescript.wasm';
    case 'tsx': return 'tree-sitter-tsx.wasm';
    case 'javascript': return 'tree-sitter-javascript.wasm';
    case 'php': return 'tree-sitter-php.wasm';
    case 'python': return 'tree-sitter-python.wasm';
    case 'csharp': return 'tree-sitter-c-sharp.wasm';
  }
}

type WebTreeSitterModule = typeof import('web-tree-sitter');

export class TreeSitterExtractor {
  private modulePromise: Promise<WebTreeSitterModule> | null = null;
  private initPromise: Promise<void> | null = null;
  private parsers = new Map<TreeSitterLanguageKey, TSParser>();
  private languages = new Map<TreeSitterLanguageKey, TSLanguage>();

  async extract(filePath: string, source: string): Promise<ExtractResult> {
    const contentHash = createHash('sha256').update(source).digest('hex');

    if (Buffer.byteLength(source, 'utf8') > MAX_FILE_BYTES) {
      return { nodes: [], edges: [], contentHash, skipped: true };
    }

    const langKey = detectLanguage(filePath);
    if (!langKey) {
      return { nodes: [], edges: [], contentHash, skipped: true };
    }

    const parser = await this.getParser(langKey);
    const tree = parser.parse(source);
    if (!tree) {
      return { nodes: [], edges: [], contentHash, skipped: true };
    }

    try {
      const ctx = new ExtractionContext(filePath, contentHash, langKey);
      switch (langKey) {
        case 'typescript':
        case 'tsx':
        case 'javascript':
          ctx.walkTypescript(tree.rootNode, ctx.moduleNode);
          break;
        case 'php':
          walkPhp(tree.rootNode, ctx);
          break;
        case 'python':
          walkPython(tree.rootNode, ctx, source);
          break;
        case 'csharp':
          walkCsharp(tree.rootNode, ctx);
          break;
      }
      return {
        nodes: ctx.allNodes(),
        edges: ctx.edges,
        contentHash,
      };
    } finally {
      tree.delete();
    }
  }

  private async loadModule(): Promise<WebTreeSitterModule> {
    if (!this.modulePromise) {
      this.modulePromise = import('web-tree-sitter');
    }
    return this.modulePromise;
  }

  private async ensureInit(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        const mod = await this.loadModule();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await mod.Parser.init({ locateFile: (file: string) => locateWasm(file) } as any);
      })();
    }
    return this.initPromise;
  }

  private async getLanguage(key: TreeSitterLanguageKey): Promise<TSLanguage> {
    const cached = this.languages.get(key);
    if (cached) return cached;
    await this.ensureInit();
    const mod = await this.loadModule();
    const lang = await mod.Language.load(locateWasm(wasmFileFor(key)));
    this.languages.set(key, lang);
    return lang;
  }

  async getParser(key: TreeSitterLanguageKey): Promise<TSParser> {
    const cached = this.parsers.get(key);
    if (cached) return cached;
    const mod = await this.loadModule();
    const lang = await this.getLanguage(key);
    const parser = new mod.Parser();
    parser.setLanguage(lang);
    this.parsers.set(key, parser);
    return parser;
  }
}

export class ExtractionContext {
  filePath: string;
  relPath: string;
  contentHash: string;
  langKey: TreeSitterLanguageKey;
  moduleNode: GraphNode;
  realNodes: GraphNode[] = [];
  refNodes = new Map<string, GraphNode>();
  edges: GraphEdge[] = [];
  now = Date.now();

  constructor(filePath: string, contentHash: string, langKey: TreeSitterLanguageKey) {
    this.filePath = filePath;
    this.relPath = filePath.replace(/\\/g, '/');
    this.contentHash = contentHash;
    this.langKey = langKey;
    this.moduleNode = {
      id: `module:${this.relPath}`,
      label: path.basename(filePath),
      type: 'module',
      sourceFile: filePath,
      properties: { language: langKey },
      tag: 'EXTRACTED',
      confidence: 1.0,
      contentHash,
      createdAt: this.now,
      updatedAt: this.now,
    };
    this.realNodes.push(this.moduleNode);
  }

  allNodes(): GraphNode[] {
    return [...this.realNodes, ...this.refNodes.values()];
  }

  walkTypescript(node: TSNode, scope: GraphNode): void {
    switch (node.type) {
      case 'function_declaration': {
        const funcNode = this.makeFunctionNode(
          node,
          'function_declaration',
          node.childForFieldName('parameters'),
        );
        if (funcNode) {
          this.realNodes.push(funcNode);
          const body = node.childForFieldName('body');
          if (body) this.walkTypescript(body, funcNode);
        }
        return;
      }
      case 'method_definition': {
        const funcNode = this.makeFunctionNode(
          node,
          'method_definition',
          node.childForFieldName('parameters'),
        );
        if (funcNode) {
          this.realNodes.push(funcNode);
          // If the enclosing scope is a class/interface, emit a member_of edge.
          if (scope.type === 'class' || scope.type === 'interface') {
            this.edges.push({
              id: `member_of:${funcNode.id}:${scope.id}`,
              sourceId: funcNode.id,
              targetId: scope.id,
              relationType: 'member_of',
              tag: 'EXTRACTED',
              confidence: 1.0,
              sourceFile: this.filePath,
              sourceLocation: funcNode.sourceLocation,
              createdAt: this.now,
            });
          }
          const body = node.childForFieldName('body');
          if (body) this.walkTypescript(body, funcNode);
        }
        return;
      }
      case 'variable_declarator': {
        const value = node.childForFieldName('value');
        const nameField = node.childForFieldName('name');
        if (
          value &&
          value.type === 'arrow_function' &&
          nameField &&
          nameField.type === 'identifier'
        ) {
          const startLine = node.startPosition.row + 1;
          const funcNode = this.makeArrowFunctionNode(value, nameField.text, startLine);
          this.realNodes.push(funcNode);
          const body = value.childForFieldName('body');
          if (body) this.walkTypescript(body, funcNode);
          return;
        }
        break;
      }
      case 'class_declaration': {
        const classNode = this.makeClassOrInterfaceNode(node, 'class', 'class');
        if (classNode) {
          this.realNodes.push(classNode);
          this.processClassHeritage(node, classNode);
          const body = node.childForFieldName('body');
          if (body) this.walkTypescript(body, classNode);
        }
        return;
      }
      case 'interface_declaration': {
        const ifaceNode = this.makeClassOrInterfaceNode(node, 'interface', 'iface');
        if (ifaceNode) {
          this.realNodes.push(ifaceNode);
          this.processInterfaceHeritage(node, ifaceNode);
          const body = node.childForFieldName('body');
          if (body) this.walkTypescript(body, ifaceNode);
        }
        return;
      }
      case 'import_statement': {
        this.processImport(node);
        return;
      }
      case 'call_expression': {
        this.processCall(node, scope);
        for (const c of node.namedChildren) {
          if (c) this.walkTypescript(c, scope);
        }
        return;
      }
    }

    // Default: recurse into named children, preserving the current scope.
    for (const c of node.namedChildren) {
      if (c) this.walkTypescript(c, scope);
    }
  }

  // ── Helpers reused by the per-language walkers (PHP/Python/C#) ─────────

  /**
   * Push a node onto the realNodes list. Per-language walkers use this so
   * they don't have to know about ExtractionContext's internal storage.
   */
  pushNode(node: GraphNode): void {
    this.realNodes.push(node);
  }

  /** Append an edge. Per-language walkers use this. */
  pushEdge(edge: GraphEdge): void {
    this.edges.push(edge);
  }

  /** Lazily create a placeholder ref node for an unresolved target. */
  ensureRef(
    id: string,
    label: string,
    type: GraphNodeType,
    extras?: { sourceFile?: string },
  ): GraphNode {
    return this.ensureRefNode(id, label, type, extras);
  }

  private makeFunctionNode(
    node: TSNode,
    kind: string,
    paramsNode: TSNode | null,
  ): GraphNode | null {
    const nameField = node.childForFieldName('name');
    if (!nameField) return null;
    const name = nameField.text;
    const startLine = node.startPosition.row + 1;
    return {
      id: `func:${this.relPath}:${startLine}:${name}`,
      label: name,
      type: 'function',
      sourceFile: this.filePath,
      sourceLocation: String(startLine),
      properties: {
        params: extractParams(paramsNode),
        async: isAsync(node),
        kind,
      },
      tag: 'EXTRACTED',
      confidence: 1.0,
      contentHash: this.contentHash,
      createdAt: this.now,
      updatedAt: this.now,
    };
  }

  private makeArrowFunctionNode(arrowNode: TSNode, name: string, startLine: number): GraphNode {
    return {
      id: `func:${this.relPath}:${startLine}:${name}`,
      label: name,
      type: 'function',
      sourceFile: this.filePath,
      sourceLocation: String(startLine),
      properties: {
        params: extractParams(arrowNode.childForFieldName('parameters')),
        async: isAsync(arrowNode),
        kind: 'arrow_function',
      },
      tag: 'EXTRACTED',
      confidence: 1.0,
      contentHash: this.contentHash,
      createdAt: this.now,
      updatedAt: this.now,
    };
  }

  private makeClassOrInterfaceNode(
    node: TSNode,
    type: 'class' | 'interface',
    idPrefix: 'class' | 'iface',
  ): GraphNode | null {
    const nameField = node.childForFieldName('name');
    if (!nameField) return null;
    const name = nameField.text;
    const startLine = node.startPosition.row + 1;
    return {
      id: `${idPrefix}:${this.relPath}:${startLine}:${name}`,
      label: name,
      type,
      sourceFile: this.filePath,
      sourceLocation: String(startLine),
      properties: {},
      tag: 'EXTRACTED',
      confidence: 1.0,
      contentHash: this.contentHash,
      createdAt: this.now,
      updatedAt: this.now,
    };
  }

  private processImport(node: TSNode): void {
    const sourceField = node.childForFieldName('source');
    if (!sourceField) return;
    const importPath = unquote(sourceField.text);
    if (!importPath) return;
    const targetId = `module_ref:${importPath}`;
    this.ensureRefNode(targetId, importPath, 'module', { sourceFile: importPath });
    const startLine = node.startPosition.row + 1;
    const startCol = node.startPosition.column;
    this.edges.push({
      id: `import:${this.moduleNode.id}:${startLine}:${startCol}:${importPath}`,
      sourceId: this.moduleNode.id,
      targetId,
      relationType: 'imports',
      tag: 'EXTRACTED',
      confidence: 1.0,
      sourceFile: this.filePath,
      sourceLocation: String(startLine),
      createdAt: this.now,
    });
  }

  private processCall(node: TSNode, scope: GraphNode): void {
    const fnField = node.childForFieldName('function');
    if (!fnField) return;
    const callee = extractCalleeName(fnField);
    if (!callee) return;
    const targetId = `func_ref:${callee}`;
    this.ensureRefNode(targetId, callee, 'function');
    const startLine = node.startPosition.row + 1;
    const startCol = node.startPosition.column;
    this.edges.push({
      id: `call:${scope.id}:${startLine}:${startCol}:${callee}`,
      sourceId: scope.id,
      targetId,
      relationType: 'calls',
      tag: 'EXTRACTED',
      confidence: 1.0,
      sourceFile: this.filePath,
      sourceLocation: String(startLine),
      createdAt: this.now,
    });
  }

  private processClassHeritage(classDecl: TSNode, classNode: GraphNode): void {
    for (const child of classDecl.children) {
      if (!child || child.type !== 'class_heritage') continue;
      for (const sub of child.children) {
        if (!sub) continue;
        if (sub.type === 'extends_clause') {
          for (const name of collectClauseTargets(sub, 'value')) {
            this.emitHeritageEdge(classNode, name, 'extends', 'class');
          }
        } else if (sub.type === 'implements_clause') {
          for (const name of collectClauseTargets(sub, 'type')) {
            this.emitHeritageEdge(classNode, name, 'implements', 'interface');
          }
        } else if (sub.isNamed) {
          // JS grammar: `class_heritage` is just `extends <expression>`.
          const name = extractTypeName(sub);
          if (name) this.emitHeritageEdge(classNode, name, 'extends', 'class');
        }
      }
    }
  }

  private processInterfaceHeritage(ifaceDecl: TSNode, ifaceNode: GraphNode): void {
    for (const child of ifaceDecl.children) {
      if (!child || child.type !== 'extends_type_clause') continue;
      for (const name of collectClauseTargets(child, 'type')) {
        this.emitHeritageEdge(ifaceNode, name, 'extends', 'interface');
      }
    }
  }

  private emitHeritageEdge(
    source: GraphNode,
    targetName: string,
    relation: Extract<RelationType, 'extends' | 'implements'>,
    targetType: 'class' | 'interface',
  ): void {
    const refPrefix = targetType === 'class' ? 'class_ref' : 'iface_ref';
    const targetId = `${refPrefix}:${targetName}`;
    this.ensureRefNode(targetId, targetName, targetType);
    this.edges.push({
      id: `${relation}:${source.id}:${targetName}`,
      sourceId: source.id,
      targetId,
      relationType: relation,
      tag: 'EXTRACTED',
      confidence: 1.0,
      sourceFile: this.filePath,
      sourceLocation: source.sourceLocation,
      createdAt: this.now,
    });
  }

  private ensureRefNode(
    id: string,
    label: string,
    type: GraphNodeType,
    extras?: { sourceFile?: string },
  ): GraphNode {
    const existing = this.refNodes.get(id);
    if (existing) return existing;
    const node: GraphNode = {
      id,
      label,
      type,
      sourceFile: extras?.sourceFile,
      properties: {},
      tag: 'INFERRED',
      confidence: 0.6,
      createdAt: this.now,
      updatedAt: this.now,
    };
    this.refNodes.set(id, node);
    return node;
  }
}

function extractParams(paramsNode: TSNode | null): string[] {
  if (!paramsNode) return [];
  const out: string[] = [];
  for (const c of paramsNode.namedChildren) {
    if (!c) continue;
    const pattern = c.childForFieldName('pattern') ?? c;
    out.push(pattern.text);
  }
  return out;
}

function isAsync(node: TSNode): boolean {
  for (const c of node.children) {
    if (c && c.type === 'async') return true;
  }
  return false;
}

function unquote(s: string): string {
  if (
    s.length >= 2 &&
    (s[0] === '"' || s[0] === "'" || s[0] === '`') &&
    s[s.length - 1] === s[0]
  ) {
    return s.slice(1, -1);
  }
  return s;
}

function extractCalleeName(node: TSNode): string | null {
  if (!node) return null;
  if (node.type === 'identifier' || node.type === 'property_identifier') {
    return node.text;
  }
  if (node.type === 'super') return 'super';
  if (node.type === 'member_expression') {
    const prop = node.childForFieldName('property');
    if (prop) return prop.text;
  }
  if (node.type === 'subscript_expression') {
    const idx = node.childForFieldName('index');
    if (idx && (idx.type === 'string' || idx.type === 'number')) {
      return unquote(idx.text);
    }
  }
  // Parenthesised / unwrap: try first named child.
  const first = node.firstNamedChild;
  if (first) return extractCalleeName(first);
  return null;
}

function extractTypeName(node: TSNode | null): string | null {
  if (!node) return null;
  if (node.type === 'identifier' || node.type === 'type_identifier') return node.text;
  if (node.type === 'generic_type' || node.type === 'nested_type_identifier') {
    const nameNode = node.childForFieldName('name');
    if (nameNode) return extractTypeName(nameNode);
  }
  if (node.type === 'member_expression') {
    const prop = node.childForFieldName('property');
    if (prop) return prop.text;
  }
  const first = node.firstNamedChild;
  if (first) return extractTypeName(first);
  return null;
}

function collectClauseTargets(clause: TSNode, fieldName: string): string[] {
  const out: string[] = [];
  const fieldChildren = clause.childrenForFieldName(fieldName);
  for (const c of fieldChildren) {
    if (!c) continue;
    const name = extractTypeName(c);
    if (name) out.push(name);
  }
  if (out.length === 0) {
    for (const c of clause.namedChildren) {
      if (!c) continue;
      const name = extractTypeName(c);
      if (name) out.push(name);
    }
  }
  return out;
}

export const treeSitterExtractor = new TreeSitterExtractor();
