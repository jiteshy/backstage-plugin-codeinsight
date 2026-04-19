import type { LLMClient } from '@codeinsight/types';

import { judgeFactPresence } from '../scorers/llmJudge';

function mockLLM(response: string): LLMClient {
  return {
    complete: jest.fn().mockResolvedValue(response),
    stream: jest.fn(),
  } as unknown as LLMClient;
}

describe('judgeFactPresence', () => {
  it('parses valid JSON and returns per-fact scores', async () => {
    const llm = mockLLM(JSON.stringify({
      results: [
        { fact: 'does A', score: 1, reason: 'explicitly says so' },
        { fact: 'does B', score: 0, reason: 'not mentioned' },
      ],
    }));

    const results = await judgeFactPresence(llm, 'some markdown', ['does A', 'does B']);

    expect(results).toEqual([
      { fact: 'does A', score: 1, reason: 'explicitly says so' },
      { fact: 'does B', score: 0, reason: 'not mentioned' },
    ]);
  });

  it('throws on malformed JSON', async () => {
    const llm = mockLLM('not json');
    await expect(judgeFactPresence(llm, 'x', ['f'])).rejects.toThrow(/JSON/);
  });

  it('throws when returned results length mismatches input facts', async () => {
    const llm = mockLLM(JSON.stringify({ results: [{ fact: 'a', score: 1, reason: 'ok' }] }));
    await expect(judgeFactPresence(llm, 'x', ['a', 'b'])).rejects.toThrow(/length/);
  });
});
