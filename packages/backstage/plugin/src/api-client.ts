import { DiscoveryApi, FetchApi } from '@backstage/core-plugin-api';

import { CodeInsightApi, DiagramSection, DocSection, QnASource } from './api';

export class CodeInsightClient implements CodeInsightApi {
  private readonly discoveryApi: DiscoveryApi;
  private readonly fetchApi: FetchApi;

  constructor(options: { discoveryApi: DiscoveryApi; fetchApi: FetchApi }) {
    this.discoveryApi = options.discoveryApi;
    this.fetchApi = options.fetchApi;
  }

  private async baseUrl(): Promise<string> {
    return this.discoveryApi.getBaseUrl('codeinsight');
  }

  async triggerIngestion(
    repoId: string,
    repoUrl: string,
  ): Promise<{ jobId: string }> {
    const base = await this.baseUrl();
    const response = await this.fetchApi.fetch(
      `${base}/repos/${encodeURIComponent(repoId)}/ingest`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl }),
      },
    );
    if (!response.ok) {
      throw new Error(`Ingestion failed: ${response.statusText}`);
    }
    return (await response.json()) as { jobId: string };
  }

  async getJobStatus(
    repoId: string,
    jobId: string,
  ): Promise<{ status: string; filesProcessed?: number; errorMessage?: string }> {
    const base = await this.baseUrl();
    const response = await this.fetchApi.fetch(
      `${base}/repos/${encodeURIComponent(repoId)}/jobs/${encodeURIComponent(jobId)}`,
    );
    if (!response.ok) {
      throw new Error(`Failed to get job status: ${response.statusText}`);
    }
    return (await response.json()) as { status: string; filesProcessed?: number; errorMessage?: string };
  }

  async getRepoStatus(
    repoId: string,
  ): Promise<{ status: string; lastCommitSha?: string; updatedAt?: string }> {
    const base = await this.baseUrl();
    const response = await this.fetchApi.fetch(
      `${base}/repos/${encodeURIComponent(repoId)}/status`,
    );
    if (!response.ok) {
      throw new Error(`Failed to get repo status: ${response.statusText}`);
    }
    return (await response.json()) as { status: string; lastCommitSha?: string; updatedAt?: string };
  }

  async getDocs(repoId: string): Promise<DocSection[]> {
    const base = await this.baseUrl();
    const response = await this.fetchApi.fetch(
      `${base}/repos/${encodeURIComponent(repoId)}/docs`,
    );
    if (response.status === 404) return [];
    if (!response.ok) {
      throw new Error(`Failed to get docs: ${response.statusText}`);
    }
    return (await response.json()) as DocSection[];
  }

  async getDiagrams(repoId: string): Promise<DiagramSection[]> {
    const base = await this.baseUrl();
    const response = await this.fetchApi.fetch(
      `${base}/repos/${encodeURIComponent(repoId)}/diagrams`,
    );
    if (response.status === 404) return [];
    if (!response.ok) {
      throw new Error(`Failed to get diagrams: ${response.statusText}`);
    }
    return (await response.json()) as DiagramSection[];
  }

  async createQnASession(repoId: string): Promise<{ sessionId: string }> {
    const base = await this.baseUrl();
    const response = await this.fetchApi.fetch(
      `${base}/repos/${encodeURIComponent(repoId)}/qna/sessions`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    );
    if (!response.ok) {
      throw new Error(`Failed to create QnA session: ${response.statusText}`);
    }
    return (await response.json()) as { sessionId: string };
  }

  async askQnAStream(
    repoId: string,
    sessionId: string,
    question: string,
    onToken: (token: string) => void,
  ): Promise<QnASource[]> {
    const base = await this.baseUrl();
    const response = await this.fetchApi.fetch(
      `${base}/repos/${encodeURIComponent(repoId)}/qna/sessions/${encodeURIComponent(sessionId)}/ask-stream`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      },
    );
    if (!response.ok) {
      throw new Error(`Failed to ask: ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');
    const decoder = new TextDecoder();
    let buffer = '';

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';
      for (const part of parts) {
        const dataLine = part.split('\n').find(l => l.startsWith('data: '));
        if (!dataLine) continue;
        const payload = JSON.parse(dataLine.slice(6)) as {
          token?: string;
          done?: boolean;
          error?: string;
        };
        if (payload.error) throw new Error(payload.error);
        if (payload.token) onToken(payload.token);
      }
    }

    // Fetch sources from the persisted assistant message
    const msgsRes = await this.fetchApi.fetch(
      `${base}/repos/${encodeURIComponent(repoId)}/qna/sessions/${encodeURIComponent(sessionId)}/messages`,
    );
    if (!msgsRes.ok) return [];
    const messages = (await msgsRes.json()) as Array<{
      role: string;
      sources?: QnASource[] | null;
    }>;
    const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
    return lastAssistant?.sources ?? [];
  }
}
