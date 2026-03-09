import { CodeInsightClient } from './api-client';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function mockDiscoveryApi(baseUrl = 'http://localhost:7007/api/codeinsight') {
  return {
    getBaseUrl: jest.fn().mockResolvedValue(baseUrl),
  };
}

function mockFetchApi(responseBody: unknown, init?: { ok?: boolean; statusText?: string }) {
  const ok = init?.ok ?? true;
  const statusText = init?.statusText ?? 'OK';

  return {
    fetch: jest.fn().mockResolvedValue({
      ok,
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
