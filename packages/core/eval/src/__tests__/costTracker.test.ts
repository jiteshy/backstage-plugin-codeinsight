import { CostTracker } from '../costTracker';

describe('CostTracker', () => {
  it('accumulates chat tokens and computes cost', () => {
    const t = new CostTracker();
    t.recordChat('claude-sonnet-4-6', 3000, 1500);
    t.recordChat('claude-sonnet-4-6', 1000, 500);

    const s = t.summary();
    expect(s.chatRequests).toBe(2);
    expect(s.chatInputTokens).toBe(4000);
    expect(s.chatOutputTokens).toBe(2000);
    expect(s.chatUsd).toBeCloseTo(0.042, 4);
  });

  it('accumulates embedding tokens and computes cost', () => {
    const t = new CostTracker();
    t.recordEmbedding('text-embedding-3-small', 100000);
    const s = t.summary();
    expect(s.embeddingRequests).toBe(1);
    expect(s.embeddingInputTokens).toBe(100000);
    expect(s.embeddingUsd).toBeCloseTo(0.002, 4);
  });

  it('totalUsd combines chat + embedding', () => {
    const t = new CostTracker();
    t.recordChat('claude-haiku-4-5', 1_000_000, 0);
    t.recordEmbedding('text-embedding-3-small', 1_000_000);
    const s = t.summary();
    expect(s.totalUsd).toBeCloseTo(0.82, 3);
  });

  it('treats unknown models as zero cost but still counts tokens', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const t = new CostTracker();
    t.recordChat('mystery-model', 1000, 500);
    const s = t.summary();
    expect(s.chatInputTokens).toBe(1000);
    expect(s.chatOutputTokens).toBe(500);
    expect(s.chatUsd).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/mystery-model/));
    warn.mockRestore();
  });
});
