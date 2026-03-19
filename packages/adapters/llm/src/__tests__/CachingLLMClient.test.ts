/**
 * Unit tests for CachingLLMClient.
 *
 * No real Knex/DB is used. The Knex instance is a jest.fn() that returns
 * a chainable mock supporting: where, first, insert, onConflict, ignore, catch.
 *
 * The inner LLMClient is also a mock — complete() and stream() are jest.fn()s.
 */

import { createHash } from 'crypto';

import type { LLMClient, LLMOptions, Logger } from '@codeinsight/types';

import { CachingLLMClient } from '../CachingLLMClient';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LLMCacheRow {
  cache_key: string;
  response: string;
  tokens_used: number;
  model_used: string;
  created_at: Date;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a chainable Knex mock.
 *
 * firstResult controls what .first() resolves to:
 *   - a LLMCacheRow → cache hit
 *   - undefined      → cache miss
 *
 * writeError (optional): if provided, the `.catch()` call on the insert chain
 * will invoke the supplied error handler callback with this error, simulating
 * a failed cache write.
 */
function buildKnexMock(firstResult: LLMCacheRow | undefined, writeError?: Error) {
  // The source code calls: .insert(...).onConflict(...).ignore().catch(fn)
  // .catch(fn) here is Promise.prototype.catch — it receives the error handler fn.
  // When writeError is set we call fn(writeError) to simulate a DB write failure.
  const catchMock = writeError
    ? jest.fn().mockImplementation((fn: (err: Error) => void) => {
        fn(writeError);
        return Promise.resolve(undefined);
      })
    : jest.fn().mockResolvedValue(undefined);

  const chainMethods = {
    where: jest.fn().mockReturnThis(),
    first: jest.fn().mockResolvedValue(firstResult),
    insert: jest.fn().mockReturnThis(),
    onConflict: jest.fn().mockReturnThis(),
    ignore: jest.fn().mockReturnThis(),
    catch: catchMock,
  };
  // knex('table') returns the chain
  const knex = jest.fn().mockReturnValue(chainMethods);
  return { knex, chain: chainMethods };
}

function buildInnerClient(): jest.Mocked<LLMClient> {
  return {
    complete: jest.fn(),
    stream: jest.fn(),
  };
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
 * Compute the expected cache key the same way CachingLLMClient does internally,
 * so tests can assert on it without white-box knowledge.
 */
function expectedCacheKey(systemPrompt: string, userPrompt: string, modelName: string): string {
  return createHash('sha256')
    .update(systemPrompt)
    .update('\x00')
    .update(userPrompt)
    .update('\x00')
    .update(modelName)
    .digest('hex');
}

function buildCacheRow(overrides: Partial<LLMCacheRow> = {}): LLMCacheRow {
  return {
    cache_key: 'abc123',
    response: 'cached response text',
    tokens_used: 42,
    model_used: 'gpt-4-turbo',
    created_at: new Date('2024-01-01'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CachingLLMClient', () => {
  const MODEL_NAME = 'gpt-4-turbo';
  const SYSTEM_PROMPT = 'You are a code assistant.';
  const USER_PROMPT = 'Explain this function.';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // complete() — cache hit
  // -------------------------------------------------------------------------

  describe('complete() — cache hit', () => {
    it('returns the cached response without calling inner.complete', async () => {
      const cachedRow = buildCacheRow({ response: 'cached answer' });
      const { knex, chain } = buildKnexMock(cachedRow);
      const inner = buildInnerClient();

      const client = new CachingLLMClient(inner, knex as any, MODEL_NAME);
      const result = await client.complete(SYSTEM_PROMPT, USER_PROMPT);

      expect(result).toBe('cached answer');
      expect(inner.complete).not.toHaveBeenCalled();
      expect(chain.first).toHaveBeenCalledTimes(1);
    });

    it('queries ci_llm_cache with the correct cache_key', async () => {
      const cacheKey = expectedCacheKey(SYSTEM_PROMPT, USER_PROMPT, MODEL_NAME);
      const cachedRow = buildCacheRow({ cache_key: cacheKey });
      const { knex, chain } = buildKnexMock(cachedRow);
      const inner = buildInnerClient();

      const client = new CachingLLMClient(inner, knex as any, MODEL_NAME);
      await client.complete(SYSTEM_PROMPT, USER_PROMPT);

      expect(knex).toHaveBeenCalledWith('ci_llm_cache');
      expect(chain.where).toHaveBeenCalledWith('cache_key', cacheKey);
    });

    it('does not insert into cache on a hit', async () => {
      const { knex, chain } = buildKnexMock(buildCacheRow());
      const inner = buildInnerClient();

      const client = new CachingLLMClient(inner, knex as any, MODEL_NAME);
      await client.complete(SYSTEM_PROMPT, USER_PROMPT);

      expect(chain.insert).not.toHaveBeenCalled();
    });

    it('logs a debug message on cache hit', async () => {
      const { knex } = buildKnexMock(buildCacheRow());
      const inner = buildInnerClient();
      const logger = buildLogger();

      const client = new CachingLLMClient(inner, knex as any, MODEL_NAME, logger);
      await client.complete(SYSTEM_PROMPT, USER_PROMPT);

      expect(logger.debug).toHaveBeenCalledWith(
        'LLM cache hit',
        expect.objectContaining({ cacheKey: expect.any(String) }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // complete() — cache miss
  // -------------------------------------------------------------------------

  describe('complete() — cache miss', () => {
    it('calls inner.complete and returns the response', async () => {
      const { knex } = buildKnexMock(undefined);
      const inner = buildInnerClient();
      inner.complete.mockResolvedValue('fresh response');

      const client = new CachingLLMClient(inner, knex as any, MODEL_NAME);
      const result = await client.complete(SYSTEM_PROMPT, USER_PROMPT);

      expect(inner.complete).toHaveBeenCalledWith(SYSTEM_PROMPT, USER_PROMPT, undefined);
      expect(result).toBe('fresh response');
    });

    it('inserts the response into ci_llm_cache after a miss', async () => {
      const { knex, chain } = buildKnexMock(undefined);
      const inner = buildInnerClient();
      inner.complete.mockResolvedValue('fresh response');

      const client = new CachingLLMClient(inner, knex as any, MODEL_NAME);
      await client.complete(SYSTEM_PROMPT, USER_PROMPT);

      expect(chain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          cache_key: expectedCacheKey(SYSTEM_PROMPT, USER_PROMPT, MODEL_NAME),
          response: 'fresh response',
          model_used: MODEL_NAME,
        }),
      );
      expect(chain.onConflict).toHaveBeenCalledWith('cache_key');
      expect(chain.ignore).toHaveBeenCalled();
    });

    it('forwards opts to inner.complete', async () => {
      const { knex } = buildKnexMock(undefined);
      const inner = buildInnerClient();
      inner.complete.mockResolvedValue('ok');
      const opts: LLMOptions = { maxTokens: 256, temperature: 0.5, stopSequences: ['STOP'] };

      const client = new CachingLLMClient(inner, knex as any, MODEL_NAME);
      await client.complete(SYSTEM_PROMPT, USER_PROMPT, opts);

      expect(inner.complete).toHaveBeenCalledWith(SYSTEM_PROMPT, USER_PROMPT, opts);
    });

    it('logs a debug message on cache miss', async () => {
      const { knex } = buildKnexMock(undefined);
      const inner = buildInnerClient();
      inner.complete.mockResolvedValue('ok');
      const logger = buildLogger();

      const client = new CachingLLMClient(inner, knex as any, MODEL_NAME, logger);
      await client.complete(SYSTEM_PROMPT, USER_PROMPT);

      expect(logger.debug).toHaveBeenCalledWith(
        'LLM cache miss — response stored',
        expect.objectContaining({ cacheKey: expect.any(String) }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Cache key determinism
  // -------------------------------------------------------------------------

  describe('cache key determinism', () => {
    it('produces the same cache_key for identical inputs on repeated calls', async () => {
      // Use two separate mocks to capture the where() arguments on each call
      const { knex: knex1, chain: chain1 } = buildKnexMock(undefined);
      const { knex: knex2, chain: chain2 } = buildKnexMock(undefined);

      const inner1 = buildInnerClient();
      inner1.complete.mockResolvedValue('r1');
      const inner2 = buildInnerClient();
      inner2.complete.mockResolvedValue('r2');

      const client1 = new CachingLLMClient(inner1, knex1 as any, MODEL_NAME);
      const client2 = new CachingLLMClient(inner2, knex2 as any, MODEL_NAME);

      await client1.complete(SYSTEM_PROMPT, USER_PROMPT);
      await client2.complete(SYSTEM_PROMPT, USER_PROMPT);

      // Both should have queried with the same cache_key
      const key1 = (chain1.where.mock.calls[0] as [string, string])[1];
      const key2 = (chain2.where.mock.calls[0] as [string, string])[1];
      expect(key1).toBe(key2);
    });

    it('produces a different cache_key when systemPrompt differs', async () => {
      const { knex: knex1, chain: chain1 } = buildKnexMock(undefined);
      const { knex: knex2, chain: chain2 } = buildKnexMock(undefined);

      const inner1 = buildInnerClient();
      inner1.complete.mockResolvedValue('r1');
      const inner2 = buildInnerClient();
      inner2.complete.mockResolvedValue('r2');

      const client1 = new CachingLLMClient(inner1, knex1 as any, MODEL_NAME);
      const client2 = new CachingLLMClient(inner2, knex2 as any, MODEL_NAME);

      await client1.complete('System prompt A', USER_PROMPT);
      await client2.complete('System prompt B', USER_PROMPT);

      const key1 = (chain1.where.mock.calls[0] as [string, string])[1];
      const key2 = (chain2.where.mock.calls[0] as [string, string])[1];
      expect(key1).not.toBe(key2);
    });

    it('produces a different cache_key when modelName differs', async () => {
      const { knex: knex1, chain: chain1 } = buildKnexMock(undefined);
      const { knex: knex2, chain: chain2 } = buildKnexMock(undefined);

      const inner1 = buildInnerClient();
      inner1.complete.mockResolvedValue('r1');
      const inner2 = buildInnerClient();
      inner2.complete.mockResolvedValue('r2');

      const client1 = new CachingLLMClient(inner1, knex1 as any, 'model-v1');
      const client2 = new CachingLLMClient(inner2, knex2 as any, 'model-v2');

      await client1.complete(SYSTEM_PROMPT, USER_PROMPT);
      await client2.complete(SYSTEM_PROMPT, USER_PROMPT);

      const key1 = (chain1.where.mock.calls[0] as [string, string])[1];
      const key2 = (chain2.where.mock.calls[0] as [string, string])[1];
      expect(key1).not.toBe(key2);
    });

    it('produces a different cache_key when userPrompt differs', async () => {
      const { knex: knex1, chain: chain1 } = buildKnexMock(undefined);
      const { knex: knex2, chain: chain2 } = buildKnexMock(undefined);

      const inner1 = buildInnerClient();
      inner1.complete.mockResolvedValue('r1');
      const inner2 = buildInnerClient();
      inner2.complete.mockResolvedValue('r2');

      const client1 = new CachingLLMClient(inner1, knex1 as any, MODEL_NAME);
      const client2 = new CachingLLMClient(inner2, knex2 as any, MODEL_NAME);

      await client1.complete(SYSTEM_PROMPT, 'User prompt A');
      await client2.complete(SYSTEM_PROMPT, 'User prompt B');

      const key1 = (chain1.where.mock.calls[0] as [string, string])[1];
      const key2 = (chain2.where.mock.calls[0] as [string, string])[1];
      expect(key1).not.toBe(key2);
    });
  });

  // -------------------------------------------------------------------------
  // Cache write failure handling
  // -------------------------------------------------------------------------

  describe('cache write failure', () => {
    it('still returns the response when the cache insert fails', async () => {
      const { knex } = buildKnexMock(undefined, new Error('DB write failed'));
      const inner = buildInnerClient();
      inner.complete.mockResolvedValue('response despite db error');
      const logger = buildLogger();

      const client = new CachingLLMClient(inner, knex as any, MODEL_NAME, logger);
      const result = await client.complete(SYSTEM_PROMPT, USER_PROMPT);

      expect(result).toBe('response despite db error');
    });

    it('calls logger.warn when cache write fails', async () => {
      const { knex } = buildKnexMock(undefined, new Error('connection refused'));
      const inner = buildInnerClient();
      inner.complete.mockResolvedValue('ok');
      const logger = buildLogger();

      const client = new CachingLLMClient(inner, knex as any, MODEL_NAME, logger);
      await client.complete(SYSTEM_PROMPT, USER_PROMPT);

      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to write LLM cache entry',
        expect.objectContaining({ error: expect.any(String) }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // stream()
  // -------------------------------------------------------------------------

  describe('stream()', () => {
    async function* makeInnerStream(chunks: string[]): AsyncIterable<string> {
      for (const chunk of chunks) {
        yield chunk;
      }
    }

    it('delegates directly to inner.stream without touching the DB', () => {
      const { knex } = buildKnexMock(undefined);
      const inner = buildInnerClient();
      const mockAsyncIterable = makeInnerStream(['a', 'b']);
      inner.stream.mockReturnValue(mockAsyncIterable);

      const client = new CachingLLMClient(inner, knex as any, MODEL_NAME);
      const result = client.stream(SYSTEM_PROMPT, USER_PROMPT);

      // stream() returns synchronously — the inner.stream result is returned directly
      expect(result).toBe(mockAsyncIterable);
      expect(inner.stream).toHaveBeenCalledWith(SYSTEM_PROMPT, USER_PROMPT, undefined);
      expect(knex).not.toHaveBeenCalled();
    });

    it('passes opts through to inner.stream', () => {
      const { knex } = buildKnexMock(undefined);
      const inner = buildInnerClient();
      inner.stream.mockReturnValue(makeInnerStream([]));
      const opts: LLMOptions = { maxTokens: 512 };

      const client = new CachingLLMClient(inner, knex as any, MODEL_NAME);
      client.stream(SYSTEM_PROMPT, USER_PROMPT, opts);

      expect(inner.stream).toHaveBeenCalledWith(SYSTEM_PROMPT, USER_PROMPT, opts);
    });

    it('yields the same chunks as the inner stream', async () => {
      const { knex } = buildKnexMock(undefined);
      const inner = buildInnerClient();
      inner.stream.mockReturnValue(makeInnerStream(['chunk1', 'chunk2', 'chunk3']));

      const client = new CachingLLMClient(inner, knex as any, MODEL_NAME);
      const chunks: string[] = [];
      for await (const chunk of client.stream(SYSTEM_PROMPT, USER_PROMPT)) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['chunk1', 'chunk2', 'chunk3']);
    });
  });

  // -------------------------------------------------------------------------
  // Works without a logger (optional param)
  // -------------------------------------------------------------------------

  describe('without logger', () => {
    it('completes successfully on cache hit without a logger', async () => {
      const { knex } = buildKnexMock(buildCacheRow({ response: 'cached' }));
      const inner = buildInnerClient();

      const client = new CachingLLMClient(inner, knex as any, MODEL_NAME);
      const result = await client.complete(SYSTEM_PROMPT, USER_PROMPT);

      expect(result).toBe('cached');
    });

    it('completes successfully on cache miss without a logger', async () => {
      const { knex } = buildKnexMock(undefined);
      const inner = buildInnerClient();
      inner.complete.mockResolvedValue('fresh');

      const client = new CachingLLMClient(inner, knex as any, MODEL_NAME);
      const result = await client.complete(SYSTEM_PROMPT, USER_PROMPT);

      expect(result).toBe('fresh');
    });
  });
});
