import { createHash } from 'crypto';

import type { LLMClient, LLMOptions, Logger } from '@codeinsight/types';
import type { Knex } from 'knex';


// ---------------------------------------------------------------------------
// DB row type — mirrors the ci_llm_cache table
// ---------------------------------------------------------------------------

interface LLMCacheRow {
  cache_key: string;
  response: string;
  tokens_used: number;
  model_used: string;
  created_at: Date;
}

// ---------------------------------------------------------------------------
// CachingLLMClient
// ---------------------------------------------------------------------------

/**
 * Transparent caching wrapper around any LLMClient.
 *
 * For `complete()`: computes a deterministic SHA-256 cache key from
 * (systemPrompt + userPrompt + modelName), checks `ci_llm_cache`, and
 * returns the cached response on a hit. On a miss, calls the underlying
 * client, stores the response, and returns it.
 *
 * For `stream()`: delegates directly to the inner client — streaming
 * responses are not cached.
 */
export class CachingLLMClient implements LLMClient {
  constructor(
    private readonly inner: LLMClient,
    private readonly knex: Knex,
    private readonly modelName: string,
    private readonly logger?: Logger,
  ) {}

  async complete(
    systemPrompt: string,
    userPrompt: string,
    opts?: LLMOptions,
  ): Promise<string> {
    const cacheKey = this.computeCacheKey(systemPrompt, userPrompt);

    // Cache lookup
    const hit = await this.knex<LLMCacheRow>('ci_llm_cache')
      .where('cache_key', cacheKey)
      .first();

    if (hit) {
      this.logger?.debug('LLM cache hit', { cacheKey, modelUsed: hit.model_used });
      return hit.response;
    }

    // Cache miss — call underlying client
    const response = await this.inner.complete(systemPrompt, userPrompt, opts);

    // Store in cache (ignore write errors — cache is best-effort)
    await this.knex<LLMCacheRow>('ci_llm_cache')
      .insert({
        cache_key: cacheKey,
        response,
        tokens_used: Math.ceil(response.length / 4),
        model_used: this.modelName,
        created_at: new Date(),
      })
      .onConflict('cache_key')
      .ignore()
      .catch(err => {
        this.logger?.warn('Failed to write LLM cache entry', {
          cacheKey,
          error: String(err),
        });
      });

    this.logger?.debug('LLM cache miss — response stored', {
      cacheKey,
      model: this.modelName,
    });

    return response;
  }

  stream(
    systemPrompt: string,
    userPrompt: string,
    opts?: LLMOptions,
  ): AsyncIterable<string> {
    // Streaming responses are not cached — delegate directly
    return this.inner.stream(systemPrompt, userPrompt, opts);
  }

  // ---------------------------------------------------------------------------
  // Cache key computation
  // ---------------------------------------------------------------------------

  /**
   * Deterministic SHA-256 key over (systemPrompt + userPrompt + modelName).
   * Changing any of the three inputs produces a different key, ensuring
   * model upgrades and prompt edits invalidate stale cache entries.
   */
  private computeCacheKey(systemPrompt: string, userPrompt: string): string {
    return createHash('sha256')
      .update(systemPrompt)
      .update('\x00')
      .update(userPrompt)
      .update('\x00')
      .update(this.modelName)
      .digest('hex');
  }
}
