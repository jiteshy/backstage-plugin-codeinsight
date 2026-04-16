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
    content: { kind: 'doc', module: 'overview', markdown: 'Hello' },
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
      expect(result!.content).toEqual({ kind: 'doc', module: 'overview', markdown: 'Hello' });
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

      artifact.content = { kind: 'doc', module: 'overview', markdown: 'Updated' };
      artifact.isStale = true;
      artifact.staleReason = 'file_changed';
      await adapter.upsertArtifact(artifact);

      const result = await adapter.getArtifact(artifact.artifactId, repoId);
      expect(result!.content).toEqual({ kind: 'doc', module: 'overview', markdown: 'Updated' });
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
  // deleteRepoFilesNotIn tests
  // -------------------------------------------------------------------------

  describe('deleteRepoFilesNotIn', () => {
    let repoId: string;

    beforeEach(async () => {
      const repo = makeRepo();
      repoId = repo.repoId;
      await adapter.upsertRepo(repo);
    });

    it('deletes file records that are not in the provided list', async () => {
      const files = [
        makeRepoFile(repoId, 'src/keep.ts'),
        makeRepoFile(repoId, 'src/delete-me.ts'),
        makeRepoFile(repoId, 'src/also-delete.ts'),
      ];
      await adapter.upsertRepoFiles(files);

      await adapter.deleteRepoFilesNotIn(repoId, ['src/keep.ts']);

      const result = await adapter.getRepoFiles(repoId);
      expect(result).toHaveLength(1);
      expect(result[0].filePath).toBe('src/keep.ts');
    });

    it('is a no-op when all current files are still present', async () => {
      const files = [
        makeRepoFile(repoId, 'src/a.ts'),
        makeRepoFile(repoId, 'src/b.ts'),
      ];
      await adapter.upsertRepoFiles(files);

      await adapter.deleteRepoFilesNotIn(repoId, ['src/a.ts', 'src/b.ts']);

      const result = await adapter.getRepoFiles(repoId);
      expect(result).toHaveLength(2);
    });

    it('deletes all files when currentFilePaths is empty', async () => {
      const files = [
        makeRepoFile(repoId, 'src/a.ts'),
        makeRepoFile(repoId, 'src/b.ts'),
      ];
      await adapter.upsertRepoFiles(files);

      await adapter.deleteRepoFilesNotIn(repoId, []);

      const result = await adapter.getRepoFiles(repoId);
      expect(result).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // getArtifactsByType tests
  // -------------------------------------------------------------------------

  describe('getArtifactsByType', () => {
    let repoId: string;

    beforeEach(async () => {
      const repo = makeRepo();
      repoId = repo.repoId;
      await adapter.upsertRepo(repo);
    });

    it('returns only artifacts of the requested type for the repo', async () => {
      const doc1 = makeArtifact(repoId, {
        artifactId: 'doc/module-a',
        artifactType: 'doc',
        content: { kind: 'doc', module: 'overview', markdown: 'Hello' },
      });
      const doc2 = makeArtifact(repoId, {
        artifactId: 'doc/module-b',
        artifactType: 'doc',
        content: { kind: 'doc', module: 'overview', markdown: 'World' },
      });
      const diagram = makeArtifact(repoId, {
        artifactId: 'diagram/arch',
        artifactType: 'diagram',
        content: { kind: 'diagram', diagramType: 'architecture', mermaid: 'graph TD' },
      });

      await adapter.upsertArtifact(doc1);
      await adapter.upsertArtifact(doc2);
      await adapter.upsertArtifact(diagram);

      const docs = await adapter.getArtifactsByType(repoId, 'doc');
      expect(docs).toHaveLength(2);
      const ids = docs.map(a => a.artifactId).sort();
      expect(ids).toEqual(['doc/module-a', 'doc/module-b']);

      const diagrams = await adapter.getArtifactsByType(repoId, 'diagram');
      expect(diagrams).toHaveLength(1);
      expect(diagrams[0].artifactId).toBe('diagram/arch');
    });

    it('returns empty array when no artifacts of that type exist', async () => {
      const doc = makeArtifact(repoId, {
        artifactId: 'doc/only',
        artifactType: 'doc',
        content: { kind: 'doc', module: 'overview', markdown: 'Hello' },
      });
      await adapter.upsertArtifact(doc);

      const result = await adapter.getArtifactsByType(repoId, 'diagram');
      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // markArtifactsStale tests
  // -------------------------------------------------------------------------

  describe('markArtifactsStale', () => {
    let repoId: string;

    beforeEach(async () => {
      const repo = makeRepo();
      repoId = repo.repoId;
      await adapter.upsertRepo(repo);
    });

    it('marks specified artifacts as stale with the given reason', async () => {
      const a1 = makeArtifact(repoId, { artifactId: 'doc/a1', isStale: false });
      const a2 = makeArtifact(repoId, { artifactId: 'doc/a2', isStale: false });
      const a3 = makeArtifact(repoId, { artifactId: 'doc/a3', isStale: false });
      await adapter.upsertArtifact(a1);
      await adapter.upsertArtifact(a2);
      await adapter.upsertArtifact(a3);

      await adapter.markArtifactsStale(repoId, ['doc/a1', 'doc/a3'], 'file_changed');

      const r1 = await adapter.getArtifact('doc/a1', repoId);
      expect(r1!.isStale).toBe(true);
      expect(r1!.staleReason).toBe('file_changed');

      const r2 = await adapter.getArtifact('doc/a2', repoId);
      expect(r2!.isStale).toBe(false);
      expect(r2!.staleReason).toBeNull();

      const r3 = await adapter.getArtifact('doc/a3', repoId);
      expect(r3!.isStale).toBe(true);
      expect(r3!.staleReason).toBe('file_changed');
    });

    it('is a no-op when artifactIds is empty', async () => {
      const a1 = makeArtifact(repoId, { artifactId: 'doc/fresh', isStale: false });
      await adapter.upsertArtifact(a1);

      await adapter.markArtifactsStale(repoId, [], 'file_changed');

      const result = await adapter.getArtifact('doc/fresh', repoId);
      expect(result!.isStale).toBe(false);
      expect(result!.staleReason).toBeNull();
    });

    it('does not affect artifacts of other repos', async () => {
      // Second repo
      const otherRepo = makeRepo();
      await adapter.upsertRepo(otherRepo);

      const myArtifact = makeArtifact(repoId, { artifactId: 'doc/mine', isStale: false });
      const otherArtifact = makeArtifact(otherRepo.repoId, {
        artifactId: 'doc/mine', // same artifactId to maximize potential for collision
        isStale: false,
      });

      await adapter.upsertArtifact(myArtifact);
      await adapter.upsertArtifact(otherArtifact);

      // Mark stale only for repoId
      await adapter.markArtifactsStale(repoId, ['doc/mine'], 'prompt_updated');

      // Own artifact is stale
      const ownResult = await adapter.getArtifact('doc/mine', repoId);
      expect(ownResult!.isStale).toBe(true);
      expect(ownResult!.staleReason).toBe('prompt_updated');

      // Other repo's artifact is untouched
      const otherResult = await adapter.getArtifact('doc/mine', otherRepo.repoId);
      expect(otherResult!.isStale).toBe(false);
      expect(otherResult!.staleReason).toBeNull();
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

  // -------------------------------------------------------------------------
  // getTokenUsageStats tests
  // -------------------------------------------------------------------------

  describe('getTokenUsageStats', () => {
    const costMap = {
      'claude-sonnet-4-20250514': 3.0,
      'text-embedding-3-small': 0.02,
      default: 3.0,
    };

    beforeEach(async () => {
      await trx('ci_qna_messages').del();
      await trx('ci_qna_sessions').del();
      await trx('ci_artifacts').del();
      await trx('ci_repositories').del();
    });

    it('returns empty stats when no data exists', async () => {
      const stats = await adapter.getTokenUsageStats('all', costMap);
      expect(stats.timeRange).toBe('all');
      expect(stats.totalTokens).toBe(0);
      expect(stats.totalEstimatedCost).toBe(0);
      expect(stats.byRepo).toEqual([]);
      expect(stats.byModel).toEqual([]);
    });

    it('aggregates ingestion tokens by repo from ci_artifacts', async () => {
      const repo = makeRepo({ name: 'my-repo' });
      await adapter.upsertRepo(repo);

      // Insert 2 artifacts with llm_used = true
      await trx('ci_artifacts').insert({
        repo_id: repo.repoId,
        artifact_id: 'doc/a',
        artifact_type: 'doc',
        content: JSON.stringify({ kind: 'doc', module: 'overview', markdown: 'Hello' }),
        input_sha: 'sha1',
        tokens_used: 500,
        llm_used: true,
        is_stale: false,
        generation_sig: 'claude-sonnet-4-20250514:v1',
        generated_at: new Date(),
      });
      await trx('ci_artifacts').insert({
        repo_id: repo.repoId,
        artifact_id: 'doc/b',
        artifact_type: 'doc',
        content: JSON.stringify({ kind: 'doc', module: 'overview', markdown: 'World' }),
        input_sha: 'sha2',
        tokens_used: 300,
        llm_used: true,
        is_stale: false,
        generation_sig: 'claude-sonnet-4-20250514:v1',
        generated_at: new Date(),
      });

      const stats = await adapter.getTokenUsageStats('all', costMap);
      expect(stats.byRepo).toHaveLength(1);
      expect(stats.byRepo[0].repoId).toBe(repo.repoId);
      expect(stats.byRepo[0].repoName).toBe('my-repo');
      expect(stats.byRepo[0].ingestionTokens).toBe(800);
      expect(stats.byRepo[0].totalTokens).toBe(800);
    });

    it('aggregates QnA tokens from ci_qna_messages', async () => {
      const repo = makeRepo({ name: 'qna-repo' });
      await adapter.upsertRepo(repo);

      const sessionId = randomUUID();
      await trx('ci_qna_sessions').insert({
        session_id: sessionId,
        repo_id: repo.repoId,
        active_context: JSON.stringify({ mentionedFiles: [], mentionedSymbols: [] }),
        created_at: new Date(),
        last_active: new Date(),
      });

      await trx('ci_qna_messages').insert({
        message_id: randomUUID(),
        session_id: sessionId,
        role: 'user',
        content: 'What does this do?',
        tokens_used: 100,
        created_at: new Date(),
      });
      await trx('ci_qna_messages').insert({
        message_id: randomUUID(),
        session_id: sessionId,
        role: 'assistant',
        content: 'It does X.',
        tokens_used: 200,
        created_at: new Date(),
      });

      const stats = await adapter.getTokenUsageStats('all', costMap);
      expect(stats.byRepo).toHaveLength(1);
      expect(stats.byRepo[0].qnaTokens).toBe(300);
    });

    it('breaks down tokens by model from generation_sig', async () => {
      const repo = makeRepo();
      await adapter.upsertRepo(repo);

      await trx('ci_artifacts').insert({
        repo_id: repo.repoId,
        artifact_id: 'doc/sonnet',
        artifact_type: 'doc',
        content: JSON.stringify({ kind: 'doc', module: 'overview', markdown: 'A' }),
        input_sha: 'sha1',
        tokens_used: 1000,
        llm_used: true,
        is_stale: false,
        generation_sig: 'claude-sonnet-4-20250514:v1',
        generated_at: new Date(),
      });
      await trx('ci_artifacts').insert({
        repo_id: repo.repoId,
        artifact_id: 'doc/embed',
        artifact_type: 'doc',
        content: JSON.stringify({ kind: 'doc', module: 'overview', markdown: 'B' }),
        input_sha: 'sha2',
        tokens_used: 500,
        llm_used: true,
        is_stale: false,
        generation_sig: 'text-embedding-3-small:v1',
        generated_at: new Date(),
      });

      const stats = await adapter.getTokenUsageStats('all', costMap);
      expect(stats.byModel.length).toBeGreaterThanOrEqual(2);

      const sonnetModel = stats.byModel.find(m => m.model === 'claude-sonnet-4-20250514');
      expect(sonnetModel).toBeDefined();
      expect(sonnetModel!.tokens).toBe(1000);

      const embedModel = stats.byModel.find(m => m.model === 'text-embedding-3-small');
      expect(embedModel).toBeDefined();
      expect(embedModel!.tokens).toBe(500);
    });

    it('filters by time range', async () => {
      const repo = makeRepo();
      await adapter.upsertRepo(repo);

      const now = new Date();
      const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

      // Old artifact (40 days ago)
      await trx('ci_artifacts').insert({
        repo_id: repo.repoId,
        artifact_id: 'doc/old',
        artifact_type: 'doc',
        content: JSON.stringify({ kind: 'doc', module: 'overview', markdown: 'Old' }),
        input_sha: 'sha-old',
        tokens_used: 1000,
        llm_used: true,
        is_stale: false,
        generation_sig: 'claude-sonnet-4-20250514:v1',
        generated_at: daysAgo(40),
      });
      // Recent artifact (2 days ago)
      await trx('ci_artifacts').insert({
        repo_id: repo.repoId,
        artifact_id: 'doc/new',
        artifact_type: 'doc',
        content: JSON.stringify({ kind: 'doc', module: 'overview', markdown: 'New' }),
        input_sha: 'sha-new',
        tokens_used: 500,
        llm_used: true,
        is_stale: false,
        generation_sig: 'claude-sonnet-4-20250514:v1',
        generated_at: daysAgo(2),
      });

      const stats7d = await adapter.getTokenUsageStats('7d', costMap);
      expect(stats7d.byRepo).toHaveLength(1);
      expect(stats7d.byRepo[0].ingestionTokens).toBe(500);

      const stats30d = await adapter.getTokenUsageStats('30d', costMap);
      expect(stats30d.byRepo).toHaveLength(1);
      expect(stats30d.byRepo[0].ingestionTokens).toBe(500);

      const statsAll = await adapter.getTokenUsageStats('all', costMap);
      expect(statsAll.byRepo).toHaveLength(1);
      expect(statsAll.byRepo[0].ingestionTokens).toBe(1500);
    });

    it('computes cost using the cost map', async () => {
      const repo = makeRepo();
      await adapter.upsertRepo(repo);

      // Insert 1M tokens with claude-sonnet model
      await trx('ci_artifacts').insert({
        repo_id: repo.repoId,
        artifact_id: 'doc/expensive',
        artifact_type: 'doc',
        content: JSON.stringify({ kind: 'doc', module: 'overview', markdown: 'Big' }),
        input_sha: 'sha-big',
        tokens_used: 1_000_000,
        llm_used: true,
        is_stale: false,
        generation_sig: 'claude-sonnet-4-20250514:v1',
        generated_at: new Date(),
      });

      const stats = await adapter.getTokenUsageStats('all', costMap);

      const sonnetModel = stats.byModel.find(m => m.model === 'claude-sonnet-4-20250514');
      expect(sonnetModel).toBeDefined();
      expect(sonnetModel!.estimatedCost).toBeCloseTo(3.0, 2);
    });
  });
});
