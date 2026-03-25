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

  it('handles exactly 500 IDs in a single batch (boundary)', async () => {
    const { knex } = makeKnex();
    const store = new PgVectorStore(knex as never);
    const ids = Array.from({ length: 500 }, (_, i) => `chunk-${i}`);
    await store.deleteChunks('repo-1', ids);
    expect(knex).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// search()
//
// The knex query chain for search is:
//   knex('ci_qna_embeddings')
//     .where('repo_id', repoId)          ← whereResult
//     .select(...)                        ← whereResult.select (but select is chained via where)
//     .orderByRaw(...)                   ← whereResult.orderByRaw → orderByRawResult
//     [.whereIn('layer', layers)]        ← orderByRawResult.whereIn → withLayerResult
//     [.whereRaw('...', [filePaths])]    ← orderByRawResult.whereRaw → withPathResult
//     .limit(topK)                       ← resolves with rows
//
// The existing makeKnex() mock wires:
//   whereResult.orderByRaw → { limit, whereIn, whereRaw }
//   whereIn (on orderByRaw result) → { limit }
//   whereRaw (on orderByRaw result) → { limit }
// ---------------------------------------------------------------------------

describe('PgVectorStore.search', () => {
  const REPO = 'repo-1';
  const embedding = [0.1, 0.2, 0.3];

  // Build a knex mock whose search query chain terminates with the given rows.
  //
  // The real chain is:
  //   knex(table).where(...).select(...).orderByRaw(...)[.whereIn(...)][.whereRaw(...)].limit(N)
  //
  // In the base makeKnex(), whereResult.select resolves immediately (terminal mock).
  // For search tests we need select() to return a chainable object with orderByRaw,
  // so we override it here to return whereResult itself — all methods live on the
  // same builder object, consistent with how Knex's fluent API actually works.
  function makeSearchKnex(resolvedRows: object[] = []) {
    const { knex, tableResult, whereResult } = makeKnex();

    // Override select to be chainable (returns whereResult, not a Promise)
    whereResult.select = jest.fn().mockReturnValue(whereResult);

    // The source chain is:
    //   let query = knex(table).where(...).select(...).orderByRaw(...)
    //   if (layers)    query = query.whereIn(...)    ← called on orderByRawResult
    //   if (filePaths) query = query.whereRaw(...)   ← called on orderByRawResult
    //   const rows = await query.limit(topK)
    //       no filters  → orderByRawResult.limit()
    //       with filter → filterResult.limit()
    const filterResult = { limit: jest.fn().mockResolvedValue(resolvedRows) };
    const orderByRawResult = {
      limit: jest.fn().mockResolvedValue(resolvedRows),
      whereIn: jest.fn().mockReturnValue(filterResult),
      whereRaw: jest.fn().mockReturnValue(filterResult),
    };

    whereResult.orderByRaw = jest.fn().mockReturnValue(orderByRawResult);

    return { knex, tableResult, whereResult, orderByRawResult, filterResult };
  }

  it('queries with correct repo_id filter, selected columns, cosine ordering, and limit', async () => {
    const { knex, tableResult, whereResult, orderByRawResult } = makeSearchKnex();
    const store = new PgVectorStore(knex as never);

    await store.search(embedding, { repoId: REPO }, 5);

    expect(knex).toHaveBeenCalledWith('ci_qna_embeddings');
    expect(tableResult.where).toHaveBeenCalledWith('repo_id', REPO);
    expect(whereResult.select).toHaveBeenCalledWith(
      'repo_id', 'chunk_id', 'content', 'content_sha', 'layer', 'metadata',
    );
    expect(whereResult.orderByRaw).toHaveBeenCalledWith(
      'embedding <=> ?::vector',
      ['[0.1,0.2,0.3]'],
    );
    // limit() is the last step of the base chain before optional whereIn/whereRaw
    expect(orderByRawResult.limit).toHaveBeenCalledWith(5);
  });

  it('formats the embedding vector as a pgvector literal [x,y,z]', async () => {
    const { knex, whereResult } = makeSearchKnex();
    const store = new PgVectorStore(knex as never);

    await store.search([1.5, 0.0, 2.25], { repoId: REPO }, 3);

    expect(whereResult.orderByRaw).toHaveBeenCalledWith(
      'embedding <=> ?::vector',
      ['[1.5,0,2.25]'],
    );
  });

  it('applies whereIn layer filter when layers array is non-empty', async () => {
    const { knex, orderByRawResult } = makeSearchKnex();
    const store = new PgVectorStore(knex as never);

    await store.search(embedding, { repoId: REPO, layers: ['code', 'doc'] }, 10);

    expect(orderByRawResult.whereIn).toHaveBeenCalledWith('layer', ['code', 'doc']);
  });

  it('skips whereIn when layers array is empty', async () => {
    const { knex, orderByRawResult } = makeSearchKnex();
    const store = new PgVectorStore(knex as never);

    await store.search(embedding, { repoId: REPO, layers: [] }, 10);

    expect(orderByRawResult.whereIn).not.toHaveBeenCalled();
  });

  it('skips whereIn when layers is not provided', async () => {
    const { knex, orderByRawResult } = makeSearchKnex();
    const store = new PgVectorStore(knex as never);

    await store.search(embedding, { repoId: REPO }, 10);

    expect(orderByRawResult.whereIn).not.toHaveBeenCalled();
  });

  it('applies whereRaw filePath filter when filePaths array is non-empty', async () => {
    const { knex, orderByRawResult } = makeSearchKnex();
    const store = new PgVectorStore(knex as never);

    await store.search(
      embedding,
      { repoId: REPO, filePaths: ['src/foo.ts', 'src/bar.ts'] },
      10,
    );

    expect(orderByRawResult.whereRaw).toHaveBeenCalledWith(
      `metadata->>'filePath' = ANY(?)`,
      [['src/foo.ts', 'src/bar.ts']],
    );
  });

  it('skips whereRaw when filePaths is not provided', async () => {
    const { knex, orderByRawResult } = makeSearchKnex();
    const store = new PgVectorStore(knex as never);

    await store.search(embedding, { repoId: REPO }, 10);

    expect(orderByRawResult.whereRaw).not.toHaveBeenCalled();
  });

  it('maps DB rows to VectorChunk objects (snake_case → camelCase)', async () => {
    const dbRows = [
      {
        repo_id: REPO,
        chunk_id: `${REPO}:src/foo.ts:myFn:code`,
        content: 'function myFn() {}',
        content_sha: 'sha256abc',
        layer: 'code',
        metadata: { filePath: 'src/foo.ts' },
      },
    ];
    const { knex } = makeSearchKnex(dbRows);
    const store = new PgVectorStore(knex as never);

    const results = await store.search(embedding, { repoId: REPO }, 5);

    expect(results).toHaveLength(1);
    const chunk = results[0];
    expect(chunk.chunkId).toBe(`${REPO}:src/foo.ts:myFn:code`);
    expect(chunk.repoId).toBe(REPO);
    expect(chunk.content).toBe('function myFn() {}');
    expect(chunk.contentSha).toBe('sha256abc');
    expect(chunk.layer).toBe('code');
    expect(chunk.metadata).toEqual({ filePath: 'src/foo.ts' });
    // embedding is NOT returned from search (large; not needed by callers)
    expect(chunk.embedding).toBeUndefined();
  });

  it('sets chunk.metadata to undefined when DB row has null metadata', async () => {
    const dbRows = [
      {
        repo_id: REPO,
        chunk_id: `${REPO}:src/a.ts:fnA:code`,
        content: 'x',
        content_sha: 'sha1',
        layer: 'code',
        metadata: null,
      },
    ];
    const { knex } = makeSearchKnex(dbRows);
    const store = new PgVectorStore(knex as never);

    const results = await store.search(embedding, { repoId: REPO }, 5);

    expect(results[0].metadata).toBeUndefined();
  });

  it('returns an empty array when no rows match', async () => {
    const { knex } = makeSearchKnex([]);
    const store = new PgVectorStore(knex as never);

    const results = await store.search(embedding, { repoId: REPO }, 5);

    expect(results).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// searchKeyword()
//
// The knex query chain for searchKeyword is:
//   knex('ci_qna_embeddings')
//     .where('repo_id', repoId)                           ← tableResult.where → whereResult
//     .whereRaw('to_tsvector(...) @@ plainto_tsquery(?)') ← whereResult.whereRaw → whereRawResult
//     .select(columns)                                    ← whereRawResult.select → selectResult
//     .orderByRaw('ts_rank(...) DESC')                    ← selectResult.orderByRaw → orderByRawResult
//     .limit(topK)                                        ← orderByRawResult.limit → limitResult
//     [.whereIn('layer', layers)]                         ← limitResult.whereIn → resolved rows
// ---------------------------------------------------------------------------

describe('PgVectorStore.searchKeyword', () => {
  const REPO = 'repo-1';

  function makeKeywordKnex(resolvedRows: object[] = []) {
    // Terminal mock for the no-layer path: limit() returns a thenable.
    // For the with-layer path: limit() returns a chainable with whereIn().
    const actualRows = resolvedRows;
    const limitResult = {
      whereIn: jest.fn().mockResolvedValue(actualRows),
      // Also thenable for the no-layer path: await limitResult resolves rows
      then: (res: (v: object[]) => void) => Promise.resolve(actualRows).then(res),
    };

    const orderByRawResult = {
      limit: jest.fn().mockReturnValue(limitResult),
    };

    const selectResult = {
      orderByRaw: jest.fn().mockReturnValue(orderByRawResult),
    };

    const whereRawResult = {
      select: jest.fn().mockReturnValue(selectResult),
    };

    const whereResult = {
      whereRaw: jest.fn().mockReturnValue(whereRawResult),
    };

    const tableResult = {
      where: jest.fn().mockReturnValue(whereResult),
    };

    const knex = jest.fn().mockReturnValue(tableResult);
    return {
      knex,
      tableResult,
      whereResult,
      whereRawResult,
      selectResult,
      orderByRawResult,
      limitResult,
    };
  }

  it('queries with correct repo_id filter, tsvector condition, ts_rank ordering, and limit', async () => {
    const { knex, tableResult, whereResult, whereRawResult, selectResult, orderByRawResult, limitResult } =
      makeKeywordKnex();
    const store = new PgVectorStore(knex as never);

    await store.searchKeyword(REPO, 'login flow', 5);

    expect(knex).toHaveBeenCalledWith('ci_qna_embeddings');
    expect(tableResult.where).toHaveBeenCalledWith('repo_id', REPO);
    expect(whereResult.whereRaw).toHaveBeenCalledWith(
      `to_tsvector('english', content) @@ plainto_tsquery('english', ?)`,
      ['login flow'],
    );
    expect(whereRawResult.select).toHaveBeenCalledWith(
      'repo_id', 'chunk_id', 'content', 'content_sha', 'layer', 'metadata',
    );
    expect(selectResult.orderByRaw).toHaveBeenCalledWith(
      `ts_rank(to_tsvector('english', content), plainto_tsquery('english', ?)) DESC`,
      ['login flow'],
    );
    expect(orderByRawResult.limit).toHaveBeenCalledWith(5);
    // No layer filter — whereIn not called
    expect(limitResult.whereIn).not.toHaveBeenCalled();
  });

  it('applies whereIn layer filter when layers array is non-empty', async () => {
    const { knex, limitResult } = makeKeywordKnex();
    const store = new PgVectorStore(knex as never);

    await store.searchKeyword(REPO, 'auth', 8, ['code', 'doc_section']);

    expect(limitResult.whereIn).toHaveBeenCalledWith('layer', ['code', 'doc_section']);
  });

  it('skips whereIn when layers array is empty', async () => {
    const { knex, limitResult } = makeKeywordKnex();
    const store = new PgVectorStore(knex as never);

    await store.searchKeyword(REPO, 'auth', 8, []);

    expect(limitResult.whereIn).not.toHaveBeenCalled();
  });

  it('skips whereIn when layers is undefined', async () => {
    const { knex, limitResult } = makeKeywordKnex();
    const store = new PgVectorStore(knex as never);

    await store.searchKeyword(REPO, 'auth', 8);

    expect(limitResult.whereIn).not.toHaveBeenCalled();
  });

  it('maps DB rows to VectorChunk objects (snake_case → camelCase)', async () => {
    const dbRows = [
      {
        repo_id: REPO,
        chunk_id: `${REPO}:src/auth.ts:loginUser:code`,
        content: 'function loginUser() {}',
        content_sha: 'sha-login',
        layer: 'code',
        metadata: { filePath: 'src/auth.ts', symbol: 'loginUser' },
      },
    ];
    const { knex } = makeKeywordKnex(dbRows);
    const store = new PgVectorStore(knex as never);

    const results = await store.searchKeyword(REPO, 'loginUser', 5);

    expect(results).toHaveLength(1);
    const chunk = results[0];
    expect(chunk.chunkId).toBe(`${REPO}:src/auth.ts:loginUser:code`);
    expect(chunk.repoId).toBe(REPO);
    expect(chunk.content).toBe('function loginUser() {}');
    expect(chunk.contentSha).toBe('sha-login');
    expect(chunk.layer).toBe('code');
    expect(chunk.metadata).toEqual({ filePath: 'src/auth.ts', symbol: 'loginUser' });
    expect(chunk.embedding).toBeUndefined();
  });

  it('sets chunk.metadata to undefined when DB row has null metadata', async () => {
    const dbRows = [
      {
        repo_id: REPO,
        chunk_id: `${REPO}:src/a.ts:fnA:code`,
        content: 'fnA docs',
        content_sha: 'sha-a',
        layer: 'doc_section',
        metadata: null,
      },
    ];
    const { knex } = makeKeywordKnex(dbRows);
    const store = new PgVectorStore(knex as never);

    const results = await store.searchKeyword(REPO, 'fnA', 5);

    expect(results[0].metadata).toBeUndefined();
  });

  it('returns an empty array when no rows match', async () => {
    const { knex } = makeKeywordKnex([]);
    const store = new PgVectorStore(knex as never);

    const results = await store.searchKeyword(REPO, 'nonexistent term xyz', 5);

    expect(results).toEqual([]);
  });
});
