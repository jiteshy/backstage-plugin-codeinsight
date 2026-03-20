import type { LLMClient, LLMOptions, Logger } from '@codeinsight/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RETRIES = 3;

/** Base delay per attempt (ms): 10s → 20s → 40s */
const BASE_DELAY_MS = [10_000, 20_000, 40_000] as const;

/** Max random jitter added on top of the base delay (ms). */
const MAX_JITTER_MS = 5_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns true for HTTP 429 / rate-limit errors from any provider. */
function isRateLimitError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const e = err as Error & { status?: number; code?: string };
  if (e.status === 429) return true;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('rate limit') ||
    msg.includes('rate_limit') ||
    msg.includes('too many requests') ||
    msg.includes('rateLimitError'.toLowerCase())
  );
}

/**
 * Parse the `retry-after` header value from the error object.
 *
 * Anthropic and OpenAI SDKs both expose response headers on their error
 * instances as `error.headers`. The header value is in seconds.
 */
function retryAfterMs(err: unknown): number | null {
  const headers = (err as Record<string, unknown> & { headers?: Record<string, string> })?.headers;
  if (!headers) return null;

  const raw = headers['retry-after'] ?? headers['Retry-After'];
  if (!raw) return null;

  const seconds = parseInt(raw, 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : null;
}

function jitter(): number {
  return Math.floor(Math.random() * MAX_JITTER_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// RetryingLLMClient
// ---------------------------------------------------------------------------

/**
 * Transparent retry wrapper around any LLMClient.
 *
 * On rate-limit errors (HTTP 429) it sleeps and retries up to MAX_RETRIES times
 * using exponential backoff (10s → 20s → 40s) plus random jitter (up to 5s).
 * If the provider returns a `retry-after` header, that value is used as the
 * minimum delay.
 *
 * All other errors are rethrown immediately without retrying.
 *
 * Compose between the raw provider client and CachingLLMClient so that only
 * successful responses end up cached:
 *
 *   AnthropicLLMClient
 *     → RetryingLLMClient   ← here
 *       → CachingLLMClient
 */
export class RetryingLLMClient implements LLMClient {
  constructor(
    private readonly inner: LLMClient,
    private readonly logger?: Logger,
  ) {}

  async complete(
    systemPrompt: string,
    userPrompt: string,
    opts?: LLMOptions,
  ): Promise<string> {
    let lastErr: unknown;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await this.waitBeforeRetry(attempt, lastErr);
      }

      try {
        return await this.inner.complete(systemPrompt, userPrompt, opts);
      } catch (err) {
        if (!isRateLimitError(err) || attempt >= MAX_RETRIES) {
          throw err;
        }
        lastErr = err;
        this.logger?.warn('Rate limit hit on LLM complete — will retry', {
          attempt,
          maxRetries: MAX_RETRIES,
        });
      }
    }

    // Unreachable, but satisfies TypeScript.
    throw lastErr;
  }

  async *stream(
    systemPrompt: string,
    userPrompt: string,
    opts?: LLMOptions,
  ): AsyncIterable<string> {
    let lastErr: unknown;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await this.waitBeforeRetry(attempt, lastErr);
      }

      try {
        for await (const chunk of this.inner.stream(systemPrompt, userPrompt, opts)) {
          yield chunk;
        }
        return; // stream completed successfully
      } catch (err) {
        if (!isRateLimitError(err) || attempt >= MAX_RETRIES) {
          throw err;
        }
        lastErr = err;
        this.logger?.warn('Rate limit hit on LLM stream — will retry', {
          attempt,
          maxRetries: MAX_RETRIES,
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async waitBeforeRetry(attempt: number, err: unknown): Promise<void> {
    const baseMs = BASE_DELAY_MS[attempt - 1] ?? BASE_DELAY_MS[BASE_DELAY_MS.length - 1];
    const computedMs = baseMs + jitter();

    // Honour the provider's retry-after header if it demands a longer wait.
    const serverMs = retryAfterMs(err);
    const delayMs = serverMs !== null ? Math.max(computedMs, serverMs) : computedMs;

    this.logger?.info('Waiting before LLM retry', {
      attempt,
      delayMs,
      serverRetryAfterMs: serverMs ?? 'none',
    });

    await sleep(delayMs);
  }
}
