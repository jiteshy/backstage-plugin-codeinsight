import {
  DatabaseService,
  LoggerService,
  RootConfigService,
} from '@backstage/backend-plugin-api';
import type { QnAService } from '@codeinsight/qna';
import type { DiagramContent, DocContent, JobQueue, StorageAdapter } from '@codeinsight/types';
import express from 'express';
import Router from 'express-promise-router';

export interface RouterOptions {
  config: RootConfigService;
  logger: LoggerService;
  database: DatabaseService;
  jobQueue: JobQueue;
  storageAdapter: StorageAdapter;
  qnaService?: QnAService;
}

export async function createRouter(
  options: RouterOptions,
): Promise<express.Router> {
  const { logger, jobQueue, storageAdapter, qnaService } = options;
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
  const KNOWN_GIT_HOSTS = new Set(['github.com', 'gitlab.com', 'bitbucket.org']);
  const VALID_ARTIFACT_TYPES = new Set(['doc', 'diagram', 'qna']);
  const VALID_RATINGS = new Set([1, -1]);

  router.post('/repos/:repoId/ingest', async (req, res) => {
    const { repoId } = req.params;
    const { repoUrl, trigger = 'manual' } = req.body ?? {};

    if (!repoUrl) {
      res.status(400).json({ error: 'repoUrl is required' });
      return;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(repoUrl);
    } catch {
      res.status(400).json({ error: 'repoUrl must be a valid URL (e.g. https://github.com/owner/repo)' });
      return;
    }
    if (parsedUrl.protocol !== 'https:') {
      res.status(400).json({ error: 'repoUrl must use HTTPS' });
      return;
    }
    if (!KNOWN_GIT_HOSTS.has(parsedUrl.hostname)) {
      res.status(400).json({
        error: `Unsupported Git host: ${parsedUrl.hostname}. Supported hosts: github.com, gitlab.com, bitbucket.org`,
      });
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
  // Delete repo — hard-delete all data for a repo (for re-registration flow)
  // DELETE /repos/:repoId
  // ---------------------------------------------------------------------------

  router.delete('/repos/:repoId', async (req, res) => {
    const { repoId } = req.params;
    try {
      await storageAdapter.deleteRepo(repoId);
      logger.info('Repo deleted', { repoId });
      res.status(204).end();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // ---------------------------------------------------------------------------
  // Feedback — submit thumbs up/down for a doc section, diagram, or Q&A answer
  // POST /repos/:repoId/feedback
  // Body: { artifactId: string, artifactType: 'doc' | 'diagram' | 'qna', rating: 1 | -1 }
  // ---------------------------------------------------------------------------

  router.post('/repos/:repoId/feedback', async (req, res) => {
    const { repoId } = req.params;
    const { artifactId, artifactType, rating } = req.body ?? {};

    if (!artifactId || typeof artifactId !== 'string') {
      res.status(400).json({ error: 'artifactId is required' });
      return;
    }
    if (!VALID_ARTIFACT_TYPES.has(artifactType)) {
      res.status(400).json({ error: 'artifactType must be one of: doc, diagram, qna' });
      return;
    }
    if (!VALID_RATINGS.has(rating)) {
      res.status(400).json({ error: 'rating must be 1 or -1' });
      return;
    }

    await storageAdapter.saveFeedback({ repoId, artifactId, artifactType, rating });
    res.status(204).end();
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

    // Sort by preferred display order (matches createDefaultRegistry() registration order).
    // Unknown module IDs fall to the end, then sorted alphabetically.
    const DIAGRAM_ORDER = [
      'universal/high-level-architecture',
      'universal/circular-dependencies',
      'universal/er-diagram',
      'backend/api-entity-mapping',
      'frontend/state-management',
      'universal/deployment-infra',
      'universal/auth-flow',
    ];
    diagrams.sort((a, b) => {
      const ai = DIAGRAM_ORDER.indexOf(a.artifactId);
      const bi = DIAGRAM_ORDER.indexOf(b.artifactId);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.artifactId.localeCompare(b.artifactId);
    });

    res.json(diagrams);
  });

  // ---------------------------------------------------------------------------
  // 5.6 — QnA endpoints
  // ---------------------------------------------------------------------------

  // POST /repos/:repoId/qna/sessions — Create a new QnA session
  router.post('/repos/:repoId/qna/sessions', async (req, res) => {
    if (!qnaService) {
      res.status(503).json({ error: 'QnA service not configured' });
      return;
    }
    const { repoId } = req.params;
    const { userRef } = req.body ?? {};
    try {
      const session = await qnaService.createSession(repoId, userRef);
      res.status(201).json(session);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // POST /repos/:repoId/qna/sessions/:sessionId/ask — Non-streaming ask
  router.post('/repos/:repoId/qna/sessions/:sessionId/ask', async (req, res) => {
    if (!qnaService) {
      res.status(503).json({ error: 'QnA service not configured' });
      return;
    }
    const { sessionId } = req.params;
    const { question } = req.body ?? {};
    if (!question) {
      res.status(400).json({ error: 'question is required' });
      return;
    }
    try {
      const answer = await qnaService.ask(sessionId, question);
      res.json(answer);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('not found')) {
        res.status(404).json({ error: message });
      } else {
        res.status(500).json({ error: message });
      }
    }
  });

  // POST /repos/:repoId/qna/sessions/:sessionId/ask-stream — SSE streaming
  router.post('/repos/:repoId/qna/sessions/:sessionId/ask-stream', async (req, res) => {
    if (!qnaService) {
      res.status(503).json({ error: 'QnA service not configured' });
      return;
    }
    const { sessionId } = req.params;
    const { question } = req.body ?? {};
    if (!question) {
      res.status(400).json({ error: 'question is required' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const controller = new AbortController();
    // Use res.on('close') rather than req.on('close'): in newer Node.js
    // versions, express.json() fully consumes the request body and the
    // IncomingMessage emits 'close' immediately after body parsing — before
    // the LLM stream even starts — causing a spurious early abort.
    // res 'close' fires only when the HTTP socket itself closes (true client
    // disconnect); the writableEnded guard prevents a false-positive abort
    // when the response ends normally via res.end().
    res.on('close', () => {
      if (!res.writableEnded) {
        controller.abort();
      }
    });

    try {
      logger.debug('ask-stream: starting stream', { sessionId, questionLen: question.length });
      const stream = qnaService.askStream(sessionId, question, controller.signal);
      let tokenCount = 0;
      for await (const token of stream) {
        if (tokenCount === 0) logger.debug('ask-stream: first token received', { sessionId });
        tokenCount++;
        res.write(`data: ${JSON.stringify({ token })}\n\n`);
      }
      logger.info('ask-stream: stream complete', { tokenCount });
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (err) {
      // Suppress abort errors — expected when the client disconnects.
      // - 'AbortError'         native DOMException / OpenAI SDK
      // - 'APIUserAbortError'  Anthropic SDK wraps AbortError under this name
      const isAbort =
        err instanceof Error &&
        (err.name === 'AbortError' ||
          err.name === 'APIUserAbortError' ||
          err.message === 'Request was aborted.');
      if (isAbort) {
        logger.warn('ask-stream: aborted (client disconnect or signal)', {
          sessionId,
          errName: err instanceof Error ? err.name : 'unknown',
        });
        res.end();
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      logger.error('ask-stream: error during streaming', { sessionId, error: message });
      res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
      res.end();
    }
  });

  // GET /repos/:repoId/qna/sessions/:sessionId/messages — Get session messages
  router.get('/repos/:repoId/qna/sessions/:sessionId/messages', async (req, res) => {
    const { sessionId } = req.params;
    try {
      const messages = await storageAdapter.getSessionMessages(sessionId);
      res.json(messages);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
