import type {
  EmbeddingClient,
  LLMClient,
  LLMOptions,
} from '@codeinsight/types';

import type { CostTracker } from '../costTracker';

/**
 * The real LLMClient interface only exposes `complete` and `stream` and does
 * not return token counts. We estimate tokens from char length using the same
 * 4-chars-per-token heuristic the pipeline uses internally — accurate enough
 * for cross-run comparisons, never for billing.
 */
const CHARS_PER_CHAT_TOKEN = 4;
const CHARS_PER_EMBED_TOKEN = 4;

function estimateTokens(s: string, charsPerToken: number): number {
  return Math.ceil(s.length / charsPerToken);
}

export function withLlmCostTracking(
  inner: LLMClient,
  tracker: CostTracker,
  model: string,
): LLMClient {
  return {
    async complete(
      systemPrompt: string,
      userPrompt: string,
      opts?: LLMOptions,
    ): Promise<string> {
      const result = await inner.complete(systemPrompt, userPrompt, opts);
      const inputTokens = estimateTokens(
        systemPrompt + userPrompt,
        CHARS_PER_CHAT_TOKEN,
      );
      const outputTokens = estimateTokens(result, CHARS_PER_CHAT_TOKEN);
      tracker.recordChat(model, inputTokens, outputTokens);
      return result;
    },

    async *stream(
      systemPrompt: string,
      userPrompt: string,
      opts?: LLMOptions,
    ): AsyncIterable<string> {
      const inputTokens = estimateTokens(
        systemPrompt + userPrompt,
        CHARS_PER_CHAT_TOKEN,
      );
      let outputChars = 0;
      for await (const chunk of inner.stream(systemPrompt, userPrompt, opts)) {
        outputChars += chunk.length;
        yield chunk;
      }
      const outputTokens = Math.ceil(outputChars / CHARS_PER_CHAT_TOKEN);
      tracker.recordChat(model, inputTokens, outputTokens);
    },
  };
}

export function withEmbeddingCostTracking(
  inner: EmbeddingClient,
  tracker: CostTracker,
  model: string,
): EmbeddingClient {
  return {
    async embed(texts: string[]): Promise<number[][]> {
      const inputTokens = texts.reduce(
        (sum, t) => sum + estimateTokens(t, CHARS_PER_EMBED_TOKEN),
        0,
      );
      const result = await inner.embed(texts);
      tracker.recordEmbedding(model, inputTokens);
      return result;
    },
  };
}
