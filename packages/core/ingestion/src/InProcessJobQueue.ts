import type { Job, JobQueue, JobStatus, StorageAdapter } from '@codeinsight/types';

import { IngestionService } from './IngestionService';

// ---------------------------------------------------------------------------
// Semaphore — limits concurrent pipeline executions
// ---------------------------------------------------------------------------

class Semaphore {
  private available: number;
  private readonly waiting: Array<() => void> = [];

  constructor(max: number) {
    this.available = max;
  }

  async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available--;
      return;
    }
    return new Promise<void>(resolve => this.waiting.push(resolve));
  }

  release(): void {
    const next = this.waiting.shift();
    if (next) {
      next();
    } else {
      this.available++;
    }
  }
}

// ---------------------------------------------------------------------------
// InProcessJobQueue
// ---------------------------------------------------------------------------

const TERMINAL_STATUSES = new Set<JobStatus>(['completed', 'failed', 'partial']);
const POLL_INTERVAL_MS = 500;

/**
 * In-process job queue backed by a concurrency semaphore.
 *
 * Limits how many ingestion pipelines can run simultaneously. When all
 * slots are taken, new `enqueue()` calls wait until a slot is released
 * rather than being rejected.
 */
export class InProcessJobQueue implements JobQueue {
  private readonly semaphore: Semaphore;

  constructor(
    private readonly ingestionService: IngestionService,
    private readonly storageAdapter: StorageAdapter,
    maxConcurrentJobs = 3,
  ) {
    this.semaphore = new Semaphore(maxConcurrentJobs);
  }

  async enqueue(job: Job): Promise<string> {
    // Wait for a slot before starting the pipeline
    await this.semaphore.acquire();

    let jobId: string;
    try {
      jobId = await this.ingestionService.triggerIngestion(
        job.repoId,
        job.repoUrl,
        job.trigger,
      );
    } catch (err) {
      // triggerIngestion threw (e.g. dedup rejection) — release immediately
      this.semaphore.release();
      throw err;
    }

    // Release the semaphore once the pipeline reaches a terminal state.
    // This runs in the background — enqueue() returns the jobId immediately.
    this.waitForTerminal(jobId)
      .catch(() => undefined)
      .finally(() => this.semaphore.release());

    return jobId;
  }

  async getStatus(jobId: string): Promise<JobStatus> {
    const job = await this.storageAdapter.getJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);
    return job.status;
  }

  private async waitForTerminal(jobId: string): Promise<void> {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const job = await this.storageAdapter.getJob(jobId);
      if (!job || TERMINAL_STATUSES.has(job.status)) return;
      await new Promise<void>(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }
}
