/**
 * Unit tests for InProcessJobQueue (Phase 2.0)
 *
 * Covers:
 *   1. enqueue() calls ingestionService.triggerIngestion with correct args
 *   2. enqueue() returns the jobId from triggerIngestion
 *   3. enqueue() re-throws errors from triggerIngestion
 *   4. getStatus() returns the job status from storageAdapter.getJob
 *   5. getStatus() throws if job not found
 *   6. Concurrency semaphore: a fourth enqueue blocks when maxConcurrentJobs=3
 *      and 3 jobs are in-flight
 *   7. Semaphore is released when a job reaches a terminal state, unblocking
 *      the waiting enqueue
 *
 * IngestionService is mocked at the interface boundary — only triggerIngestion
 * is used by InProcessJobQueue, so the mock is minimal.
 * StorageAdapter is mocked for getJob only.
 * Fake timers are used to control the polling loop without real delays.
 */

import type { IngestionJob, StorageAdapter } from '@codeinsight/types';

import { IngestionService } from '../IngestionService';
import { InProcessJobQueue } from '../InProcessJobQueue';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeMockIngestionService(overrides?: {
  triggerIngestion?: jest.Mock;
}): jest.Mocked<Pick<IngestionService, 'triggerIngestion'>> & IngestionService {
  return {
    triggerIngestion: overrides?.triggerIngestion ?? jest.fn(),
  } as unknown as jest.Mocked<Pick<IngestionService, 'triggerIngestion'>> & IngestionService;
}

function makeMockStorageAdapter(overrides?: {
  getJob?: jest.Mock;
}): jest.Mocked<Pick<StorageAdapter, 'getJob'>> & StorageAdapter {
  return {
    getJob: overrides?.getJob ?? jest.fn().mockResolvedValue(null),
  } as unknown as jest.Mocked<Pick<StorageAdapter, 'getJob'>> & StorageAdapter;
}

function makeJob(repoId = 'repo-1', repoUrl = 'https://github.com/org/repo') {
  return { repoId, repoUrl, trigger: 'manual' as const };
}

function makeIngestionJobRecord(overrides?: Partial<IngestionJob>): IngestionJob {
  return {
    jobId: 'job-001',
    repoId: 'repo-1',
    trigger: 'manual',
    status: 'queued',
    filesProcessed: 0,
    filesSkipped: 0,
    tokensConsumed: 0,
    createdAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InProcessJobQueue', () => {

  // -------------------------------------------------------------------------
  // enqueue() — happy path
  // -------------------------------------------------------------------------

  describe('enqueue()', () => {
    it('calls triggerIngestion with the correct repoId, repoUrl, and trigger', async () => {
      const triggerIngestion = jest.fn().mockResolvedValue('job-abc');
      const service = makeMockIngestionService({ triggerIngestion });
      const storage = makeMockStorageAdapter({
        getJob: jest.fn().mockResolvedValue(makeIngestionJobRecord({ jobId: 'job-abc', status: 'completed' })),
      });

      const queue = new InProcessJobQueue(service, storage);
      await queue.enqueue(makeJob());

      expect(triggerIngestion).toHaveBeenCalledTimes(1);
      expect(triggerIngestion).toHaveBeenCalledWith(
        'repo-1',
        'https://github.com/org/repo',
        'manual',
      );
    });

    it('returns the jobId produced by triggerIngestion', async () => {
      const triggerIngestion = jest.fn().mockResolvedValue('job-xyz');
      const service = makeMockIngestionService({ triggerIngestion });
      const storage = makeMockStorageAdapter({
        getJob: jest.fn().mockResolvedValue(makeIngestionJobRecord({ jobId: 'job-xyz', status: 'completed' })),
      });

      const queue = new InProcessJobQueue(service, storage);
      const jobId = await queue.enqueue(makeJob());

      expect(jobId).toBe('job-xyz');
    });

    it('passes through a webhook trigger', async () => {
      const triggerIngestion = jest.fn().mockResolvedValue('job-webhook');
      const service = makeMockIngestionService({ triggerIngestion });
      const storage = makeMockStorageAdapter({
        getJob: jest.fn().mockResolvedValue(makeIngestionJobRecord({ jobId: 'job-webhook', status: 'completed' })),
      });

      const queue = new InProcessJobQueue(service, storage);
      await queue.enqueue({ repoId: 'repo-2', repoUrl: 'https://github.com/org/repo2', trigger: 'webhook' });

      expect(triggerIngestion).toHaveBeenCalledWith('repo-2', 'https://github.com/org/repo2', 'webhook');
    });
  });

  // -------------------------------------------------------------------------
  // enqueue() — error re-throw
  // -------------------------------------------------------------------------

  describe('enqueue() — error propagation', () => {
    it('re-throws an error from triggerIngestion (e.g. "already running")', async () => {
      const triggerIngestion = jest.fn().mockRejectedValue(
        new Error('Ingestion already running for repo repo-1 (job job-running)'),
      );
      const service = makeMockIngestionService({ triggerIngestion });
      const storage = makeMockStorageAdapter();

      const queue = new InProcessJobQueue(service, storage);

      await expect(queue.enqueue(makeJob())).rejects.toThrow(
        /already running.*repo-1/,
      );
    });

    it('releases the semaphore slot after an error so subsequent enqueues are not blocked', async () => {
      // First enqueue fails, semaphore must be released
      const triggerIngestion = jest.fn()
        .mockRejectedValueOnce(new Error('already running'))
        .mockResolvedValueOnce('job-second');

      const storage = makeMockStorageAdapter({
        getJob: jest.fn().mockResolvedValue(makeIngestionJobRecord({ jobId: 'job-second', status: 'completed' })),
      });

      const queue = new InProcessJobQueue(
        makeMockIngestionService({ triggerIngestion }),
        storage,
        1, // maxConcurrentJobs = 1 to make the semaphore effect observable
      );

      // First enqueue errors — should release its slot
      await expect(queue.enqueue(makeJob())).rejects.toThrow('already running');

      // Second enqueue must not hang (slot was released)
      const jobId = await queue.enqueue(makeJob('repo-2', 'https://github.com/org/repo2'));
      expect(jobId).toBe('job-second');
    });
  });

  // -------------------------------------------------------------------------
  // getStatus()
  // -------------------------------------------------------------------------

  describe('getStatus()', () => {
    it('returns the status from storageAdapter.getJob', async () => {
      const getJob = jest.fn().mockResolvedValue(
        makeIngestionJobRecord({ jobId: 'job-001', status: 'running' }),
      );
      const service = makeMockIngestionService();
      const storage = makeMockStorageAdapter({ getJob });

      const queue = new InProcessJobQueue(service, storage);
      const status = await queue.getStatus('job-001');

      expect(status).toBe('running');
      expect(getJob).toHaveBeenCalledWith('job-001');
    });

    it('returns "completed" when the job has completed', async () => {
      const getJob = jest.fn().mockResolvedValue(
        makeIngestionJobRecord({ status: 'completed' }),
      );
      const queue = new InProcessJobQueue(
        makeMockIngestionService(),
        makeMockStorageAdapter({ getJob }),
      );

      expect(await queue.getStatus('job-001')).toBe('completed');
    });

    it('returns "failed" when the job has failed', async () => {
      const getJob = jest.fn().mockResolvedValue(
        makeIngestionJobRecord({ status: 'failed' }),
      );
      const queue = new InProcessJobQueue(
        makeMockIngestionService(),
        makeMockStorageAdapter({ getJob }),
      );

      expect(await queue.getStatus('job-001')).toBe('failed');
    });

    it('returns "partial" when the job ended with partial status', async () => {
      const getJob = jest.fn().mockResolvedValue(
        makeIngestionJobRecord({ status: 'partial' }),
      );
      const queue = new InProcessJobQueue(
        makeMockIngestionService(),
        makeMockStorageAdapter({ getJob }),
      );

      expect(await queue.getStatus('job-001')).toBe('partial');
    });

    it('throws when the job is not found', async () => {
      const getJob = jest.fn().mockResolvedValue(null);
      const queue = new InProcessJobQueue(
        makeMockIngestionService(),
        makeMockStorageAdapter({ getJob }),
      );

      await expect(queue.getStatus('job-missing')).rejects.toThrow(
        'Job job-missing not found',
      );
    });
  });

  // -------------------------------------------------------------------------
  // Concurrency semaphore
  // -------------------------------------------------------------------------

  describe('concurrency semaphore', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('allows up to maxConcurrentJobs enqueues without blocking', async () => {
      // 3 slots; enqueue 3 jobs — all should resolve immediately
      let jobCounter = 0;
      const triggerIngestion = jest.fn().mockImplementation(async () => {
        jobCounter++;
        return `job-${jobCounter}`;
      });

      // getJob always returns a running status to keep the background poll alive
      const getJob = jest.fn().mockResolvedValue(
        makeIngestionJobRecord({ status: 'running' }),
      );

      const queue = new InProcessJobQueue(
        makeMockIngestionService({ triggerIngestion }),
        makeMockStorageAdapter({ getJob }),
        3,
      );

      const results = await Promise.all([
        queue.enqueue(makeJob('r1', 'https://github.com/org/r1')),
        queue.enqueue(makeJob('r2', 'https://github.com/org/r2')),
        queue.enqueue(makeJob('r3', 'https://github.com/org/r3')),
      ]);

      expect(results).toEqual(['job-1', 'job-2', 'job-3']);
    });

    it('blocks a fourth enqueue when 3 slots are already occupied', async () => {
      // All three slots occupied with never-resolving triggers
      const neverResolveOrTerminate = jest.fn().mockReturnValue(new Promise(() => {}));

      const getJob = jest.fn().mockResolvedValue(
        makeIngestionJobRecord({ status: 'running' }),
      );

      const queue = new InProcessJobQueue(
        makeMockIngestionService({ triggerIngestion: neverResolveOrTerminate }),
        makeMockStorageAdapter({ getJob }),
        3,
      );

      // Start 3 enqueues — they each hang waiting for triggerIngestion
      const p1 = queue.enqueue(makeJob('r1', 'https://github.com/org/r1'));
      const p2 = queue.enqueue(makeJob('r2', 'https://github.com/org/r2'));
      const p3 = queue.enqueue(makeJob('r3', 'https://github.com/org/r3'));

      // Fourth enqueue must not have resolved yet — track its resolution
      let fourthResolved = false;
      const p4 = queue.enqueue(makeJob('r4', 'https://github.com/org/r4')).then(id => {
        fourthResolved = true;
        return id;
      });

      // Allow existing microtasks to drain but advance no timers
      await Promise.resolve();
      await Promise.resolve();

      // The fourth enqueue should still be blocked (semaphore full)
      expect(fourthResolved).toBe(false);

      // Suppress unhandled rejection noise — these promises never resolve
      p1.catch(() => {});
      p2.catch(() => {});
      p3.catch(() => {});
      p4.catch(() => {});
    });

    it('unblocks a waiting enqueue when a running job reaches a terminal state', async () => {
      // Slot size = 1. First job occupies the single slot. Once it terminates,
      // the second enqueue should proceed.

      let resolveFirstTrigger!: (value: string) => void;
      const firstTrigger = new Promise<string>(resolve => {
        resolveFirstTrigger = resolve;
      });

      let triggerCallCount = 0;
      const triggerIngestion = jest.fn().mockImplementation(() => {
        triggerCallCount++;
        if (triggerCallCount === 1) return firstTrigger;
        return Promise.resolve('job-second');
      });

      // getJob: return 'running' for job-first, then 'completed' to release the semaphore
      let pollCount = 0;
      const getJob = jest.fn().mockImplementation(async (jobId: string) => {
        if (jobId === 'job-first') {
          pollCount++;
          // On the 2nd poll, return terminal status
          const status = pollCount >= 2 ? 'completed' : 'running';
          return makeIngestionJobRecord({ jobId: 'job-first', status });
        }
        return makeIngestionJobRecord({ jobId: 'job-second', status: 'completed' });
      });

      const queue = new InProcessJobQueue(
        makeMockIngestionService({ triggerIngestion }),
        makeMockStorageAdapter({ getJob }),
        1, // maxConcurrentJobs = 1
      );

      // Start first enqueue — triggers first and occupies the single slot
      resolveFirstTrigger('job-first');
      const firstJobId = await queue.enqueue(makeJob('r1', 'https://github.com/org/r1'));
      expect(firstJobId).toBe('job-first');

      // Start second enqueue — should be blocked
      let secondResolved = false;
      const p2 = queue.enqueue(makeJob('r2', 'https://github.com/org/r2')).then(id => {
        secondResolved = true;
        return id;
      });

      // Allow microtasks to drain — second enqueue is blocked
      await Promise.resolve();
      await Promise.resolve();
      expect(secondResolved).toBe(false);

      // Advance fake timers past the first poll interval (500ms) — first poll returns 'running'
      jest.advanceTimersByTime(500);
      await Promise.resolve();
      await Promise.resolve();

      // Advance again — second poll returns 'completed', releasing the semaphore
      jest.advanceTimersByTime(500);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      const secondJobId = await p2;
      expect(secondResolved).toBe(true);
      expect(secondJobId).toBe('job-second');
    });
  });
});
