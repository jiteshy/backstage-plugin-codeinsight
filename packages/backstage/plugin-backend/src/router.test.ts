import http from 'http';

import type { IngestionJob, Repository } from '@codeinsight/types';
import express from 'express';

import { createRouter, RouterOptions } from './router';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockLogger() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn().mockReturnThis(),
  };
}

function mockConfig() {
  return {
    getOptionalString: jest.fn(),
    getString: jest.fn(),
    getOptionalNumber: jest.fn(),
    getNumber: jest.fn(),
    getOptionalBoolean: jest.fn(),
    getBoolean: jest.fn(),
    getOptionalConfig: jest.fn(),
    getConfig: jest.fn(),
    getOptionalConfigArray: jest.fn(),
    getConfigArray: jest.fn(),
    getOptionalStringArray: jest.fn(),
    getStringArray: jest.fn(),
    has: jest.fn(),
    keys: jest.fn(),
  };
}

function mockDatabase() {
  return {
    getClient: jest.fn(),
  };
}

function mockJobQueue() {
  return {
    enqueue: jest.fn(),
    getStatus: jest.fn(),
  };
}

function mockStorageAdapter() {
  return {
    getJob: jest.fn(),
    getRepo: jest.fn(),
    // remaining methods not exercised in router tests
    upsertRepo: jest.fn(),
    updateRepoStatus: jest.fn(),
    upsertRepoFiles: jest.fn(),
    getRepoFiles: jest.fn(),
    getChangedRepoFiles: jest.fn(),
    deleteRepoFilesNotIn: jest.fn(),
    upsertCIGNodes: jest.fn(),
    upsertCIGEdges: jest.fn(),
    deleteCIGForFiles: jest.fn(),
    getCIGNodes: jest.fn(),
    getCIGEdges: jest.fn(),
    upsertArtifact: jest.fn(),
    getArtifact: jest.fn(),
    getArtifactsByType: jest.fn(),
    getArtifactInputs: jest.fn(),
    getStaleArtifacts: jest.fn(),
    markArtifactsStale: jest.fn(),
    getArtifactIdsByFilePaths: jest.fn(),
    getArtifactDependents: jest.fn(),
    upsertArtifactInputs: jest.fn(),
    createJob: jest.fn(),
    updateJob: jest.fn(),
    getActiveJobForRepo: jest.fn(),
    deleteRepo: jest.fn().mockResolvedValue(undefined),
    getSessionMessages: jest.fn().mockResolvedValue([]),
  };
}

/** Make an HTTP request against a running express app and return status + body */
function request(
  server: http.Server,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === 'string') {
      return reject(new Error('Server not listening on a port'));
    }

    const payload = body ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = {};
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(Buffer.byteLength(payload));
    }

    const req = http.request(
      { hostname: '127.0.0.1', port: addr.port, path, method, headers },
      res => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          let parsedBody: unknown;
          try {
            parsedBody = JSON.parse(data);
          } catch {
            parsedBody = data;
          }
          resolve({ status: res.statusCode ?? 0, body: parsedBody });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createRouter', () => {
  let server: http.Server;
  let logger: ReturnType<typeof mockLogger>;
  let jobQueue: ReturnType<typeof mockJobQueue>;
  let storageAdapter: ReturnType<typeof mockStorageAdapter>;

  beforeEach(async () => {
    logger = mockLogger();
    jobQueue = mockJobQueue();
    storageAdapter = mockStorageAdapter();

    const options: RouterOptions = {
      config: mockConfig() as unknown as RouterOptions['config'],
      logger: logger as unknown as RouterOptions['logger'],
      database: mockDatabase() as unknown as RouterOptions['database'],
      jobQueue: jobQueue as unknown as RouterOptions['jobQueue'],
      storageAdapter: storageAdapter as unknown as RouterOptions['storageAdapter'],
    };

    const router = await createRouter(options);
    const app = express();
    app.use(router);
    server = app.listen(0);
  });

  afterEach(done => {
    server.close(done);
  });

  // -------------------------------------------------------------------------
  // Health
  // -------------------------------------------------------------------------

  describe('GET /health', () => {
    it('returns 200 with { status: "ok" }', async () => {
      const res = await request(server, 'GET', '/health');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok' });
    });

    it('calls logger.debug', async () => {
      await request(server, 'GET', '/health');
      expect(logger.debug).toHaveBeenCalledWith('Health check');
    });
  });

  describe('unknown routes', () => {
    it('returns 404 for an undefined route', async () => {
      const res = await request(server, 'GET', '/nonexistent');
      expect(res.status).toBe(404);
    });
  });

  it('returns an express Router (function)', async () => {
    const options: RouterOptions = {
      config: mockConfig() as unknown as RouterOptions['config'],
      logger: mockLogger() as unknown as RouterOptions['logger'],
      database: mockDatabase() as unknown as RouterOptions['database'],
      jobQueue: mockJobQueue() as unknown as RouterOptions['jobQueue'],
      storageAdapter: mockStorageAdapter() as unknown as RouterOptions['storageAdapter'],
    };
    const router = await createRouter(options);
    expect(typeof router).toBe('function');
  });

  // -------------------------------------------------------------------------
  // POST /repos/:repoId/ingest
  // -------------------------------------------------------------------------

  describe('POST /repos/:repoId/ingest', () => {
    it('returns 202 with jobId on success', async () => {
      jobQueue.enqueue.mockResolvedValue('job-abc');

      const res = await request(
        server,
        'POST',
        '/repos/my-repo/ingest',
        { repoUrl: 'https://github.com/org/repo', trigger: 'manual' },
      );

      expect(res.status).toBe(202);
      expect(res.body).toEqual({ jobId: 'job-abc' });
      expect(jobQueue.enqueue).toHaveBeenCalledWith({
        repoId: 'my-repo',
        repoUrl: 'https://github.com/org/repo',
        trigger: 'manual',
      });
    });

    it('defaults trigger to "manual" when not provided', async () => {
      jobQueue.enqueue.mockResolvedValue('job-xyz');

      await request(server, 'POST', '/repos/r1/ingest', { repoUrl: 'https://github.com/a/b' });

      expect(jobQueue.enqueue).toHaveBeenCalledWith({
        repoId: 'r1',
        repoUrl: 'https://github.com/a/b',
        trigger: 'manual',
      });
    });

    it('returns 400 when repoUrl is missing', async () => {
      const res = await request(server, 'POST', '/repos/my-repo/ingest', {});
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: expect.stringContaining('repoUrl') });
    });

    // ----- 6.2.1: URL validation -----

    it('returns 400 when repoUrl is not a valid URL', async () => {
      const res = await request(
        server,
        'POST',
        '/repos/my-repo/ingest',
        { repoUrl: 'not-a-url' },
      );
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: expect.stringContaining('valid URL') });
    });

    it('returns 400 when repoUrl uses http instead of https', async () => {
      const res = await request(
        server,
        'POST',
        '/repos/my-repo/ingest',
        { repoUrl: 'http://github.com/org/repo' },
      );
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: expect.stringContaining('HTTPS') });
    });

    it('returns 400 when repoUrl hostname is not a supported Git host', async () => {
      const res = await request(
        server,
        'POST',
        '/repos/my-repo/ingest',
        { repoUrl: 'https://internal.example.com/org/repo' },
      );
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: expect.stringContaining('Unsupported Git host') });
    });

    it('accepts gitlab.com as a valid host', async () => {
      jobQueue.enqueue.mockResolvedValue('job-gl');
      const res = await request(
        server,
        'POST',
        '/repos/my-repo/ingest',
        { repoUrl: 'https://gitlab.com/org/repo' },
      );
      expect(res.status).toBe(202);
    });

    it('accepts bitbucket.org as a valid host', async () => {
      jobQueue.enqueue.mockResolvedValue('job-bb');
      const res = await request(
        server,
        'POST',
        '/repos/my-repo/ingest',
        { repoUrl: 'https://bitbucket.org/org/repo' },
      );
      expect(res.status).toBe(202);
    });

    it('returns 400 for an invalid trigger value', async () => {
      const res = await request(
        server,
        'POST',
        '/repos/my-repo/ingest',
        { repoUrl: 'https://github.com/org/repo', trigger: 'bad-trigger' },
      );
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: expect.stringContaining('Invalid trigger') });
    });

    it('returns 409 when a job is already running', async () => {
      jobQueue.enqueue.mockRejectedValue(
        new Error('Ingestion already running for repo my-repo (job job-123)'),
      );

      const res = await request(
        server,
        'POST',
        '/repos/my-repo/ingest',
        { repoUrl: 'https://github.com/org/repo' },
      );

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ error: expect.stringContaining('already running') });
    });

    it('returns 500 on unexpected error', async () => {
      jobQueue.enqueue.mockRejectedValue(new Error('DB connection failed'));

      const res = await request(
        server,
        'POST',
        '/repos/my-repo/ingest',
        { repoUrl: 'https://github.com/org/repo' },
      );

      expect(res.status).toBe(500);
    });
  });

  // -------------------------------------------------------------------------
  // GET /repos/:repoId/jobs/:jobId
  // -------------------------------------------------------------------------

  describe('GET /repos/:repoId/jobs/:jobId', () => {
    it('returns the job when found', async () => {
      const job: Partial<IngestionJob> = {
        jobId: 'job-1',
        repoId: 'repo-1',
        status: 'completed',
        filesProcessed: 10,
        filesSkipped: 0,
      };
      storageAdapter.getJob.mockResolvedValue(job);

      const res = await request(server, 'GET', '/repos/repo-1/jobs/job-1');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ jobId: 'job-1', status: 'completed' });
    });

    it('returns 404 when job does not exist', async () => {
      storageAdapter.getJob.mockResolvedValue(null);

      const res = await request(server, 'GET', '/repos/repo-1/jobs/missing-job');
      expect(res.status).toBe(404);
    });

    it('returns 404 when job belongs to a different repo', async () => {
      const job: Partial<IngestionJob> = { jobId: 'job-1', repoId: 'other-repo', status: 'completed' };
      storageAdapter.getJob.mockResolvedValue(job);

      const res = await request(server, 'GET', '/repos/repo-1/jobs/job-1');
      expect(res.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // GET /repos/:repoId/docs
  // -------------------------------------------------------------------------

  describe('GET /repos/:repoId/docs', () => {
    it('returns sorted doc sections with metadata', async () => {
      storageAdapter.getRepo.mockResolvedValue({ repoId: 'repo-1', status: 'ready' });
      storageAdapter.getArtifactsByType.mockResolvedValue([
        {
          repoId: 'repo-1',
          artifactId: 'core/overview',
          artifactType: 'doc',
          content: { kind: 'doc', module: 'core/overview', markdown: '# Overview\n\nHello.' },
          inputSha: 'sha-1',
          isStale: false,
          staleReason: null,
          tokensUsed: 300,
          llmUsed: true,
          generatedAt: new Date('2024-06-01T10:00:00Z'),
        },
        {
          repoId: 'repo-1',
          artifactId: 'backend/api-reference',
          artifactType: 'doc',
          content: { kind: 'doc', module: 'backend/api-reference', markdown: '## API' },
          inputSha: 'sha-2',
          isStale: true,
          staleReason: 'file_changed',
          tokensUsed: 450,
          llmUsed: true,
          generatedAt: new Date('2024-06-01T09:00:00Z'),
        },
      ]);
      storageAdapter.getArtifactInputs
        .mockResolvedValueOnce([{ filePath: 'README.md', fileSha: 'x' }])
        .mockResolvedValueOnce([
          { filePath: 'src/routes.ts', fileSha: 'y' },
          { filePath: 'src/app.ts', fileSha: 'z' },
        ]);

      const res = await request(server, 'GET', '/repos/repo-1/docs');

      expect(res.status).toBe(200);
      const body = res.body as Array<Record<string, unknown>>;
      // Sorted by artifactId: backend/api-reference < core/overview
      expect(body[0].artifactId).toBe('backend/api-reference');
      expect(body[0].markdown).toBe('## API');
      expect(body[0].isStale).toBe(true);
      expect(body[0].staleReason).toBe('file_changed');
      expect(body[0].fileCount).toBe(2);
      expect(body[0].tokensUsed).toBe(450);
      expect(typeof body[0].generatedAt).toBe('string');
      expect(Number.isNaN(Date.parse(body[0].generatedAt as string))).toBe(false);
      expect(body[1].artifactId).toBe('core/overview');
      expect(body[1].markdown).toBe('# Overview\n\nHello.');
      expect(body[1].isStale).toBe(false);
      expect(body[1].fileCount).toBe(1);
      expect(body[1].tokensUsed).toBe(300);
    });

    it('returns empty array when no doc artifacts exist', async () => {
      storageAdapter.getRepo.mockResolvedValue({ repoId: 'repo-1', status: 'ready' });
      storageAdapter.getArtifactsByType.mockResolvedValue([]);

      const res = await request(server, 'GET', '/repos/repo-1/docs');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('returns 404 when repo does not exist', async () => {
      storageAdapter.getRepo.mockResolvedValue(null);

      const res = await request(server, 'GET', '/repos/unknown-repo/docs');

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: expect.stringContaining('Repo not found') });
    });

    it('handles artifact with no content (empty markdown)', async () => {
      storageAdapter.getRepo.mockResolvedValue({ repoId: 'repo-1', status: 'ready' });
      storageAdapter.getArtifactsByType.mockResolvedValue([
        {
          repoId: 'repo-1',
          artifactId: 'core/overview',
          artifactType: 'doc',
          content: null,
          inputSha: 'sha-1',
          isStale: false,
          staleReason: null,
          tokensUsed: 0,
          llmUsed: false,
          generatedAt: new Date('2024-06-01T10:00:00Z'),
        },
      ]);
      storageAdapter.getArtifactInputs.mockResolvedValue([]);

      const res = await request(server, 'GET', '/repos/repo-1/docs');

      expect(res.status).toBe(200);
      const body = res.body as Array<Record<string, unknown>>;
      expect(body[0].markdown).toBe('');
      expect(body[0].fileCount).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // GET /repos/:repoId/diagrams
  // -------------------------------------------------------------------------

  describe('GET /repos/:repoId/diagrams', () => {
    it('returns sorted diagram sections including nodeMap when present', async () => {
      storageAdapter.getRepo.mockResolvedValue({ repoId: 'repo-1', status: 'ready' });
      storageAdapter.getArtifactsByType.mockResolvedValue([
        {
          repoId: 'repo-1',
          artifactId: 'universal/dependency-graph',
          artifactType: 'diagram',
          content: {
            kind: 'diagram',
            diagramType: 'graph',
            mermaid: 'graph TD\n  A --> B',
            title: 'Dependency Graph',
            description: 'Module import structure',
            nodeMap: { A: 'src/a.ts', B: 'src/b.ts' },
          },
          inputSha: 'sha-dg',
          isStale: false,
          staleReason: null,
          tokensUsed: 0,
          llmUsed: false,
          generatedAt: new Date('2024-07-01T10:00:00Z'),
        },
        {
          repoId: 'repo-1',
          artifactId: 'backend/api-flow',
          artifactType: 'diagram',
          content: {
            kind: 'diagram',
            diagramType: 'sequenceDiagram',
            mermaid: 'sequenceDiagram\n  A->>B: call',
            title: 'API Flow',
            description: null,
            nodeMap: undefined,
          },
          inputSha: 'sha-af',
          isStale: true,
          staleReason: 'file_changed',
          tokensUsed: 512,
          llmUsed: true,
          generatedAt: new Date('2024-07-01T09:00:00Z'),
        },
      ]);

      const res = await request(server, 'GET', '/repos/repo-1/diagrams');

      expect(res.status).toBe(200);
      const body = res.body as Array<Record<string, unknown>>;
      // Sorted by artifactId: backend/api-flow < universal/dependency-graph
      expect(body[0].artifactId).toBe('backend/api-flow');
      expect(body[0].diagramType).toBe('sequenceDiagram');
      expect(body[0].mermaid).toBe('sequenceDiagram\n  A->>B: call');
      expect(body[0].isStale).toBe(true);
      expect(body[0].staleReason).toBe('file_changed');
      expect(body[0].llmUsed).toBe(true);
      expect(body[0].tokensUsed).toBe(512);
      expect(body[0].nodeMap).toBeNull(); // undefined → null via ?? null
      expect(typeof body[0].generatedAt).toBe('string');

      expect(body[1].artifactId).toBe('universal/dependency-graph');
      expect(body[1].diagramType).toBe('graph');
      expect(body[1].title).toBe('Dependency Graph');
      expect(body[1].description).toBe('Module import structure');
      expect(body[1].isStale).toBe(false);
      expect(body[1].llmUsed).toBe(false);
      expect(body[1].tokensUsed).toBe(0);
      expect(body[1].nodeMap).toEqual({ A: 'src/a.ts', B: 'src/b.ts' });
    });

    it('returns null for nodeMap when artifact content has no nodeMap', async () => {
      storageAdapter.getRepo.mockResolvedValue({ repoId: 'repo-1', status: 'ready' });
      storageAdapter.getArtifactsByType.mockResolvedValue([
        {
          repoId: 'repo-1',
          artifactId: 'universal/er-diagram',
          artifactType: 'diagram',
          content: {
            kind: 'diagram',
            diagramType: 'erDiagram',
            mermaid: 'erDiagram\n  User { int id }',
            title: 'ER Diagram',
          },
          inputSha: 'sha-er',
          isStale: false,
          staleReason: null,
          tokensUsed: 0,
          llmUsed: false,
          generatedAt: new Date('2024-07-01T11:00:00Z'),
        },
      ]);

      const res = await request(server, 'GET', '/repos/repo-1/diagrams');

      expect(res.status).toBe(200);
      const body = res.body as Array<Record<string, unknown>>;
      expect(body[0].nodeMap).toBeNull();
    });

    it('returns empty array when no diagram artifacts exist', async () => {
      storageAdapter.getRepo.mockResolvedValue({ repoId: 'repo-1', status: 'ready' });
      storageAdapter.getArtifactsByType.mockResolvedValue([]);

      const res = await request(server, 'GET', '/repos/repo-1/diagrams');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('returns 404 when repo does not exist', async () => {
      storageAdapter.getRepo.mockResolvedValue(null);

      const res = await request(server, 'GET', '/repos/unknown-repo/diagrams');

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: expect.stringContaining('Repo not found') });
    });

    it('falls back to artifactId as title and "unknown" as diagramType when content is null', async () => {
      storageAdapter.getRepo.mockResolvedValue({ repoId: 'repo-1', status: 'ready' });
      storageAdapter.getArtifactsByType.mockResolvedValue([
        {
          repoId: 'repo-1',
          artifactId: 'universal/dependency-graph',
          artifactType: 'diagram',
          content: null,
          inputSha: 'sha-null',
          isStale: false,
          staleReason: null,
          tokensUsed: 0,
          llmUsed: false,
          generatedAt: new Date('2024-07-01T10:00:00Z'),
        },
      ]);

      const res = await request(server, 'GET', '/repos/repo-1/diagrams');

      expect(res.status).toBe(200);
      const body = res.body as Array<Record<string, unknown>>;
      expect(body[0].title).toBe('universal/dependency-graph');
      expect(body[0].diagramType).toBe('unknown');
      expect(body[0].mermaid).toBe('');
      expect(body[0].nodeMap).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // GET /repos/:repoId/status
  // -------------------------------------------------------------------------

  describe('GET /repos/:repoId/status', () => {
    it('returns repo status when found', async () => {
      const repo: Partial<Repository> = {
        repoId: 'repo-1',
        status: 'ready',
        lastCommitSha: 'abc123',
        updatedAt: new Date('2024-01-01'),
      };
      storageAdapter.getRepo.mockResolvedValue(repo);

      const res = await request(server, 'GET', '/repos/repo-1/status');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        repoId: 'repo-1',
        status: 'ready',
        lastCommitSha: 'abc123',
      });
    });

    it('returns 404 when repo does not exist', async () => {
      storageAdapter.getRepo.mockResolvedValue(null);

      const res = await request(server, 'GET', '/repos/unknown-repo/status');
      expect(res.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // DELETE /repos/:repoId  (6.3 — repo re-registration)
  // -------------------------------------------------------------------------

  describe('DELETE /repos/:repoId', () => {
    it('returns 204 and calls deleteRepo on success', async () => {
      storageAdapter.deleteRepo.mockResolvedValue(undefined);

      const res = await request(server, 'DELETE', '/repos/repo-1');

      expect(res.status).toBe(204);
      expect(storageAdapter.deleteRepo).toHaveBeenCalledWith('repo-1');
    });

    it('returns 500 when deleteRepo throws', async () => {
      storageAdapter.deleteRepo.mockRejectedValue(new Error('DB error'));

      const res = await request(server, 'DELETE', '/repos/repo-1');

      expect(res.status).toBe(500);
      expect(res.body).toMatchObject({ error: 'DB error' });
    });

    it('URL-encoded repoId is decoded correctly', async () => {
      storageAdapter.deleteRepo.mockResolvedValue(undefined);

      const res = await request(server, 'DELETE', '/repos/org~my-repo');

      expect(res.status).toBe(204);
      expect(storageAdapter.deleteRepo).toHaveBeenCalledWith('org~my-repo');
    });
  });
});
