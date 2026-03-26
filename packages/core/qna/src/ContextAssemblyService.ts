import type {
  CIGEdge,
  CIGNode,
  Logger,
  StorageAdapter,
  VectorChunk,
  VectorStore,
} from '@codeinsight/types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ExpansionType = 'callee_snippet' | 'doc_link' | 'import_list';

export interface ContextExpansion {
  type: ExpansionType;
  content: string;
  estimatedTokens: number;
  filePath?: string;
  symbol?: string;
}

export interface ContextBlock {
  chunk: VectorChunk;
  chunkTokens: number;
  expansions: ContextExpansion[];
  expansionTokens: number;
  totalTokens: number;
}

export interface AssembledContext {
  blocks: ContextBlock[];
  totalTokens: number;
  truncated: boolean;
  droppedChunks: number;
}

export interface ContextAssemblyConfig {
  /** Maximum total tokens for the assembled context. Default: 8000. */
  maxContextTokens?: number;
  /** Maximum tokens per callee snippet. Default: 200. */
  maxCalleeTokens?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_CONTEXT_TOKENS = 8000;
const DEFAULT_MAX_CALLEE_TOKENS = 200;
const MAX_CALLEES_PER_CHUNK = 3;
const MAX_IMPORT_PATHS = 10;
const CHARS_PER_TOKEN = 4;

// Layers that support code-level expansions (callee_snippets, import_list)
const CODE_LAYERS = new Set(['code', 'cig_metadata']);
// Layers that support doc_link expansion
const DOC_SEARCH_LAYERS = new Set(['code', 'cig_metadata', 'file_summary']);

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  return text.length <= maxChars ? text : text.slice(0, maxChars);
}

// ---------------------------------------------------------------------------
// CIG lookup helpers
// ---------------------------------------------------------------------------

interface CIGMaps {
  nodesById: Map<string, CIGNode>;
  nodesByKey: Map<string, CIGNode>;       // key = `${filePath}::${symbolName}`
  edgesByFromNodeId: Map<string, CIGEdge[]>;
  nodesByFilePath: Map<string, CIGNode[]>;
}

function buildCIGMaps(nodes: CIGNode[], edges: CIGEdge[]): CIGMaps {
  const nodesById = new Map<string, CIGNode>();
  const nodesByKey = new Map<string, CIGNode>();
  const nodesByFilePath = new Map<string, CIGNode[]>();

  for (const node of nodes) {
    nodesById.set(node.nodeId, node);
    nodesByKey.set(`${node.filePath}::${node.symbolName}`, node);

    const bucket = nodesByFilePath.get(node.filePath);
    if (bucket) {
      bucket.push(node);
    } else {
      nodesByFilePath.set(node.filePath, [node]);
    }
  }

  const edgesByFromNodeId = new Map<string, CIGEdge[]>();
  for (const edge of edges) {
    const bucket = edgesByFromNodeId.get(edge.fromNodeId);
    if (bucket) {
      bucket.push(edge);
    } else {
      edgesByFromNodeId.set(edge.fromNodeId, [edge]);
    }
  }

  return { nodesById, nodesByKey, edgesByFromNodeId, nodesByFilePath };
}

// ---------------------------------------------------------------------------
// ContextAssemblyService
// ---------------------------------------------------------------------------

export class ContextAssemblyService {
  constructor(
    private readonly storage: StorageAdapter,
    private readonly vectorStore: VectorStore,
    private readonly config: ContextAssemblyConfig = {},
    private readonly logger?: Logger,
  ) {}

  async assemble(repoId: string, chunks: VectorChunk[]): Promise<AssembledContext> {
    if (chunks.length === 0) {
      return { blocks: [], totalTokens: 0, truncated: false, droppedChunks: 0 };
    }

    const maxContextTokens = this.config.maxContextTokens ?? DEFAULT_MAX_CONTEXT_TOKENS;
    const maxCalleeTokens = this.config.maxCalleeTokens ?? DEFAULT_MAX_CALLEE_TOKENS;

    // Load CIG data once per assemble() call
    let cigMaps: CIGMaps | null = null;
    try {
      const [nodes, edges] = await Promise.all([
        this.storage.getCIGNodes(repoId),
        this.storage.getCIGEdges(repoId),
      ]);
      cigMaps = buildCIGMaps(nodes, edges);
    } catch (err) {
      this.logger?.warn('ContextAssemblyService: failed to load CIG data', {
        repoId,
        error: String(err),
      });
      // cigMaps stays null — callee/import expansions will be skipped
    }

    // Build a block for each chunk
    const blocks: ContextBlock[] = [];
    for (const chunk of chunks) {
      const expansions = await this.buildExpansions(
        repoId,
        chunk,
        cigMaps,
        maxCalleeTokens,
      );

      const chunkTokens = estimateTokens(chunk.content);
      const expansionTokens = expansions.reduce((sum, e) => sum + e.estimatedTokens, 0);

      blocks.push({
        chunk,
        chunkTokens,
        expansions,
        expansionTokens,
        totalTokens: chunkTokens + expansionTokens,
      });
    }

    // Token budget enforcement — drop from the tail (least relevant) first
    return this.enforceTokenBudget(blocks, maxContextTokens);
  }

  // -------------------------------------------------------------------------
  // Expansion builders
  // -------------------------------------------------------------------------

  private async buildExpansions(
    repoId: string,
    chunk: VectorChunk,
    cigMaps: CIGMaps | null,
    maxCalleeTokens: number,
  ): Promise<ContextExpansion[]> {
    const expansions: ContextExpansion[] = [];

    const isCodeLayer = CODE_LAYERS.has(chunk.layer);
    const canSearchDocs = DOC_SEARCH_LAYERS.has(chunk.layer);

    if (isCodeLayer && cigMaps) {
      // 1. Callee snippets
      const calleeExpansions = this.buildCalleeExpansions(chunk, cigMaps, maxCalleeTokens);
      expansions.push(...calleeExpansions);

      // 3. Import list
      const importExpansion = this.buildImportListExpansion(chunk, cigMaps);
      if (importExpansion) {
        expansions.push(importExpansion);
      }
    }

    // 2. Doc link — only for non-doc/diagram layers
    if (canSearchDocs) {
      const docExpansion = await this.buildDocLinkExpansion(repoId, chunk);
      if (docExpansion) {
        expansions.push(docExpansion);
      }
    }

    return expansions;
  }

  private buildCalleeExpansions(
    chunk: VectorChunk,
    cigMaps: CIGMaps,
    maxCalleeTokens: number,
  ): ContextExpansion[] {
    const filePath = chunk.metadata?.filePath as string | undefined;
    const symbol = chunk.metadata?.symbol as string | undefined;

    if (!filePath || !symbol) return [];

    const node = cigMaps.nodesByKey.get(`${filePath}::${symbol}`);
    if (!node) return [];

    const outEdges = cigMaps.edgesByFromNodeId.get(node.nodeId) ?? [];
    const callEdges = outEdges.filter(e => e.edgeType === 'calls');

    const expansions: ContextExpansion[] = [];
    for (const edge of callEdges.slice(0, MAX_CALLEES_PER_CHUNK)) {
      const callee = cigMaps.nodesById.get(edge.toNodeId);
      if (!callee) continue;

      const description =
        `${callee.symbolType} ${callee.symbolName} in ${callee.filePath}` +
        ` (lines ${callee.startLine}–${callee.endLine})`;

      const truncated = truncateToTokens(description, maxCalleeTokens);
      expansions.push({
        type: 'callee_snippet',
        content: truncated,
        estimatedTokens: estimateTokens(truncated),
        filePath: callee.filePath,
        symbol: callee.symbolName,
      });
    }

    return expansions;
  }

  private buildImportListExpansion(
    chunk: VectorChunk,
    cigMaps: CIGMaps,
  ): ContextExpansion | null {
    const filePath = chunk.metadata?.filePath as string | undefined;
    if (!filePath) return null;

    const fileNodes = cigMaps.nodesByFilePath.get(filePath) ?? [];
    if (fileNodes.length === 0) return null;

    const importedPaths = new Set<string>();
    for (const node of fileNodes) {
      const outEdges = cigMaps.edgesByFromNodeId.get(node.nodeId) ?? [];
      for (const edge of outEdges) {
        if (edge.edgeType !== 'imports') continue;
        const target = cigMaps.nodesById.get(edge.toNodeId);
        if (target && target.filePath !== filePath) {
          importedPaths.add(target.filePath);
        }
        if (importedPaths.size >= MAX_IMPORT_PATHS) break;
      }
      if (importedPaths.size >= MAX_IMPORT_PATHS) break;
    }

    if (importedPaths.size === 0) return null;

    const content = `Imports from: ${[...importedPaths].join(', ')}`;
    return {
      type: 'import_list',
      content,
      estimatedTokens: estimateTokens(content),
      filePath,
    };
  }

  private async buildDocLinkExpansion(
    repoId: string,
    chunk: VectorChunk,
  ): Promise<ContextExpansion | null> {
    const searchTerm =
      (chunk.metadata?.symbol as string | undefined) ??
      (chunk.metadata?.filePath as string | undefined);

    if (!searchTerm) return null;

    try {
      const results = await this.vectorStore.searchKeyword(repoId, searchTerm, 2, ['doc']);

      // Take first result that is not the current chunk
      const docChunk = results.find(r => r.chunkId !== chunk.chunkId);
      if (!docChunk) return null;

      return {
        type: 'doc_link',
        content: docChunk.content,
        estimatedTokens: estimateTokens(docChunk.content),
        filePath: docChunk.metadata?.filePath as string | undefined,
        symbol: docChunk.metadata?.symbol as string | undefined,
      };
    } catch (err) {
      this.logger?.warn('ContextAssemblyService: doc_link search failed', {
        repoId,
        chunkId: chunk.chunkId,
        error: String(err),
      });
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Token budget enforcement
  // -------------------------------------------------------------------------

  private enforceTokenBudget(
    blocks: ContextBlock[],
    maxContextTokens: number,
  ): AssembledContext {
    let totalTokens = blocks.reduce((sum, b) => sum + b.totalTokens, 0);

    if (totalTokens <= maxContextTokens) {
      return { blocks, totalTokens, truncated: false, droppedChunks: 0 };
    }

    // Drop blocks from the tail (least relevant) until within budget
    let droppedChunks = 0;
    while (blocks.length > 0 && totalTokens > maxContextTokens) {
      const dropped = blocks.pop()!;
      totalTokens -= dropped.totalTokens;
      droppedChunks++;
    }

    return {
      blocks,
      totalTokens,
      truncated: true,
      droppedChunks,
    };
  }
}
