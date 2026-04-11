import { createHash } from 'crypto';

import { ChunkingService, FileSummaryService } from '@codeinsight/chunking';
import type { EmbeddingClient, LLMClient, Logger, StorageAdapter, VectorChunk, VectorStore } from '@codeinsight/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IndexingResult {
  chunksTotal: number;
  chunksIndexed: number;
  chunksSkipped: number;
  chunksDeleted: number;
}

/** Optional configuration for IndexingService. */
export interface IndexingConfig {
  /**
   * Token limit for the embedding model. Default: 8192.
   * All current OpenAI embedding models (text-embedding-3-small,
   * text-embedding-3-large, ada-002) share this limit.
   */
  modelTokenLimit?: number;
  /**
   * Characters per token estimate. Default: 3.
   * Passed to ChunkingService for chunk splitting decisions.
   * The embedding safety cap uses a more conservative 2 chars/token to
   * account for dense content (Mermaid, minified code) that has fewer
   * chars per actual token than typical prose or TypeScript.
   */
  charsPerToken?: number;
}

// ---------------------------------------------------------------------------
// IndexingService
// ---------------------------------------------------------------------------

/**
 * Orchestrates the QnA indexing pipeline:
 *
 *   ChunkingService + FileSummaryService → delta filter → EmbeddingClient (batched) → VectorStore
 *
 * Delta behaviour: chunks whose `contentSha` matches what is already stored
 * in the vector store are skipped — no redundant embedding API calls.
 *
 * For `file_summary` layer chunks, `contentSha` is set to the source file's
 * `currentSha` (not a hash of the summary text) to prevent unnecessary LLM
 * re-runs when the file content has not changed.
 *
 * Batch size for embedding calls: 100 (OpenAI default limit).
 */
export class IndexingService {
  private static readonly EMBED_BATCH_SIZE = 100;

  private readonly maxEmbedChars: number;
  private readonly chunkingService: ChunkingService;
  private readonly fileSummaryService: FileSummaryService | undefined;

  constructor(
    private readonly embeddingClient: EmbeddingClient,
    private readonly vectorStore: VectorStore,
    storageAdapter: StorageAdapter,
    private readonly logger?: Logger,
    config?: IndexingConfig,
    llmClient?: LLMClient,
  ) {
    const charsPerToken = config?.charsPerToken ?? 3;
    const modelTokenLimit = config?.modelTokenLimit ?? 8_192;
    this.maxEmbedChars = modelTokenLimit;
    this.chunkingService = new ChunkingService(storageAdapter, logger, { charsPerToken });
    this.fileSummaryService = llmClient
      ? new FileSummaryService(storageAdapter, llmClient, logger, { charsPerToken })
      : undefined;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Build (or incrementally update) the vector index for a repository.
   *
   * @param repoId   Repository ID
   * @param cloneDir Path to the cloned repo on disk (needed for code and file_summary chunks)
   */
  async indexRepo(repoId: string, cloneDir: string): Promise<IndexingResult> {
    this.logger?.info('IndexingService: starting', { repoId });

    // 1. Load existing index state first — FileSummaryService needs it for delta skip
    const existing = await this.vectorStore.listChunks(repoId);
    const existingMap = new Map(existing.map(c => [c.chunkId, c.contentSha]));

    // 2. Produce chunks from all layers (run in parallel where possible)
    const [{ chunks: regularChunks }, summaryResult] = await Promise.all([
      this.chunkingService.chunkRepo(repoId, cloneDir),
      this.fileSummaryService
        ? this.fileSummaryService.summarize(repoId, cloneDir, existingMap)
        : Promise.resolve({ chunks: [], stats: null }),
    ]);

    const chunks = [...regularChunks, ...summaryResult.chunks];

    // 3. Compute contentSha for each chunk:
    //    - file_summary: use fileSha (source file SHA) for LLM-stability
    //    - all others: SHA-256 of chunk content
    const chunksWithSha = chunks.map(chunk => ({
      chunk,
      contentSha:
        chunk.layer === 'file_summary'
          ? chunk.fileSha
          : computeContentSha(chunk.content),
    }));

    // 4. Identify which chunks need (re-)embedding
    const toIndex = chunksWithSha.filter(
      ({ chunk, contentSha }) => existingMap.get(chunk.chunkId) !== contentSha,
    );

    // 5. Identify stale chunks (no longer produced by any service)
    const currentIds = new Set(chunks.map(c => c.chunkId));
    const deletedIds = [...existingMap.keys()].filter(id => !currentIds.has(id));
    if (deletedIds.length > 0) {
      await this.vectorStore.deleteChunks(repoId, deletedIds);
      this.logger?.info('IndexingService: deleted stale chunks', {
        repoId,
        count: deletedIds.length,
      });
    }

    // 6. Embed + upsert in batches
    let indexed = 0;
    for (let i = 0; i < toIndex.length; i += IndexingService.EMBED_BATCH_SIZE) {
      const batch = toIndex.slice(i, i + IndexingService.EMBED_BATCH_SIZE);
      const texts = batch.map(({ chunk }) => {
        if (chunk.content.length > this.maxEmbedChars) {
          this.logger?.warn('IndexingService: chunk exceeds maxEmbedChars, truncating', {
            repoId,
            chunkId: chunk.chunkId,
            layer: chunk.layer,
            contentLength: chunk.content.length,
            maxEmbedChars: this.maxEmbedChars,
          });
          return chunk.content.slice(0, this.maxEmbedChars);
        }
        return chunk.content;
      });

      this.logger?.debug('IndexingService: embedding batch', {
        repoId,
        batchStart: i,
        batchSize: batch.length,
      });

      const embeddings = await this.embeddingClient.embed(texts);

      const vectorChunks: VectorChunk[] = batch.map(({ chunk, contentSha }, j) => ({
        chunkId: chunk.chunkId,
        repoId: chunk.repoId,
        content: chunk.content,
        contentSha,
        embedding: embeddings[j],
        layer: chunk.layer,
        metadata: chunk.metadata as Record<string, unknown> | undefined,
      }));

      await this.vectorStore.upsert(vectorChunks);
      indexed += batch.length;
    }

    const result: IndexingResult = {
      chunksTotal: chunks.length,
      chunksIndexed: indexed,
      chunksSkipped: chunks.length - toIndex.length,
      chunksDeleted: deletedIds.length,
    };

    this.logger?.info('IndexingService: complete', { repoId, ...result });
    return result;
  }
}

// ---------------------------------------------------------------------------
// Pure utility
// ---------------------------------------------------------------------------

/** SHA-256 of chunk text — used as the content-addressable key. */
export function computeContentSha(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
