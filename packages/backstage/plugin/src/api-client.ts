import { DiscoveryApi, FetchApi } from '@backstage/core-plugin-api';

import { CodeInsightApi, DiagramSection, DocSection } from './api';

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
    if (!response.ok) {
      throw new Error(`Failed to get diagrams: ${response.statusText}`);
    }
    return (await response.json()) as DiagramSection[];
  }
}
