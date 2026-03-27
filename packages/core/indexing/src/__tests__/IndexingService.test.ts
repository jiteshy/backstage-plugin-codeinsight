import { createHash } from 'crypto';

import type { EmbeddingClient, StorageAdapter, VectorChunk, VectorStore } from '@codeinsight/types';

import { IndexingService, computeContentSha } from '../IndexingService';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

// ---------------------------------------------------------------------------
// Minimal StorageAdapter stub — returns empty CIG + no artifacts
// ---------------------------------------------------------------------------

function makeStorage(overrides: Partial<StorageAdapter> = {}): StorageAdapter {
  return {
    getCIGNodes: jest.fn().mockResolvedValue([]),
    getCIGEdges: jest.fn().mockResolvedValue([]),
    getRepoFiles: jest.fn().mockResolvedValue([]),
    getArtifactsByType: jest.fn().mockResolvedValue([]),
    getArtifactInputs: jest.fn().mockResolvedValue([]),
    getRepo: jest.fn().mockResolvedValue(null),
    upsertRepo: jest.fn().mockResolvedValue(undefined),
    updateRepoStatus: jest.fn().mockResolvedValue(undefined),
    upsertRepoFiles: jest.fn().mockResolvedValue(undefined),
    getChangedRepoFiles: jest.fn().mockResolvedValue([]),
    deleteRepoFilesNotIn: jest.fn().mockResolvedValue(undefined),
    upsertCIGNodes: jest.fn().mockResolvedValue(undefined),
    upsertCIGEdges: jest.fn().mockResolvedValue(undefined),
    deleteCIGForFiles: jest.fn().mockResolvedValue(undefined),
    upsertArtifact: jest.fn().mockResolvedValue(undefined),
    getArtifact: jest.fn().mockResolvedValue(null),
    getStaleArtifacts: jest.fn().mockResolvedValue([]),
    markArtifactsStale: jest.fn().mockResolvedValue(undefined),
    upsertArtifactInputs: jest.fn().mockResolvedValue(undefined),
    getArtifactIdsByFilePaths: jest.fn().mockResolvedValue([]),
    getArtifactDependents: jest.fn().mockResolvedValue([]),
    createJob: jest.fn().mockResolvedValue('job-1'),
    updateJob: jest.fn().mockResolvedValue(undefined),
    getJob: jest.fn().mockResolvedValue(null),
    getActiveJobForRepo: jest.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as StorageAdapter;
}

function makeEmbeddingClient(dim = 3): EmbeddingClient {
  return {
    embed: jest.fn().mockImplementation(async (texts: string[]) =>
      texts.map(() => Array(dim).fill(0.1)),
    ),
  };
}

function makeVectorStore(
  existingChunks: Array<{ chunkId: string; contentSha: string }> = [],
): VectorStore & { upsertCalls: VectorChunk[][]; deleteCalls: string[][] } {
  const upsertCalls: VectorChunk[][] = [];
  const deleteCalls: string[][] = [];
  return {
    upsertCalls,
    deleteCalls,
    listChunks: jest.fn().mockResolvedValue(existingChunks),
    upsert: jest.fn().mockImplementation(async (chunks: VectorChunk[]) => {
      upsertCalls.push(chunks);
    }),
    deleteChunks: jest.fn().mockImplementation(async (_repoId: string, ids: string[]) => {
      deleteCalls.push(ids);
    }),
    search: jest.fn().mockResolvedValue([]),
    searchKeyword: jest.fn().mockResolvedValue([]),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('computeContentSha', () => {
  it('returns stable SHA-256 hex string', () => {
    const result = computeContentSha('hello world');
    expect(result).toBe(sha('hello world'));
    expect(result).toHaveLength(64);
  });

  it('is deterministic', () => {
    expect(computeContentSha('foo')).toBe(computeContentSha('foo'));
  });

  it('differs for different inputs', () => {
    expect(computeContentSha('foo')).not.toBe(computeContentSha('bar'));
  });
});

describe('IndexingService', () => {
  const REPO_ID = 'repo-123';
  const CLONE_DIR = '/tmp/repo-123';

  it('indexes an empty repo with zero embed calls and upserts', async () => {
    const storage = makeStorage();
    const embeddingClient = makeEmbeddingClient();
    const vectorStore = makeVectorStore();

    const service = new IndexingService(embeddingClient, vectorStore, storage);
    const result = await service.indexRepo(REPO_ID, CLONE_DIR);

    expect(result.chunksTotal).toBe(0);
    expect(result.chunksIndexed).toBe(0);
    expect(result.chunksSkipped).toBe(0);
    expect(result.chunksDeleted).toBe(0);
    expect(embeddingClient.embed).not.toHaveBeenCalled();
    expect(vectorStore.upsert).not.toHaveBeenCalled();
  });

  it('indexes a fresh repo with no prior chunks', async () => {
    // Two doc artifacts → two doc chunks
    const docArtifact = {
      repoId: REPO_ID,
      artifactId: 'core/overview',
      artifactType: 'doc',
      content: { kind: 'doc', module: 'overview', markdown: 'Hello world' },
      inputSha: sha('Hello world'),
      promptVersion: null,
      isStale: false,
      staleReason: null,
      tokensUsed: 0,
      llmUsed: false,
      generatedAt: new Date(),
    };

    const storage = makeStorage({
      getArtifactsByType: jest.fn().mockImplementation(async (_repoId: string, type: string) => {
        if (type === 'doc') return [docArtifact];
        return [];
      }),
    });

    const embeddingClient = makeEmbeddingClient();
    const vectorStore = makeVectorStore(); // no prior chunks

    const service = new IndexingService(embeddingClient, vectorStore, storage);
    const result = await service.indexRepo(REPO_ID, CLONE_DIR);

    expect(result.chunksTotal).toBe(1);
    expect(result.chunksIndexed).toBe(1);
    expect(result.chunksSkipped).toBe(0);
    expect(result.chunksDeleted).toBe(0);
    expect(embeddingClient.embed).toHaveBeenCalledTimes(1);
    expect(vectorStore.upsert).toHaveBeenCalledTimes(1);

    const upserted = vectorStore.upsertCalls[0];
    expect(upserted).toHaveLength(1);
    expect(upserted[0].chunkId).toContain(REPO_ID);
    expect(upserted[0].contentSha).toBe(computeContentSha('Hello world'));
    expect(upserted[0].embedding).toHaveLength(3);
  });

  it('skips chunks whose contentSha is unchanged (delta)', async () => {
    const content = 'Some stable content';
    const chunkId = `${REPO_ID}:core/overview:overview:doc`;
    const existingContentSha = computeContentSha(content);

    const docArtifact = {
      repoId: REPO_ID,
      artifactId: 'core/overview',
      artifactType: 'doc',
      content: { kind: 'doc', module: 'overview', markdown: content },
      inputSha: existingContentSha,
      promptVersion: null,
      isStale: false,
      staleReason: null,
      tokensUsed: 0,
      llmUsed: false,
      generatedAt: new Date(),
    };

    const storage = makeStorage({
      getArtifactsByType: jest.fn().mockImplementation(async (_repoId: string, type: string) => {
        if (type === 'doc') return [docArtifact];
        return [];
      }),
    });

    const embeddingClient = makeEmbeddingClient();
    // Vector store already has this chunk with matching contentSha
    const vectorStore = makeVectorStore([{ chunkId, contentSha: existingContentSha }]);

    const service = new IndexingService(embeddingClient, vectorStore, storage);
    const result = await service.indexRepo(REPO_ID, CLONE_DIR);

    expect(result.chunksTotal).toBe(1);
    expect(result.chunksIndexed).toBe(0);
    expect(result.chunksSkipped).toBe(1);
    expect(embeddingClient.embed).not.toHaveBeenCalled();
    expect(vectorStore.upsert).not.toHaveBeenCalled();
  });

  it('re-embeds a chunk when its contentSha changes', async () => {
    const oldContent = 'Old content';
    const newContent = 'New content (updated)';
    const chunkId = `${REPO_ID}:core/overview:overview:doc`;

    const docArtifact = {
      repoId: REPO_ID,
      artifactId: 'core/overview',
      artifactType: 'doc',
      content: { kind: 'doc', module: 'overview', markdown: newContent },
      inputSha: computeContentSha(newContent),
      promptVersion: null,
      isStale: false,
      staleReason: null,
      tokensUsed: 0,
      llmUsed: false,
      generatedAt: new Date(),
    };

    const storage = makeStorage({
      getArtifactsByType: jest.fn().mockImplementation(async (_repoId: string, type: string) => {
        if (type === 'doc') return [docArtifact];
        return [];
      }),
    });

    const embeddingClient = makeEmbeddingClient();
    // Vector store has the OLD contentSha
    const vectorStore = makeVectorStore([
      { chunkId, contentSha: computeContentSha(oldContent) },
    ]);

    const service = new IndexingService(embeddingClient, vectorStore, storage);
    const result = await service.indexRepo(REPO_ID, CLONE_DIR);

    expect(result.chunksIndexed).toBe(1);
    expect(embeddingClient.embed).toHaveBeenCalledTimes(1);
    expect(vectorStore.upsert).toHaveBeenCalledTimes(1);
    expect(vectorStore.upsertCalls[0][0].contentSha).toBe(
      computeContentSha(newContent),
    );
  });

  it('deletes stale chunks no longer present in source', async () => {
    const staleChunkId = `${REPO_ID}:old/file.ts:oldFn:code`;

    const storage = makeStorage(); // produces no chunks
    const embeddingClient = makeEmbeddingClient();
    // Vector store has a chunk that ChunkingService no longer produces
    const vectorStore = makeVectorStore([
      { chunkId: staleChunkId, contentSha: 'abc123' },
    ]);

    const service = new IndexingService(embeddingClient, vectorStore, storage);
    const result = await service.indexRepo(REPO_ID, CLONE_DIR);

    expect(result.chunksDeleted).toBe(1);
    expect(vectorStore.deleteChunks).toHaveBeenCalledWith(REPO_ID, [staleChunkId]);
    expect(embeddingClient.embed).not.toHaveBeenCalled();
  });

  it('handles split-chunk delta: old single chunk deleted, new sub-chunks indexed fresh', async () => {
    // Scenario: ChunkingService previously produced one chunk for a doc artifact
    // (chunkId = `${REPO_ID}:core/big-module:overview:doc`).
    // After the artifact markdown grew beyond maxChunkTokens, ChunkingService now
    // splits it into two sub-chunks: ':0' and ':1'.
    // The old un-suffixed entry must be deleted and both sub-chunks must be
    // embedded + upserted as new.
    //
    // We simulate this by having the vector store report the old chunk ID while
    // the storage mock returns an artifact whose markdown is large enough to
    // trigger splitting (> 1000 tokens ~ 4000 chars at 4 chars/token).

    const oldChunkId = `${REPO_ID}:core/big-module:overview:doc`;
    const subChunkId0 = `${REPO_ID}:core/big-module:overview:doc:0`;
    const subChunkId1 = `${REPO_ID}:core/big-module:overview:doc:1`;

    // Each paragraph is ~600 tokens (2400 chars). Two paragraphs = 1200 tokens > 1000 limit.
    const para1 = 'A'.repeat(2400);
    const para2 = 'B'.repeat(2400);
    const oversizedMarkdown = `${para1}\n\n${para2}`;

    const docArtifact = {
      repoId: REPO_ID,
      artifactId: 'core/big-module',
      artifactType: 'doc',
      content: { kind: 'doc', module: 'overview', markdown: oversizedMarkdown },
      inputSha: computeContentSha(oversizedMarkdown),
      promptVersion: null,
      isStale: false,
      staleReason: null,
      tokensUsed: 0,
      llmUsed: false,
      generatedAt: new Date(),
    };

    const storage = makeStorage({
      getArtifactsByType: jest.fn().mockImplementation(async (_repoId: string, type: string) => {
        if (type === 'doc') return [docArtifact];
        return [];
      }),
    });

    const embeddingClient = makeEmbeddingClient();
    // Vector store has the OLD un-suffixed chunk ID (pre-split state)
    const vectorStore = makeVectorStore([
      { chunkId: oldChunkId, contentSha: 'stale-sha-from-before-split' },
    ]);

    const service = new IndexingService(embeddingClient, vectorStore, storage);
    const result = await service.indexRepo(REPO_ID, CLONE_DIR);

    // ChunkingService splits the oversized artifact into 2 sub-chunks
    expect(result.chunksTotal).toBe(2);

    // Both sub-chunks are new (not in the existing map) → both indexed
    expect(result.chunksIndexed).toBe(2);
    expect(result.chunksSkipped).toBe(0);

    // The old un-suffixed chunk ID is no longer produced → deleted
    expect(result.chunksDeleted).toBe(1);
    expect(vectorStore.deleteChunks).toHaveBeenCalledWith(REPO_ID, [oldChunkId]);

    // Both sub-chunk IDs appear in the upserted output
    const allUpserted = vectorStore.upsertCalls.flat();
    const upsertedIds = allUpserted.map(c => c.chunkId);
    expect(upsertedIds).toContain(subChunkId0);
    expect(upsertedIds).toContain(subChunkId1);

    // Embeddings were requested for both sub-chunks in one batch
    expect(embeddingClient.embed).toHaveBeenCalledTimes(1);
    const [embeddedTexts] = (embeddingClient.embed as jest.Mock).mock.calls[0];
    expect(embeddedTexts).toHaveLength(2);
  });

  it('batches embed calls at 100 chunks per batch', async () => {
    // Create 250 distinct doc artifacts
    const artifacts = Array.from({ length: 250 }, (_, i) => ({
      repoId: REPO_ID,
      artifactId: `core/section-${i}`,
      artifactType: 'doc',
      content: { kind: 'doc', module: `section-${i}`, markdown: `Content for section ${i}` },
      inputSha: computeContentSha(`Content for section ${i}`),
      promptVersion: null,
      isStale: false,
      staleReason: null,
      tokensUsed: 0,
      llmUsed: false,
      generatedAt: new Date(),
    }));

    const storage = makeStorage({
      getArtifactsByType: jest.fn().mockImplementation(async (_repoId: string, type: string) => {
        if (type === 'doc') return artifacts;
        return [];
      }),
    });

    const embeddingClient = makeEmbeddingClient();
    const vectorStore = makeVectorStore(); // fresh — no prior chunks

    const service = new IndexingService(embeddingClient, vectorStore, storage);
    const result = await service.indexRepo(REPO_ID, CLONE_DIR);

    expect(result.chunksTotal).toBe(250);
    expect(result.chunksIndexed).toBe(250);
    // Expect 3 embed calls: 100 + 100 + 50
    expect(embeddingClient.embed).toHaveBeenCalledTimes(3);
    expect(vectorStore.upsert).toHaveBeenCalledTimes(3);
  });
});
