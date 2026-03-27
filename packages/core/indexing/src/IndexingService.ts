import { createHash } from 'crypto';

import { ChunkingService } from '@codeinsight/chunking';
import type { EmbeddingClient, Logger, StorageAdapter, VectorChunk, VectorStore } from '@codeinsight/types';

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
   * Passed to ChunkingService and used to derive the per-text char cap
   * sent to the embedding API: `modelTokenLimit * charsPerToken`.
   */
  charsPerToken?: number;
}

// ---------------------------------------------------------------------------
// IndexingService
// ---------------------------------------------------------------------------

/**
 * Orchestrates the QnA indexing pipeline:
 *
 *   ChunkingService → delta filter → EmbeddingClient (batched) → VectorStore
 *
 * Delta behaviour: chunks whose `content_sha` matches what is already stored
 * in the vector store are skipped — no redundant embedding API calls.
 *
 * Batch size for embedding calls: 100 (OpenAI default limit).
 */
export class IndexingService {
  private static readonly EMBED_BATCH_SIZE = 100;

  // Safety cap: text longer than this is truncated before embedding.
  // Derived as modelTokenLimit * charsPerToken so it scales with the
  // configured model. ChunkingService already splits chunks well below
  // this limit — this is a last-resort guard.
  private readonly maxEmbedChars: number;

  private readonly chunkingService: ChunkingService;

  constructor(
    private readonly embeddingClient: EmbeddingClient,
    private readonly vectorStore: VectorStore,
    storageAdapter: StorageAdapter,
    private readonly logger?: Logger,
    config?: IndexingConfig,
  ) {
    const charsPerToken = config?.charsPerToken ?? 3;
    const modelTokenLimit = config?.modelTokenLimit ?? 8_192;
    this.maxEmbedChars = modelTokenLimit * charsPerToken;
    this.chunkingService = new ChunkingService(storageAdapter, logger, { charsPerToken });
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Build (or incrementally update) the vector index for a repository.
   *
   * @param repoId   Repository ID
   * @param cloneDir Path to the cloned repo on disk (needed for code chunks)
   */
  async indexRepo(repoId: string, cloneDir: string): Promise<IndexingResult> {
    this.logger?.info('IndexingService: starting', { repoId });

    // 1. Produce chunks from all layers
    const { chunks } = await this.chunkingService.chunkRepo(repoId, cloneDir);

    // 2. Load existing index state for delta detection
    const existing = await this.vectorStore.listChunks(repoId);
    const existingMap = new Map(existing.map(c => [c.chunkId, c.contentSha]));

    // 3. Compute contentSha for each chunk once, then identify which need (re-)embedding
    const chunksWithSha = chunks.map(chunk => ({
      chunk,
      contentSha: computeContentSha(chunk.content),
    }));
    const toIndex = chunksWithSha.filter(
      ({ chunk, contentSha }) => existingMap.get(chunk.chunkId) !== contentSha,
    );

    // 4. Identify stale chunks (chunks no longer produced by ChunkingService)
    const currentIds = new Set(chunks.map(c => c.chunkId));
    const deletedIds = [...existingMap.keys()].filter(id => !currentIds.has(id));
    if (deletedIds.length > 0) {
      await this.vectorStore.deleteChunks(repoId, deletedIds);
      this.logger?.info('IndexingService: deleted stale chunks', {
        repoId,
        count: deletedIds.length,
      });
    }

    // 5. Embed + upsert in batches
    let indexed = 0;
    for (let i = 0; i < toIndex.length; i += IndexingService.EMBED_BATCH_SIZE) {
      const batch = toIndex.slice(i, i + IndexingService.EMBED_BATCH_SIZE);
      const texts = batch.map(({ chunk }) =>
        chunk.content.length > this.maxEmbedChars
          ? chunk.content.slice(0, this.maxEmbedChars)
          : chunk.content,
      );

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
