import type { Artifact, LLMClient } from '@codeinsight/types';

import { runEval } from '../runner';
import type { PipelineAdapter, RepoFixture } from '../types';

function fixture(): RepoFixture {
  return {
    meta: {
      slug: 'small',
      gitUrl: 'https://example.com/foo.git',
      commitSha: 'deadbeef',
      description: 'test',
      sizeCategory: 'small',
      fileCountApprox: 10,
    },
    expectedOverview: { bullets: ['does X'] },
    expectedArchitecture: { subsystems: [], externalDependencies: [] },
    expectedDiagrams: {
      systemArchitecture: { mustContainLabels: [], mustContainEdges: [] },
      dataModel: null,
      keyFlows: [],
    },
    qaPairs: [],
  };
}

function mockAdapter(): PipelineAdapter {
  return {
    version: 'test',
    ingest: jest.fn().mockResolvedValue(undefined),
    getDocArtifacts: jest.fn().mockResolvedValue([] as Artifact[]),
    getDiagramArtifacts: jest.fn().mockResolvedValue([] as Artifact[]),
    askQna: jest.fn(),
  };
}

function mockLLM(): LLMClient {
  return {
    complete: jest.fn().mockResolvedValue('{"results":[]}'),
    stream: jest.fn(),
  } as unknown as LLMClient;
}

describe('runEval', () => {
  it('clones, ingests, scores, and returns a RepoReport', async () => {
    const cloneFn = jest.fn().mockResolvedValue('/tmp/clone-dir');
    const adapter = mockAdapter();
    const llm = mockLLM();

    const report = await runEval({
      fixture: fixture(),
      adapter,
      judgeLlm: llm,
      cloneFn,
      now: () => new Date('2026-04-19T12:00:00Z'),
    });

    expect(cloneFn).toHaveBeenCalledWith('https://example.com/foo.git', 'deadbeef');
    expect(adapter.ingest).toHaveBeenCalled();
    expect(report.fixtureSlug).toBe('small');
    expect(report.pipelineVersion).toBe('test');
    expect(report.doc).toHaveLength(2);
    expect(report.diagram).toHaveLength(3);
    expect(report.qna.details).toHaveLength(0);
    expect(report.wallClockSeconds).toBeGreaterThanOrEqual(0);
  });
});
