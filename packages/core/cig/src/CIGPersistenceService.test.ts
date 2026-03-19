import type { CIGEdge, CIGNode, Logger, StorageAdapter } from '@codeinsight/types';

import { CIGPersistenceService } from './CIGPersistenceService';
import type { CIGBuildResult } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(overrides: Partial<CIGNode> = {}): CIGNode {
  return {
    nodeId: 'repo-1:src/index.ts:main:function',
    repoId: 'repo-1',
    filePath: 'src/index.ts',
    symbolName: 'main',
    symbolType: 'function',
    startLine: 1,
    endLine: 10,
    exported: true,
    extractedSha: 'sha-abc',
    metadata: null,
    ...overrides,
  };
}

function makeEdge(overrides: Partial<CIGEdge> = {}): CIGEdge {
  return {
    edgeId: 'repo-1:src/a.ts:<module>:variable->imports->repo-1:src/b.ts:<module>:variable',
    repoId: 'repo-1',
    fromNodeId: 'repo-1:src/a.ts:<module>:variable',
    toNodeId: 'repo-1:src/b.ts:<module>:variable',
    edgeType: 'imports',
    ...overrides,
  };
}

function makeResult(overrides: Partial<CIGBuildResult> = {}): CIGBuildResult {
  return {
    nodes: [makeNode()],
    edges: [makeEdge()],
    filesProcessed: 1,
    filesSkipped: 0,
    errors: [],
    ...overrides,
  };
}

function createMockStorage(): jest.Mocked<StorageAdapter> {
  return {
    getRepo: jest.fn().mockResolvedValue(undefined),
    upsertRepo: jest.fn().mockResolvedValue(undefined),
    updateRepoStatus: jest.fn().mockResolvedValue(undefined),
    upsertRepoFiles: jest.fn().mockResolvedValue(undefined),
    getRepoFiles: jest.fn().mockResolvedValue(undefined),
    getChangedRepoFiles: jest.fn().mockResolvedValue(undefined),
    upsertCIGNodes: jest.fn().mockResolvedValue(undefined),
    upsertCIGEdges: jest.fn().mockResolvedValue(undefined),
    deleteCIGForFiles: jest.fn().mockResolvedValue(undefined),
    getCIGNodes: jest.fn().mockResolvedValue(undefined),
    getCIGEdges: jest.fn().mockResolvedValue(undefined),
    deleteRepoFilesNotIn: jest.fn().mockResolvedValue(undefined),
    upsertArtifact: jest.fn().mockResolvedValue(undefined),
    getArtifact: jest.fn().mockResolvedValue(undefined),
    getArtifactsByType: jest.fn().mockResolvedValue([]),
    getStaleArtifacts: jest.fn().mockResolvedValue([]),
    markArtifactsStale: jest.fn().mockResolvedValue(undefined),
    upsertArtifactInputs: jest.fn().mockResolvedValue(undefined),
    getArtifactInputs: jest.fn().mockResolvedValue([]),
    createJob: jest.fn().mockResolvedValue(undefined),
    updateJob: jest.fn().mockResolvedValue(undefined),
    getJob: jest.fn().mockResolvedValue(undefined),
    getActiveJobForRepo: jest.fn().mockResolvedValue(undefined),
  } as jest.Mocked<StorageAdapter>;
}

function createMockLogger(): jest.Mocked<Logger> {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CIGPersistenceService', () => {
  let storage: jest.Mocked<StorageAdapter>;
  let logger: jest.Mocked<Logger>;
  let service: CIGPersistenceService;

  beforeEach(() => {
    storage = createMockStorage();
    logger = createMockLogger();
    service = new CIGPersistenceService(storage, logger);
  });

  // -------------------------------------------------------------------------
  // Full run
  // -------------------------------------------------------------------------

  describe('full run (no changedFiles)', () => {
    it('upserts all nodes and edges', async () => {
      const nodes = [
        makeNode({ nodeId: 'repo-1:src/a.ts:foo:function', filePath: 'src/a.ts', symbolName: 'foo' }),
        makeNode({ nodeId: 'repo-1:src/b.ts:bar:function', filePath: 'src/b.ts', symbolName: 'bar' }),
      ];
      const edges = [makeEdge()];
      const result = makeResult({ nodes, edges });

      const stats = await service.persist('repo-1', result);

      expect(storage.upsertCIGNodes).toHaveBeenCalledWith(nodes);
      expect(storage.upsertCIGEdges).toHaveBeenCalledWith(edges);
      expect(storage.deleteCIGForFiles).not.toHaveBeenCalled();
      expect(stats).toEqual({ nodesAttempted: 2, edgesAttempted: 1 });
    });

    it('does not call deleteCIGForFiles on full run', async () => {
      await service.persist('repo-1', makeResult());

      expect(storage.deleteCIGForFiles).not.toHaveBeenCalled();
    });

    it('skips upsertCIGNodes when no nodes', async () => {
      await service.persist('repo-1', makeResult({ nodes: [] }));

      expect(storage.upsertCIGNodes).not.toHaveBeenCalled();
    });

    it('skips upsertCIGEdges when no edges', async () => {
      await service.persist('repo-1', makeResult({ edges: [] }));

      expect(storage.upsertCIGEdges).not.toHaveBeenCalled();
    });

    it('handles empty result', async () => {
      const stats = await service.persist('repo-1', makeResult({ nodes: [], edges: [] }));

      expect(storage.upsertCIGNodes).not.toHaveBeenCalled();
      expect(storage.upsertCIGEdges).not.toHaveBeenCalled();
      expect(stats).toEqual({ nodesAttempted: 0, edgesAttempted: 0 });
    });

    it('returns correct counts', async () => {
      const nodes = Array.from({ length: 5 }, (_, i) =>
        makeNode({ nodeId: `repo-1:src/${i}.ts:fn:function`, symbolName: `fn${i}` }),
      );
      const edges = Array.from({ length: 3 }, (_, i) =>
        makeEdge({ edgeId: `edge-${i}` }),
      );

      const stats = await service.persist('repo-1', makeResult({ nodes, edges }));

      expect(stats).toEqual({ nodesAttempted: 5, edgesAttempted: 3 });
    });
  });

  // -------------------------------------------------------------------------
  // Delta run
  // -------------------------------------------------------------------------

  describe('delta run (with changedFiles)', () => {
    it('deletes CIG for changed files before upserting', async () => {
      const changedFiles = ['src/a.ts', 'src/b.ts'];
      const result = makeResult();

      await service.persist('repo-1', result, { changedFiles });

      // deleteCIGForFiles called BEFORE upserts
      const deleteOrder = storage.deleteCIGForFiles.mock.invocationCallOrder[0];
      const nodesOrder = storage.upsertCIGNodes.mock.invocationCallOrder[0];
      expect(deleteOrder).toBeLessThan(nodesOrder);

      expect(storage.deleteCIGForFiles).toHaveBeenCalledWith('repo-1', changedFiles);
      expect(storage.upsertCIGNodes).toHaveBeenCalledWith(result.nodes);
      expect(storage.upsertCIGEdges).toHaveBeenCalledWith(result.edges);
    });

    it('passes correct repoId and file paths to deleteCIGForFiles', async () => {
      const changedFiles = ['prisma/schema.prisma', 'src/models/user.ts'];

      await service.persist('repo-1', makeResult(), { changedFiles });

      expect(storage.deleteCIGForFiles).toHaveBeenCalledWith('repo-1', changedFiles);
    });

    it('does not delete when changedFiles is empty array', async () => {
      await service.persist('repo-1', makeResult(), { changedFiles: [] });

      expect(storage.deleteCIGForFiles).not.toHaveBeenCalled();
    });

    it('handles delta with no new nodes or edges', async () => {
      const changedFiles = ['src/deleted.ts'];
      const result = makeResult({ nodes: [], edges: [] });

      const stats = await service.persist('repo-1', result, { changedFiles });

      expect(storage.deleteCIGForFiles).toHaveBeenCalledWith('repo-1', changedFiles);
      expect(storage.upsertCIGNodes).not.toHaveBeenCalled();
      expect(storage.upsertCIGEdges).not.toHaveBeenCalled();
      expect(stats).toEqual({ nodesAttempted: 0, edgesAttempted: 0 });
    });
  });

  // -------------------------------------------------------------------------
  // Logging
  // -------------------------------------------------------------------------

  describe('logging', () => {
    it('logs on full run', async () => {
      await service.persist('repo-1', makeResult());

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('full run'),
      );
    });

    it('logs on delta run', async () => {
      await service.persist('repo-1', makeResult(), {
        changedFiles: ['src/a.ts'],
      });

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('delta'),
      );
    });

    it('works without a logger', async () => {
      const serviceNoLogger = new CIGPersistenceService(storage);

      await expect(
        serviceNoLogger.persist('repo-1', makeResult()),
      ).resolves.not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Error propagation
  // -------------------------------------------------------------------------

  describe('error propagation', () => {
    it('propagates storage errors from upsertCIGNodes', async () => {
      storage.upsertCIGNodes.mockRejectedValue(new Error('DB connection lost'));

      await expect(
        service.persist('repo-1', makeResult()),
      ).rejects.toThrow('DB connection lost');
    });

    it('propagates storage errors from upsertCIGEdges', async () => {
      storage.upsertCIGEdges.mockRejectedValue(new Error('FK violation'));

      await expect(
        service.persist('repo-1', makeResult()),
      ).rejects.toThrow('FK violation');
    });

    it('propagates storage errors from deleteCIGForFiles', async () => {
      storage.deleteCIGForFiles.mockRejectedValue(new Error('timeout'));

      await expect(
        service.persist('repo-1', makeResult(), { changedFiles: ['src/a.ts'] }),
      ).rejects.toThrow('timeout');
    });
  });
});
