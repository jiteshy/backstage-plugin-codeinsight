import { createHash } from 'crypto';

import type { EmbeddingClient, Logger } from '@codeinsight/types';
import type { Knex } from 'knex';

// ---------------------------------------------------------------------------
// DB row type — mirrors the ci_embedding_cache table
// ---------------------------------------------------------------------------

interface EmbeddingCacheRow {
  content_sha: string;
  embedding: string; // pgvector returns as string representation
  model_used: string;
  created_at: Date;
}

// ---------------------------------------------------------------------------
// CachingEmbeddingClient
// ---------------------------------------------------------------------------

/**
 * Transparent caching wrapper around any EmbeddingClient.
 *
 * For each text in a batch:
 * 1. Compute SHA-256 of the text
 * 2. Check ci_embedding_cache for a hit
 * 3. Only embed texts that are cache misses
 * 4. Store new embeddings in the cache
 *
 * Returns embeddings in the same order as the input texts.
 */
export class CachingEmbeddingClient implements EmbeddingClient {
  constructor(
    private readonly inner: EmbeddingClient,
    private readonly knex: Knex,
    private readonly modelName: string,
    private readonly logger?: Logger,
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    // Compute content SHAs for all texts
    const shas = texts.map(t => this.computeContentSha(t));

    // Look up cached embeddings
    const cachedRows = await this.knex<EmbeddingCacheRow>('ci_embedding_cache')
      .whereIn('content_sha', shas)
      .andWhere('model_used', this.modelName)
      .select('content_sha', 'embedding');

    const cacheMap = new Map<string, number[]>();
    for (const row of cachedRows) {
      cacheMap.set(row.content_sha, this.parseEmbedding(row.embedding));
    }

    // Identify misses
    const missIndices: number[] = [];
    const missTexts: string[] = [];
    for (let i = 0; i < texts.length; i++) {
      if (!cacheMap.has(shas[i])) {
        missIndices.push(i);
        missTexts.push(texts[i]);
      }
    }

    this.logger?.debug('Embedding cache lookup', {
      total: texts.length,
      hits: texts.length - missTexts.length,
      misses: missTexts.length,
    });

    // Embed misses
    let missEmbeddings: number[][] = [];
    if (missTexts.length > 0) {
      missEmbeddings = await this.inner.embed(missTexts);

      // Store in cache (best-effort — don't fail the whole call on write errors)
      await this.storeCacheEntries(missTexts, missEmbeddings, shas, missIndices);
    }

    // Assemble results in original order
    const results: number[][] = new Array(texts.length);
    let missIdx = 0;
    for (let i = 0; i < texts.length; i++) {
      const cached = cacheMap.get(shas[i]);
      if (cached) {
        results[i] = cached;
      } else {
        results[i] = missEmbeddings[missIdx++];
      }
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private computeContentSha(text: string): string {
    return createHash('sha256').update(text).digest('hex');
  }

  private parseEmbedding(raw: string): number[] {
    // pgvector returns embeddings as '[0.1,0.2,...]' string
    if (typeof raw === 'string') {
      const trimmed = raw.replace(/^\[|\]$/g, '');
      return trimmed.split(',').map(Number);
    }
    // If already an array (some drivers parse automatically)
    return raw as unknown as number[];
  }

  private async storeCacheEntries(
    texts: string[],
    embeddings: number[][],
    allShas: string[],
    missIndices: number[],
  ): Promise<void> {
    try {
      const rows = texts.map((_, j) => ({
        content_sha: allShas[missIndices[j]],
        embedding: `[${embeddings[j].join(',')}]`,
        model_used: this.modelName,
        created_at: new Date(),
      }));

      // Insert in batches to avoid exceeding parameter limits
      const BATCH_SIZE = 50;
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        await this.knex('ci_embedding_cache')
          .insert(batch)
          .onConflict('content_sha')
          .ignore();
      }
    } catch (err) {
      this.logger?.warn('Failed to write embedding cache entries', {
        error: String(err),
        count: texts.length,
      });
    }
  }
}
