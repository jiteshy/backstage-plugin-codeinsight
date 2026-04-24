import type { IngestionStack } from '@codeinsight/composition';
import type { Artifact, VectorChunk } from '@codeinsight/types';

import type { CostTracker } from '../costTracker';
import type { CostSummary, PipelineAdapter, RepoFixtureMeta } from '../types';

export interface V1AdapterOpts {
  costTracker: CostTracker;
  /** Poll interval when waiting for ingestion job to finish (ms). */
  jobPollIntervalMs?: number;
  /** Hard cap on how long to wait for ingestion (ms). */
  jobTimeoutMs?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_JOB_TIMEOUT_MS = 30 * 60 * 1_000; // 30 min

export class V1Adapter implements PipelineAdapter {
  readonly version = 'v1';

  constructor(
    private readonly stack: IngestionStack,
    private readonly opts: V1AdapterOpts,
  ) {}

  async ingest(meta: RepoFixtureMeta, _cloneDir: string): Promise<void> {
    const repoId = meta.slug;

    // Cascade-delete any prior repo data so the ingest starts from a clean slate.
    // ci_repositories has ON DELETE CASCADE to every child table.
    await this.stack.storageAdapter.deleteRepo(repoId);

    const jobId = await this.stack.ingestionService.triggerIngestion(
      repoId,
      meta.gitUrl,
      'manual',
    );

    await this.waitForJob(jobId);
  }

  private async waitForJob(jobId: string): Promise<void> {
    const interval = this.opts.jobPollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const timeout = this.opts.jobTimeoutMs ?? DEFAULT_JOB_TIMEOUT_MS;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      const job = await this.stack.storageAdapter.getJob(jobId);
      if (!job) {
        throw new Error(`Job ${jobId} not found`);
      }
      if (job.status === 'completed' || job.status === 'partial') {
        return;
      }
      if (job.status === 'failed') {
        throw new Error(
          `Ingestion job ${jobId} failed: ${job.errorMessage ?? 'unknown error'}`,
        );
      }
      await delay(interval);
    }

    throw new Error(`Ingestion job ${jobId} timed out after ${timeout}ms`);
  }

  async getDocArtifacts(repoSlug: string): Promise<Artifact[]> {
    return this.stack.storageAdapter.getArtifactsByType(repoSlug, 'doc');
  }

  async getDiagramArtifacts(repoSlug: string): Promise<Artifact[]> {
    return this.stack.storageAdapter.getArtifactsByType(repoSlug, 'diagram');
  }

  async askQna(
    repoSlug: string,
    question: string,
  ): Promise<{ answer: string; retrievedChunks: VectorChunk[] }> {
    if (!this.stack.qnaService) {
      throw new Error(
        'QnA service not configured — v1Adapter requires both LLM and embedding config',
      );
    }

    const session = await this.stack.qnaService.createSession(repoSlug);
    const result = await this.stack.qnaService.ask(session.sessionId, question);

    // The qna scorer only reads `metadata.filePath` from each chunk.
    // Synthesize minimal VectorChunk shapes from the QnASource list so scoring works.
    const retrievedChunks: VectorChunk[] = result.sources.map((src, i) => ({
      chunkId: `eval-src-${i}`,
      repoId: repoSlug,
      content: src.snippet ?? '',
      contentSha: '',
      layer: src.layer ?? 'unknown',
      metadata: {
        filePath: src.filePath,
        symbol: src.symbol,
        startLine: src.startLine,
        endLine: src.endLine,
      },
    }));

    return { answer: result.answer, retrievedChunks };
  }

  cost(): CostSummary {
    return this.opts.costTracker.summary();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
