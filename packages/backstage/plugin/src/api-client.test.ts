import { CodeInsightClient } from './api-client';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function mockDiscoveryApi(baseUrl = 'http://localhost:7007/api/codeinsight') {
  return {
    getBaseUrl: jest.fn().mockResolvedValue(baseUrl),
  };
}

function mockFetchApi(
  responseBody: unknown,
  init?: { ok?: boolean; statusText?: string; status?: number },
) {
  const ok = init?.ok ?? true;
  const statusText = init?.statusText ?? 'OK';
  // Default to 200 for ok responses, caller must supply explicit status for error cases
  const status = init?.status ?? (ok ? 200 : 500);

  return {
    fetch: jest.fn().mockResolvedValue({
      ok,
      status,
      statusText,
      json: jest.fn().mockResolvedValue(responseBody),
    }),
  };
}

function createClient(overrides?: {
  discoveryApi?: ReturnType<typeof mockDiscoveryApi>;
  fetchApi?: ReturnType<typeof mockFetchApi>;
}) {
  const discoveryApi = overrides?.discoveryApi ?? mockDiscoveryApi();
  const fetchApi = overrides?.fetchApi ?? mockFetchApi({});

  return {
    client: new CodeInsightClient({ discoveryApi, fetchApi }),
    discoveryApi,
    fetchApi,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CodeInsightClient', () => {
  const BASE_URL = 'http://localhost:7007/api/codeinsight';

  // -----------------------------------------------------------------------
  // triggerIngestion
  // -----------------------------------------------------------------------
  describe('triggerIngestion', () => {
    it('sends POST to the correct URL with repo URL in body', async () => {
      const responseBody = { jobId: 'job-123' };
      const fetchApi = mockFetchApi(responseBody);
      const { client } = createClient({ fetchApi });

      const result = await client.triggerIngestion('my-repo', 'https://github.com/org/repo');

      expect(result).toEqual({ jobId: 'job-123' });
      expect(fetchApi.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/repos/my-repo/ingest`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repoUrl: 'https://github.com/org/repo' }),
        },
      );
    });

    it('encodes the repoId in the URL', async () => {
      const fetchApi = mockFetchApi({ jobId: 'job-456' });
      const { client } = createClient({ fetchApi });

      await client.triggerIngestion('repo/with/slashes', 'https://github.com/org/repo');

      const calledUrl = fetchApi.fetch.mock.calls[0][0] as string;
      expect(calledUrl).toBe(`${BASE_URL}/repos/repo%2Fwith%2Fslashes/ingest`);
    });

    it('throws when the response is not ok', async () => {
      const fetchApi = mockFetchApi(null, { ok: false, statusText: 'Internal Server Error' });
      const { client } = createClient({ fetchApi });

      await expect(
        client.triggerIngestion('my-repo', 'https://github.com/org/repo'),
      ).rejects.toThrow('Ingestion failed: Internal Server Error');
    });
  });

  // -----------------------------------------------------------------------
  // getJobStatus
  // -----------------------------------------------------------------------
  describe('getJobStatus', () => {
    it('sends GET to the correct URL and returns job status', async () => {
      const responseBody = { status: 'completed', filesProcessed: 42 };
      const fetchApi = mockFetchApi(responseBody);
      const { client } = createClient({ fetchApi });

      const result = await client.getJobStatus('my-repo', 'job-123');

      expect(result).toEqual({ status: 'completed', filesProcessed: 42 });
      expect(fetchApi.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/repos/my-repo/jobs/job-123`,
      );
    });

    it('encodes both repoId and jobId in the URL', async () => {
      const fetchApi = mockFetchApi({ status: 'running' });
      const { client } = createClient({ fetchApi });

      await client.getJobStatus('repo/special', 'job/special');

      const calledUrl = fetchApi.fetch.mock.calls[0][0] as string;
      expect(calledUrl).toBe(`${BASE_URL}/repos/repo%2Fspecial/jobs/job%2Fspecial`);
    });

    it('returns optional fields when present', async () => {
      const responseBody = {
        status: 'failed',
        filesProcessed: 5,
        errorMessage: 'Tree-sitter parse error',
      };
      const fetchApi = mockFetchApi(responseBody);
      const { client } = createClient({ fetchApi });

      const result = await client.getJobStatus('my-repo', 'job-789');

      expect(result).toEqual(responseBody);
    });

    it('throws when the response is not ok', async () => {
      const fetchApi = mockFetchApi(null, { ok: false, statusText: 'Not Found' });
      const { client } = createClient({ fetchApi });

      await expect(
        client.getJobStatus('my-repo', 'job-missing'),
      ).rejects.toThrow('Failed to get job status: Not Found');
    });
  });

  // -----------------------------------------------------------------------
  // getRepoStatus
  // -----------------------------------------------------------------------
  describe('getRepoStatus', () => {
    it('sends GET to the correct URL and returns repo status', async () => {
      const responseBody = {
        status: 'indexed',
        lastCommitSha: 'abc123',
        updatedAt: '2026-03-08T00:00:00Z',
      };
      const fetchApi = mockFetchApi(responseBody);
      const { client } = createClient({ fetchApi });

      const result = await client.getRepoStatus('my-repo');

      expect(result).toEqual(responseBody);
      expect(fetchApi.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/repos/my-repo/status`,
      );
    });

    it('encodes the repoId in the URL', async () => {
      const fetchApi = mockFetchApi({ status: 'pending' });
      const { client } = createClient({ fetchApi });

      await client.getRepoStatus('org/repo-name');

      const calledUrl = fetchApi.fetch.mock.calls[0][0] as string;
      expect(calledUrl).toBe(`${BASE_URL}/repos/org%2Frepo-name/status`);
    });

    it('returns minimal response without optional fields', async () => {
      const fetchApi = mockFetchApi({ status: 'pending' });
      const { client } = createClient({ fetchApi });

      const result = await client.getRepoStatus('my-repo');

      expect(result).toEqual({ status: 'pending' });
    });

    it('throws when the response is not ok', async () => {
      const fetchApi = mockFetchApi(null, { ok: false, statusText: 'Service Unavailable' });
      const { client } = createClient({ fetchApi });

      await expect(
        client.getRepoStatus('my-repo'),
      ).rejects.toThrow('Failed to get repo status: Service Unavailable');
    });
  });

  // -----------------------------------------------------------------------
  // getDocs
  // -----------------------------------------------------------------------
  describe('getDocs', () => {
    it('sends GET to the correct URL and returns doc sections', async () => {
      const responseBody = [
        {
          artifactId: 'core/overview',
          markdown: '# Overview',
          isStale: false,
          staleReason: null,
          fileCount: 2,
          generatedAt: '2024-06-01T10:00:00.000Z',
          tokensUsed: 300,
        },
      ];
      const fetchApi = mockFetchApi(responseBody);
      const { client } = createClient({ fetchApi });

      const result = await client.getDocs('my-repo');

      expect(result).toEqual(responseBody);
      expect(fetchApi.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/repos/my-repo/docs`,
      );
    });

    it('encodes the repoId in the URL', async () => {
      const fetchApi = mockFetchApi([]);
      const { client } = createClient({ fetchApi });

      await client.getDocs('org/repo-name');

      const calledUrl = fetchApi.fetch.mock.calls[0][0] as string;
      expect(calledUrl).toBe(`${BASE_URL}/repos/org%2Frepo-name/docs`);
    });

    it('returns an empty array when no docs exist', async () => {
      const fetchApi = mockFetchApi([]);
      const { client } = createClient({ fetchApi });

      const result = await client.getDocs('my-repo');

      expect(result).toEqual([]);
    });

    it('returns stale sections correctly', async () => {
      const responseBody = [
        {
          artifactId: 'backend/api-reference',
          markdown: '## API',
          isStale: true,
          staleReason: 'file_changed',
          fileCount: 3,
          generatedAt: '2024-06-01T09:00:00.000Z',
          tokensUsed: 450,
        },
      ];
      const fetchApi = mockFetchApi(responseBody);
      const { client } = createClient({ fetchApi });

      const result = await client.getDocs('my-repo');

      expect(result[0].isStale).toBe(true);
      expect(result[0].staleReason).toBe('file_changed');
      expect(result[0].tokensUsed).toBe(450);
    });

    it('returns an empty array for a 404 response without throwing', async () => {
      const fetchApi = mockFetchApi(null, { ok: false, status: 404, statusText: 'Not Found' });
      const { client } = createClient({ fetchApi });

      const result = await client.getDocs('my-repo');

      expect(result).toEqual([]);
    });

    it('throws for a non-ok response that is not 404 (e.g. 500)', async () => {
      const fetchApi = mockFetchApi(null, { ok: false, status: 500, statusText: 'Internal Server Error' });
      const { client } = createClient({ fetchApi });

      await expect(client.getDocs('my-repo')).rejects.toThrow(
        'Failed to get docs: Internal Server Error',
      );
    });

    it('throws when the response is not ok', async () => {
      const fetchApi = mockFetchApi(null, { ok: false, statusText: 'Service Unavailable' });
      const { client } = createClient({ fetchApi });

      await expect(client.getDocs('my-repo')).rejects.toThrow('Failed to get docs: Service Unavailable');
    });
  });

  // -----------------------------------------------------------------------
  // getDiagrams
  // -----------------------------------------------------------------------
  describe('getDiagrams', () => {
    it('sends GET to the correct URL and returns diagram sections', async () => {
      const responseBody = [
        {
          artifactId: 'dep-graph',
          title: 'Dependency Graph',
          diagramType: 'graph',
          mermaid: 'graph TD\n  A --> B',
          isStale: false,
          staleReason: null,
          llmUsed: false,
          nodeMap: null,
          generatedAt: '2024-06-01T10:00:00.000Z',
          tokensUsed: 0,
        },
      ];
      const fetchApi = mockFetchApi(responseBody);
      const { client } = createClient({ fetchApi });

      const result = await client.getDiagrams('my-repo');

      expect(result).toEqual(responseBody);
      expect(fetchApi.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/repos/my-repo/diagrams`,
      );
    });

    it('encodes the repoId in the URL', async () => {
      const fetchApi = mockFetchApi([]);
      const { client } = createClient({ fetchApi });

      await client.getDiagrams('org/repo-name');

      const calledUrl = fetchApi.fetch.mock.calls[0][0] as string;
      expect(calledUrl).toBe(`${BASE_URL}/repos/org%2Frepo-name/diagrams`);
    });

    it('returns an empty array for a 404 response without throwing', async () => {
      const fetchApi = mockFetchApi(null, { ok: false, status: 404, statusText: 'Not Found' });
      const { client } = createClient({ fetchApi });

      const result = await client.getDiagrams('my-repo');

      expect(result).toEqual([]);
    });

    it('throws for a non-ok response that is not 404 (e.g. 500)', async () => {
      const fetchApi = mockFetchApi(null, { ok: false, status: 500, statusText: 'Internal Server Error' });
      const { client } = createClient({ fetchApi });

      await expect(client.getDiagrams('my-repo')).rejects.toThrow(
        'Failed to get diagrams: Internal Server Error',
      );
    });

    it('returns an empty array when no diagrams exist', async () => {
      const fetchApi = mockFetchApi([]);
      const { client } = createClient({ fetchApi });

      const result = await client.getDiagrams('my-repo');

      expect(result).toEqual([]);
    });

    it('returns diagrams with optional nodeMap populated', async () => {
      const responseBody = [
        {
          artifactId: 'api-flow',
          title: 'API Flow',
          diagramType: 'flowchart',
          mermaid: 'flowchart LR\n  A --> B',
          isStale: false,
          staleReason: null,
          llmUsed: true,
          nodeMap: { UserService: 'src/services/UserService.ts' },
          generatedAt: '2024-06-01T12:00:00.000Z',
          tokensUsed: 800,
        },
      ];
      const fetchApi = mockFetchApi(responseBody);
      const { client } = createClient({ fetchApi });

      const result = await client.getDiagrams('my-repo');

      expect(result[0].nodeMap).toEqual({ UserService: 'src/services/UserService.ts' });
      expect(result[0].llmUsed).toBe(true);
      expect(result[0].tokensUsed).toBe(800);
    });

    it('returns stale diagrams correctly', async () => {
      const responseBody = [
        {
          artifactId: 'er-diagram',
          title: 'ER Diagram',
          diagramType: 'erDiagram',
          mermaid: 'erDiagram\n  A ||--o{ B : has',
          isStale: true,
          staleReason: 'file_changed',
          llmUsed: false,
          nodeMap: null,
          generatedAt: '2024-05-15T08:00:00.000Z',
          tokensUsed: 0,
        },
      ];
      const fetchApi = mockFetchApi(responseBody);
      const { client } = createClient({ fetchApi });

      const result = await client.getDiagrams('my-repo');

      expect(result[0].isStale).toBe(true);
      expect(result[0].staleReason).toBe('file_changed');
    });
  });

  // -----------------------------------------------------------------------
  // createQnASession
  // -----------------------------------------------------------------------
  describe('createQnASession', () => {
    it('sends POST to the correct session creation URL', async () => {
      const fetchApi = mockFetchApi({ sessionId: 'sess-abc' });
      const { client } = createClient({ fetchApi });

      const result = await client.createQnASession('my-repo');

      expect(result).toEqual({ sessionId: 'sess-abc' });
      expect(fetchApi.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/repos/my-repo/qna/sessions`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      );
    });

    it('encodes the repoId in the URL', async () => {
      const fetchApi = mockFetchApi({ sessionId: 'sess-xyz' });
      const { client } = createClient({ fetchApi });

      await client.createQnASession('org/my-repo');

      const calledUrl = fetchApi.fetch.mock.calls[0][0] as string;
      expect(calledUrl).toBe(`${BASE_URL}/repos/org%2Fmy-repo/qna/sessions`);
    });

    it('throws when the response is not ok', async () => {
      const fetchApi = mockFetchApi(null, { ok: false, statusText: 'Service Unavailable' });
      const { client } = createClient({ fetchApi });

      await expect(client.createQnASession('my-repo')).rejects.toThrow(
        'Failed to create QnA session: Service Unavailable',
      );
    });
  });

  // -----------------------------------------------------------------------
  // askQnAStream
  // -----------------------------------------------------------------------
  describe('askQnAStream', () => {
    /**
     * Builds a minimal ReadableStreamDefaultReader mock from a sequence of
     * raw SSE text chunks (each chunk is a string that will be returned by
     * successive reader.read() calls).  The final read() returns done=true.
     */
    function makeStreamReader(chunks: string[]) {
      const encoder = new TextEncoder();
      let idx = 0;
      return {
        read: jest.fn(async () => {
          if (idx < chunks.length) {
            return { done: false, value: encoder.encode(chunks[idx++]) };
          }
          return { done: true as const, value: undefined };
        }),
        cancel: jest.fn().mockResolvedValue(undefined),
      };
    }

    /** Wraps a fetch mock so response.body.getReader() returns the given reader. */
    function mockFetchWithStream(reader: ReturnType<typeof makeStreamReader>) {
      return {
        fetch: jest.fn().mockResolvedValue({
          ok: true,
          status: 200,
          statusText: 'OK',
          body: { getReader: jest.fn().mockReturnValue(reader) },
          json: jest.fn(),
        }),
      };
    }

    /** Builds a second fetch mock (for the /messages GET call) with a JSON response. */
    function mockMessagesFetch(messages: Array<{ role: string; sources?: unknown[] | null }>) {
      return jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: jest.fn().mockResolvedValue(messages),
      });
    }

    it('sends POST to the correct ask-stream URL with the question in the body', async () => {
      const reader = makeStreamReader(['data: {"done":true}\n\n']);
      const fetchMock = mockFetchWithStream(reader);
      // Second call: /messages endpoint
      fetchMock.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        body: { getReader: jest.fn().mockReturnValue(reader) },
        json: jest.fn(),
      });
      // Override with a two-call sequence
      const streamFetch = jest.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          body: { getReader: jest.fn().mockReturnValue(reader) },
          json: jest.fn(),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: jest.fn().mockResolvedValue([]),
        });

      const discoveryApi = mockDiscoveryApi();
      const client = new CodeInsightClient({
        discoveryApi,
        fetchApi: { fetch: streamFetch },
      });

      await client.askQnAStream('my-repo', 'sess-1', 'What does this do?', jest.fn());

      expect(streamFetch).toHaveBeenNthCalledWith(
        1,
        `${BASE_URL}/repos/my-repo/qna/sessions/sess-1/ask-stream`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: 'What does this do?' }),
        },
      );
    });

    it('calls onToken for each token event in the SSE stream', async () => {
      // Two SSE frames: one token, one done
      const sseChunk = 'data: {"token":"Hello"}\n\ndata: {"token":" world"}\n\ndata: {"done":true}\n\n';
      const reader = makeStreamReader([sseChunk]);

      const streamFetch = jest.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          body: { getReader: jest.fn().mockReturnValue(reader) },
          json: jest.fn(),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: jest.fn().mockResolvedValue([
            { role: 'assistant', sources: [] },
          ]),
        });

      const discoveryApi = mockDiscoveryApi();
      const client = new CodeInsightClient({
        discoveryApi,
        fetchApi: { fetch: streamFetch },
      });

      const onToken = jest.fn();
      await client.askQnAStream('my-repo', 'sess-1', 'question', onToken);

      expect(onToken).toHaveBeenCalledTimes(2);
      expect(onToken).toHaveBeenNthCalledWith(1, 'Hello');
      expect(onToken).toHaveBeenNthCalledWith(2, ' world');
    });

    it('calls reader.cancel() in the finally block after streaming completes', async () => {
      const reader = makeStreamReader(['data: {"done":true}\n\n']);
      const streamFetch = jest.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          body: { getReader: jest.fn().mockReturnValue(reader) },
          json: jest.fn(),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: jest.fn().mockResolvedValue([]),
        });

      const discoveryApi = mockDiscoveryApi();
      const client = new CodeInsightClient({
        discoveryApi,
        fetchApi: { fetch: streamFetch },
      });

      await client.askQnAStream('my-repo', 'sess-1', 'q', jest.fn());

      expect(reader.cancel).toHaveBeenCalledTimes(1);
    });

    it('fetches /messages after stream and returns sources from the last assistant message', async () => {
      const reader = makeStreamReader(['data: {"done":true}\n\n']);
      const sources = [
        { filePath: 'src/auth.ts', symbol: 'AuthService', startLine: 10 },
      ];
      const streamFetch = jest.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          body: { getReader: jest.fn().mockReturnValue(reader) },
          json: jest.fn(),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: jest.fn().mockResolvedValue([
            { role: 'user', sources: null },
            { role: 'assistant', sources },
          ]),
        });

      const discoveryApi = mockDiscoveryApi();
      const client = new CodeInsightClient({
        discoveryApi,
        fetchApi: { fetch: streamFetch },
      });

      const result = await client.askQnAStream('my-repo', 'sess-1', 'q', jest.fn());

      expect(result).toEqual(sources);
      // Second fetch should be the /messages GET
      const secondUrl = streamFetch.mock.calls[1][0] as string;
      expect(secondUrl).toBe(`${BASE_URL}/repos/my-repo/qna/sessions/sess-1/messages`);
    });

    it('returns the LAST assistant message sources when there are multiple assistant messages', async () => {
      const reader = makeStreamReader(['data: {"done":true}\n\n']);
      const firstSources = [{ filePath: 'old.ts' }];
      const lastSources = [{ filePath: 'new.ts', startLine: 5 }];
      const streamFetch = jest.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          body: { getReader: jest.fn().mockReturnValue(reader) },
          json: jest.fn(),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: jest.fn().mockResolvedValue([
            { role: 'user', sources: null },
            { role: 'assistant', sources: firstSources },
            { role: 'user', sources: null },
            { role: 'assistant', sources: lastSources },
          ]),
        });

      const discoveryApi = mockDiscoveryApi();
      const client = new CodeInsightClient({
        discoveryApi,
        fetchApi: { fetch: streamFetch },
      });

      const result = await client.askQnAStream('my-repo', 'sess-1', 'q', jest.fn());

      expect(result).toEqual(lastSources);
    });

    it('returns an empty array when /messages responds with a non-ok status', async () => {
      const reader = makeStreamReader(['data: {"done":true}\n\n']);
      const streamFetch = jest.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          body: { getReader: jest.fn().mockReturnValue(reader) },
          json: jest.fn(),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          json: jest.fn().mockResolvedValue(null),
        });

      const discoveryApi = mockDiscoveryApi();
      const client = new CodeInsightClient({
        discoveryApi,
        fetchApi: { fetch: streamFetch },
      });

      const result = await client.askQnAStream('my-repo', 'sess-1', 'q', jest.fn());

      expect(result).toEqual([]);
    });

    it('returns an empty array when the last assistant message has no sources', async () => {
      const reader = makeStreamReader(['data: {"done":true}\n\n']);
      const streamFetch = jest.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          body: { getReader: jest.fn().mockReturnValue(reader) },
          json: jest.fn(),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: jest.fn().mockResolvedValue([
            { role: 'assistant', sources: null },
          ]),
        });

      const discoveryApi = mockDiscoveryApi();
      const client = new CodeInsightClient({
        discoveryApi,
        fetchApi: { fetch: streamFetch },
      });

      const result = await client.askQnAStream('my-repo', 'sess-1', 'q', jest.fn());

      expect(result).toEqual([]);
    });

    it('throws when the initial POST response is not ok', async () => {
      const fetchApi = mockFetchApi(null, { ok: false, statusText: 'Unauthorized' });
      const { client } = createClient({ fetchApi });

      await expect(
        client.askQnAStream('my-repo', 'sess-1', 'q', jest.fn()),
      ).rejects.toThrow('Failed to ask: Unauthorized');
    });

    it('throws when response.body is null (no readable stream)', async () => {
      const streamFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        body: null,
        json: jest.fn(),
      });

      const discoveryApi = mockDiscoveryApi();
      const client = new CodeInsightClient({
        discoveryApi,
        fetchApi: { fetch: streamFetch },
      });

      await expect(
        client.askQnAStream('my-repo', 'sess-1', 'q', jest.fn()),
      ).rejects.toThrow('No response body');
    });

    it('throws when an SSE frame contains a malformed JSON payload', async () => {
      const reader = makeStreamReader(['data: NOT_JSON\n\n']);
      const streamFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        body: { getReader: jest.fn().mockReturnValue(reader) },
        json: jest.fn(),
      });

      const discoveryApi = mockDiscoveryApi();
      const client = new CodeInsightClient({
        discoveryApi,
        fetchApi: { fetch: streamFetch },
      });

      await expect(
        client.askQnAStream('my-repo', 'sess-1', 'q', jest.fn()),
      ).rejects.toThrow('Malformed SSE frame:');
    });

    it('throws when an SSE frame carries an error field', async () => {
      const reader = makeStreamReader(['data: {"error":"Something went wrong"}\n\n']);
      const streamFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        body: { getReader: jest.fn().mockReturnValue(reader) },
        json: jest.fn(),
      });

      const discoveryApi = mockDiscoveryApi();
      const client = new CodeInsightClient({
        discoveryApi,
        fetchApi: { fetch: streamFetch },
      });

      await expect(
        client.askQnAStream('my-repo', 'sess-1', 'q', jest.fn()),
      ).rejects.toThrow('Something went wrong');
    });

    it('still calls reader.cancel() when an SSE error frame is encountered', async () => {
      const reader = makeStreamReader(['data: {"error":"boom"}\n\n']);
      const streamFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        body: { getReader: jest.fn().mockReturnValue(reader) },
        json: jest.fn(),
      });

      const discoveryApi = mockDiscoveryApi();
      const client = new CodeInsightClient({
        discoveryApi,
        fetchApi: { fetch: streamFetch },
      });

      await expect(
        client.askQnAStream('my-repo', 'sess-1', 'q', jest.fn()),
      ).rejects.toThrow('boom');

      expect(reader.cancel).toHaveBeenCalledTimes(1);
    });

    it('handles SSE frames split across multiple chunks (buffer accumulation)', async () => {
      // Frame split across two read() calls
      const part1 = 'data: {"tok';
      const part2 = 'en":"split"}\n\ndata: {"done":true}\n\n';
      const reader = makeStreamReader([part1, part2]);

      const streamFetch = jest.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          body: { getReader: jest.fn().mockReturnValue(reader) },
          json: jest.fn(),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: jest.fn().mockResolvedValue([
            { role: 'assistant', sources: [] },
          ]),
        });

      const discoveryApi = mockDiscoveryApi();
      const client = new CodeInsightClient({
        discoveryApi,
        fetchApi: { fetch: streamFetch },
      });

      const onToken = jest.fn();
      await client.askQnAStream('my-repo', 'sess-1', 'q', onToken);

      expect(onToken).toHaveBeenCalledWith('split');
    });

    it('encodes both repoId and sessionId in all URLs', async () => {
      const reader = makeStreamReader(['data: {"done":true}\n\n']);
      const streamFetch = jest.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          body: { getReader: jest.fn().mockReturnValue(reader) },
          json: jest.fn(),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: jest.fn().mockResolvedValue([]),
        });

      const discoveryApi = mockDiscoveryApi();
      const client = new CodeInsightClient({
        discoveryApi,
        fetchApi: { fetch: streamFetch },
      });

      await client.askQnAStream('org/repo', 'sess/1', 'q', jest.fn());

      const streamUrl = streamFetch.mock.calls[0][0] as string;
      const messagesUrl = streamFetch.mock.calls[1][0] as string;

      expect(streamUrl).toBe(
        `${BASE_URL}/repos/org%2Frepo/qna/sessions/sess%2F1/ask-stream`,
      );
      expect(messagesUrl).toBe(
        `${BASE_URL}/repos/org%2Frepo/qna/sessions/sess%2F1/messages`,
      );
    });
  });

  // -----------------------------------------------------------------------
  // Shared behavior
  // -----------------------------------------------------------------------
  describe('discovery API integration', () => {
    it('calls discoveryApi.getBaseUrl with "codeinsight"', async () => {
      const discoveryApi = mockDiscoveryApi();
      const fetchApi = mockFetchApi({ status: 'ok' });
      const { client } = createClient({ discoveryApi, fetchApi });

      await client.getRepoStatus('any-repo');

      expect(discoveryApi.getBaseUrl).toHaveBeenCalledWith('codeinsight');
    });

    it('uses the base URL returned by discoveryApi', async () => {
      const customBase = 'http://custom-host:9000/api/codeinsight';
      const discoveryApi = mockDiscoveryApi(customBase);
      const fetchApi = mockFetchApi({ status: 'ok' });
      const { client } = createClient({ discoveryApi, fetchApi });

      await client.getRepoStatus('my-repo');

      const calledUrl = fetchApi.fetch.mock.calls[0][0] as string;
      expect(calledUrl).toStartWith(customBase);
    });
  });
});

// ---------------------------------------------------------------------------
// Custom matcher (local, avoids need for jest-extended)
// ---------------------------------------------------------------------------
expect.extend({
  toStartWith(received: string, prefix: string) {
    const pass = received.startsWith(prefix);
    return {
      pass,
      message: () =>
        `expected "${received}" ${pass ? 'not ' : ''}to start with "${prefix}"`,
    };
  },
});

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace jest {
    interface Matchers<R> {
      toStartWith(prefix: string): R;
    }
  }
}
