import type { LLMClient, VectorChunk } from '@codeinsight/types';

import { scoreQna } from '../scorers/qnaScorer';
import type { PipelineAdapter, QaPair } from '../types';

function mockLLM(responses: string[]): LLMClient {
  let i = 0;
  return {
    complete: jest.fn().mockImplementation(() => Promise.resolve(responses[i++])),
    stream: jest.fn(),
  } as unknown as LLMClient;
}

function mockAdapter(
  answers: Array<{ answer: string; retrieved: VectorChunk[] }>,
): PipelineAdapter {
  let i = 0;
  return {
    version: 'mock',
    ingest: jest.fn(),
    getDocArtifacts: jest.fn(),
    getDiagramArtifacts: jest.fn(),
    askQna: jest.fn().mockImplementation(() => Promise.resolve({
      answer: answers[i].answer,
      retrievedChunks: answers[i++].retrieved,
    })),
  };
}

function chunk(filePath: string, content = ''): VectorChunk {
  return { chunkId: filePath, repoId: 'r', content, contentSha: 's', layer: 'code', metadata: { filePath } };
}

describe('scoreQna', () => {
  it('computes recall@10 and per-question details', async () => {
    const qa: QaPair[] = [{
      question: 'How does auth work?',
      expectedFiles: ['src/auth.ts', 'src/session.ts'],
      mustIncludeFacts: ['verifies JWT', 'stores session in redis'],
      shouldNotHallucinate: [],
    }];
    const adapter = mockAdapter([{
      answer: 'Auth verifies JWT and stores session in redis.',
      retrieved: [chunk('src/auth.ts'), chunk('src/other.ts')],
    }]);
    const llm = mockLLM([
      JSON.stringify({ results: [
        { fact: 'verifies JWT', score: 1, reason: '' },
        { fact: 'stores session in redis', score: 1, reason: '' },
      ]}),
    ]);

    const result = await scoreQna('slug', qa, adapter, llm);

    expect(result.details).toHaveLength(1);
    expect(result.details[0].recallAt10).toBe(0.5);
    expect(result.details[0].completeness).toBe(1);
    expect(result.details[0].hallucinationCount).toBe(0);
  });

  it('flags hallucinations when shouldNotHallucinate phrase appears', async () => {
    const qa: QaPair[] = [{
      question: 'q',
      expectedFiles: [],
      mustIncludeFacts: [],
      shouldNotHallucinate: ['we use kafka'],
    }];
    const adapter = mockAdapter([{
      answer: 'It runs on AWS. Also we use kafka for events.',
      retrieved: [],
    }]);
    const llm = mockLLM([]);

    const result = await scoreQna('slug', qa, adapter, llm);
    expect(result.details[0].hallucinationCount).toBe(1);
  });

  it('overall penalizes hallucination (0.2 off)', async () => {
    const qa: QaPair[] = [{
      question: 'q',
      expectedFiles: ['src/a.ts'],
      mustIncludeFacts: ['fact'],
      shouldNotHallucinate: ['bad'],
    }];
    const adapter = mockAdapter([{
      answer: 'fact and bad',
      retrieved: [chunk('src/a.ts')],
    }]);
    const llm = mockLLM([
      JSON.stringify({ results: [{ fact: 'fact', score: 1, reason: '' }] }),
    ]);

    const result = await scoreQna('slug', qa, adapter, llm);
    expect(result.overall).toBeCloseTo(0.8, 2);
  });
});
