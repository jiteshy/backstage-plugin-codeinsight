import type { VectorChunk } from '@codeinsight/types';

import { PgVectorStore } from '../PgVectorStore';

// ---------------------------------------------------------------------------
// Knex mock builder
// ---------------------------------------------------------------------------

function makeKnex() {
  // Chainable mock that records calls
  const insertResult = { onConflict: jest.fn() };
  insertResult.onConflict.mockReturnValue({ merge: jest.fn().mockResolvedValue(undefined) });

  const deleteResult = { delete: jest.fn().mockResolvedValue(undefined) };
  const whereInResult = { ...deleteResult };
  const whereResult = {
    whereIn: jest.fn().mockReturnValue(whereInResult),
    select: jest.fn().mockResolvedValue([]),
    orderByRaw: jest.fn(),
    limit: jest.fn(),
    whereRaw: jest.fn(),
  };
  whereResult.orderByRaw.mockReturnValue({
    limit: jest.fn().mockResolvedValue([]),
    whereIn: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }),
    whereRaw: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }),
  });

  const tableResult = {
    where: jest.fn().mockReturnValue(whereResult),
    insert: jest.fn().mockReturnValue(insertResult),
  };

  const knex = jest.fn().mockReturnValue(tableResult);
  return { knex, tableResult, whereResult, whereInResult, insertResult };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeChunk(overrides: Partial<VectorChunk> = {}): VectorChunk {
  return {
    chunkId: 'repo-1:src/foo.ts:myFn:code',
    repoId: 'repo-1',
    content: 'function myFn() {}',
    contentSha: 'abc123',
    embedding: [0.1, 0.2, 0.3],
    layer: 'code',
    metadata: { filePath: 'src/foo.ts', symbol: 'myFn' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// upsert()
// ---------------------------------------------------------------------------

describe('PgVectorStore.upsert', () => {
  it('is a no-op for empty array', async () => {
    const { knex } = makeKnex();
    const store = new PgVectorStore(knex as never);
    await store.upsert([]);
    expect(knex).not.toHaveBeenCalled();
  });

  it('inserts a row with correct shape', async () => {
    const { knex, tableResult, insertResult } = makeKnex();
    const store = new PgVectorStore(knex as never);

    const chunk = makeChunk();
    await store.upsert([chunk]);

    expect(knex).toHaveBeenCalledWith('ci_qna_embeddings');
    const rows = tableResult.insert.mock.calls[0][0];
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.repo_id).toBe('repo-1');
    expect(row.chunk_id).toBe('repo-1:src/foo.ts:myFn:code');
    expect(row.content).toBe('function myFn() {}');
    expect(row.content_sha).toBe('abc123');
    expect(row.layer).toBe('code');
    expect(row.embedding).toBe('[0.1,0.2,0.3]');
    // metadata must NOT be JSON.stringify'd (pg driver handles objects)
    expect(row.metadata).toEqual({ filePath: 'src/foo.ts', symbol: 'myFn' });
    expect(typeof row.metadata).not.toBe('string');
    expect(insertResult.onConflict).toHaveBeenCalledWith(['repo_id', 'chunk_id']);
  });

  it('sets metadata to null when chunk has no metadata', async () => {
    const { knex, tableResult } = makeKnex();
    const store = new PgVectorStore(knex as never);

    await store.upsert([makeChunk({ metadata: undefined })]);

    const rows = tableResult.insert.mock.calls[0][0];
    expect(rows[0].metadata).toBeNull();
  });

  it('batches 60 chunks into 2 inserts of 50', async () => {
    const { knex } = makeKnex();
    const store = new PgVectorStore(knex as never);
    const chunks = Array.from({ length: 60 }, (_, i) => makeChunk({ chunkId: `id-${i}` }));
    await store.upsert(chunks);
    // Called twice: first table lookup for batch 1, second for batch 2
    expect(knex).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// listChunks()
// ---------------------------------------------------------------------------

describe('PgVectorStore.listChunks', () => {
  it('returns empty array when no rows exist', async () => {
    const { knex } = makeKnex();
    const store = new PgVectorStore(knex as never);
    const result = await store.listChunks('repo-1');
    expect(result).toEqual([]);
  });

  it('maps DB rows to { chunkId, contentSha }', async () => {
    const { knex, tableResult, whereResult } = makeKnex();
    whereResult.select = jest.fn().mockResolvedValue([
      { chunk_id: 'chunk-a', content_sha: 'sha-a' },
      { chunk_id: 'chunk-b', content_sha: 'sha-b' },
    ]);
    const store = new PgVectorStore(knex as never);
    const result = await store.listChunks('repo-1');

    expect(tableResult.where).toHaveBeenCalledWith('repo_id', 'repo-1');
    expect(result).toEqual([
      { chunkId: 'chunk-a', contentSha: 'sha-a' },
      { chunkId: 'chunk-b', contentSha: 'sha-b' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// deleteChunks()
// ---------------------------------------------------------------------------

describe('PgVectorStore.deleteChunks', () => {
  it('is a no-op for empty array', async () => {
    const { knex } = makeKnex();
    const store = new PgVectorStore(knex as never);
    await store.deleteChunks('repo-1', []);
    expect(knex).not.toHaveBeenCalled();
  });

  it('deletes the specified chunk IDs', async () => {
    const { knex, tableResult, whereResult, whereInResult } = makeKnex();
    const store = new PgVectorStore(knex as never);
    await store.deleteChunks('repo-1', ['chunk-a', 'chunk-b']);

    expect(knex).toHaveBeenCalledWith('ci_qna_embeddings');
    expect(tableResult.where).toHaveBeenCalledWith('repo_id', 'repo-1');
    expect(whereResult.whereIn).toHaveBeenCalledWith('chunk_id', ['chunk-a', 'chunk-b']);
    expect(whereInResult.delete).toHaveBeenCalled();
  });

  it('splits 600 IDs into 2 delete batches of 500', async () => {
    const { knex } = makeKnex();
    const store = new PgVectorStore(knex as never);
    const ids = Array.from({ length: 600 }, (_, i) => `chunk-${i}`);
    await store.deleteChunks('repo-1', ids);
    // 2 batches: first 500, then 100
    expect(knex).toHaveBeenCalledTimes(2);
  });
});
