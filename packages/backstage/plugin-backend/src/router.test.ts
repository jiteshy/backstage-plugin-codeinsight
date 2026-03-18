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
    getStaleArtifacts: jest.fn(),
    markArtifactsStale: jest.fn(),
    createJob: jest.fn(),
    updateJob: jest.fn(),
    getActiveJobForRepo: jest.fn(),
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
});
