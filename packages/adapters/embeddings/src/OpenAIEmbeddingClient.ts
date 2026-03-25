import type { EmbeddingClient, EmbeddingConfig } from '@codeinsight/types';
import OpenAI from 'openai';

/**
 * EmbeddingClient backed by the OpenAI Embeddings API.
 *
 * Uses text-embedding-3-small by default. Config is injected — never reads
 * process.env directly.
 */
export class OpenAIEmbeddingClient implements EmbeddingClient {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly dimensions: number | undefined;

  constructor(config: EmbeddingConfig) {
    this.client = new OpenAI({ apiKey: config.apiKey });
    this.model = config.model ?? 'text-embedding-3-small';
    this.dimensions = config.dimensions;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const response = await this.client.embeddings.create({
      model: this.model,
      input: texts,
      ...(this.dimensions ? { dimensions: this.dimensions } : {}),
    });

    // OpenAI returns embeddings in the same order as the input
    return response.data.map(d => d.embedding);
  }
}
