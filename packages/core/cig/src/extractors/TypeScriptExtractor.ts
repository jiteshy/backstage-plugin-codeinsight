import path from 'path';

import type { CIGEdge, CIGNode, EdgeType, RepoFile, SymbolType } from '@codeinsight/types';
import type Parser from 'tree-sitter';

import type { LanguageExtractor } from '../types';

// ---------------------------------------------------------------------------
// TypeScriptExtractor — symbol extraction for TS, TSX, and JS files
// ---------------------------------------------------------------------------

/** AST node types that contain nested statements worth recursing into. */
const NESTED_BLOCK_TYPES = new Set([
  'statement_block',
  'if_statement',
  'for_statement',
  'for_in_statement',
  'for_of_statement',
  'while_statement',
  'do_statement',
  'try_statement',
  'switch_statement',
]);

/** Build the deterministic nodeId for a file's module-level CIGNode. */
function moduleNodeId(repoId: string, filePath: string): string {
  return `${repoId}:${filePath}:<module>:variable`;
}

export class TypeScriptExtractor implements LanguageExtractor {
  readonly languages = ['typescript', 'tsx', 'javascript'];

  // -------------------------------------------------------------------------
  // Symbol extraction (Pass 1)
  // -------------------------------------------------------------------------

  extractSymbols(tree: Parser.Tree, file: RepoFile, repoId: string): CIGNode[] {
    const nodes: CIGNode[] = [];
    this.walkForSymbols(tree.rootNode, file, repoId, nodes, false, null);
    this.walkForRoutes(tree.rootNode, file, repoId, nodes);
    return nodes;
  }

  // -------------------------------------------------------------------------
  // Edge extraction (Pass 2) — import/export relationships
  // -------------------------------------------------------------------------

  extractEdges(
    tree: Parser.Tree,
    file: RepoFile,
    repoId: string,
    nodesByFile: Map<string, CIGNode[]>,
  ): CIGEdge[] {
    const edges: CIGEdge[] = [];
    const srcModuleId = moduleNodeId(repoId, file.filePath);
    const allFilePaths = Array.from(nodesByFile.keys());

    this.walkForEdges(tree.rootNode, file, repoId, srcModuleId, nodesByFile, allFilePaths, edges);
    return edges;
  }

  // -------------------------------------------------------------------------
  // Private: recursive symbol walker
  // -------------------------------------------------------------------------

  private walkForSymbols(
    node: Parser.SyntaxNode,
    file: RepoFile,
    repoId: string,
    out: CIGNode[],
    parentExported: boolean,
    parentClassName: string | null,
  ): void {
    // --- export_statement: unwrap and mark children as exported ---
    // Walk named children (function/class/interface/etc.) — they carry the symbol.
    // `export default 42` or `export default <expr>` has no named child that
    // matches a symbol declaration, so the loop produces nothing and we return.
    if (node.type === 'export_statement') {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)!;
        this.walkForSymbols(child, file, repoId, out, true, parentClassName);
      }
      return;
    }

    // --- function_declaration / generator_function_declaration ---
    if (
      node.type === 'function_declaration' ||
      node.type === 'generator_function_declaration'
    ) {
      const name = node.childForFieldName('name');
      if (name) {
        out.push(
          this.makeNode(repoId, file, name.text, 'function', node, parentExported, parentClassName),
        );
      }
      // Check for nested functions inside the body
      const body = node.childForFieldName('body');
      if (body) {
        this.walkBodyForNested(body, file, repoId, out, parentClassName);
      }
      return;
    }

    // --- class_declaration / abstract_class_declaration ---
    if (
      node.type === 'class_declaration' ||
      node.type === 'abstract_class_declaration'
    ) {
      const name = node.childForFieldName('name');
      const className = name?.text ?? null;
      if (name) {
        out.push(
          this.makeNode(repoId, file, name.text, 'class', node, parentExported, parentClassName),
        );
      }
      // Extract class methods
      const body = node.childForFieldName('body');
      if (body) {
        for (let i = 0; i < body.namedChildCount; i++) {
          const member = body.namedChild(i)!;
          if (member.type === 'method_definition') {
            this.extractMethod(member, file, repoId, out, className);
          }
        }
      }
      return;
    }

    // --- interface_declaration ---
    if (node.type === 'interface_declaration') {
      const name = node.childForFieldName('name');
      if (name) {
        out.push(
          this.makeNode(repoId, file, name.text, 'interface', node, parentExported, parentClassName),
        );
      }
      return;
    }

    // --- type_alias_declaration ---
    if (node.type === 'type_alias_declaration') {
      const name = node.childForFieldName('name');
      if (name) {
        out.push(
          this.makeNode(repoId, file, name.text, 'type', node, parentExported, parentClassName),
        );
      }
      return;
    }

    // --- enum_declaration ---
    if (node.type === 'enum_declaration') {
      const name = node.childForFieldName('name');
      if (name) {
        out.push(
          this.makeNode(repoId, file, name.text, 'enum', node, parentExported, parentClassName),
        );
      }
      return;
    }

    // --- lexical_declaration / variable_declaration (arrow functions) ---
    if (
      node.type === 'lexical_declaration' ||
      node.type === 'variable_declaration'
    ) {
      for (let i = 0; i < node.namedChildCount; i++) {
        const declarator = node.namedChild(i)!;
        if (declarator.type === 'variable_declarator') {
          const nameNode = declarator.childForFieldName('name');
          const valueNode = declarator.childForFieldName('value');
          if (nameNode && valueNode?.type === 'arrow_function') {
            out.push(
              this.makeNode(
                repoId,
                file,
                nameNode.text,
                'function',
                node, // use the full declaration for line range
                parentExported,
                parentClassName,
              ),
            );
            // Check for nested functions inside arrow body
            const body = valueNode.childForFieldName('body');
            if (body) {
              this.walkBodyForNested(body, file, repoId, out, parentClassName);
            }
          } else if (nameNode && valueNode?.type === 'function') {
            // const foo = function() {}
            out.push(
              this.makeNode(repoId, file, nameNode.text, 'function', node, parentExported, parentClassName),
            );
            const body = valueNode.childForFieldName('body');
            if (body) {
              this.walkBodyForNested(body, file, repoId, out, parentClassName);
            }
          }
        }
      }
      return;
    }

    // --- Default: recurse into children for top-level statements ---
    if (node.type === 'program' || node.type === 'statement_block') {
      for (let i = 0; i < node.namedChildCount; i++) {
        this.walkForSymbols(node.namedChild(i)!, file, repoId, out, false, parentClassName);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Extract class method
  // -------------------------------------------------------------------------

  private extractMethod(
    method: Parser.SyntaxNode,
    file: RepoFile,
    repoId: string,
    out: CIGNode[],
    className: string | null,
  ): void {
    // Find the property_identifier child (the method name)
    // and detect get/set kind from anonymous keyword tokens
    let nameNode: Parser.SyntaxNode | null = null;
    let kind: string | null = null;
    for (let i = 0; i < method.childCount; i++) {
      const child = method.child(i)!;
      if (child.type === 'property_identifier') {
        nameNode = child;
        break;
      }
      // Detect get/set keywords (anonymous tokens before the name)
      if (!child.isNamed && (child.type === 'get' || child.type === 'set')) {
        kind = child.type;
      }
    }
    if (!nameNode) return;

    // Disambiguate get/set accessors in the symbol name to avoid nodeId collisions
    const baseName = nameNode.text;
    const qualifiedName = kind ? `${baseName}:${kind}` : baseName;
    const methodName = className
      ? `${className}.${qualifiedName}`
      : qualifiedName;

    out.push(
      this.makeNode(repoId, file, methodName, 'function', method, false, className),
    );

    // Nested functions inside method body
    const body = method.childForFieldName('body');
    if (body) {
      this.walkBodyForNested(body, file, repoId, out, className);
    }
  }

  // -------------------------------------------------------------------------
  // Walk a block body for nested function declarations
  // -------------------------------------------------------------------------

  private walkBodyForNested(
    body: Parser.SyntaxNode,
    file: RepoFile,
    repoId: string,
    out: CIGNode[],
    parentClassName: string | null,
  ): void {
    for (let i = 0; i < body.namedChildCount; i++) {
      const child = body.namedChild(i)!;
      if (
        child.type === 'function_declaration' ||
        child.type === 'generator_function_declaration'
      ) {
        const name = child.childForFieldName('name');
        if (name) {
          out.push(
            this.makeNode(repoId, file, name.text, 'function', child, false, parentClassName),
          );
          // Recurse deeper
          const innerBody = child.childForFieldName('body');
          if (innerBody) {
            this.walkBodyForNested(innerBody, file, repoId, out, parentClassName);
          }
        }
      }
      // Nested arrow function assigned to variable
      if (
        child.type === 'lexical_declaration' ||
        child.type === 'variable_declaration'
      ) {
        for (let j = 0; j < child.namedChildCount; j++) {
          const declarator = child.namedChild(j)!;
          if (declarator.type === 'variable_declarator') {
            const nameNode = declarator.childForFieldName('name');
            const valueNode = declarator.childForFieldName('value');
            if (nameNode && valueNode?.type === 'arrow_function') {
              out.push(
                this.makeNode(repoId, file, nameNode.text, 'function', child, false, parentClassName),
              );
            }
          }
        }
      }
      // Recurse into blocks (if/for/while/etc.)
      if (NESTED_BLOCK_TYPES.has(child.type)) {
        this.walkBodyForNested(child, file, repoId, out, parentClassName);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Edge extraction: walk AST for import/export statements
  // -------------------------------------------------------------------------

  private walkForEdges(
    node: Parser.SyntaxNode,
    file: RepoFile,
    repoId: string,
    srcModuleId: string,
    nodesByFile: Map<string, CIGNode[]>,
    allFilePaths: string[],
    edges: CIGEdge[],
  ): void {
    if (node.type === 'import_statement') {
      this.extractImportEdges(node, file, repoId, srcModuleId, nodesByFile, allFilePaths, edges);
      return;
    }

    if (node.type === 'export_statement') {
      // Re-exports: export { x } from './module' or export * from './module'
      const source = this.getStringLiteralChild(node);
      if (source) {
        this.extractReexportEdges(node, file, repoId, srcModuleId, nodesByFile, allFilePaths, edges);
      }
      return;
    }

    // Recurse into top-level children
    for (let i = 0; i < node.namedChildCount; i++) {
      this.walkForEdges(node.namedChild(i)!, file, repoId, srcModuleId, nodesByFile, allFilePaths, edges);
    }
  }

  private extractImportEdges(
    node: Parser.SyntaxNode,
    file: RepoFile,
    repoId: string,
    srcModuleId: string,
    nodesByFile: Map<string, CIGNode[]>,
    allFilePaths: string[],
    edges: CIGEdge[],
  ): void {
    const sourcePath = this.getStringLiteralChild(node);
    if (!sourcePath || !this.isRelativeImport(sourcePath)) return;

    const resolved = this.resolveImportPath(sourcePath, file.filePath, allFilePaths);
    if (!resolved) return;

    const targetNodes = nodesByFile.get(resolved);
    if (!targetNodes) return;

    // Find import_clause child
    const importClause = this.findChildByType(node, 'import_clause');
    if (!importClause) {
      // Side-effect import: import './module' → edge to target module
      const targetId = moduleNodeId(repoId, resolved);
      edges.push(this.makeEdge(repoId, srcModuleId, targetId, 'imports'));
      return;
    }

    // Process the import clause children
    for (let i = 0; i < importClause.namedChildCount; i++) {
      const child = importClause.namedChild(i)!;

      if (child.type === 'identifier') {
        // Default import: import Foo from './module'
        this.addEdgeForDefaultImport(repoId, srcModuleId, resolved, edges);
      } else if (child.type === 'named_imports') {
        // Named imports: import { Foo, Bar as Baz } from './module'
        this.addEdgesForNamedImports(child, repoId, srcModuleId, resolved, targetNodes, edges);
      } else if (child.type === 'namespace_import') {
        // Namespace import: import * as ns from './module'
        const targetId = moduleNodeId(repoId, resolved);
        edges.push(this.makeEdge(repoId, srcModuleId, targetId, 'imports'));
      }
    }
  }

  private extractReexportEdges(
    node: Parser.SyntaxNode,
    file: RepoFile,
    repoId: string,
    srcModuleId: string,
    nodesByFile: Map<string, CIGNode[]>,
    allFilePaths: string[],
    edges: CIGEdge[],
  ): void {
    const sourcePath = this.getStringLiteralChild(node);
    if (!sourcePath || !this.isRelativeImport(sourcePath)) return;

    const resolved = this.resolveImportPath(sourcePath, file.filePath, allFilePaths);
    if (!resolved) return;

    const targetNodes = nodesByFile.get(resolved);
    if (!targetNodes) return;

    // Check for export * from './module'
    let hasWildcard = false;
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!;
      if (!child.isNamed && child.type === '*') {
        hasWildcard = true;
        break;
      }
    }

    if (hasWildcard) {
      const targetId = moduleNodeId(repoId, resolved);
      edges.push(this.makeEdge(repoId, srcModuleId, targetId, 'imports'));
      return;
    }

    // export { Foo, Bar } from './module' — named re-exports
    const exportClause = this.findChildByType(node, 'export_clause');
    if (exportClause) {
      this.addEdgesForNamedImports(exportClause, repoId, srcModuleId, resolved, targetNodes, edges);
    }
  }

  private addEdgeForDefaultImport(
    repoId: string,
    srcModuleId: string,
    resolved: string,
    edges: CIGEdge[],
  ): void {
    const targetId = moduleNodeId(repoId, resolved);
    edges.push(this.makeEdge(repoId, srcModuleId, targetId, 'imports'));
  }

  private addEdgesForNamedImports(
    importsNode: Parser.SyntaxNode,
    repoId: string,
    srcModuleId: string,
    resolved: string,
    targetNodes: CIGNode[],
    edges: CIGEdge[],
  ): void {
    for (let i = 0; i < importsNode.namedChildCount; i++) {
      const spec = importsNode.namedChild(i)!;
      if (spec.type !== 'import_specifier' && spec.type !== 'export_specifier') continue;

      // For `import { Foo as Bar }`, the imported name is "Foo" (first identifier)
      // For `import { Foo }`, the imported name is "Foo"
      const nameNode = spec.childForFieldName('name');
      const importedName = nameNode?.text ?? spec.namedChild(0)?.text;
      if (!importedName) continue;

      // Handle `default as X` re-exports
      if (importedName === 'default') {
        const targetId = moduleNodeId(repoId, resolved);
        edges.push(this.makeEdge(repoId, srcModuleId, targetId, 'imports'));
        continue;
      }

      // Find the matching exported symbol in the target file
      const targetNode = targetNodes.find(
        n => n.symbolName === importedName && n.exported && n.symbolName !== '<module>',
      );
      if (targetNode) {
        edges.push(this.makeEdge(repoId, srcModuleId, targetNode.nodeId, 'imports'));
      } else {
        // Fallback: create edge to target module (symbol might be re-exported or a type)
        const targetId = moduleNodeId(repoId, resolved);
        edges.push(this.makeEdge(repoId, srcModuleId, targetId, 'imports'));
      }
    }
  }

  // -------------------------------------------------------------------------
  // Path resolution for imports
  // -------------------------------------------------------------------------

  private isRelativeImport(importPath: string): boolean {
    return importPath.startsWith('./') || importPath.startsWith('../');
  }

  private resolveImportPath(
    importPath: string,
    currentFilePath: string,
    allFilePaths: string[],
  ): string | null {
    const currentDir = path.dirname(currentFilePath);
    const resolved = path.normalize(path.join(currentDir, importPath));
    const fileSet = new Set(allFilePaths);

    // Try exact match
    if (fileSet.has(resolved)) return resolved;

    // Try with extensions
    const extensions = ['.ts', '.tsx', '.js', '.jsx'];
    for (const ext of extensions) {
      if (fileSet.has(resolved + ext)) return resolved + ext;
    }

    // Try as directory with index file
    for (const ext of extensions) {
      const indexPath = path.join(resolved, `index${ext}`);
      if (fileSet.has(indexPath)) return indexPath;
    }

    return null;
  }

  // -------------------------------------------------------------------------
  // AST helpers
  // -------------------------------------------------------------------------

  private getStringLiteralChild(node: Parser.SyntaxNode): string | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)!;
      if (child.type === 'string') {
        // Remove quotes from the string literal
        const text = child.text;
        return text.slice(1, -1);
      }
    }
    return null;
  }

  private findChildByType(
    node: Parser.SyntaxNode,
    type: string,
  ): Parser.SyntaxNode | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)!;
      if (child.type === type) return child;
    }
    return null;
  }

  private makeEdge(
    repoId: string,
    fromNodeId: string,
    toNodeId: string,
    edgeType: EdgeType,
  ): CIGEdge {
    return {
      edgeId: `${fromNodeId}->${edgeType}->${toNodeId}`,
      repoId,
      fromNodeId,
      toNodeId,
      edgeType,
    };
  }

  // -------------------------------------------------------------------------
  // Route extraction: Express/Fastify/Koa-style route definitions
  // -------------------------------------------------------------------------

  /** HTTP methods recognized as route-defining calls. */
  private static readonly ROUTE_METHODS = new Set([
    'get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'all',
  ]);

  /** Object names that typically hold a router/app instance. */
  private static readonly ROUTER_OBJECTS = new Set([
    'app', 'router', 'server',
  ]);

  /**
   * Walk the entire AST looking for Express-style route calls:
   *   router.get('/path', handler)
   *   app.post('/path', middleware, handler)
   *   router.use('/prefix', subRouter)
   */
  private walkForRoutes(
    node: Parser.SyntaxNode,
    file: RepoFile,
    repoId: string,
    out: CIGNode[],
  ): void {
    if (node.type === 'call_expression') {
      this.tryExtractRoute(node, file, repoId, out);
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      this.walkForRoutes(node.namedChild(i)!, file, repoId, out);
    }
  }

  /**
   * Check if a call_expression matches a route pattern and extract it.
   */
  private tryExtractRoute(
    callNode: Parser.SyntaxNode,
    file: RepoFile,
    repoId: string,
    out: CIGNode[],
  ): void {
    const fn = callNode.childForFieldName('function');
    if (!fn || fn.type !== 'member_expression') return;

    const object = fn.childForFieldName('object');
    const property = fn.childForFieldName('property');
    if (!object || !property) return;

    const methodName = property.text;

    // Must be a known HTTP method or 'use'
    const isRouteMethod = TypeScriptExtractor.ROUTE_METHODS.has(methodName);
    if (!isRouteMethod && methodName !== 'use') return;

    const args = callNode.childForFieldName('arguments');
    if (!args) return;

    // Check for chained pattern: router.route('/path').get(handler)
    // In this case, object is a call_expression for router.route('/path'),
    // the path comes from .route() args, and .get() args have only handler(s).
    const chainedPath = this.extractChainedRoutePath(object);
    if (chainedPath) {
      const handler = this.extractHandlerFromArgs(args);
      const method = methodName.toUpperCase();
      const symbolName = `${method} ${chainedPath}`;
      const metadata: Record<string, unknown> = {
        httpMethod: method,
        routePath: chainedPath,
      };
      if (handler) metadata.handler = handler;

      out.push({
        nodeId: `${repoId}:${file.filePath}:${method}#${chainedPath}:route`,
        repoId,
        filePath: file.filePath,
        symbolName,
        symbolType: 'route',
        startLine: callNode.startPosition.row + 1,
        endLine: callNode.endPosition.row + 1,
        exported: false,
        extractedSha: file.currentSha,
        metadata,
      });
      return;
    }

    // Standard pattern: router.get('/path', handler)
    const objectName = this.extractObjectName(object);
    if (!objectName) return;
    if (!TypeScriptExtractor.ROUTER_OBJECTS.has(objectName)) return;

    // Extract route path (first string argument) and handler name
    const routeInfo = this.extractRouteInfo(args, methodName);
    if (!routeInfo) return;

    const { routePath, httpMethod, handler } = routeInfo;

    // Build a descriptive symbol name: GET /api/users
    const method = httpMethod.toUpperCase();
    const symbolName = `${method} ${routePath}`;
    const metadata: Record<string, unknown> = {
      httpMethod: method,
      routePath,
    };
    if (handler) {
      metadata.handler = handler;
    }

    // Use # as method/path separator in nodeId to avoid spaces in the colon-delimited key
    out.push({
      nodeId: `${repoId}:${file.filePath}:${method}#${routePath}:route`,
      repoId,
      filePath: file.filePath,
      symbolName,
      symbolType: 'route',
      startLine: callNode.startPosition.row + 1,
      endLine: callNode.endPosition.row + 1,
      exported: false,
      extractedSha: file.currentSha,
      metadata,
    });
  }

  /**
   * Extract the root object name from potentially chained member expressions.
   */
  private extractObjectName(node: Parser.SyntaxNode): string | null {
    if (node.type === 'identifier') {
      return node.text;
    }
    return null;
  }

  /**
   * Detect the chained pattern: `router.route('/path').get(handler).post(handler2)`.
   * Walks up call_expression chains to find the `.route('/path')` root.
   */
  private extractChainedRoutePath(objectNode: Parser.SyntaxNode): string | null {
    if (objectNode.type !== 'call_expression') return null;

    const fn = objectNode.childForFieldName('function');
    if (!fn || fn.type !== 'member_expression') return null;

    const prop = fn.childForFieldName('property');
    if (!prop) return null;

    const obj = fn.childForFieldName('object');
    if (!obj) return null;

    // Found the .route('/path') call at the root
    if (prop.text === 'route') {
      const rootName = this.extractObjectName(obj);
      if (!rootName || !TypeScriptExtractor.ROUTER_OBJECTS.has(rootName)) return null;

      const args = objectNode.childForFieldName('arguments');
      if (!args || args.namedChildCount === 0) return null;

      const firstArg = args.namedChild(0)!;
      if (firstArg.type === 'string') {
        return firstArg.text.slice(1, -1);
      } else if (firstArg.type === 'template_string') {
        return firstArg.text.slice(1, -1);
      }
      return null;
    }

    // Recurse: the object might be another chained call (e.g. .get() before .post())
    return this.extractChainedRoutePath(obj);
  }

  /**
   * Extract handler name from the last argument in a route call's args.
   */
  private extractHandlerFromArgs(argsNode: Parser.SyntaxNode): string | null {
    if (argsNode.namedChildCount === 0) return null;
    const lastArg = argsNode.namedChild(argsNode.namedChildCount - 1)!;
    return this.extractHandlerName(lastArg);
  }

  /**
   * Parse the arguments of a route call to extract path, method, and handler.
   * Returns null if no string path is found (not a route definition).
   */
  private extractRouteInfo(
    argsNode: Parser.SyntaxNode,
    methodName: string,
  ): { routePath: string; httpMethod: string; handler: string | null } | null {
    const isUse = methodName === 'use';
    const args: Parser.SyntaxNode[] = [];
    for (let i = 0; i < argsNode.namedChildCount; i++) {
      args.push(argsNode.namedChild(i)!);
    }

    if (args.length === 0) return null;

    // First arg should be a string literal (the route path)
    const firstArg = args[0];
    let routePath: string | null = null;

    if (firstArg.type === 'string') {
      routePath = firstArg.text.slice(1, -1); // strip surrounding ' or "
    } else if (firstArg.type === 'template_string') {
      // Store raw template text; interpolated paths (e.g. `/api/${v}/users`) are kept verbatim.
      routePath = firstArg.text.slice(1, -1); // strip surrounding backticks
    }

    // For .use() without a string path, skip (middleware-only use)
    if (!routePath && isUse) return null;

    // For HTTP methods without a path (rare but possible: app.get(handler))
    // we still want to capture it if there's a string path
    if (!routePath) return null;

    const httpMethod = methodName; // always lowercase; caller uppercases

    // Handler is the last argument (could be an identifier or member_expression)
    const handler = args.length > 1 ? this.extractHandlerName(args[args.length - 1]) : null;

    return { routePath, httpMethod, handler };
  }

  /**
   * Extract a human-readable handler name from the last argument of a route call.
   */
  private extractHandlerName(node: Parser.SyntaxNode): string | null {
    if (node.type === 'identifier') {
      return node.text;
    }
    if (node.type === 'member_expression') {
      return node.text;
    }
    // Arrow function or function expression — look for a meaningful name
    // In practice these are inline handlers; return null.
    return null;
  }

  // -------------------------------------------------------------------------
  // Build a CIGNode
  // -------------------------------------------------------------------------

  private makeNode(
    repoId: string,
    file: RepoFile,
    symbolName: string,
    symbolType: SymbolType,
    node: Parser.SyntaxNode,
    exported: boolean,
    parentClassName: string | null,
  ): CIGNode {
    const metadata: Record<string, unknown> = {};
    if (parentClassName) {
      metadata.className = parentClassName;
    }

    return {
      nodeId: `${repoId}:${file.filePath}:${symbolName}:${symbolType}`,
      repoId,
      filePath: file.filePath,
      symbolName,
      symbolType,
      startLine: node.startPosition.row + 1, // Tree-sitter is 0-based
      endLine: node.endPosition.row + 1,
      exported,
      extractedSha: file.currentSha,
      metadata: Object.keys(metadata).length > 0 ? metadata : null,
    };
  }
}
