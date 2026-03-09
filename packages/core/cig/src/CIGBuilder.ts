import type { CIGEdge, CIGNode, RepoFile } from '@codeinsight/types';
import Parser from 'tree-sitter';

import type {
  CIGBuildResult,
  CIGBuilderConfig,
  LanguageExtractor,
} from './types';

/* eslint-disable @typescript-eslint/no-var-requires */
const treeSitterJavascript = require('tree-sitter-javascript');
const treeSitterTypescript = require('tree-sitter-typescript');
/* eslint-enable @typescript-eslint/no-var-requires */

// ---------------------------------------------------------------------------
// Grammar registry — maps language names to Tree-sitter grammars
// ---------------------------------------------------------------------------

type GrammarLoader = () => Parser.Language;

const GRAMMAR_REGISTRY: Record<string, GrammarLoader> = {
  typescript: () => treeSitterTypescript.typescript,
  tsx: () => treeSitterTypescript.tsx,
  javascript: () => treeSitterJavascript,
};

// ---------------------------------------------------------------------------
// CIGBuilder — dispatches to registered LanguageExtractors
// ---------------------------------------------------------------------------

const DEFAULT_MAX_FILE_SIZE = 1_048_576; // 1 MB

export class CIGBuilder {
  private readonly extractors = new Map<string, LanguageExtractor>();
  private readonly parsers = new Map<string, Parser>();
  private readonly config: Required<CIGBuilderConfig>;

  constructor(config: CIGBuilderConfig = {}) {
    this.config = {
      maxFileSizeBytes: config.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE,
    };
  }

  // -------------------------------------------------------------------------
  // Extractor registration
  // -------------------------------------------------------------------------

  registerExtractor(extractor: LanguageExtractor): void {
    for (const lang of extractor.languages) {
      this.extractors.set(lang, extractor);
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Build a CIG from a set of repo files with their source contents.
   * Files without a registered extractor are skipped.
   */
  build(
    repoId: string,
    files: Array<{ file: RepoFile; content: string }>,
  ): CIGBuildResult {
    const allNodes: CIGNode[] = [];
    const allEdges: CIGEdge[] = [];
    const errors: Array<{ filePath: string; error: string }> = [];
    let filesProcessed = 0;
    let filesSkipped = 0;

    // Collect nodes per file for edge resolution + cache parsed trees
    const nodesByFile = new Map<string, CIGNode[]>();
    const treeCache = new Map<string, { tree: Parser.Tree; file: RepoFile }>();

    // --- Pass 1: extract symbols ---
    for (const { file, content } of files) {
      const language = file.language;

      if (!language || !this.extractors.has(language)) {
        filesSkipped++;
        continue;
      }

      if (Buffer.byteLength(content, 'utf8') > this.config.maxFileSizeBytes) {
        filesSkipped++;
        errors.push({
          filePath: file.filePath,
          error: `File exceeds max size (${this.config.maxFileSizeBytes} bytes)`,
        });
        continue;
      }

      try {
        const parser = this.getParser(language);
        const tree = parser.parse(content);
        treeCache.set(file.filePath, { tree, file });
        const extractor = this.extractors.get(language)!;
        const nodes = extractor.extractSymbols(tree, file, repoId);
        nodesByFile.set(file.filePath, nodes);
        allNodes.push(...nodes);
        filesProcessed++;
      } catch (err) {
        filesSkipped++;
        errors.push({
          filePath: file.filePath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // --- Pass 2: extract edges (reuse cached trees) ---
    for (const [filePath, { tree, file }] of treeCache) {
      const language = file.language!;
      const extractor = this.extractors.get(language);
      if (!extractor || !nodesByFile.has(filePath)) continue;

      try {
        const edges = extractor.extractEdges(tree, file, repoId, nodesByFile);
        allEdges.push(...edges);
      } catch (err) {
        errors.push({
          filePath,
          error: `Edge extraction failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    return { nodes: allNodes, edges: allEdges, filesProcessed, filesSkipped, errors };
  }

  // -------------------------------------------------------------------------
  // Parser management
  // -------------------------------------------------------------------------

  private getParser(language: string): Parser {
    let parser = this.parsers.get(language);
    if (parser) return parser;

    const grammarLoader = GRAMMAR_REGISTRY[language];
    if (!grammarLoader) {
      throw new Error(`No Tree-sitter grammar registered for language: ${language}`);
    }

    parser = new Parser();
    parser.setLanguage(grammarLoader());
    this.parsers.set(language, parser);
    return parser;
  }
}
