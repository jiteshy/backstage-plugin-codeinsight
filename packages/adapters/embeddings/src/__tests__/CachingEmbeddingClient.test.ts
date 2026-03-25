/**
 * Unit tests for CachingEmbeddingClient.
 *
 * No real Knex/DB is used. The Knex instance is mocked to return chainable
 * query builder objects. The inner EmbeddingClient is also a mock.
 */

import { createHash } from 'crypto';

import type { EmbeddingClient, Logger } from '@codeinsight/types';

import { CachingEmbeddingClient } from '../CachingEmbeddingClient';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function buildInnerClient(): jest.Mocked<EmbeddingClient> {
  return { embed: jest.fn() };
}

function buildLogger(): jest.Mocked<Logger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

/**
 * Build a mock Knex instance that supports the query patterns used by
 * CachingEmbeddingClient:
 *
 * Read path:  knex('ci_embedding_cache').whereIn(...).select(...)
 * Write path: knex('ci_embedding_cache').insert(...).onConflict(...).ignore()
 */
function buildKnexMock(cachedRows: Array<{ content_sha: string; embedding: string }> = []) {
  const insertMock = jest.fn();
  const chainMethods = {
    whereIn: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    select: jest.fn().mockResolvedValue(cachedRows),
    insert: insertMock.mockReturnThis(),
    onConflict: jest.fn().mockReturnThis(),
    ignore: jest.fn().mockResolvedValue(undefined),
  };
  const knex = jest.fn().mockReturnValue(chainMethods);
  return { knex, chain: chainMethods, insertMock };
}

function buildKnexMockWithWriteError(
  cachedRows: Array<{ content_sha: string; embedding: string }> = [],
  writeError: Error,
) {
  const chainMethods = {
    whereIn: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    select: jest.fn().mockResolvedValue(cachedRows),
    insert: jest.fn().mockReturnThis(),
    onConflict: jest.fn().mockReturnThis(),
    ignore: jest.fn().mockRejectedValue(writeError),
  };
  const knex = jest.fn().mockReturnValue(chainMethods);
  return { knex, chain: chainMethods };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const MODEL_NAME = 'text-embedding-3-small';

describe('CachingEmbeddingClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Empty input
  // -------------------------------------------------------------------------

  it('returns empty array for empty input without touching DB or inner client', async () => {
    const { knex } = buildKnexMock();
    const inner = buildInnerClient();

    const client = new CachingEmbeddingClient(inner, knex as any, MODEL_NAME);
    const result = await client.embed([]);

    expect(result).toEqual([]);
    expect(knex).not.toHaveBeenCalled();
    expect(inner.embed).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // All cache hits
  // -------------------------------------------------------------------------

  describe('all cache hits', () => {
    it('returns cached embeddings without calling inner.embed', async () => {
      const text1 = 'function foo() {}';
      const text2 = 'function bar() {}';
      const { knex } = buildKnexMock([
        { content_sha: sha256(text1), embedding: '[0.1,0.2,0.3]' },
        { content_sha: sha256(text2), embedding: '[0.4,0.5,0.6]' },
      ]);
      const inner = buildInnerClient();

      const client = new CachingEmbeddingClient(inner, knex as any, MODEL_NAME);
      const result = await client.embed([text1, text2]);

      expect(result).toEqual([
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ]);
      expect(inner.embed).not.toHaveBeenCalled();
    });

    it('queries ci_embedding_cache with correct SHAs', async () => {
      const text = 'hello world';
      const { knex, chain } = buildKnexMock([
        { content_sha: sha256(text), embedding: '[0.1]' },
      ]);
      const inner = buildInnerClient();

      const client = new CachingEmbeddingClient(inner, knex as any, MODEL_NAME);
      await client.embed([text]);

      expect(knex).toHaveBeenCalledWith('ci_embedding_cache');
      expect(chain.whereIn).toHaveBeenCalledWith('content_sha', [sha256(text)]);
    });

    it('filters cache lookups by model_used', async () => {
      const text = 'hello world';
      const { knex, chain } = buildKnexMock([
        { content_sha: sha256(text), embedding: '[0.1]' },
      ]);
      const inner = buildInnerClient();

      const client = new CachingEmbeddingClient(inner, knex as any, MODEL_NAME);
      await client.embed([text]);

      expect(chain.andWhere).toHaveBeenCalledWith('model_used', MODEL_NAME);
    });
  });

  // -------------------------------------------------------------------------
  // All cache misses
  // -------------------------------------------------------------------------

  describe('all cache misses', () => {
    it('calls inner.embed and returns results', async () => {
      const { knex } = buildKnexMock([]);
      const inner = buildInnerClient();
      inner.embed.mockResolvedValue([[0.1, 0.2], [0.3, 0.4]]);

      const client = new CachingEmbeddingClient(inner, knex as any, MODEL_NAME);
      const result = await client.embed(['text1', 'text2']);

      expect(inner.embed).toHaveBeenCalledWith(['text1', 'text2']);
      expect(result).toEqual([[0.1, 0.2], [0.3, 0.4]]);
    });

    it('stores new embeddings in ci_embedding_cache', async () => {
      const { knex, chain } = buildKnexMock([]);
      const inner = buildInnerClient();
      inner.embed.mockResolvedValue([[0.1, 0.2]]);

      const client = new CachingEmbeddingClient(inner, knex as any, MODEL_NAME);
      await client.embed(['hello']);

      // First call is the read (whereIn), second call is the write (insert)
      expect(chain.insert).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            content_sha: sha256('hello'),
            embedding: '[0.1,0.2]',
            model_used: MODEL_NAME,
          }),
        ]),
      );
      expect(chain.onConflict).toHaveBeenCalledWith('content_sha');
      expect(chain.ignore).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Partial cache hits
  // -------------------------------------------------------------------------

  describe('partial cache hits', () => {
    it('only embeds texts that are cache misses', async () => {
      const cached = 'cached text';
      const missed = 'new text';
      const { knex } = buildKnexMock([
        { content_sha: sha256(cached), embedding: '[0.9,0.8]' },
      ]);
      const inner = buildInnerClient();
      inner.embed.mockResolvedValue([[0.1, 0.2]]);

      const client = new CachingEmbeddingClient(inner, knex as any, MODEL_NAME);
      const result = await client.embed([cached, missed]);

      // Only the missed text should be sent to inner
      expect(inner.embed).toHaveBeenCalledWith([missed]);
      // Results should be in original order
      expect(result).toEqual([
        [0.9, 0.8], // from cache
        [0.1, 0.2], // from inner
      ]);
    });

    it('preserves order when misses are interspersed with hits', async () => {
      const t1 = 'text1';
      const t2 = 'text2';
      const t3 = 'text3';
      // t1 and t3 are cached, t2 is a miss
      const { knex } = buildKnexMock([
        { content_sha: sha256(t1), embedding: '[1.0]' },
        { content_sha: sha256(t3), embedding: '[3.0]' },
      ]);
      const inner = buildInnerClient();
      inner.embed.mockResolvedValue([[2.0]]);

      const client = new CachingEmbeddingClient(inner, knex as any, MODEL_NAME);
      const result = await client.embed([t1, t2, t3]);

      expect(inner.embed).toHaveBeenCalledWith([t2]);
      expect(result).toEqual([[1.0], [2.0], [3.0]]);
    });
  });

  // -------------------------------------------------------------------------
  // Duplicate texts in batch
  // -------------------------------------------------------------------------

  describe('duplicate texts', () => {
    it('handles duplicate texts correctly (same SHA)', async () => {
      const text = 'duplicate';
      const { knex } = buildKnexMock([]);
      const inner = buildInnerClient();
      // Inner only receives unique texts, but our implementation sends duplicates
      // since dedup isn't required — the cache handles it on the second occurrence
      inner.embed.mockResolvedValue([[0.5, 0.6], [0.5, 0.6]]);

      const client = new CachingEmbeddingClient(inner, knex as any, MODEL_NAME);
      const result = await client.embed([text, text]);

      expect(result[0]).toEqual(result[1]);
    });
  });

  // -------------------------------------------------------------------------
  // Cache write failure
  // -------------------------------------------------------------------------

  describe('cache write failure', () => {
    it('returns embeddings even when cache write fails', async () => {
      const { knex } = buildKnexMockWithWriteError([], new Error('DB write failed'));
      const inner = buildInnerClient();
      inner.embed.mockResolvedValue([[0.1, 0.2]]);
      const logger = buildLogger();

      const client = new CachingEmbeddingClient(inner, knex as any, MODEL_NAME, logger);
      const result = await client.embed(['hello']);

      expect(result).toEqual([[0.1, 0.2]]);
    });

    it('logs a warning when cache write fails', async () => {
      const { knex } = buildKnexMockWithWriteError([], new Error('connection refused'));
      const inner = buildInnerClient();
      inner.embed.mockResolvedValue([[0.1]]);
      const logger = buildLogger();

      const client = new CachingEmbeddingClient(inner, knex as any, MODEL_NAME, logger);
      await client.embed(['hello']);

      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to write embedding cache entries',
        expect.objectContaining({ error: expect.any(String) }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Logging
  // -------------------------------------------------------------------------

  describe('logging', () => {
    it('logs cache statistics on each call', async () => {
      const text = 'cached';
      const { knex } = buildKnexMock([
        { content_sha: sha256(text), embedding: '[0.1]' },
      ]);
      const inner = buildInnerClient();
      inner.embed.mockResolvedValue([[0.2]]);
      const logger = buildLogger();

      const client = new CachingEmbeddingClient(inner, knex as any, MODEL_NAME, logger);
      await client.embed([text, 'uncached']);

      expect(logger.debug).toHaveBeenCalledWith('Embedding cache lookup', {
        total: 2,
        hits: 1,
        misses: 1,
      });
    });

    it('works without a logger', async () => {
      const { knex } = buildKnexMock([]);
      const inner = buildInnerClient();
      inner.embed.mockResolvedValue([[0.1]]);

      const client = new CachingEmbeddingClient(inner, knex as any, MODEL_NAME);
      const result = await client.embed(['hello']);

      expect(result).toEqual([[0.1]]);
    });
  });

  // -------------------------------------------------------------------------
  // SHA determinism
  // -------------------------------------------------------------------------

  describe('content SHA determinism', () => {
    it('same text always produces the same SHA', async () => {
      const { knex, chain } = buildKnexMock([]);
      const inner = buildInnerClient();
      inner.embed.mockResolvedValue([[0.1]]);

      const client = new CachingEmbeddingClient(inner, knex as any, MODEL_NAME);

      await client.embed(['deterministic text']);

      const queriedShas1 = (chain.whereIn.mock.calls[0] as [string, string[]])[1];

      // Reset and call again
      chain.whereIn.mockClear();
      chain.select.mockResolvedValue([]);
      inner.embed.mockResolvedValue([[0.1]]);

      await client.embed(['deterministic text']);

      const queriedShas2 = (chain.whereIn.mock.calls[0] as [string, string[]])[1];
      expect(queriedShas1).toEqual(queriedShas2);
    });
  });
});
