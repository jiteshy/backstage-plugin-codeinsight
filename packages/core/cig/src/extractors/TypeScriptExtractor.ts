import type { CIGEdge, CIGNode, RepoFile, SymbolType } from '@codeinsight/types';
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

export class TypeScriptExtractor implements LanguageExtractor {
  readonly languages = ['typescript', 'tsx', 'javascript'];

  // -------------------------------------------------------------------------
  // Symbol extraction (Pass 1)
  // -------------------------------------------------------------------------

  extractSymbols(tree: Parser.Tree, file: RepoFile, repoId: string): CIGNode[] {
    const nodes: CIGNode[] = [];
    this.walkForSymbols(tree.rootNode, file, repoId, nodes, false, null);
    return nodes;
  }

  // -------------------------------------------------------------------------
  // Edge extraction (Pass 2) — stub for 1.7.3
  // -------------------------------------------------------------------------

  extractEdges(
    _tree: Parser.Tree,
    _file: RepoFile,
    _repoId: string,
    _nodesByFile: Map<string, CIGNode[]>,
  ): CIGEdge[] {
    return [];
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
