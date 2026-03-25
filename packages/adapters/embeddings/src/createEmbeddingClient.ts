import type { EmbeddingClient, EmbeddingConfig, Logger } from '@codeinsight/types';
import type { Knex } from 'knex';

import { CachingEmbeddingClient } from './CachingEmbeddingClient';
import { OpenAIEmbeddingClient } from './OpenAIEmbeddingClient';

/**
 * Factory that creates an EmbeddingClient with caching enabled.
 *
 * Currently supports OpenAI only (provider: 'openai'). The returned client is
 * a CachingEmbeddingClient wrapping an OpenAIEmbeddingClient — identical
 * texts will be served from ci_embedding_cache without an API call.
 */
export function createEmbeddingClient(
  config: EmbeddingConfig,
  logger?: Logger,
  knex?: Knex,
): EmbeddingClient {
  const inner = new OpenAIEmbeddingClient(config);
  const modelName = config.model ?? 'text-embedding-3-small';

  if (knex) {
    return new CachingEmbeddingClient(inner, knex, modelName, logger);
  }

  return inner;
}
