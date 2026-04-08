/**
 * Unit tests for RetryingLLMClient.
 *
 * The inner LLMClient is a jest mock. The sleep/delay behaviour is bypassed by
 * jest.useFakeTimers() so tests run instantly even though the source code
 * applies exponential back-off delays.
 *
 * Key behaviours under test:
 *  - complete(): retries on 429 rate-limit errors up to MAX_RETRIES times.
 *  - complete(): rethrows immediately for non-rate-limit errors (no retry).
 *  - complete(): rethrows after MAX_RETRIES exhausted.
 *  - stream(): retries on 429 errors that occur before any token is yielded.
 *  - stream(): rethrows immediately (no retry) once at least one token has been
 *    yielded — the `started` guard that prevents duplicate token output.
 *  - stream(): rethrows immediately for non-rate-limit errors.
 */

import type { LLMClient, Logger } from '@codeinsight/types';

import { RetryingLLMClient } from '../RetryingLLMClient';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRateLimitError(opts: { status?: number; message?: string } = {}): Error {
  const err = new Error(opts.message ?? 'Rate limit exceeded') as Error & { status?: number };
  err.status = opts.status ?? 429;
  return err;
}

function makeGenericError(message = 'Internal server error'): Error {
  return new Error(message);
}

function makeInnerClient(overrides: Partial<LLMClient> = {}): jest.Mocked<LLMClient> {
  return {
    complete: jest.fn(),
    stream: jest.fn(),
    ...overrides,
  } as jest.Mocked<LLMClient>;
}

function makeLogger(): jest.Mocked<Logger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RetryingLLMClient', () => {
  let setTimeoutSpy: jest.SpyInstance;

  beforeEach(() => {
    // Replace setTimeout with an immediate resolver so back-off sleep() calls
    // complete without any wall-clock delay. This avoids the complexity of
    // interleaving fake-timer advancement with async microtask queues.
    setTimeoutSpy = jest
      .spyOn(global, 'setTimeout')
      .mockImplementation((fn: (...args: unknown[]) => void) => {
        fn();
        return 0 as unknown as ReturnType<typeof setTimeout>;
      });
  });

  afterEach(() => {
    setTimeoutSpy.mockRestore();
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // complete()
  // -------------------------------------------------------------------------

  describe('complete()', () => {
    it('returns the result immediately when inner.complete succeeds on first attempt', async () => {
      const inner = makeInnerClient();
      inner.complete.mockResolvedValue('success');

      const client = new RetryingLLMClient(inner);
      const result = await client.complete('sys', 'user');

      expect(result).toBe('success');
      expect(inner.complete).toHaveBeenCalledTimes(1);
    });

    it('retries on a 429 error and succeeds on the second attempt', async () => {
      const inner = makeInnerClient();
      inner.complete
        .mockRejectedValueOnce(makeRateLimitError())
        .mockResolvedValueOnce('success on retry');

      const client = new RetryingLLMClient(inner);
      const result = await client.complete('sys', 'user');

      expect(result).toBe('success on retry');
      expect(inner.complete).toHaveBeenCalledTimes(2);
    });

    it('retries on a message-based rate-limit error (no status code)', async () => {
      const inner = makeInnerClient();
      // Some providers surface rate limits via message text, not status code
      const rateLimitByMessage = new Error('too many requests from your account');
      inner.complete
        .mockRejectedValueOnce(rateLimitByMessage)
        .mockResolvedValueOnce('recovered');

      const client = new RetryingLLMClient(inner);
      const result = await client.complete('sys', 'user');

      expect(result).toBe('recovered');
      expect(inner.complete).toHaveBeenCalledTimes(2);
    });

    it('rethrows immediately for non-rate-limit errors without retrying', async () => {
      const inner = makeInnerClient();
      const genericError = makeGenericError('DB connection failed');
      inner.complete.mockRejectedValue(genericError);

      const client = new RetryingLLMClient(inner);
      await expect(client.complete('sys', 'user')).rejects.toThrow('DB connection failed');

      // No retry — should only have been called once
      expect(inner.complete).toHaveBeenCalledTimes(1);
    });

    it('exhausts MAX_RETRIES (3) and rethrows the last error', async () => {
      const inner = makeInnerClient();
      const rateLimitError = makeRateLimitError({ message: 'rate limit exceeded' });
      // Fail on all 4 attempts (attempt 0 + 3 retries)
      inner.complete.mockRejectedValue(rateLimitError);

      const client = new RetryingLLMClient(inner);
      await expect(client.complete('sys', 'user')).rejects.toThrow('rate limit exceeded');

      // 1 initial + 3 retries = 4 total calls
      expect(inner.complete).toHaveBeenCalledTimes(4);
    });

    it('logs a warning on each rate-limit retry', async () => {
      const inner = makeInnerClient();
      inner.complete
        .mockRejectedValueOnce(makeRateLimitError())
        .mockResolvedValueOnce('ok');

      const logger = makeLogger();
      const client = new RetryingLLMClient(inner, logger);
      await client.complete('sys', 'user');

      expect(logger.warn).toHaveBeenCalledWith(
        'Rate limit hit on LLM complete — will retry',
        expect.objectContaining({ attempt: 0, maxRetries: 3 }),
      );
    });

    it('passes systemPrompt, userPrompt, and opts through to inner.complete', async () => {
      const inner = makeInnerClient();
      inner.complete.mockResolvedValue('ok');

      const client = new RetryingLLMClient(inner);
      await client.complete('my system', 'my user', { maxTokens: 512, temperature: 0.7 });

      expect(inner.complete).toHaveBeenCalledWith('my system', 'my user', {
        maxTokens: 512,
        temperature: 0.7,
      });
    });
  });

  // -------------------------------------------------------------------------
  // stream()
  // -------------------------------------------------------------------------

  describe('stream()', () => {
    it('yields all tokens from a successful stream on the first attempt', async () => {
      const inner = makeInnerClient();
      inner.stream.mockImplementation(async function* () {
        yield 'token1';
        yield 'token2';
      });

      const client = new RetryingLLMClient(inner);
      const tokens: string[] = [];
      for await (const token of client.stream('sys', 'user')) {
        tokens.push(token);
      }

      expect(tokens).toEqual(['token1', 'token2']);
      expect(inner.stream).toHaveBeenCalledTimes(1);
    });

    it('retries and succeeds when a 429 error occurs before any tokens are yielded', async () => {
      const inner = makeInnerClient();

      // First attempt: throws before yielding anything
      async function* failingStream(): AsyncIterable<string> {
        throw makeRateLimitError({ message: 'rate limit — no tokens yet' });
        // eslint-disable-next-line no-unreachable
        yield '';
      }

      // Second attempt: succeeds
      async function* successStream(): AsyncIterable<string> {
        yield 'hello';
        yield ' world';
      }

      inner.stream
        .mockReturnValueOnce(failingStream())
        .mockReturnValueOnce(successStream());

      const client = new RetryingLLMClient(inner);
      const tokens: string[] = [];

      for await (const token of client.stream('sys', 'user')) {
        tokens.push(token);
      }

      expect(tokens).toEqual(['hello', ' world']);
      expect(inner.stream).toHaveBeenCalledTimes(2);
    });

    it('does NOT retry and throws immediately when a 429 error occurs after the first token is yielded (started guard)', async () => {
      const inner = makeInnerClient();
      const rateLimitAfterToken = makeRateLimitError({ message: 'rate limit mid-stream' });

      // Yields one token then throws a 429
      async function* partialStream(): AsyncIterable<string> {
        yield 'first-token';
        throw rateLimitAfterToken;
      }

      inner.stream.mockReturnValue(partialStream());

      const client = new RetryingLLMClient(inner);
      const tokens: string[] = [];

      await expect(async () => {
        for await (const token of client.stream('sys', 'user')) {
          tokens.push(token);
        }
      }).rejects.toThrow('rate limit mid-stream');

      // Only one attempt — the `started` guard prevents retry
      expect(inner.stream).toHaveBeenCalledTimes(1);
      // The first token was received before the error
      expect(tokens).toEqual(['first-token']);
    });

    it('rethrows immediately for non-rate-limit errors before any tokens, without retrying', async () => {
      const inner = makeInnerClient();

      async function* errorStream(): AsyncIterable<string> {
        throw makeGenericError('timeout');
        // eslint-disable-next-line no-unreachable
        yield '';
      }

      inner.stream.mockReturnValue(errorStream());

      const client = new RetryingLLMClient(inner);

      await expect(async () => {
        for await (const _ of client.stream('sys', 'user')) {
          // no-op
        }
      }).rejects.toThrow('timeout');

      expect(inner.stream).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry for non-rate-limit errors even after the first token', async () => {
      const inner = makeInnerClient();

      async function* partialWithGenericError(): AsyncIterable<string> {
        yield 'first-token';
        throw makeGenericError('network error');
      }

      inner.stream.mockReturnValue(partialWithGenericError());

      const client = new RetryingLLMClient(inner);

      await expect(async () => {
        for await (const _ of client.stream('sys', 'user')) {
          // no-op
        }
      }).rejects.toThrow('network error');

      expect(inner.stream).toHaveBeenCalledTimes(1);
    });

    it('logs a warning when retrying a stream after a pre-token rate-limit error', async () => {
      const inner = makeInnerClient();

      async function* failingStream(): AsyncIterable<string> {
        throw makeRateLimitError();
        // eslint-disable-next-line no-unreachable
        yield '';
      }

      async function* successStream(): AsyncIterable<string> {
        yield 'ok';
      }

      inner.stream
        .mockReturnValueOnce(failingStream())
        .mockReturnValueOnce(successStream());

      const logger = makeLogger();
      const client = new RetryingLLMClient(inner, logger);

      for await (const _ of client.stream('sys', 'user')) {
        // no-op
      }

      expect(logger.warn).toHaveBeenCalledWith(
        'Rate limit hit on LLM stream — will retry',
        expect.objectContaining({ attempt: 0, maxRetries: 3 }),
      );
    });

    it('works correctly without a logger (optional param)', async () => {
      const inner = makeInnerClient();
      inner.stream.mockImplementation(async function* () {
        yield 'chunk';
      });

      const client = new RetryingLLMClient(inner); // no logger
      const tokens: string[] = [];
      for await (const token of client.stream('sys', 'user')) {
        tokens.push(token);
      }

      expect(tokens).toEqual(['chunk']);
    });
  });
});
