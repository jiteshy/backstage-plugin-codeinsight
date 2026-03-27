import type { EmbeddingConfig } from '@codeinsight/types';

/** Standard output dimensions for known OpenAI embedding models. */
const MODEL_DIMENSIONS: Record<string, number> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
};

/**
 * Derive the expected embedding vector dimension from config.
 *
 * Resolution order:
 *  1. `config.dimensions` — explicit override (OpenAI supports Matryoshka
 *     truncation to a lower dimension via the `dimensions` parameter)
 *  2. Known model name → standard output dimension
 *  3. Default: 1536 (text-embedding-3-small)
 */
export function deriveEmbeddingDimension(config: EmbeddingConfig): number {
  if (config.dimensions) return config.dimensions;
  const model = config.model ?? 'text-embedding-3-small';
  return MODEL_DIMENSIONS[model] ?? 1536;
}
