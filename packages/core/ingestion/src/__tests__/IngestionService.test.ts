/**
 * Unit tests for IngestionService (Phase 1.8 fixes)
 *
 * Covers the three behaviours that have no unit-level test:
 *   1. finalStatus is 'partial' when filesSkipped > 0, 'completed' otherwise
 *   2. Clone directory is removed after a successful run when
 *      cleanupAfterIngestion is true (the default), and kept when false
 *   3. Duplicate-job guard: queued → return existing jobId, running → throw
 *
 * CIGPersistenceService is constructed internally by IngestionService, so
 * the entire '@codeinsight/cig' module is mocked at the module level.
 * CIGBuilder is injectable via the optional 5th constructor param.
 * All I/O interfaces (StorageAdapter, RepoConnector) are jest.fn() mocks.
 * fs/promises is mocked to avoid any real filesystem interaction.
 */

import { promises as fs } from 'fs';

import type {
  IngestionConfig,
  IngestionJob,
  RepoConnector,
  RepoFile,
  StorageAdapter,
} from '@codeinsight/types';

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

// Mock the entire @codeinsight/cig module so CIGPersistenceService.persist
// and CIGBuilder.build can be controlled without tree-sitter / Postgres.
jest.mock('@codeinsight/cig', () => {
  const mockPersist = jest.fn().mockResolvedValue(undefined);
  const mockBuild = jest.fn();

  const MockCIGPersistenceService = jest.fn().mockImplementation(() => ({
    persist: mockPersist,
  }));

  const MockCIGBuilder = jest.fn().mockImplementation(() => ({
    build: mockBuild,
    registerExtractor: jest.fn(),
    registerContentExtractor: jest.fn(),
  }));

  return {
    CIGPersistenceService: MockCIGPersistenceService,
    CIGBuilder: MockCIGBuilder,
    TypeScriptExtractor: jest.fn(),
    PrismaExtractor: jest.fn(),
    // expose the raw mock fns so tests can configure them
    __mockPersist: mockPersist,
    __mockBuild: mockBuild,
  };
});

// Mock fs/promises so no real filesystem I/O occurs.
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: jest.fn(),
      rm: jest.fn().mockResolvedValue(undefined),
    },
  };
});

// Import after mocks are set up.
import { IngestionService } from '../IngestionService';
import { StalenessService } from '../StalenessService';

// ---------------------------------------------------------------------------
// Typed access to the mock internals
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-var-requires
const cigMocks = require('@codeinsight/cig') as {
  __mockPersist: jest.Mock;
  __mockBuild: jest.Mock;
  CIGBuilder: jest.Mock;
};

const mockReadFile = fs.readFile as jest.Mock;
const mockFsRm = fs.rm as jest.Mock;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRepoFile(overrides?: Partial<RepoFile>): RepoFile {
  return {
    repoId: 'repo-1',
    filePath: 'src/index.ts',
    currentSha: 'sha-abc',
    lastProcessedSha: null,
    fileType: 'source',
    language: 'typescript',
    parseStatus: 'pending',
    ...overrides,
  };
}

function makeJob(overrides?: Partial<IngestionJob>): IngestionJob {
  return {
    jobId: 'job-001',
    repoId: 'repo-1',
    trigger: 'manual',
    status: 'queued',
    filesProcessed: 0,
    filesSkipped: 0,
    tokensConsumed: 0,
    createdAt: new Date('2024-01-01'),
    ...overrides,
  };
}

function makeConfig(overrides?: Partial<IngestionConfig>): IngestionConfig {
  return {
    tempDir: '/tmp/codeinsight-test',
    deltaThreshold: 0.4,
    maxConcurrentJobs: 1,
    jobTimeoutMinutes: 30,
    cleanupAfterIngestion: true,
    ...overrides,
  };
}

function makeLogger() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function makeStorageAdapter(): jest.Mocked<StorageAdapter> {
  return {
    getActiveJobForRepo: jest.fn(),
    getRepo: jest.fn(),
    upsertRepo: jest.fn().mockResolvedValue(undefined),
    updateRepoStatus: jest.fn().mockResolvedValue(undefined),
    createJob: jest.fn().mockImplementation(async (job: IngestionJob) => job.jobId),
    updateJob: jest.fn().mockResolvedValue(undefined),
    upsertRepoFiles: jest.fn().mockResolvedValue(undefined),
    getRepoFiles: jest.fn().mockResolvedValue([]),
    getChangedRepoFiles: jest.fn().mockResolvedValue([]),
    deleteRepoFilesNotIn: jest.fn().mockResolvedValue(undefined),
    upsertCIGNodes: jest.fn().mockResolvedValue(undefined),
    upsertCIGEdges: jest.fn().mockResolvedValue(undefined),
    deleteCIGForFiles: jest.fn().mockResolvedValue(undefined),
    getCIGNodes: jest.fn().mockResolvedValue([]),
    getCIGEdges: jest.fn().mockResolvedValue([]),
    upsertArtifact: jest.fn().mockResolvedValue(undefined),
    getArtifact: jest.fn().mockResolvedValue(null),
    getArtifactsByType: jest.fn().mockResolvedValue([]),
    getStaleArtifacts: jest.fn().mockResolvedValue([]),
    markArtifactsStale: jest.fn().mockResolvedValue(undefined),
    upsertArtifactInputs: jest.fn().mockResolvedValue(undefined),
    getArtifactInputs: jest.fn().mockResolvedValue([]),
    getArtifactIdsByFilePaths: jest.fn().mockResolvedValue([]),
    getArtifactDependents: jest.fn().mockResolvedValue([]),
    getJob: jest.fn().mockResolvedValue(null),
  } as unknown as jest.Mocked<StorageAdapter>;
}

function makeRepoConnector(overrides?: Partial<RepoConnector>): jest.Mocked<RepoConnector> {
  return {
    clone: jest.fn().mockResolvedValue(undefined),
    getFileTree: jest.fn().mockResolvedValue([makeRepoFile()]),
    getHeadSha: jest.fn().mockResolvedValue('head-sha-001'),
    getChangedFiles: jest.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as jest.Mocked<RepoConnector>;
}

// ---------------------------------------------------------------------------
// Helper: build a CIGBuildResult with configurable filesSkipped
// ---------------------------------------------------------------------------

function makeBuildResult(overrides?: {
  filesProcessed?: number;
  filesSkipped?: number;
  errorPaths?: string[];
}) {
  const errorPaths = overrides?.errorPaths ?? [];
  return {
    nodes: [],
    edges: [],
    filesProcessed: overrides?.filesProcessed ?? 1,
    filesSkipped: overrides?.filesSkipped ?? 0,
    errors: errorPaths.map(filePath => ({ filePath, error: 'parse error' })),
  };
}

// ---------------------------------------------------------------------------
// Shared setup: configure storage and file-reading for a standard full run
// ---------------------------------------------------------------------------

function setupFullRunMocks(
  storage: jest.Mocked<StorageAdapter>,
  buildResult: ReturnType<typeof makeBuildResult>,
) {
  // No active job, no prior repo record
  storage.getActiveJobForRepo.mockResolvedValue(null);
  storage.getRepo.mockResolvedValue(null); // triggers upsertRepo + no lastCommitSha → full run

  cigMocks.__mockBuild.mockReturnValue(buildResult);
  mockReadFile.mockResolvedValue(Buffer.from('// file content'));
}

// ---------------------------------------------------------------------------
// Helper: trigger ingestion and wait for the async pipeline to settle
// ---------------------------------------------------------------------------

async function triggerAndWait(service: IngestionService, repoId = 'repo-1', repoUrl = 'https://github.com/org/repo') {
  const jobId = await service.triggerIngestion(repoId, repoUrl, 'manual');
  // Allow the fire-and-forget pipeline to resolve
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  return jobId;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IngestionService', () => {
  let storage: jest.Mocked<StorageAdapter>;
  let connector: jest.Mocked<RepoConnector>;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    jest.clearAllMocks();
    storage = makeStorageAdapter();
    connector = makeRepoConnector();
    logger = makeLogger();
  });

  // -------------------------------------------------------------------------
  // triggerIngestion — duplicate-job guard
  // -------------------------------------------------------------------------

  describe('triggerIngestion — duplicate-job guard', () => {
    it('returns the existing jobId when an identical queued job exists', async () => {
      const existingJob = makeJob({ jobId: 'queued-job-existing', status: 'queued' });
      storage.getActiveJobForRepo.mockResolvedValue(existingJob);

      const service = new IngestionService(connector, storage, logger, makeConfig());
      const result = await service.triggerIngestion('repo-1', 'https://github.com/org/repo', 'manual');

      expect(result).toBe('queued-job-existing');
      expect(storage.createJob).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        'Returning existing queued job',
        expect.objectContaining({ repoId: 'repo-1', jobId: 'queued-job-existing' }),
      );
    });

    it('throws when a running job already exists for the repo', async () => {
      const runningJob = makeJob({ jobId: 'running-job-123', status: 'running' });
      storage.getActiveJobForRepo.mockResolvedValue(runningJob);

      const service = new IngestionService(connector, storage, logger, makeConfig());

      await expect(
        service.triggerIngestion('repo-1', 'https://github.com/org/repo', 'manual'),
      ).rejects.toThrow(/already running.*repo-1.*running-job-123/);

      expect(storage.createJob).not.toHaveBeenCalled();
    });

    it('creates a new repo record when the repo does not exist yet', async () => {
      storage.getActiveJobForRepo.mockResolvedValue(null);
      storage.getRepo.mockResolvedValue(null); // repo does not exist

      const service = new IngestionService(connector, storage, logger, makeConfig());
      // Immediately detach the async pipeline so the test doesn't hang
      jest.spyOn(service as any, 'runPipeline').mockResolvedValue(undefined);

      await service.triggerIngestion('repo-1', 'https://github.com/org/repo', 'manual');

      expect(storage.upsertRepo).toHaveBeenCalledWith(
        expect.objectContaining({ repoId: 'repo-1', url: 'https://github.com/org/repo' }),
      );
    });

    it('skips upsertRepo when the repo already exists', async () => {
      storage.getActiveJobForRepo.mockResolvedValue(null);
      storage.getRepo
        .mockResolvedValueOnce({ repoId: 'repo-1', status: 'ready' } as any) // for triggerIngestion check
        .mockResolvedValue(null); // subsequent calls in pipeline

      const service = new IngestionService(connector, storage, logger, makeConfig());
      jest.spyOn(service as any, 'runPipeline').mockResolvedValue(undefined);

      await service.triggerIngestion('repo-1', 'https://github.com/org/repo', 'manual');

      expect(storage.upsertRepo).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // pipeline — finalStatus: 'partial' vs 'completed'
  // -------------------------------------------------------------------------

  describe('pipeline — job final status', () => {
    it('marks job as "completed" when no files are skipped', async () => {
      const buildResult = makeBuildResult({ filesProcessed: 3, filesSkipped: 0 });
      setupFullRunMocks(storage, buildResult);

      const service = new IngestionService(connector, storage, logger, makeConfig());
      await triggerAndWait(service);

      const updateCalls = storage.updateJob.mock.calls;
      const finalCall = updateCalls[updateCalls.length - 1][1] as Partial<IngestionJob>;
      expect(finalCall.status).toBe('completed');
    });

    it('marks job as "partial" when filesSkipped > 0', async () => {
      // Two files; one has a parse error (filesSkipped = 1)
      const errorFile = makeRepoFile({ filePath: 'src/broken.ts' });
      const goodFile = makeRepoFile({ filePath: 'src/ok.ts' });

      connector.getFileTree.mockResolvedValue([goodFile, errorFile]);
      mockReadFile.mockResolvedValue(Buffer.from('// content'));

      storage.getActiveJobForRepo.mockResolvedValue(null);
      storage.getRepo.mockResolvedValue(null);

      const buildResult = makeBuildResult({
        filesProcessed: 1,
        filesSkipped: 1,
        errorPaths: ['src/broken.ts'],
      });
      cigMocks.__mockBuild.mockReturnValue(buildResult);

      const service = new IngestionService(connector, storage, logger, makeConfig());
      await triggerAndWait(service);

      const updateCalls = storage.updateJob.mock.calls;
      const finalCall = updateCalls[updateCalls.length - 1][1] as Partial<IngestionJob>;
      expect(finalCall.status).toBe('partial');
      expect(finalCall.filesSkipped).toBe(1);
    });

    it('logs final status including runType, filesProcessed, and filesSkipped', async () => {
      const buildResult = makeBuildResult({ filesProcessed: 5, filesSkipped: 2 });
      setupFullRunMocks(storage, buildResult);

      const service = new IngestionService(connector, storage, logger, makeConfig());
      await triggerAndWait(service);

      expect(logger.info).toHaveBeenCalledWith(
        'Ingestion completed',
        expect.objectContaining({
          filesProcessed: 5,
          filesSkipped: 2,
          status: 'partial',
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // pipeline — clone cleanup behaviour
  // -------------------------------------------------------------------------

  describe('pipeline — clone directory cleanup', () => {
    it('removes the clone directory after a successful run when cleanupAfterIngestion is true', async () => {
      const buildResult = makeBuildResult({ filesProcessed: 1 });
      setupFullRunMocks(storage, buildResult);

      const config = makeConfig({ cleanupAfterIngestion: true, tempDir: '/tmp/ci-test' });
      const service = new IngestionService(connector, storage, logger, config);
      await triggerAndWait(service, 'repo-1');

      expect(mockFsRm).toHaveBeenCalledWith(
        '/tmp/ci-test/repo-1',
        { recursive: true, force: true },
      );
    });

    it('keeps the clone directory when cleanupAfterIngestion is false', async () => {
      const buildResult = makeBuildResult({ filesProcessed: 1 });
      setupFullRunMocks(storage, buildResult);

      const config = makeConfig({ cleanupAfterIngestion: false, tempDir: '/tmp/ci-test' });
      const service = new IngestionService(connector, storage, logger, config);
      await triggerAndWait(service, 'repo-1');

      expect(mockFsRm).not.toHaveBeenCalled();
    });

    it('removes the clone directory even when the pipeline throws', async () => {
      storage.getActiveJobForRepo.mockResolvedValue(null);
      storage.getRepo.mockResolvedValue(null);
      connector.clone.mockRejectedValue(new Error('network error'));

      const config = makeConfig({ cleanupAfterIngestion: true, tempDir: '/tmp/ci-test' });
      const service = new IngestionService(connector, storage, logger, config);
      await triggerAndWait(service, 'repo-1');

      expect(mockFsRm).toHaveBeenCalledWith(
        '/tmp/ci-test/repo-1',
        { recursive: true, force: true },
      );
    });

    it('does NOT remove the clone directory on error when cleanupAfterIngestion is false', async () => {
      storage.getActiveJobForRepo.mockResolvedValue(null);
      storage.getRepo.mockResolvedValue(null);
      connector.clone.mockRejectedValue(new Error('network error'));

      const config = makeConfig({ cleanupAfterIngestion: false, tempDir: '/tmp/ci-test' });
      const service = new IngestionService(connector, storage, logger, config);
      await triggerAndWait(service, 'repo-1');

      expect(mockFsRm).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // pipeline — error path: job and repo status updated on failure
  // -------------------------------------------------------------------------

  describe('pipeline — error handling', () => {
    it('marks job as "failed" and repo status as "error" when pipeline throws', async () => {
      storage.getActiveJobForRepo.mockResolvedValue(null);
      storage.getRepo.mockResolvedValue(null);
      connector.clone.mockRejectedValue(new Error('clone failed'));

      const service = new IngestionService(connector, storage, logger, makeConfig());
      await triggerAndWait(service);

      expect(storage.updateJob).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ status: 'failed', errorMessage: 'clone failed' }),
      );
      expect(storage.updateRepoStatus).toHaveBeenCalledWith('repo-1', 'error');
    });

    it('logs an error with the failure message', async () => {
      storage.getActiveJobForRepo.mockResolvedValue(null);
      storage.getRepo.mockResolvedValue(null);
      connector.clone.mockRejectedValue(new Error('clone failed'));

      const service = new IngestionService(connector, storage, logger, makeConfig());
      await triggerAndWait(service);

      expect(logger.error).toHaveBeenCalledWith(
        'Ingestion pipeline failed',
        expect.objectContaining({ error: 'clone failed' }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // determineRunType — changedFiles preserved on threshold-triggered full run
  // -------------------------------------------------------------------------

  describe('determineRunType — threshold-triggered full run preserves changedFiles', () => {
    it('preserves changedFiles in the job update when threshold is exceeded', async () => {
      // Arrange: repo has a prior commit SHA so delta detection runs
      const existingRepo = {
        repoId: 'repo-1',
        status: 'ready',
        lastCommitSha: 'old-sha',
      };
      storage.getActiveJobForRepo.mockResolvedValue(null);
      storage.getRepo.mockResolvedValue(existingRepo as any);

      // 3 files total; 2 changed → ratio 0.67 > threshold 0.4 → full run
      const files = [
        makeRepoFile({ filePath: 'a.ts' }),
        makeRepoFile({ filePath: 'b.ts' }),
        makeRepoFile({ filePath: 'c.ts' }),
      ];
      connector.getFileTree.mockResolvedValue(files);
      connector.getChangedFiles.mockResolvedValue(['a.ts', 'b.ts']);
      mockReadFile.mockResolvedValue(Buffer.from('// content'));

      const buildResult = makeBuildResult({ filesProcessed: 3 });
      cigMocks.__mockBuild.mockReturnValue(buildResult);

      const config = makeConfig({ deltaThreshold: 0.4 });
      const service = new IngestionService(connector, storage, logger, config);
      await triggerAndWait(service);

      // Find the updateJob call that sets changedFiles (the one that records run metadata)
      const changedFilesCall = storage.updateJob.mock.calls.find(
        ([, patch]) => (patch as any).changedFiles !== undefined,
      );
      expect(changedFilesCall).toBeDefined();
      expect((changedFilesCall![1] as any).changedFiles).toEqual(['a.ts', 'b.ts']);
    });

    it('logs the threshold-exceeded event', async () => {
      const existingRepo = { repoId: 'repo-1', status: 'ready', lastCommitSha: 'old-sha' };
      storage.getActiveJobForRepo.mockResolvedValue(null);
      storage.getRepo.mockResolvedValue(existingRepo as any);

      const files = [makeRepoFile({ filePath: 'a.ts' }), makeRepoFile({ filePath: 'b.ts' })];
      connector.getFileTree.mockResolvedValue(files);
      connector.getChangedFiles.mockResolvedValue(['a.ts', 'b.ts']); // 100% > 40%
      mockReadFile.mockResolvedValue(Buffer.from('// content'));
      cigMocks.__mockBuild.mockReturnValue(makeBuildResult({ filesProcessed: 2 }));

      const service = new IngestionService(connector, storage, logger, makeConfig({ deltaThreshold: 0.4 }));
      await triggerAndWait(service);

      expect(logger.info).toHaveBeenCalledWith(
        'Delta threshold exceeded, switching to full run',
        expect.objectContaining({ repoId: 'repo-1', threshold: 0.4 }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // provider detection
  // -------------------------------------------------------------------------

  describe('provider detection', () => {
    it.each([
      ['https://github.com/org/repo', 'github'],
      ['https://gitlab.com/org/repo', 'gitlab'],
      ['https://bitbucket.org/org/repo', 'bitbucket'],
      ['https://internal.example.com/repo', 'github'], // default
    ])('detects provider "%s" as "%s"', async (url, expectedProvider) => {
      storage.getActiveJobForRepo.mockResolvedValue(null);
      storage.getRepo.mockResolvedValue(null);

      const service = new IngestionService(connector, storage, logger, makeConfig());
      jest.spyOn(service as any, 'runPipeline').mockResolvedValue(undefined);

      await service.triggerIngestion('repo-1', url, 'manual');

      expect(storage.upsertRepo).toHaveBeenCalledWith(
        expect.objectContaining({ provider: expectedProvider }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // pipeline — StalenessService sweep call site
  // -------------------------------------------------------------------------

  describe('pipeline — staleness sweep', () => {
    function makeMockStalenessService(sweep = jest.fn().mockResolvedValue([])) {
      return { sweep } as unknown as StalenessService;
    }

    it('calls sweep with all file paths on a first-run (no prior commit SHA)', async () => {
      const sweepMock = jest.fn().mockResolvedValue([]);
      const stalenessService = makeMockStalenessService(sweepMock);

      const buildResult = makeBuildResult({ filesProcessed: 1 });
      setupFullRunMocks(storage, buildResult);
      // getRepo returns null → first-ever run (no lastCommitSha)

      const service = new IngestionService(
        connector, storage, logger, makeConfig(), undefined, stalenessService,
      );
      await triggerAndWait(service);

      expect(sweepMock).toHaveBeenCalledWith(
        'repo-1',
        expect.arrayContaining(['src/index.ts']),
      );
    });

    it('calls sweep with only changedFiles on a threshold-triggered full run', async () => {
      const sweepMock = jest.fn().mockResolvedValue([]);
      const stalenessService = makeMockStalenessService(sweepMock);

      const existingRepo = { repoId: 'repo-1', status: 'ready', lastCommitSha: 'old-sha' };
      storage.getActiveJobForRepo.mockResolvedValue(null);
      storage.getRepo.mockResolvedValue(existingRepo as any);

      // Two files in tree; both are reported as changed → ratio = 1.0 > threshold 0.4
      const file1 = makeRepoFile({ filePath: 'src/a.ts' });
      const file2 = makeRepoFile({ filePath: 'src/b.ts' });
      connector.getFileTree.mockResolvedValue([file1, file2]);
      connector.getChangedFiles.mockResolvedValue(['src/a.ts', 'src/b.ts']);
      mockReadFile.mockResolvedValue(Buffer.from('// content'));

      const buildResult = makeBuildResult({ filesProcessed: 2 });
      cigMocks.__mockBuild.mockReturnValue(buildResult);

      const service = new IngestionService(
        connector, storage, logger, makeConfig(), undefined, stalenessService,
      );
      await triggerAndWait(service);

      // Must use changedFiles (not all filtered files) even though runType = 'full'
      expect(sweepMock).toHaveBeenCalledWith('repo-1', ['src/a.ts', 'src/b.ts']);
    });

    it('calls sweep with only changedFiles on a delta run', async () => {
      const sweepMock = jest.fn().mockResolvedValue([]);
      const stalenessService = makeMockStalenessService(sweepMock);

      const existingRepo = { repoId: 'repo-1', status: 'ready', lastCommitSha: 'old-sha' };
      storage.getActiveJobForRepo.mockResolvedValue(null);
      storage.getRepo.mockResolvedValue(existingRepo as any);

      // Three files in tree; only one changed → ratio = 0.33 < threshold 0.4 → delta run
      const files = [
        makeRepoFile({ filePath: 'src/a.ts' }),
        makeRepoFile({ filePath: 'src/b.ts' }),
        makeRepoFile({ filePath: 'src/c.ts' }),
      ];
      connector.getFileTree.mockResolvedValue(files);
      connector.getChangedFiles.mockResolvedValue(['src/a.ts']);
      mockReadFile.mockResolvedValue(Buffer.from('// content'));

      const buildResult = makeBuildResult({ filesProcessed: 1 });
      cigMocks.__mockBuild.mockReturnValue(buildResult);

      const service = new IngestionService(
        connector, storage, logger, makeConfig(), undefined, stalenessService,
      );
      await triggerAndWait(service);

      // Delta run: sweep only the one changed file
      expect(sweepMock).toHaveBeenCalledWith('repo-1', ['src/a.ts']);
    });

    it('records stale artifact IDs in the job when sweep returns ids', async () => {
      const sweepMock = jest.fn().mockResolvedValue(['core/overview', 'backend/auth']);
      const stalenessService = makeMockStalenessService(sweepMock);

      const buildResult = makeBuildResult({ filesProcessed: 1 });
      setupFullRunMocks(storage, buildResult);

      const service = new IngestionService(
        connector, storage, logger, makeConfig(), undefined, stalenessService,
      );
      await triggerAndWait(service);

      expect(storage.updateJob).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ artifactsStale: ['core/overview', 'backend/auth'] }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // pipeline — doc generation
  // -------------------------------------------------------------------------

  describe('pipeline — doc generation', () => {
    function makeDocGenerator(overrides?: Partial<{ generateDocs: jest.Mock }>) {
      return {
        generateDocs: jest.fn().mockResolvedValue({ totalTokensUsed: 0 }),
        ...overrides,
      };
    }

    it('calls docGenerator.generateDocs after staleness sweep', async () => {
      const buildResult = makeBuildResult({ filesProcessed: 1 });
      setupFullRunMocks(storage, buildResult);

      const docGenerator = makeDocGenerator({
        generateDocs: jest.fn().mockResolvedValue({ totalTokensUsed: 0 }),
      });
      const config = makeConfig({ tempDir: '/tmp/ci-test' });

      const service = new IngestionService(
        connector, storage, logger, config, undefined, undefined, docGenerator,
      );
      await triggerAndWait(service, 'repo-1');

      expect(docGenerator.generateDocs).toHaveBeenCalledWith(
        'repo-1',
        '/tmp/ci-test/repo-1',
      );
    });

    it('records tokensConsumed from doc generation in job', async () => {
      const buildResult = makeBuildResult({ filesProcessed: 1 });
      setupFullRunMocks(storage, buildResult);

      const docGenerator = makeDocGenerator({
        generateDocs: jest.fn().mockResolvedValue({ totalTokensUsed: 500 }),
      });

      const service = new IngestionService(
        connector, storage, logger, makeConfig(), undefined, undefined, docGenerator,
      );
      await triggerAndWait(service);

      const updateCalls = storage.updateJob.mock.calls;
      const finalCall = updateCalls[updateCalls.length - 1][1] as Partial<IngestionJob>;
      expect(finalCall.tokensConsumed).toBe(500);
    });

    it('doc generation failure is non-fatal — pipeline completes with status "completed" and tokensConsumed 0', async () => {
      const buildResult = makeBuildResult({ filesProcessed: 1 });
      setupFullRunMocks(storage, buildResult);

      const docGenerator = makeDocGenerator({
        generateDocs: jest.fn().mockRejectedValue(new Error('LLM unavailable')),
      });

      const service = new IngestionService(
        connector, storage, logger, makeConfig(), undefined, undefined, docGenerator,
      );
      await triggerAndWait(service);

      const updateCalls = storage.updateJob.mock.calls;
      const finalCall = updateCalls[updateCalls.length - 1][1] as Partial<IngestionJob>;
      expect(finalCall.status).toBe('completed');
      expect(finalCall.tokensConsumed).toBe(0);
    });

    it('skips doc generation when no docGenerator is provided', async () => {
      const buildResult = makeBuildResult({ filesProcessed: 1 });
      setupFullRunMocks(storage, buildResult);

      // No docGenerator passed — constructor receives only 6 args
      const service = new IngestionService(
        connector, storage, logger, makeConfig(), undefined, undefined,
      );
      await triggerAndWait(service);

      // Pipeline must complete normally
      const updateCalls = storage.updateJob.mock.calls;
      const finalCall = updateCalls[updateCalls.length - 1][1] as Partial<IngestionJob>;
      expect(finalCall.status).toBe('completed');
    });
  });
});
