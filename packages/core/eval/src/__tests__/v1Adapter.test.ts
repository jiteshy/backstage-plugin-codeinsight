import type { IngestionStack } from '@codeinsight/composition';
import type { Artifact, IngestionJob, QnAAnswer } from '@codeinsight/types';

import { V1Adapter } from '../adapters/v1Adapter';
import { CostTracker } from '../costTracker';
import type { RepoFixtureMeta } from '../types';

function mockStack(overrides?: {
  jobStatuses?: IngestionJob['status'][];
  qnaAnswer?: QnAAnswer;
  artifacts?: Artifact[];
}): IngestionStack {
  const jobStatuses = overrides?.jobStatuses ?? ['completed'];
  let callIdx = 0;

  const getJob = jest.fn().mockImplementation(
    async (): Promise<IngestionJob> => ({
      jobId: 'job-1',
      repoId: 'test',
      trigger: 'manual',
      status: jobStatuses[Math.min(callIdx++, jobStatuses.length - 1)],
      filesProcessed: 0,
      filesSkipped: 0,
      tokensConsumed: 0,
      createdAt: new Date(),
      errorMessage: null,
    }),
  );

  return {
    storageAdapter: {
      deleteRepo: jest.fn().mockResolvedValue(undefined),
      getJob,
      getArtifactsByType: jest
        .fn()
        .mockImplementation(async (_repoId: string, type: string) =>
          (overrides?.artifacts ?? []).filter(a => a.artifactType === type),
        ),
    } as never,
    ingestionService: {
      triggerIngestion: jest.fn().mockResolvedValue('job-1'),
    } as never,
    jobQueue: {} as never,
    qnaService: {
      createSession: jest
        .fn()
        .mockResolvedValue({ sessionId: 'sess-1', repoId: 'test' }),
      ask: jest
        .fn()
        .mockResolvedValue(
          overrides?.qnaAnswer ?? {
            answer: 'hi',
            sources: [],
            tokensUsed: 0,
            messageId: 'm-1',
            sessionId: 'sess-1',
          },
        ),
    } as never,
    llmClient: {} as never,
    embeddingClient: {} as never,
    vectorStore: {} as never,
    docGenerationService: undefined,
    diagramGenerationService: {} as never,
    indexingService: undefined,
    logger: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
}

const fixtureMeta: RepoFixtureMeta = {
  slug: 'test',
  gitUrl: 'https://github.com/example/test',
  commitSha: 'abc123',
  description: 'test repo',
  sizeCategory: 'small',
  fileCountApprox: 10,
};

describe('V1Adapter', () => {
  it('version is "v1"', () => {
    const a = new V1Adapter(mockStack(), { costTracker: new CostTracker() });
    expect(a.version).toBe('v1');
  });

  it('ingest() deletes prior repo rows, triggers ingestion, and waits for the job', async () => {
    const stack = mockStack({ jobStatuses: ['queued', 'running', 'completed'] });
    const a = new V1Adapter(stack, {
      costTracker: new CostTracker(),
      jobPollIntervalMs: 1,
    });

    await a.ingest(fixtureMeta, '/tmp/clone');

    expect(stack.storageAdapter.deleteRepo).toHaveBeenCalledWith('test');
    expect(stack.ingestionService.triggerIngestion).toHaveBeenCalledWith(
      'test',
      'https://github.com/example/test',
      'manual',
    );
    expect(stack.storageAdapter.getJob).toHaveBeenCalled();
  });

  it('ingest() throws when the job fails', async () => {
    const stack = mockStack({ jobStatuses: ['failed'] });
    const a = new V1Adapter(stack, {
      costTracker: new CostTracker(),
      jobPollIntervalMs: 1,
    });

    await expect(a.ingest(fixtureMeta, '/tmp/clone')).rejects.toThrow(/failed/);
  });

  it('ingest() accepts a "partial" terminal status', async () => {
    const stack = mockStack({ jobStatuses: ['partial'] });
    const a = new V1Adapter(stack, {
      costTracker: new CostTracker(),
      jobPollIntervalMs: 1,
    });

    await expect(a.ingest(fixtureMeta, '/tmp/clone')).resolves.toBeUndefined();
  });

  it('getDocArtifacts filters to artifactType=doc', async () => {
    const stack = mockStack({
      artifacts: [
        { artifactType: 'doc' } as Artifact,
        { artifactType: 'diagram' } as Artifact,
      ],
    });
    const a = new V1Adapter(stack, { costTracker: new CostTracker() });

    const result = await a.getDocArtifacts('test');
    expect(result).toHaveLength(1);
    expect(result[0].artifactType).toBe('doc');
    expect(stack.storageAdapter.getArtifactsByType).toHaveBeenCalledWith(
      'test',
      'doc',
    );
  });

  it('getDiagramArtifacts filters to artifactType=diagram', async () => {
    const stack = mockStack({
      artifacts: [
        { artifactType: 'doc' } as Artifact,
        { artifactType: 'diagram' } as Artifact,
      ],
    });
    const a = new V1Adapter(stack, { costTracker: new CostTracker() });

    const result = await a.getDiagramArtifacts('test');
    expect(result).toHaveLength(1);
    expect(result[0].artifactType).toBe('diagram');
  });

  it('askQna creates session, asks, returns answer + synthesized retrievedChunks', async () => {
    const stack = mockStack({
      qnaAnswer: {
        answer: 'The auth flow works like this.',
        sources: [
          { filePath: 'src/auth.ts', startLine: 1, endLine: 10, layer: 'code' },
          { filePath: 'src/user.ts' },
        ],
        tokensUsed: 100,
        messageId: 'm-1',
        sessionId: 'sess-1',
      },
    });
    const a = new V1Adapter(stack, { costTracker: new CostTracker() });

    const { answer, retrievedChunks } = await a.askQna('test', 'how does auth work?');

    expect(answer).toBe('The auth flow works like this.');
    expect(retrievedChunks).toHaveLength(2);
    expect(retrievedChunks[0].metadata?.['filePath']).toBe('src/auth.ts');
    expect(retrievedChunks[1].metadata?.['filePath']).toBe('src/user.ts');
  });

  it('askQna throws if qnaService is not configured', async () => {
    const stack = mockStack();
    (stack as { qnaService: unknown }).qnaService = undefined;

    const a = new V1Adapter(stack, { costTracker: new CostTracker() });
    await expect(a.askQna('test', 'question')).rejects.toThrow(/QnA/);
  });

  it('cost() returns the CostTracker summary', () => {
    const tracker = new CostTracker();
    tracker.recordChat('claude-opus-4-7', 100, 20);
    const a = new V1Adapter(mockStack(), { costTracker: tracker });

    const c = a.cost();
    expect(c.chatRequests).toBe(1);
    expect(c.chatInputTokens).toBe(100);
  });
});
