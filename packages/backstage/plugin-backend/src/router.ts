import {
  DatabaseService,
  LoggerService,
  RootConfigService,
} from '@backstage/backend-plugin-api';
import type { JobQueue, StorageAdapter } from '@codeinsight/types';
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

  return router;
}
