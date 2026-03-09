import { randomUUID } from 'crypto';

import type {
  Artifact,
  CIGEdge,
  CIGNode,
  IngestionJob,
  RepoFile,
  Repository,
} from '@codeinsight/types';
import Knex from 'knex';
import type { Knex as KnexType } from 'knex';

import { KnexStorageAdapter } from './KnexStorageAdapter';

// ---------------------------------------------------------------------------
// Test setup — real Postgres, transaction-based isolation
// ---------------------------------------------------------------------------

let knex: KnexType;
let trx: KnexType.Transaction;
let adapter: KnexStorageAdapter;

beforeAll(async () => {
  knex = Knex({
    client: 'pg',
    connection: {
      host: 'localhost',
      port: 5433,
      user: 'codeinsight',
      password: 'codeinsight',
      database: 'codeinsight',
    },
  });
  // Verify connection
  await knex.raw('SELECT 1');
});

afterAll(async () => {
  await knex.destroy();
});

beforeEach(async () => {
  trx = await knex.transaction();
  adapter = new KnexStorageAdapter(trx as unknown as KnexType);
});

afterEach(async () => {
  await trx.rollback();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRepo(overrides?: Partial<Repository>): Repository {
  return {
    repoId: randomUUID(),
    name: 'test-repo',
    url: 'https://github.com/test/test-repo',
    provider: 'github',
    status: 'idle',
    lastCommitSha: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeRepoFile(
  repoId: string,
  filePath: string,
  overrides?: Partial<RepoFile>,
): RepoFile {
  return {
    repoId,
    filePath,
    currentSha: randomUUID(),
    lastProcessedSha: null,
    fileType: 'source',
    language: 'typescript',
    parseStatus: 'pending',
    ...overrides,
  };
}

function makeCIGNode(
  repoId: string,
  overrides?: Partial<CIGNode>,
): CIGNode {
  return {
    nodeId: randomUUID(),
    repoId,
    filePath: 'src/index.ts',
    symbolName: 'main',
    symbolType: 'function',
    startLine: 1,
    endLine: 10,
    exported: true,
    extractedSha: 'abc123',
    metadata: null,
    ...overrides,
  };
}

function makeJob(repoId: string, overrides?: Partial<IngestionJob>): IngestionJob {
  return {
    jobId: randomUUID(),
    repoId,
    trigger: 'manual',
    status: 'queued',
    fromCommit: null,
    toCommit: null,
    changedFiles: null,
    artifactsStale: null,
    filesProcessed: 0,
    filesSkipped: 0,
    tokensConsumed: 0,
    errorMessage: null,
    startedAt: null,
    completedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeArtifact(repoId: string, overrides?: Partial<Artifact>): Artifact {
  return {
    repoId,
    artifactId: `doc/${randomUUID()}`,
    artifactType: 'doc',
    content: { title: 'Test', body: 'Hello' },
    inputSha: randomUUID(),
    promptVersion: 'v1',
    isStale: false,
    staleReason: null,
    tokensUsed: 100,
    llmUsed: true,
    generatedAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Repository tests
// ---------------------------------------------------------------------------

describe('KnexStorageAdapter', () => {
  describe('Repository operations', () => {
    it('getRepo returns null for non-existent repo', async () => {
      const result = await adapter.getRepo('non-existent');
      expect(result).toBeNull();
    });

    it('upsertRepo inserts a new repo and getRepo retrieves it', async () => {
      const repo = makeRepo();
      await adapter.upsertRepo(repo);

      const result = await adapter.getRepo(repo.repoId);
      expect(result).not.toBeNull();
      expect(result!.repoId).toBe(repo.repoId);
      expect(result!.name).toBe(repo.name);
      expect(result!.url).toBe(repo.url);
      expect(result!.provider).toBe('github');
      expect(result!.status).toBe('idle');
    });

    it('upsertRepo updates an existing repo', async () => {
      const repo = makeRepo();
      await adapter.upsertRepo(repo);

      repo.name = 'updated-name';
      repo.status = 'processing';
      repo.updatedAt = new Date();
      await adapter.upsertRepo(repo);

      const result = await adapter.getRepo(repo.repoId);
      expect(result!.name).toBe('updated-name');
      expect(result!.status).toBe('processing');
    });

    it('updateRepoStatus updates status and updated_at', async () => {
      const repo = makeRepo();
      await adapter.upsertRepo(repo);

      await adapter.updateRepoStatus(repo.repoId, 'ready', 'sha123');

      const result = await adapter.getRepo(repo.repoId);
      expect(result!.status).toBe('ready');
      expect(result!.lastCommitSha).toBe('sha123');
    });

    it('updateRepoStatus without lastCommitSha leaves it unchanged', async () => {
      const repo = makeRepo({ lastCommitSha: 'original-sha' });
      await adapter.upsertRepo(repo);

      await adapter.updateRepoStatus(repo.repoId, 'processing');

      const result = await adapter.getRepo(repo.repoId);
      expect(result!.status).toBe('processing');
      expect(result!.lastCommitSha).toBe('original-sha');
    });
  });

  // -------------------------------------------------------------------------
  // File tracking tests
  // -------------------------------------------------------------------------

  describe('File tracking', () => {
    let repoId: string;

    beforeEach(async () => {
      const repo = makeRepo();
      repoId = repo.repoId;
      await adapter.upsertRepo(repo);
    });

    it('upsertRepoFiles inserts files and getRepoFiles retrieves them', async () => {
      const files = [
        makeRepoFile(repoId, 'src/index.ts'),
        makeRepoFile(repoId, 'src/app.ts'),
      ];
      await adapter.upsertRepoFiles(files);

      const result = await adapter.getRepoFiles(repoId);
      expect(result).toHaveLength(2);
      const paths = result.map(f => f.filePath).sort();
      expect(paths).toEqual(['src/app.ts', 'src/index.ts']);
    });

    it('upsertRepoFiles updates existing files on conflict', async () => {
      const file = makeRepoFile(repoId, 'src/index.ts', {
        currentSha: 'sha-v1',
      });
      await adapter.upsertRepoFiles([file]);

      file.currentSha = 'sha-v2';
      file.parseStatus = 'parsed';
      await adapter.upsertRepoFiles([file]);

      const result = await adapter.getRepoFiles(repoId);
      expect(result).toHaveLength(1);
      expect(result[0].currentSha).toBe('sha-v2');
      expect(result[0].parseStatus).toBe('parsed');
    });

    it('upsertRepoFiles with empty array is a no-op', async () => {
      await adapter.upsertRepoFiles([]);
      const result = await adapter.getRepoFiles(repoId);
      expect(result).toHaveLength(0);
    });

    it('getChangedRepoFiles returns files where current_sha != last_processed_sha', async () => {
      const files = [
        makeRepoFile(repoId, 'src/changed.ts', {
          currentSha: 'new-sha',
          lastProcessedSha: 'old-sha',
        }),
        makeRepoFile(repoId, 'src/unchanged.ts', {
          currentSha: 'same-sha',
          lastProcessedSha: 'same-sha',
        }),
        makeRepoFile(repoId, 'src/new-file.ts', {
          currentSha: 'some-sha',
          lastProcessedSha: null,
        }),
      ];
      await adapter.upsertRepoFiles(files);

      const changed = await adapter.getChangedRepoFiles(repoId);
      expect(changed).toHaveLength(2);
      const paths = changed.map(f => f.filePath).sort();
      expect(paths).toEqual(['src/changed.ts', 'src/new-file.ts']);
    });

    it('handles batch upsert with 500+ files', async () => {
      const files: RepoFile[] = [];
      for (let i = 0; i < 600; i++) {
        files.push(makeRepoFile(repoId, `src/file-${i}.ts`));
      }
      await adapter.upsertRepoFiles(files);

      const result = await adapter.getRepoFiles(repoId);
      expect(result).toHaveLength(600);
    });
  });

  // -------------------------------------------------------------------------
  // CIG tests
  // -------------------------------------------------------------------------

  describe('CIG operations', () => {
    let repoId: string;

    beforeEach(async () => {
      const repo = makeRepo();
      repoId = repo.repoId;
      await adapter.upsertRepo(repo);
    });

    it('upsertCIGNodes inserts nodes and getCIGNodes retrieves them', async () => {
      const nodes = [
        makeCIGNode(repoId, { symbolName: 'funcA', filePath: 'src/a.ts' }),
        makeCIGNode(repoId, { symbolName: 'funcB', filePath: 'src/b.ts' }),
      ];
      await adapter.upsertCIGNodes(nodes);

      const result = await adapter.getCIGNodes(repoId);
      expect(result).toHaveLength(2);
      const names = result.map(n => n.symbolName).sort();
      expect(names).toEqual(['funcA', 'funcB']);
    });

    it('upsertCIGNodes updates existing nodes on conflict', async () => {
      const node = makeCIGNode(repoId, {
        symbolName: 'func',
        filePath: 'src/a.ts',
        startLine: 1,
        endLine: 10,
      });
      await adapter.upsertCIGNodes([node]);

      node.startLine = 5;
      node.endLine = 20;
      node.extractedSha = 'new-sha';
      await adapter.upsertCIGNodes([node]);

      const result = await adapter.getCIGNodes(repoId);
      expect(result).toHaveLength(1);
      expect(result[0].startLine).toBe(5);
      expect(result[0].endLine).toBe(20);
      expect(result[0].extractedSha).toBe('new-sha');
    });

    it('upsertCIGEdges inserts edges and getCIGEdges retrieves them', async () => {
      const nodeA = makeCIGNode(repoId, {
        symbolName: 'funcA',
        filePath: 'src/a.ts',
      });
      const nodeB = makeCIGNode(repoId, {
        symbolName: 'funcB',
        filePath: 'src/b.ts',
      });
      await adapter.upsertCIGNodes([nodeA, nodeB]);

      const edge: CIGEdge = {
        edgeId: randomUUID(),
        repoId,
        fromNodeId: nodeA.nodeId,
        toNodeId: nodeB.nodeId,
        edgeType: 'calls',
      };
      await adapter.upsertCIGEdges([edge]);

      const result = await adapter.getCIGEdges(repoId);
      expect(result).toHaveLength(1);
      expect(result[0].fromNodeId).toBe(nodeA.nodeId);
      expect(result[0].toNodeId).toBe(nodeB.nodeId);
      expect(result[0].edgeType).toBe('calls');
    });

    it('deleteCIGForFiles removes nodes and cascade-deletes edges', async () => {
      const nodeA = makeCIGNode(repoId, {
        symbolName: 'funcA',
        filePath: 'src/a.ts',
      });
      const nodeB = makeCIGNode(repoId, {
        symbolName: 'funcB',
        filePath: 'src/b.ts',
      });
      await adapter.upsertCIGNodes([nodeA, nodeB]);

      const edge: CIGEdge = {
        edgeId: randomUUID(),
        repoId,
        fromNodeId: nodeA.nodeId,
        toNodeId: nodeB.nodeId,
        edgeType: 'imports',
      };
      await adapter.upsertCIGEdges([edge]);

      // Delete nodes for file a.ts — should cascade-delete edges
      await adapter.deleteCIGForFiles(repoId, ['src/a.ts']);

      const nodes = await adapter.getCIGNodes(repoId);
      expect(nodes).toHaveLength(1);
      expect(nodes[0].filePath).toBe('src/b.ts');

      const edges = await adapter.getCIGEdges(repoId);
      expect(edges).toHaveLength(0);
    });

    it('deleteCIGForFiles with empty array is a no-op', async () => {
      const node = makeCIGNode(repoId);
      await adapter.upsertCIGNodes([node]);

      await adapter.deleteCIGForFiles(repoId, []);

      const result = await adapter.getCIGNodes(repoId);
      expect(result).toHaveLength(1);
    });

    it('handles batch upsert with 500+ nodes', async () => {
      const nodes: CIGNode[] = [];
      for (let i = 0; i < 600; i++) {
        nodes.push(
          makeCIGNode(repoId, {
            symbolName: `func${i}`,
            filePath: `src/file-${i}.ts`,
          }),
        );
      }
      await adapter.upsertCIGNodes(nodes);

      const result = await adapter.getCIGNodes(repoId);
      expect(result).toHaveLength(600);
    });

    it('upsertCIGNodes with empty array is a no-op', async () => {
      await adapter.upsertCIGNodes([]);
      const result = await adapter.getCIGNodes(repoId);
      expect(result).toHaveLength(0);
    });

    it('upsertCIGEdges with empty array is a no-op', async () => {
      await adapter.upsertCIGEdges([]);
      const result = await adapter.getCIGEdges(repoId);
      expect(result).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Artifact tests
  // -------------------------------------------------------------------------

  describe('Artifact operations', () => {
    let repoId: string;

    beforeEach(async () => {
      const repo = makeRepo();
      repoId = repo.repoId;
      await adapter.upsertRepo(repo);
    });

    it('upsertArtifact inserts and getArtifact retrieves', async () => {
      const artifact = makeArtifact(repoId);
      await adapter.upsertArtifact(artifact);

      const result = await adapter.getArtifact(artifact.artifactId, repoId);
      expect(result).not.toBeNull();
      expect(result!.artifactId).toBe(artifact.artifactId);
      expect(result!.artifactType).toBe('doc');
      expect(result!.content).toEqual({ title: 'Test', body: 'Hello' });
      expect(result!.tokensUsed).toBe(100);
      expect(result!.llmUsed).toBe(true);
    });

    it('getArtifact returns null for non-existent artifact', async () => {
      const result = await adapter.getArtifact('non-existent', repoId);
      expect(result).toBeNull();
    });

    it('upsertArtifact updates existing artifact on conflict', async () => {
      const artifact = makeArtifact(repoId);
      await adapter.upsertArtifact(artifact);

      artifact.content = { title: 'Updated' };
      artifact.isStale = true;
      artifact.staleReason = 'file_changed';
      await adapter.upsertArtifact(artifact);

      const result = await adapter.getArtifact(artifact.artifactId, repoId);
      expect(result!.content).toEqual({ title: 'Updated' });
      expect(result!.isStale).toBe(true);
      expect(result!.staleReason).toBe('file_changed');
    });

    it('getStaleArtifacts returns only stale artifacts', async () => {
      const fresh = makeArtifact(repoId, {
        artifactId: 'doc/fresh',
        isStale: false,
      });
      const stale = makeArtifact(repoId, {
        artifactId: 'doc/stale',
        isStale: true,
        staleReason: 'file_changed',
      });
      await adapter.upsertArtifact(fresh);
      await adapter.upsertArtifact(stale);

      const result = await adapter.getStaleArtifacts(repoId);
      expect(result).toHaveLength(1);
      expect(result[0].artifactId).toBe('doc/stale');
    });
  });

  // -------------------------------------------------------------------------
  // Job tests
  // -------------------------------------------------------------------------

  describe('Job operations', () => {
    let repoId: string;

    beforeEach(async () => {
      const repo = makeRepo();
      repoId = repo.repoId;
      await adapter.upsertRepo(repo);
    });

    it('createJob inserts a job and getJob retrieves it', async () => {
      const job = makeJob(repoId);
      const jobId = await adapter.createJob(job);

      expect(jobId).toBe(job.jobId);

      const result = await adapter.getJob(jobId);
      expect(result).not.toBeNull();
      expect(result!.repoId).toBe(repoId);
      expect(result!.trigger).toBe('manual');
      expect(result!.status).toBe('queued');
      expect(result!.filesProcessed).toBe(0);
    });

    it('getJob returns null for non-existent job', async () => {
      const result = await adapter.getJob(randomUUID());
      expect(result).toBeNull();
    });

    it('updateJob updates specified fields only', async () => {
      const job = makeJob(repoId);
      await adapter.createJob(job);

      await adapter.updateJob(job.jobId, {
        status: 'running',
        startedAt: new Date(),
        filesProcessed: 10,
      });

      const result = await adapter.getJob(job.jobId);
      expect(result!.status).toBe('running');
      expect(result!.filesProcessed).toBe(10);
      expect(result!.startedAt).not.toBeNull();
      // Unmodified fields stay the same
      expect(result!.trigger).toBe('manual');
      expect(result!.filesSkipped).toBe(0);
    });

    it('updateJob with empty update is a no-op', async () => {
      const job = makeJob(repoId);
      await adapter.createJob(job);

      await adapter.updateJob(job.jobId, {});

      const result = await adapter.getJob(job.jobId);
      expect(result!.status).toBe('queued');
    });

    it('updateJob can set errorMessage', async () => {
      const job = makeJob(repoId);
      await adapter.createJob(job);

      await adapter.updateJob(job.jobId, {
        status: 'failed',
        errorMessage: 'Clone failed: timeout',
      });

      const result = await adapter.getJob(job.jobId);
      expect(result!.status).toBe('failed');
      expect(result!.errorMessage).toBe('Clone failed: timeout');
    });

    it('getActiveJobForRepo returns running/queued job', async () => {
      const job = makeJob(repoId, { status: 'running' });
      await adapter.createJob(job);

      const result = await adapter.getActiveJobForRepo(repoId);
      expect(result).not.toBeNull();
      expect(result!.jobId).toBe(job.jobId);
    });

    it('getActiveJobForRepo returns null when no active job exists', async () => {
      const job = makeJob(repoId, { status: 'completed' });
      await adapter.createJob(job);

      const result = await adapter.getActiveJobForRepo(repoId);
      expect(result).toBeNull();
    });

    it('getActiveJobForRepo returns the most recent active job', async () => {
      const older = makeJob(repoId, {
        status: 'running',
        createdAt: new Date('2024-01-01'),
      });
      const newer = makeJob(repoId, {
        status: 'queued',
        createdAt: new Date('2024-06-01'),
      });
      await adapter.createJob(older);
      await adapter.createJob(newer);

      const result = await adapter.getActiveJobForRepo(repoId);
      expect(result!.jobId).toBe(newer.jobId);
    });

    it('createJob stores changedFiles array correctly', async () => {
      const job = makeJob(repoId, {
        changedFiles: ['src/a.ts', 'src/b.ts', 'package.json'],
      });
      await adapter.createJob(job);

      const result = await adapter.getJob(job.jobId);
      expect(result!.changedFiles).toEqual([
        'src/a.ts',
        'src/b.ts',
        'package.json',
      ]);
    });
  });
});
