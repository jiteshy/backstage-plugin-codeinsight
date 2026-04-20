import type { Artifact, LLMClient } from '@codeinsight/types';

import { scoreDocs } from '../scorers/docScorer';
import type { ExpectedArchitecture, ExpectedOverview } from '../types';

function mockLLM(responses: string[]): LLMClient {
  let i = 0;
  return {
    complete: jest.fn().mockImplementation(() => Promise.resolve(responses[i++])),
    stream: jest.fn(),
  } as unknown as LLMClient;
}

function docArtifact(module: string, markdown: string): Artifact {
  return {
    repoId: 'r',
    artifactId: module,
    artifactType: 'doc',
    content: { kind: 'doc', module, markdown },
    inputSha: 'x',
    promptVersion: null,
    generationSig: 'v1',
    isStale: false,
    staleReason: null,
    tokensUsed: 100,
    llmUsed: true,
    generatedAt: new Date(),
  };
}

describe('scoreDocs', () => {
  const overview: ExpectedOverview = { bullets: ['is a web service', 'uses postgres'] };
  const arch: ExpectedArchitecture = {
    subsystems: [
      { name: 'API', mustMentionFiles: [] },
      { name: 'Worker', mustMentionFiles: [] },
    ],
    externalDependencies: ['postgres'],
  };

  it('returns scores for overview and architecture modules found in artifacts', async () => {
    const artifacts: Artifact[] = [
      docArtifact('overview', '# Overview\nIt is a web service using Postgres.'),
      docArtifact('architecture', '# Arch\nAPI and Worker subsystems talk to Postgres.'),
    ];
    const llm = mockLLM([
      JSON.stringify({ results: [
        { fact: 'is a web service', score: 1, reason: 'said' },
        { fact: 'uses postgres', score: 1, reason: 'said' },
      ]}),
      JSON.stringify({ results: [
        { fact: 'mentions subsystem API', score: 1, reason: 'said' },
        { fact: 'mentions subsystem Worker', score: 1, reason: 'said' },
        { fact: 'mentions external dependency postgres', score: 1, reason: 'said' },
      ]}),
    ]);

    const result = await scoreDocs(artifacts, overview, arch, llm);

    expect(result).toHaveLength(2);
    expect(result[0].module).toBe('overview');
    expect(result[0].overall).toBe(1);
    expect(result[1].module).toBe('architecture');
    expect(result[1].overall).toBe(1);
  });

  it('gives zero overall for missing modules', async () => {
    const llm = mockLLM([]);
    const result = await scoreDocs([], overview, arch, llm);
    expect(result).toEqual([
      { module: 'overview', overall: 0, factScores: [] },
      { module: 'architecture', overall: 0, factScores: [] },
    ]);
  });

  it('averages per-fact scores', async () => {
    const artifacts = [docArtifact('overview', '# X')];
    const llm = mockLLM([
      JSON.stringify({ results: [
        { fact: 'is a web service', score: 1, reason: '' },
        { fact: 'uses postgres', score: 0, reason: '' },
      ]}),
    ]);

    const result = await scoreDocs(artifacts, overview, { subsystems: [], externalDependencies: [] }, llm);
    expect(result[0].overall).toBe(0.5);
  });

  it('deterministically scores mustMentionFiles by substring presence in the architecture doc', async () => {
    const markdown = '# Arch\nThe API layer lives in src/routes/v1/auth.route.js.\nWorkers are in src/workers/.';
    const artifacts = [docArtifact('architecture', markdown)];
    const archWithFiles: ExpectedArchitecture = {
      subsystems: [
        {
          name: 'API',
          mustMentionFiles: ['src/routes/v1/auth.route.js', 'src/routes/v1/user.route.js'],
        },
      ],
      externalDependencies: [],
    };
    const llm = mockLLM([
      JSON.stringify({ results: [
        { fact: 'mentions subsystem API', score: 1, reason: 'said' },
      ]}),
    ]);

    const result = await scoreDocs(artifacts, { bullets: [] }, archWithFiles, llm);

    const archScore = result[1];
    const fileScores = archScore.factScores.filter(f => f.fact.startsWith('mentions file'));
    expect(fileScores).toHaveLength(2);
    expect(fileScores.find(f => f.fact.includes('auth.route.js'))?.score).toBe(1);
    expect(fileScores.find(f => f.fact.includes('user.route.js'))?.score).toBe(0);
    // overall = (1 subsystem + 1 hit + 0 miss) / 3 = 0.666...
    expect(archScore.overall).toBeCloseTo(2 / 3, 5);
  });
});
