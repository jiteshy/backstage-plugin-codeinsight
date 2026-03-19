import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';

import {
  CIGBuilder,
  CIGPersistenceService,
  PrismaExtractor,
  TypeScriptExtractor,
} from '@codeinsight/cig';
import type {
  IngestionConfig,
  IngestionJob,
  JobTrigger,
  Logger,
  ParseStatus,
  RepoConnector,
  RepoFile,
  StorageAdapter,
} from '@codeinsight/types';

import { FileFilter } from './FileFilter';
import { StalenessService } from './StalenessService';

// ---------------------------------------------------------------------------
// Factory — builds a CIGBuilder with all Phase 1 extractors registered
// ---------------------------------------------------------------------------

function createDefaultCIGBuilder(): CIGBuilder {
  const builder = new CIGBuilder();
  builder.registerExtractor(new TypeScriptExtractor());
  builder.registerContentExtractor(new PrismaExtractor());
  return builder;
}

// ---------------------------------------------------------------------------
// IngestionService
// ---------------------------------------------------------------------------

export class IngestionService {
  private readonly cigBuilder: CIGBuilder;
  private readonly cigPersistence: CIGPersistenceService;
  private readonly fileFilter: FileFilter;
  private readonly stalenessService: StalenessService;

  constructor(
    private readonly repoConnector: RepoConnector,
    private readonly storageAdapter: StorageAdapter,
    private readonly logger: Logger,
    private readonly config: IngestionConfig,
    cigBuilder?: CIGBuilder,
    stalenessService?: StalenessService,
  ) {
    this.cigBuilder = cigBuilder ?? createDefaultCIGBuilder();
    this.cigPersistence = new CIGPersistenceService(storageAdapter, logger);
    this.fileFilter = new FileFilter(config.fileFilter);
    this.stalenessService = stalenessService ?? new StalenessService(storageAdapter, logger);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Trigger ingestion for a repository. Returns the job ID immediately.
   * The pipeline runs asynchronously — poll job status to track progress.
   *
   * Duplicate prevention (1.8.5):
   * - If a job is already `running`, throws an error.
   * - If a job is already `queued`, returns the existing job ID.
   */
  async triggerIngestion(
    repoId: string,
    repoUrl: string,
    trigger: JobTrigger,
  ): Promise<string> {
    const active = await this.storageAdapter.getActiveJobForRepo(repoId);
    if (active) {
      if (active.status === 'running') {
        throw new Error(
          `Ingestion already running for repo ${repoId} (job ${active.jobId})`,
        );
      }
      if (active.status === 'queued') {
        this.logger.info('Returning existing queued job', {
          repoId,
          jobId: active.jobId,
        });
        return active.jobId;
      }
    }

    // Ensure repo record exists (FK required before job insert)
    const existingRepo = await this.storageAdapter.getRepo(repoId);
    if (!existingRepo) {
      await this.storageAdapter.upsertRepo({
        repoId,
        name: repoId,
        url: repoUrl,
        provider: this.detectProvider(repoUrl),
        status: 'idle',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    const job: IngestionJob = {
      jobId: randomUUID(),
      repoId,
      trigger,
      status: 'queued',
      filesProcessed: 0,
      filesSkipped: 0,
      tokensConsumed: 0,
      createdAt: new Date(),
    };

    await this.storageAdapter.createJob(job);
    this.logger.info('Ingestion job created', { repoId, jobId: job.jobId, trigger });

    // Fire-and-forget: run pipeline asynchronously
    this.runPipeline(job.jobId, repoId, repoUrl).catch(err => {
      this.logger.error('Unhandled error in ingestion pipeline', {
        repoId,
        jobId: job.jobId,
        error: String(err),
      });
    });

    return job.jobId;
  }

  // ---------------------------------------------------------------------------
  // Pipeline — 1.8.2
  // ---------------------------------------------------------------------------

  private async runPipeline(
    jobId: string,
    repoId: string,
    repoUrl: string,
  ): Promise<void> {
    const cloneDir = path.join(this.config.tempDir, repoId);
    try {
      // Mark job running
      await this.storageAdapter.updateJob(jobId, {
        status: 'running',
        startedAt: new Date(),
      });

      // Mark repo as processing (repo record already exists from triggerIngestion)
      await this.storageAdapter.updateRepoStatus(repoId, 'processing');

      // Determine clone depth before cloning.
      // Delta runs need enough history to span fromSha..toSha for getChangedFiles.
      // If a prior commit SHA exists, use deltaCloneDepth (default 50); otherwise
      // use cloneDepth (default 1) for first-run full clones.
      const existingRepo = await this.storageAdapter.getRepo(repoId);
      const hasPriorRun = !!existingRepo?.lastCommitSha;
      const depth = hasPriorRun
        ? (this.config.deltaCloneDepth ?? 50)
        : (this.config.cloneDepth ?? 1);

      // Clone repo
      this.logger.info('Cloning repository', { repoId, repoUrl, cloneDir, depth });
      await this.repoConnector.clone(repoUrl, cloneDir, { depth });
      const headSha = await this.repoConnector.getHeadSha(cloneDir);

      // Get + filter file tree
      const rawFiles = await this.repoConnector.getFileTree(cloneDir);
      const filteredFiles = this.applyFilter(rawFiles, repoId);

      this.logger.info('File tree ready', {
        repoId,
        total: rawFiles.length,
        filtered: filteredFiles.length,
      });

      // Persist initial file records (currentSha set, lastProcessedSha null for new files)
      await this.storageAdapter.upsertRepoFiles(filteredFiles);

      // Determine full vs delta run
      const { runType, changedFiles } = await this.determineRunType(
        repoId,
        cloneDir,
        headSha,
        filteredFiles,
      );

      this.logger.info('Run type determined', {
        repoId,
        runType,
        changedCount: changedFiles?.length ?? 0,
      });

      const repo = await this.storageAdapter.getRepo(repoId);
      await this.storageAdapter.updateJob(jobId, {
        fromCommit: repo?.lastCommitSha ?? null,
        toCommit: headSha,
        changedFiles: changedFiles ?? null,
      });

      let filesProcessed = 0;
      let filesSkipped = 0;
      let staleArtifactIds: string[] = [];

      if (runType === 'full') {
        const result = await this.runFullCIG(repoId, cloneDir, filteredFiles);
        filesProcessed = result.filesProcessed;
        filesSkipped = result.filesSkipped;
        // Mark all filtered files as processed
        await this.markFilesProcessed(filteredFiles, result.errors.map(e => e.filePath));
        // Sweep all files — every artifact may be affected on a full run
        staleArtifactIds = await this.stalenessService.sweep(
          repoId,
          filteredFiles.map(f => f.filePath),
        );
      } else {
        const result = await this.runDeltaCIG(
          repoId,
          cloneDir,
          filteredFiles,
          changedFiles!,
        );
        filesProcessed = result.filesProcessed;
        filesSkipped = result.filesSkipped;
        // Mark only changed files as processed
        const changedSet = new Set(changedFiles!);
        const changedRepoFiles = filteredFiles.filter(f => changedSet.has(f.filePath));
        await this.markFilesProcessed(changedRepoFiles, result.errors.map(e => e.filePath));
        // Sweep only changed files
        staleArtifactIds = await this.stalenessService.sweep(repoId, changedFiles!);
      }

      // Record stale artifact IDs in job for observability
      if (staleArtifactIds.length > 0) {
        await this.storageAdapter.updateJob(jobId, {
          artifactsStale: staleArtifactIds,
        });
      }

      // Update repo status to ready
      await this.storageAdapter.updateRepoStatus(repoId, 'ready', headSha);

      // Use 'partial' when some files were skipped (parse errors), 'completed' otherwise
      const finalStatus = filesSkipped > 0 ? 'partial' : 'completed';

      // Mark job complete
      await this.storageAdapter.updateJob(jobId, {
        status: finalStatus,
        filesProcessed,
        filesSkipped,
        completedAt: new Date(),
      });

      this.logger.info('Ingestion completed', {
        repoId,
        jobId,
        runType,
        filesProcessed,
        filesSkipped,
        status: finalStatus,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error('Ingestion pipeline failed', { repoId, jobId, error: message });

      await this.storageAdapter.updateJob(jobId, {
        status: 'failed',
        errorMessage: message,
        completedAt: new Date(),
      }).catch(() => {});

      await this.storageAdapter.updateRepoStatus(repoId, 'error').catch(() => {});
    } finally {
      // Clean up the cloned repo directory (default: true)
      if (this.config.cleanupAfterIngestion !== false) {
        await fs.rm(cloneDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Run type detection — 1.8.3
  // ---------------------------------------------------------------------------

  private async determineRunType(
    repoId: string,
    cloneDir: string,
    headSha: string,
    filteredFiles: RepoFile[],
  ): Promise<{ runType: 'full' | 'delta'; changedFiles?: string[] }> {
    const repo = await this.storageAdapter.getRepo(repoId);

    // No prior commit SHA → always full run
    if (!repo?.lastCommitSha) {
      return { runType: 'full' };
    }

    const changedFiles = await this.repoConnector.getChangedFiles(
      cloneDir,
      repo.lastCommitSha,
      headSha,
    );

    if (changedFiles.length === 0) {
      // Nothing changed — delta with empty set (no CIG work needed)
      return { runType: 'delta', changedFiles: [] };
    }

    // If the ratio of changed files exceeds the threshold, do a full run
    const ratio = changedFiles.length / Math.max(filteredFiles.length, 1);
    if (ratio > this.config.deltaThreshold) {
      this.logger.info('Delta threshold exceeded, switching to full run', {
        repoId,
        changedFiles: changedFiles.length,
        total: filteredFiles.length,
        ratio: ratio.toFixed(2),
        threshold: this.config.deltaThreshold,
      });
      // Preserve changedFiles for observability even on threshold-triggered full run
      return { runType: 'full', changedFiles };
    }

    return { runType: 'delta', changedFiles };
  }

  // ---------------------------------------------------------------------------
  // Full CIG run
  // ---------------------------------------------------------------------------

  private async runFullCIG(
    repoId: string,
    cloneDir: string,
    files: RepoFile[],
  ) {
    const filesWithContent = await this.readFileContents(cloneDir, files);
    const result = this.cigBuilder.build(repoId, filesWithContent);

    this.logger.info('CIG full build complete', {
      repoId,
      nodes: result.nodes.length,
      edges: result.edges.length,
      filesProcessed: result.filesProcessed,
      filesSkipped: result.filesSkipped,
      errors: result.errors.length,
    });

    await this.cigPersistence.persist(repoId, result);
    return result;
  }

  // ---------------------------------------------------------------------------
  // Delta CIG run — 1.8.4
  // ---------------------------------------------------------------------------

  private async runDeltaCIG(
    repoId: string,
    cloneDir: string,
    allFiles: RepoFile[],
    changedFilePaths: string[],
  ) {
    if (changedFilePaths.length === 0) {
      return { filesProcessed: 0, filesSkipped: 0, errors: [] };
    }

    const changedSet = new Set(changedFilePaths);
    const filesToProcess = allFiles.filter(f => changedSet.has(f.filePath));

    const filesWithContent = await this.readFileContents(cloneDir, filesToProcess);
    const result = this.cigBuilder.build(repoId, filesWithContent);

    this.logger.info('CIG delta build complete', {
      repoId,
      changedFiles: changedFilePaths.length,
      nodes: result.nodes.length,
      edges: result.edges.length,
      filesProcessed: result.filesProcessed,
    });

    await this.cigPersistence.persist(repoId, result, { changedFiles: changedFilePaths });
    return result;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private applyFilter(rawFiles: RepoFile[], repoId: string): RepoFile[] {
    return rawFiles
      .filter(f => !this.fileFilter.shouldExclude(f.filePath))
      .map(f => ({
        ...f,
        repoId,
        fileType: this.fileFilter.classifyFile(f.filePath),
        language: this.fileFilter.detectLanguage(f.filePath),
        parseStatus: 'pending' as ParseStatus,
      }));
  }

  private async readFileContents(
    cloneDir: string,
    files: RepoFile[],
  ): Promise<Array<{ file: RepoFile; content: string }>> {
    const results: Array<{ file: RepoFile; content: string }> = [];
    for (const file of files) {
      try {
        const content = await fs.readFile(
          path.join(cloneDir, file.filePath),
          'utf-8',
        );
        results.push({ file, content });
      } catch {
        // File unreadable — skip silently (may be a symlink or binary)
        this.logger.warn('Could not read file, skipping', {
          filePath: file.filePath,
        });
      }
    }
    return results;
  }

  private async markFilesProcessed(
    files: RepoFile[],
    errorPaths: string[],
  ): Promise<void> {
    const errorSet = new Set(errorPaths);
    const updated = files.map(f => ({
      ...f,
      lastProcessedSha: f.currentSha,
      parseStatus: (errorSet.has(f.filePath) ? 'error' : 'parsed') as ParseStatus,
    }));
    await this.storageAdapter.upsertRepoFiles(updated);
  }

  private detectProvider(
    repoUrl: string,
  ): 'github' | 'gitlab' | 'bitbucket' {
    if (repoUrl.includes('github.com')) return 'github';
    if (repoUrl.includes('gitlab.com')) return 'gitlab';
    if (repoUrl.includes('bitbucket.org')) return 'bitbucket';
    return 'github'; // default for unknown
  }
}
