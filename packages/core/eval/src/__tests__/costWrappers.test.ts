import type { EmbeddingClient, LLMClient } from '@codeinsight/types';

import {
  withEmbeddingCostTracking,
  withLlmCostTracking,
} from '../adapters/costWrappers';
import { CostTracker } from '../costTracker';

function makeLlm(completeImpl: () => Promise<string>): LLMClient {
  return {
    complete: jest.fn(completeImpl) as unknown as LLMClient['complete'],
    // eslint-disable-next-line require-yield
    stream: jest.fn(async function* () {
      yield 'hi';
    }) as unknown as LLMClient['stream'],
  };
}

describe('withLlmCostTracking', () => {
  it('estimates tokens from char length on complete()', async () => {
    const tracker = new CostTracker();
    const inner = makeLlm(async () => 'the result text');

    const wrapped = withLlmCostTracking(inner, tracker, 'claude-opus-4-7');
    const got = await wrapped.complete('sys'.repeat(4), 'user'.repeat(4));

    expect(got).toBe('the result text');
    const s = tracker.summary();
    expect(s.chatRequests).toBe(1);
    expect(s.chatInputTokens).toBeGreaterThan(0);
    expect(s.chatOutputTokens).toBeGreaterThan(0);
    expect(s.chatUsd).toBeGreaterThan(0);
  });

  it('accumulates tokens across multiple calls', async () => {
    const tracker = new CostTracker();
    const inner = makeLlm(async () => 'hello');
    const wrapped = withLlmCostTracking(inner, tracker, 'claude-haiku-4-5');

    await wrapped.complete('a', 'b');
    await wrapped.complete('c', 'd');

    expect(tracker.summary().chatRequests).toBe(2);
  });

  it('records tokens after a streaming call completes', async () => {
    const tracker = new CostTracker();
    const inner: LLMClient = {
      complete: jest.fn() as unknown as LLMClient['complete'],
      stream: (async function* () {
        yield 'abcd';
        yield 'efgh';
      }) as unknown as LLMClient['stream'],
    };

    const wrapped = withLlmCostTracking(inner, tracker, 'claude-opus-4-7');
    const collected: string[] = [];
    for await (const chunk of wrapped.stream('sys', 'user')) {
      collected.push(chunk);
    }

    expect(collected).toEqual(['abcd', 'efgh']);
    const s = tracker.summary();
    expect(s.chatRequests).toBe(1);
    expect(s.chatOutputTokens).toBeGreaterThan(0);
  });
});

describe('withEmbeddingCostTracking', () => {
  it('estimates input tokens from total text length', async () => {
    const tracker = new CostTracker();
    const inner: EmbeddingClient = {
      embed: jest.fn().mockResolvedValue([[0.1, 0.2]]),
    };

    const wrapped = withEmbeddingCostTracking(
      inner,
      tracker,
      'text-embedding-3-small',
    );
    await wrapped.embed(['hello world']);

    const s = tracker.summary();
    expect(s.embeddingRequests).toBe(1);
    expect(s.embeddingInputTokens).toBeGreaterThan(0);
    expect(s.embeddingUsd).toBeGreaterThan(0);
  });
});
