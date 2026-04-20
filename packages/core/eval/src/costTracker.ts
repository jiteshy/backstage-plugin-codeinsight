import type { CostSummary } from './types';

// USD per million tokens. Updated 2026-04-19.
// Sources: Anthropic + OpenAI public pricing pages. Keep in sync with config defaults.
const CHAT_PRICES: Record<string, { input: number; output: number }> = {
  'claude-opus-4-7':   { input: 15.00, output: 75.00 },
  'claude-sonnet-4-6': { input:  3.00, output: 15.00 },
  'claude-haiku-4-5':  { input:  0.80, output:  4.00 },
  'gpt-4.1':           { input:  2.50, output: 10.00 },
  'gpt-4.1-mini':      { input:  0.15, output:  0.60 },
  'gpt-4o':            { input:  2.50, output: 10.00 },
};

const EMBED_PRICES: Record<string, number> = {
  'text-embedding-3-small': 0.02,
  'text-embedding-3-large': 0.13,
};

export class CostTracker {
  private _chatRequests = 0;
  private _chatInput = 0;
  private _chatOutput = 0;
  private _chatUsd = 0;
  private _embedRequests = 0;
  private _embedInput = 0;
  private _embedUsd = 0;

  recordChat(model: string, inputTokens: number, outputTokens: number): void {
    this._chatRequests += 1;
    this._chatInput += inputTokens;
    this._chatOutput += outputTokens;

    const price = CHAT_PRICES[model];
    if (!price) {
      // eslint-disable-next-line no-console
      console.warn(`CostTracker: unknown chat model "${model}" — cost reported as 0`);
      return;
    }
    this._chatUsd += (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
  }

  recordEmbedding(model: string, inputTokens: number): void {
    this._embedRequests += 1;
    this._embedInput += inputTokens;

    const price = EMBED_PRICES[model];
    if (!price) {
      // eslint-disable-next-line no-console
      console.warn(`CostTracker: unknown embedding model "${model}" — cost reported as 0`);
      return;
    }
    this._embedUsd += (inputTokens * price) / 1_000_000;
  }

  summary(): CostSummary {
    return {
      chatRequests:       this._chatRequests,
      chatInputTokens:    this._chatInput,
      chatOutputTokens:   this._chatOutput,
      chatUsd:            this._chatUsd,
      embeddingRequests:  this._embedRequests,
      embeddingInputTokens: this._embedInput,
      embeddingUsd:       this._embedUsd,
      totalUsd:           this._chatUsd + this._embedUsd,
    };
  }
}
