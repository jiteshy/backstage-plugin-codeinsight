import type {
  CIGNode,
  Logger,
  StorageAdapter,
  VectorChunk,
  VectorStore,
} from '@codeinsight/types';

// ---------------------------------------------------------------------------
// Query classification
// ---------------------------------------------------------------------------

export type QueryType =
  | 'conceptual'
  | 'specific'
  | 'relational'
  | 'navigational'
  | 'general';

// Layer constants — match what ChunkingService produces
const LAYER_CODE = 'code';
const LAYER_FILE_SUMMARY = 'file_summary';
const LAYER_DOC_SECTION = 'doc_section';
const LAYER_DIAGRAM_DESC = 'diagram_desc';
const LAYER_CIG_METADATA = 'cig_metadata';

const ALL_INDEXED_LAYERS = [
  LAYER_CODE,
  LAYER_FILE_SUMMARY,
  LAYER_DOC_SECTION,
  LAYER_DIAGRAM_DESC,
];

// Patterns for query classification — order matters (most specific first)
const RELATIONAL_RE =
  /\b(what calls|who calls|callers? of|callee of|calls|uses|depends on|imported by|dependen(t|cies) of|references?)\b/i;
const NAVIGATIONAL_RE = /\b(where is|find|which file|locate|path to|defined in)\b/i;
const CONCEPTUAL_RE =
  /\b(how does|what is|explain|overview|describe|understand|architecture|design)\b/i;
const SPECIFIC_RE =
  /\b(what does|implement(ation)?|definition of|signature of)\b/i;

/**
 * Classify a natural-language query into one of five query types that
 * determine which retrieval paths to activate.
 */
export function classifyQuery(query: string): QueryType {
  if (RELATIONAL_RE.test(query)) return 'relational';
  if (NAVIGATIONAL_RE.test(query)) return 'navigational';
  // A camelCase/PascalCase identifier is a strong signal the query is about a
  // specific symbol — check this before the broad 'how does' / 'what is'
  // conceptual patterns to avoid misclassifying "How does loginUser work?".
  if (/\b[A-Za-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*\b/.test(query)) return 'specific';
  if (CONCEPTUAL_RE.test(query)) return 'conceptual';
  if (SPECIFIC_RE.test(query)) return 'specific';
  return 'general';
}

// ---------------------------------------------------------------------------
// Identifier extraction (for CIG lookup)
// ---------------------------------------------------------------------------

/**
 * Extract likely symbol identifiers from a query string.
 * Matches camelCase, PascalCase, and snake_case tokens of 3+ characters.
 */
export function extractIdentifiers(query: string): string[] {
  const camelOrPascal = query.match(/\b[A-Za-z][a-zA-Z0-9]{2,}\b/g) ?? [];
  // Filter out common English stop-words that are not identifiers
  const stopWords = new Set([
    'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'her',
    'was', 'one', 'our', 'out', 'use', 'had', 'how', 'did', 'get', 'its',
    'may', 'who', 'why', 'let', 'put', 'see', 'too', 'via', 'any',
    'has', 'file', 'what', 'does', 'this', 'that', 'with', 'from', 'into',
    'they', 'them', 'then', 'than', 'when', 'also', 'call', 'calls', 'used',
    'which', 'where', 'there', 'their', 'would', 'could', 'about', 'after',
    'class', 'type', 'code', 'list', 'show', 'find', 'look', 'like', 'give',
    'explain', 'describe', 'overview', 'design', 'define', 'locate',
    // Common TS/JS keywords that appear in code questions but are not symbol names
    'function', 'return', 'import', 'export', 'const', 'async', 'await',
    'interface', 'boolean', 'string', 'number', 'object', 'array',
  ]);
  return camelOrPascal.filter(t => !stopWords.has(t.toLowerCase()));
}

// ---------------------------------------------------------------------------
// Layer selection per query type
// ---------------------------------------------------------------------------

function layersForQueryType(type: QueryType): string[] | undefined {
  switch (type) {
    case 'conceptual':
      return [LAYER_FILE_SUMMARY, LAYER_DOC_SECTION, LAYER_DIAGRAM_DESC];
    case 'specific':
      return [LAYER_CODE];
    case 'relational':
    case 'navigational':
      // Will use CIG lookup + keyword; skip embedding layers for now
      return [LAYER_CODE, LAYER_FILE_SUMMARY];
    case 'general':
    default:
      return ALL_INDEXED_LAYERS;
  }
}

// ---------------------------------------------------------------------------
// CIG synthetic chunk builder
// ---------------------------------------------------------------------------

function cigNodeToChunk(node: CIGNode): VectorChunk {
  const content =
    `${node.symbolType} ${node.symbolName} in ${node.filePath}` +
    ` (lines ${node.startLine}–${node.endLine})`;
  return {
    chunkId: `${node.repoId}:${node.filePath}:${node.symbolName}:${node.symbolType}`,
    repoId: node.repoId,
    content,
    contentSha: node.extractedSha,
    layer: LAYER_CIG_METADATA,
    metadata: {
      filePath: node.filePath,
      symbol: node.symbolName,
      symbolType: node.symbolType,
      startLine: node.startLine,
      endLine: node.endLine,
    },
  };
}

// ---------------------------------------------------------------------------
// RetrievalService
// ---------------------------------------------------------------------------

export interface RetrievalOptions {
  /** Maximum number of chunks to return after deduplication. Default: 8. */
  topK?: number;
  /**
   * Override the auto-detected query type. Useful for callers that have
   * already classified the query through another mechanism.
   */
  queryType?: QueryType;
}

/**
 * Orchestrates three parallel retrieval paths and merges results:
 *
 *   1. Vector search  — pgvector cosine similarity (semantic)
 *   2. Keyword search — PostgreSQL full-text search (exact terms)
 *   3. CIG lookup     — direct symbol-name match in the Code Intelligence Graph
 *
 * Results are deduplicated by `chunkId` and the top `topK` are returned.
 * Vector results rank first (most semantically relevant), followed by
 * keyword matches, then CIG synthetic chunks.
 */
export class RetrievalService {
  private static readonly DEFAULT_TOP_K = 8;
  /** How many raw results to fetch from each retrieval path before merging. */
  private static readonly FETCH_PER_PATH = 10;

  constructor(
    private readonly vectorStore: VectorStore,
    private readonly storage: StorageAdapter,
    private readonly logger?: Logger,
  ) {}

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  async retrieve(
    repoId: string,
    query: string,
    queryEmbedding: number[],
    opts: RetrievalOptions = {},
  ): Promise<VectorChunk[]> {
    const topK = opts.topK ?? RetrievalService.DEFAULT_TOP_K;
    const queryType = opts.queryType ?? classifyQuery(query);
    const layers = layersForQueryType(queryType);

    this.logger?.debug('RetrievalService.retrieve', { repoId, queryType, layers });

    // Run all three paths concurrently
    const [vectorChunks, keywordChunks, cigChunks] = await Promise.all([
      this.vectorSearch(repoId, queryEmbedding, layers, queryType),
      this.keywordSearch(repoId, query, layers, queryType),
      this.cigLookup(repoId, query, queryType),
    ]);

    // Merge: vector first (highest semantic signal), then keyword, then CIG
    const merged = this.mergeAndDeduplicate(
      vectorChunks,
      keywordChunks,
      cigChunks,
    );

    const result = merged.slice(0, topK);

    this.logger?.debug('RetrievalService.retrieve complete', {
      repoId,
      queryType,
      vectorCount: vectorChunks.length,
      keywordCount: keywordChunks.length,
      cigCount: cigChunks.length,
      mergedCount: merged.length,
      returnedCount: result.length,
    });

    return result;
  }

  // -------------------------------------------------------------------------
  // Private retrieval paths
  // -------------------------------------------------------------------------

  private async vectorSearch(
    repoId: string,
    embedding: number[],
    layers: string[] | undefined,
    queryType: QueryType,
  ): Promise<VectorChunk[]> {
    // Relational queries rely on CIG — skip expensive vector search
    if (queryType === 'relational') return [];

    try {
      return await this.vectorStore.search(
        embedding,
        { repoId, layers },
        RetrievalService.FETCH_PER_PATH,
      );
    } catch (err) {
      this.logger?.warn('RetrievalService: vector search failed', {
        error: String(err),
      });
      return [];
    }
  }

  private async keywordSearch(
    repoId: string,
    query: string,
    layers: string[] | undefined,
    queryType: QueryType,
  ): Promise<VectorChunk[]> {
    // Conceptual queries are better served by semantic search alone
    if (queryType === 'conceptual') return [];

    try {
      return await this.vectorStore.searchKeyword(
        repoId,
        query,
        RetrievalService.FETCH_PER_PATH,
        layers,
      );
    } catch (err) {
      this.logger?.warn('RetrievalService: keyword search failed', {
        error: String(err),
      });
      return [];
    }
  }

  private async cigLookup(
    repoId: string,
    query: string,
    queryType: QueryType,
  ): Promise<VectorChunk[]> {
    // Only activate CIG lookup for relational / navigational / specific queries
    if (
      queryType !== 'relational' &&
      queryType !== 'navigational' &&
      queryType !== 'specific'
    ) {
      return [];
    }

    const identifiers = extractIdentifiers(query);
    if (identifiers.length === 0) return [];

    try {
      const allNodes = await this.storage.getCIGNodes(repoId);
      const matched = allNodes.filter(node =>
        identifiers.some(id =>
          node.symbolName.toLowerCase().includes(id.toLowerCase()),
        ),
      );

      // Prefer exact matches; limit to FETCH_PER_PATH
      const exact = matched.filter(n =>
        identifiers.some(id => n.symbolName.toLowerCase() === id.toLowerCase()),
      );
      const fuzzy = matched.filter(
        n => !identifiers.some(id => n.symbolName.toLowerCase() === id.toLowerCase()),
      );

      return [...exact, ...fuzzy]
        .slice(0, RetrievalService.FETCH_PER_PATH)
        .map(cigNodeToChunk);
    } catch (err) {
      this.logger?.warn('RetrievalService: CIG lookup failed', {
        error: String(err),
      });
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // Merge + deduplication
  // -------------------------------------------------------------------------

  private mergeAndDeduplicate(
    ...sources: VectorChunk[][]
  ): VectorChunk[] {
    const seen = new Set<string>();
    const result: VectorChunk[] = [];

    for (const chunks of sources) {
      for (const chunk of chunks) {
        if (!seen.has(chunk.chunkId)) {
          seen.add(chunk.chunkId);
          result.push(chunk);
        }
      }
    }

    return result;
  }
}
