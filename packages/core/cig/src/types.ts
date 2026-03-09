import type { CIGEdge, CIGNode, RepoFile } from '@codeinsight/types';
import type Parser from 'tree-sitter';

// ---------------------------------------------------------------------------
// LanguageExtractor — implement one per language to add CIG support
// ---------------------------------------------------------------------------

/**
 * Extracts CIG nodes and edges from a parsed AST for a specific language.
 * Adding a new language = implementing this interface and registering it
 * with the CIGBuilder via `registerExtractor()`.
 */
export interface LanguageExtractor {
  /** Languages this extractor handles (e.g. ['typescript', 'javascript']). */
  readonly languages: string[];

  /** Extract symbols (functions, classes, interfaces, etc.) from a parsed AST. */
  extractSymbols(tree: Parser.Tree, file: RepoFile, repoId: string): CIGNode[];

  /** Extract relationships (imports, exports, calls, extends) from a parsed AST. */
  extractEdges(
    tree: Parser.Tree,
    file: RepoFile,
    repoId: string,
    nodesByFile: Map<string, CIGNode[]>,
  ): CIGEdge[];
}

// ---------------------------------------------------------------------------
// CIGBuilder configuration
// ---------------------------------------------------------------------------

export interface CIGBuilderConfig {
  /** Maximum file size in bytes to parse (default: 1MB). */
  maxFileSizeBytes?: number;
}

// ---------------------------------------------------------------------------
// Build result
// ---------------------------------------------------------------------------

export interface CIGBuildResult {
  nodes: CIGNode[];
  edges: CIGEdge[];
  filesProcessed: number;
  filesSkipped: number;
  errors: Array<{ filePath: string; error: string }>;
}
