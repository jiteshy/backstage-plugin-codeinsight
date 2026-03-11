/**
 * Integration test: IngestionService end-to-end pipeline (1.8.6)
 *
 * - Uses real Postgres (Docker on port 5433) via KnexStorageAdapter
 * - Uses the sample-express-app fixture at test/fixtures/sample-express-app/
 * - RepoConnector is a mock backed by the local fixture directory
 * - Verifies: full run → queued→running→completed, CIG nodes/edges exist,
 *   files tracked, then delta run only reprocesses changed files
 */

import * as fs from 'fs';
import * as path from 'path';

import { KnexStorageAdapter } from '@codeinsight/storage';
import type {
  CloneOptions,
  IngestionJob,
  RepoFile,
  RepoConnector,
} from '@codeinsight/types';
import Knex from 'knex';
import type { Knex as KnexType } from 'knex';

import { IngestionService } from '../IngestionService';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FIXTURE_ROOT = path.resolve(
  __dirname,
  '../../../../../test/fixtures/sample-express-app',
);

// tempDir is set to the parent of the fixture dir so that
// cloneDir = path.join(tempDir, repoId) == FIXTURE_ROOT
const TEMP_DIR = path.dirname(FIXTURE_ROOT);
const REPO_ID = path.basename(FIXTURE_ROOT); // 'sample-express-app'
const REPO_URL = 'https://github.com/test/sample-express-app';

const DB_CONFIG = {
  client: 'pg' as const,
  connection: {
    host: 'localhost',
    port: 5433,
    user: 'codeinsight',
    password: 'codeinsight',
    database: 'codeinsight',
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForJob(
  adapter: KnexStorageAdapter,
  jobId: string,
  timeoutMs = 15_000,
): Promise<IngestionJob> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = await adapter.getJob(jobId);
    if (job && ['completed', 'failed', 'partial'].includes(job.status)) {
      return job;
    }
    await sleep(100);
  }
  throw new Error(`Job ${jobId} did not reach terminal state within ${timeoutMs}ms`);
}

// ---------------------------------------------------------------------------
// Mock RepoConnector backed by the fixture directory
// ---------------------------------------------------------------------------

function buildMockRepoConnector(opts: {
  headSha: string;
  changedFiles?: string[];
}): RepoConnector {
  return {
    clone: async (_url: string, _targetDir: string, _opts?: CloneOptions) => {
      // no-op: cloneDir == FIXTURE_ROOT (tempDir/repoId)
    },
    getFileTree: async (dir: string): Promise<RepoFile[]> => {
      const files: RepoFile[] = [];
      function walk(d: string): void {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
          const full = path.join(d, entry.name);
          const rel = path.relative(dir, full);
          if (entry.isDirectory()) {
            if (['node_modules', '.git'].includes(entry.name)) continue;
            walk(full);
          } else {
            const content = fs.readFileSync(full);
            files.push({
              repoId: '',
              filePath: rel,
              currentSha: `sha-${Buffer.from(content).toString('base64').slice(0, 8)}`,
              lastProcessedSha: null,
              fileType: 'source',
              language: null,
              parseStatus: 'pending',
            });
          }
        }
      }
      walk(dir);
      return files;
    },
    getHeadSha: async (_dir: string) => opts.headSha,
    getChangedFiles: async (_dir: string, _from: string, _to: string) =>
      opts.changedFiles ?? [],
  };
}

// ---------------------------------------------------------------------------
// DB setup — per-test schema isolation via transactions
// ---------------------------------------------------------------------------

let knex: KnexType;

beforeAll(async () => {
  knex = Knex(DB_CONFIG);
  await knex.raw('SELECT 1');
});

afterAll(async () => {
  await knex.destroy();
});

// Clean up any leftover fixture data between tests
async function cleanup(): Promise<void> {
  // Delete in FK-safe order
  await knex('ci_cig_edges').where('repo_id', REPO_ID).delete();
  await knex('ci_cig_nodes').where('repo_id', REPO_ID).delete();
  await knex('ci_repo_files').where('repo_id', REPO_ID).delete();
  await knex('ci_ingestion_jobs').where('repo_id', REPO_ID).delete();
  await knex('ci_repositories').where('repo_id', REPO_ID).delete();
}

beforeEach(async () => {
  await cleanup();
});

afterEach(async () => {
  await cleanup();
});

// ---------------------------------------------------------------------------
// Helpers that create a real adapter + service per test
// ---------------------------------------------------------------------------

function makeService(connector: RepoConnector): {
  service: IngestionService;
  adapter: KnexStorageAdapter;
} {
  const adapter = new KnexStorageAdapter(knex);
  const service = new IngestionService(
    connector,
    adapter,
    {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: (msg, meta) => console.error('[IngestionService]', msg, meta),
    },
    {
      tempDir: TEMP_DIR,
      deltaThreshold: 0.4,
      maxConcurrentJobs: 1,
      jobTimeoutMinutes: 30,
    },
  );
  return { service, adapter };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IngestionService integration', () => {
  it('full pipeline: queued → running → completed with CIG data in DB', async () => {
    const connector = buildMockRepoConnector({ headSha: 'sha-v1' });
    const { service, adapter } = makeService(connector);

    const jobId = await service.triggerIngestion(REPO_ID, REPO_URL, 'manual');
    expect(typeof jobId).toBe('string');

    // Job should be in queued or running immediately
    const initialJob = await adapter.getJob(jobId);
    expect(initialJob).not.toBeNull();
    expect(['queued', 'running']).toContain(initialJob!.status);

    // Wait for completion
    const job = await waitForJob(adapter, jobId);
    expect(job.status).toBe('completed');
    expect(job.filesProcessed).toBeGreaterThan(0);
    expect(job.toCommit).toBe('sha-v1');

    // Repo status is ready
    const repo = await adapter.getRepo(REPO_ID);
    expect(repo).not.toBeNull();
    expect(repo!.status).toBe('ready');
    expect(repo!.lastCommitSha).toBe('sha-v1');

    // CIG nodes extracted
    const nodes = await adapter.getCIGNodes(REPO_ID);
    expect(nodes.length).toBeGreaterThan(10);

    // CIG edges extracted
    const edges = await adapter.getCIGEdges(REPO_ID);
    expect(edges.length).toBeGreaterThan(0);

    // Repo files tracked
    const files = await adapter.getRepoFiles(REPO_ID);
    expect(files.length).toBeGreaterThan(0);

    // All tracked files have lastProcessedSha set
    const unprocessed = files.filter(f => !f.lastProcessedSha);
    expect(unprocessed).toHaveLength(0);
  });

  it('duplicate job: queued → returns existing jobId', async () => {
    // Seed a queued job directly so there's no timing race
    const storedAdapter = new KnexStorageAdapter(knex);
    await storedAdapter.upsertRepo({
      repoId: REPO_ID,
      name: REPO_ID,
      url: REPO_URL,
      provider: 'github',
      status: 'idle',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const existingJobId = await storedAdapter.createJob({
      jobId: '00000000-0000-0000-0000-000000000001',
      repoId: REPO_ID,
      trigger: 'manual',
      status: 'queued',
      filesProcessed: 0,
      filesSkipped: 0,
      tokensConsumed: 0,
      createdAt: new Date(),
    });

    const connector = buildMockRepoConnector({ headSha: 'sha-v1' });
    const { service } = makeService(connector);

    const returnedId = await service.triggerIngestion(REPO_ID, REPO_URL, 'manual');
    expect(returnedId).toBe(existingJobId);
  });

  it('duplicate job: running → throws error', async () => {
    // Seed a running job directly so there's no timing race
    const storedAdapter = new KnexStorageAdapter(knex);
    await storedAdapter.upsertRepo({
      repoId: REPO_ID,
      name: REPO_ID,
      url: REPO_URL,
      provider: 'github',
      status: 'processing',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await storedAdapter.createJob({
      jobId: '00000000-0000-0000-0000-000000000002',
      repoId: REPO_ID,
      trigger: 'manual',
      status: 'running',
      startedAt: new Date(),
      filesProcessed: 0,
      filesSkipped: 0,
      tokensConsumed: 0,
      createdAt: new Date(),
    });

    const { service } = makeService(buildMockRepoConnector({ headSha: 'sha-v1' }));

    await expect(
      service.triggerIngestion(REPO_ID, REPO_URL, 'manual'),
    ).rejects.toThrow(/already running/);
  });

  it('delta run: only reprocesses changed files', async () => {
    // --- Full run first ---
    const fullConnector = buildMockRepoConnector({ headSha: 'sha-v1' });
    const { service: svc1, adapter } = makeService(fullConnector);
    const fullJobId = await svc1.triggerIngestion(REPO_ID, REPO_URL, 'manual');
    const fullJob = await waitForJob(adapter, fullJobId);
    expect(fullJob.status).toBe('completed');

    const nodesAfterFull = await adapter.getCIGNodes(REPO_ID);
    expect(nodesAfterFull.length).toBeGreaterThan(0);

    // --- Delta run with one changed file ---
    const changedFile = 'src/controllers/UserController.ts';
    const deltaConnector = buildMockRepoConnector({
      headSha: 'sha-v2',
      changedFiles: [changedFile],
    });
    const { service: svc2 } = makeService(deltaConnector);
    const deltaJobId = await svc2.triggerIngestion(REPO_ID, REPO_URL, 'webhook');
    const deltaJob = await waitForJob(adapter, deltaJobId);

    expect(deltaJob.status).toBe('completed');
    expect(deltaJob.changedFiles).toEqual([changedFile]);

    // Delta job processed only the changed file (+ its module node)
    expect(deltaJob.filesProcessed).toBeLessThan(fullJob.filesProcessed!);

    // CIG still intact: total nodes should be preserved or similar
    const nodesAfterDelta = await adapter.getCIGNodes(REPO_ID);
    expect(nodesAfterDelta.length).toBeGreaterThan(0);

    // Nodes for unchanged files still present
    const unchangedFileNodes = nodesAfterDelta.filter(
      n => n.filePath !== changedFile && !n.filePath.endsWith('schema.prisma'),
    );
    expect(unchangedFileNodes.length).toBeGreaterThan(0);
  });

  it('empty delta: no CIG work when no files changed', async () => {
    // Full run first
    const { service: svc1, adapter } = makeService(
      buildMockRepoConnector({ headSha: 'sha-v1' }),
    );
    await waitForJob(adapter, await svc1.triggerIngestion(REPO_ID, REPO_URL, 'manual'));

    // Second run with same sha and no changed files
    const { service: svc2 } = makeService(
      buildMockRepoConnector({ headSha: 'sha-v2', changedFiles: [] }),
    );
    const jobId = await svc2.triggerIngestion(REPO_ID, REPO_URL, 'schedule');
    const job = await waitForJob(adapter, jobId);

    expect(job.status).toBe('completed');
    expect(job.filesProcessed).toBe(0);
    expect(job.filesSkipped).toBe(0);
  });

  it('full run threshold: switches to full when delta ratio exceeds threshold', async () => {
    // Full run first to set lastCommitSha
    const { service: svc1, adapter } = makeService(
      buildMockRepoConnector({ headSha: 'sha-v1' }),
    );
    await waitForJob(adapter, await svc1.triggerIngestion(REPO_ID, REPO_URL, 'manual'));

    const allFiles = await adapter.getRepoFiles(REPO_ID);
    // Mark > 40% of files as changed to trigger full run
    const manyChanges = allFiles.slice(0, Math.ceil(allFiles.length * 0.5))
      .map(f => f.filePath);

    const connector = buildMockRepoConnector({
      headSha: 'sha-v3',
      changedFiles: manyChanges,
    });
    const { service: svc3 } = makeService(connector);
    const jobId = await svc3.triggerIngestion(REPO_ID, REPO_URL, 'webhook');
    const job = await waitForJob(adapter, jobId);

    expect(job.status).toBe('completed');
    // Full run processes all filterable files
    expect(job.filesProcessed).toBeGreaterThan(1);
    // changedFiles is null on full run (no delta metadata)
    expect(job.changedFiles).toBeNull();
  });
});
