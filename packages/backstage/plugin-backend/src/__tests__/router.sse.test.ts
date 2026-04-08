/**
 * Tests for the SSE streaming endpoint:
 *   POST /repos/:repoId/qna/sessions/:sessionId/ask-stream
 *
 * This file is deliberately separate from router.test.ts so that the SSE
 * helpers (which need to collect chunked responses over time) do not bloat the
 * main router test suite.
 *
 * Approach:
 * - A real express app is bound to a random port (like the main router tests).
 * - `qnaService` is injected as a mock that returns controlled async generators.
 * - Raw HTTP is used (Node `http` module) to read the SSE stream.
 * - Fake timers are NOT needed — the mock generators complete synchronously.
 */

import http from 'http';

import type { QnAService } from '@codeinsight/qna';
import express from 'express';

import { createRouter, RouterOptions } from '../router';

// ---------------------------------------------------------------------------
// Shared mock factories (mirrors router.test.ts style)
// ---------------------------------------------------------------------------

function mockLogger() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn().mockReturnThis(),
  };
}

function mockConfig() {
  return {
    getOptionalString: jest.fn(),
    getString: jest.fn(),
    getOptionalNumber: jest.fn(),
    getNumber: jest.fn(),
    getOptionalBoolean: jest.fn(),
    getBoolean: jest.fn(),
    getOptionalConfig: jest.fn(),
    getConfig: jest.fn(),
    getOptionalConfigArray: jest.fn(),
    getConfigArray: jest.fn(),
    getOptionalStringArray: jest.fn(),
    getStringArray: jest.fn(),
    has: jest.fn(),
    keys: jest.fn(),
  };
}

function mockDatabase() {
  return { getClient: jest.fn() };
}

function mockJobQueue() {
  return { enqueue: jest.fn(), getStatus: jest.fn() };
}

function mockStorageAdapter() {
  return {
    getJob: jest.fn(),
    getRepo: jest.fn(),
    upsertRepo: jest.fn(),
    updateRepoStatus: jest.fn(),
    upsertRepoFiles: jest.fn(),
    getRepoFiles: jest.fn(),
    getChangedRepoFiles: jest.fn(),
    deleteRepoFilesNotIn: jest.fn(),
    upsertCIGNodes: jest.fn(),
    upsertCIGEdges: jest.fn(),
    deleteCIGForFiles: jest.fn(),
    getCIGNodes: jest.fn(),
    getCIGEdges: jest.fn(),
    upsertArtifact: jest.fn(),
    getArtifact: jest.fn(),
    getArtifactsByType: jest.fn(),
    getArtifactInputs: jest.fn(),
    getStaleArtifacts: jest.fn(),
    markArtifactsStale: jest.fn(),
    getArtifactIdsByFilePaths: jest.fn(),
    getArtifactDependents: jest.fn(),
    upsertArtifactInputs: jest.fn(),
    createJob: jest.fn(),
    updateJob: jest.fn(),
    getActiveJobForRepo: jest.fn(),
    getSessionMessages: jest.fn().mockResolvedValue([]),
  };
}

// ---------------------------------------------------------------------------
// SSE HTTP helper
// ---------------------------------------------------------------------------

/**
 * Posts to a SSE endpoint and collects all the `data:` frames written before
 * the connection is closed. Returns the raw array of parsed frame bodies.
 */
function sseRequest(
  server: http.Server,
  path: string,
  body: unknown,
): Promise<{ frames: Array<Record<string, unknown>>; statusCode: number }> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === 'string') {
      return reject(new Error('Server not listening on a port'));
    }

    const payload = JSON.stringify(body);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(payload)),
      Accept: 'text/event-stream',
    };

    const req = http.request(
      { hostname: '127.0.0.1', port: addr.port, path, method: 'POST', headers },
      res => {
        const frames: Array<Record<string, unknown>> = [];
        let buffer = '';

        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();

          // Parse complete SSE lines: lines starting with "data: "
          const lines = buffer.split('\n');
          // Keep potentially incomplete last line
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('data: ')) {
              const json = trimmed.slice('data: '.length);
              try {
                frames.push(JSON.parse(json) as Record<string, unknown>);
              } catch {
                // ignore malformed frames
              }
            }
          }
        });

        res.on('end', () => {
          resolve({ frames, statusCode: res.statusCode ?? 0 });
        });

        res.on('error', reject);
      },
    );

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /repos/:repoId/qna/sessions/:sessionId/ask-stream', () => {
  let server: http.Server;
  let qnaService: jest.Mocked<Pick<QnAService, 'askStream' | 'createSession' | 'ask'>>;

  beforeEach(async () => {
    qnaService = {
      createSession: jest.fn(),
      ask: jest.fn(),
      askStream: jest.fn(),
    };

    const options: RouterOptions = {
      config: mockConfig() as unknown as RouterOptions['config'],
      logger: mockLogger() as unknown as RouterOptions['logger'],
      database: mockDatabase() as unknown as RouterOptions['database'],
      jobQueue: mockJobQueue() as unknown as RouterOptions['jobQueue'],
      storageAdapter: mockStorageAdapter() as unknown as RouterOptions['storageAdapter'],
      qnaService: qnaService as unknown as RouterOptions['qnaService'],
    };

    const router = await createRouter(options);
    const app = express();
    app.use(router);
    server = app.listen(0);
  });

  afterEach(done => {
    server.close(done);
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Successful stream
  // -------------------------------------------------------------------------

  it('writes SSE token frames and a done frame, then ends the response', async () => {
    qnaService.askStream.mockImplementation(async function* () {
      yield 'Hello';
      yield ', world';
    });

    const { frames, statusCode } = await sseRequest(
      server,
      '/repos/repo-1/qna/sessions/sess-1/ask-stream',
      { question: 'What is auth?' },
    );

    // SSE responses don't return a 200 status in the traditional sense — they use 200
    // for the stream, but the status is set before flushHeaders() is called.
    // express-promise-router defaults to 200 when res.setHeader/flushHeaders is called.
    expect(statusCode).toBe(200);

    // Expect two token frames then a done frame
    expect(frames).toHaveLength(3);
    expect(frames[0]).toEqual({ token: 'Hello' });
    expect(frames[1]).toEqual({ token: ', world' });
    expect(frames[2]).toEqual({ done: true });
  });

  it('calls qnaService.askStream with sessionId, question, and an AbortSignal', async () => {
    qnaService.askStream.mockImplementation(async function* () {
      yield 'ok';
    });

    await sseRequest(
      server,
      '/repos/repo-1/qna/sessions/sess-42/ask-stream',
      { question: 'Explain the auth flow.' },
    );

    expect(qnaService.askStream).toHaveBeenCalledTimes(1);
    const [calledSessionId, calledQuestion, calledSignal] = (
      qnaService.askStream as jest.Mock
    ).mock.calls[0] as [string, string, AbortSignal];

    expect(calledSessionId).toBe('sess-42');
    expect(calledQuestion).toBe('Explain the auth flow.');
    // The router creates an AbortController and passes its signal
    expect(calledSignal).toBeInstanceOf(AbortSignal);
  });

  it('returns 400 when question is missing', async () => {
    // For a 400 the router responds with JSON before setting SSE headers,
    // so this goes through the standard JSON helper path.
    const { frames, statusCode } = await sseRequest(
      server,
      '/repos/repo-1/qna/sessions/sess-1/ask-stream',
      {},
    );

    expect(statusCode).toBe(400);
    // No SSE frames expected — the response body is plain JSON
    expect(frames).toHaveLength(0);
  });

  it('returns 503 when qnaService is not configured', async () => {
    // Rebuild the server without qnaService
    server.close();
    const options: RouterOptions = {
      config: mockConfig() as unknown as RouterOptions['config'],
      logger: mockLogger() as unknown as RouterOptions['logger'],
      database: mockDatabase() as unknown as RouterOptions['database'],
      jobQueue: mockJobQueue() as unknown as RouterOptions['jobQueue'],
      storageAdapter: mockStorageAdapter() as unknown as RouterOptions['storageAdapter'],
      // qnaService intentionally omitted
    };
    const router = await createRouter(options);
    const app = express();
    app.use(router);
    await new Promise<void>(resolve => {
      server = app.listen(0, resolve);
    });

    const { statusCode } = await sseRequest(
      server,
      '/repos/repo-1/qna/sessions/sess-1/ask-stream',
      { question: 'hello' },
    );

    expect(statusCode).toBe(503);
  });

  // -------------------------------------------------------------------------
  // Abort / client disconnect
  // -------------------------------------------------------------------------

  it('ends the response cleanly (no error frame) when the stream throws an AbortError', async () => {
    const abortError = new Error('This operation was aborted');
    abortError.name = 'AbortError';

    qnaService.askStream.mockImplementation(async function* () {
      throw abortError;
      // eslint-disable-next-line no-unreachable
      yield '';
    });

    const { frames, statusCode } = await sseRequest(
      server,
      '/repos/repo-1/qna/sessions/sess-1/ask-stream',
      { question: 'Hello?' },
    );

    expect(statusCode).toBe(200);
    // No error frame — the abort is suppressed silently
    expect(frames.some(f => 'error' in f)).toBe(false);
    // No done frame either — the handler just calls res.end()
    expect(frames.some(f => 'done' in f)).toBe(false);
  });

  it('ends the response cleanly (no error frame) when the stream throws APIUserAbortError', async () => {
    const abortError = new Error('Request aborted by user');
    abortError.name = 'APIUserAbortError';

    qnaService.askStream.mockImplementation(async function* () {
      throw abortError;
      // eslint-disable-next-line no-unreachable
      yield '';
    });

    const { frames } = await sseRequest(
      server,
      '/repos/repo-1/qna/sessions/sess-1/ask-stream',
      { question: 'Hello?' },
    );

    expect(frames.some(f => 'error' in f)).toBe(false);
  });

  it('ends the response cleanly when stream throws "Request was aborted." message', async () => {
    const abortError = new Error('Request was aborted.');

    qnaService.askStream.mockImplementation(async function* () {
      throw abortError;
      // eslint-disable-next-line no-unreachable
      yield '';
    });

    const { frames } = await sseRequest(
      server,
      '/repos/repo-1/qna/sessions/sess-1/ask-stream',
      { question: 'Hello?' },
    );

    expect(frames.some(f => 'error' in f)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Non-abort stream error
  // -------------------------------------------------------------------------

  it('writes an error frame when the stream throws a non-abort error', async () => {
    const runtimeError = new Error('LLM provider unavailable');

    qnaService.askStream.mockImplementation(async function* () {
      throw runtimeError;
      // eslint-disable-next-line no-unreachable
      yield '';
    });

    const { frames, statusCode } = await sseRequest(
      server,
      '/repos/repo-1/qna/sessions/sess-1/ask-stream',
      { question: 'What is auth?' },
    );

    expect(statusCode).toBe(200); // Headers already sent before the error
    const errorFrame = frames.find(f => 'error' in f);
    expect(errorFrame).toBeDefined();
    expect(errorFrame?.error).toBe('LLM provider unavailable');
  });

  it('writes an error frame after yielding some tokens when stream errors mid-way', async () => {
    qnaService.askStream.mockImplementation(async function* () {
      yield 'partial ';
      throw new Error('mid-stream failure');
    });

    const { frames } = await sseRequest(
      server,
      '/repos/repo-1/qna/sessions/sess-1/ask-stream',
      { question: 'Tell me about auth.' },
    );

    // Should have the partial token frame, then an error frame
    expect(frames[0]).toEqual({ token: 'partial ' });
    const errorFrame = frames.find(f => 'error' in f);
    expect(errorFrame?.error).toBe('mid-stream failure');
  });
});
