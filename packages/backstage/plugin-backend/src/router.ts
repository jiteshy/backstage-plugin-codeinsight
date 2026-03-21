import {
  DatabaseService,
  LoggerService,
  RootConfigService,
} from '@backstage/backend-plugin-api';
import type { DiagramContent, DocContent, JobQueue, StorageAdapter } from '@codeinsight/types';
import express from 'express';
import Router from 'express-promise-router';

export interface RouterOptions {
  config: RootConfigService;
  logger: LoggerService;
  database: DatabaseService;
  jobQueue: JobQueue;
  storageAdapter: StorageAdapter;
}

export async function createRouter(
  options: RouterOptions,
): Promise<express.Router> {
  const { logger, jobQueue, storageAdapter } = options;
  const router = Router();

  router.use(express.json());

  // ---------------------------------------------------------------------------
  // Health
  // ---------------------------------------------------------------------------

  router.get('/health', (_req, res) => {
    logger.debug('Health check');
    res.json({ status: 'ok' });
  });

  // ---------------------------------------------------------------------------
  // 1.9.2 — Trigger ingestion
  // POST /repos/:repoId/ingest
  // Body: { repoUrl: string, trigger?: 'manual' | 'webhook' | 'schedule' }
  // ---------------------------------------------------------------------------

  const VALID_TRIGGERS = new Set<string>(['manual', 'webhook', 'schedule']);

  router.post('/repos/:repoId/ingest', async (req, res) => {
    const { repoId } = req.params;
    const { repoUrl, trigger = 'manual' } = req.body ?? {};

    if (!repoUrl) {
      res.status(400).json({ error: 'repoUrl is required' });
      return;
    }

    if (!VALID_TRIGGERS.has(trigger)) {
      res.status(400).json({ error: `Invalid trigger value: ${trigger}. Must be one of: manual, webhook, schedule` });
      return;
    }

    try {
      const jobId = await jobQueue.enqueue({ repoId, repoUrl, trigger });
      logger.info('Ingestion triggered', { repoId, trigger, jobId });
      res.status(202).json({ jobId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('already running')) {
        res.status(409).json({ error: message });
      } else {
        res.status(500).json({ error: message });
      }
    }
  });

  // ---------------------------------------------------------------------------
  // 1.9.3 — Get job status
  // GET /repos/:repoId/jobs/:jobId
  // ---------------------------------------------------------------------------

  router.get('/repos/:repoId/jobs/:jobId', async (req, res) => {
    const { repoId, jobId } = req.params;
    const job = await storageAdapter.getJob(jobId);

    if (!job || job.repoId !== repoId) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    res.json(job);
  });

  // ---------------------------------------------------------------------------
  // 1.9.4 — Get repo status
  // GET /repos/:repoId/status
  // ---------------------------------------------------------------------------

  router.get('/repos/:repoId/status', async (req, res) => {
    const { repoId } = req.params;
    const repo = await storageAdapter.getRepo(repoId);

    if (!repo) {
      res.status(404).json({ error: 'Repo not found' });
      return;
    }

    res.json({
      repoId: repo.repoId,
      status: repo.status,
      lastCommitSha: repo.lastCommitSha,
      updatedAt: repo.updatedAt,
    });
  });

  // ---------------------------------------------------------------------------
  // 2.7 — Get doc artifacts
  // GET /repos/:repoId/docs
  // Returns all doc artifacts for the repo with per-section metadata
  // ---------------------------------------------------------------------------

  router.get('/repos/:repoId/docs', async (req, res) => {
    const { repoId } = req.params;

    const repo = await storageAdapter.getRepo(repoId);
    if (!repo) {
      res.status(404).json({ error: 'Repo not found' });
      return;
    }

    const artifacts = await storageAdapter.getArtifactsByType(repoId, 'doc');

    const docs = await Promise.all(
      artifacts.map(async artifact => {
        const inputs = await storageAdapter.getArtifactInputs(repoId, artifact.artifactId);
        const content = artifact.content as DocContent | undefined | null;
        return {
          artifactId: artifact.artifactId,
          markdown: content?.markdown ?? '',
          isStale: artifact.isStale,
          staleReason: artifact.staleReason ?? null,
          fileCount: inputs.length,
          generatedAt: artifact.generatedAt,
          tokensUsed: artifact.tokensUsed,
        };
      }),
    );

    docs.sort((a, b) => a.artifactId.localeCompare(b.artifactId));

    res.json(docs);
  });

  // ---------------------------------------------------------------------------
  // 3.5 — Get diagram artifacts
  // GET /repos/:repoId/diagrams
  // Returns all diagram artifacts for the repo
  // ---------------------------------------------------------------------------

  router.get('/repos/:repoId/diagrams', async (req, res) => {
    const { repoId } = req.params;

    const repo = await storageAdapter.getRepo(repoId);
    if (!repo) {
      res.status(404).json({ error: 'Repo not found' });
      return;
    }

    const artifacts = await storageAdapter.getArtifactsByType(repoId, 'diagram');

    const diagrams = artifacts.map(artifact => {
      const content = artifact.content as DiagramContent | undefined | null;
      return {
        artifactId: artifact.artifactId,
        title: content?.title ?? artifact.artifactId,
        description: content?.description ?? null,
        diagramType: content?.diagramType ?? 'unknown',
        mermaid: content?.mermaid ?? '',
        isStale: artifact.isStale,
        staleReason: artifact.staleReason ?? null,
        llmUsed: artifact.llmUsed,
        nodeMap: content?.nodeMap ?? null,
        generatedAt: artifact.generatedAt,
        tokensUsed: artifact.tokensUsed,
      };
    });

    diagrams.sort((a, b) => a.artifactId.localeCompare(b.artifactId));

    res.json(diagrams);
  });

  return router;
}
