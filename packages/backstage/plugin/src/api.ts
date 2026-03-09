import { createApiRef } from '@backstage/core-plugin-api';

export interface CodeInsightApi {
  triggerIngestion(repoId: string, repoUrl: string): Promise<{ jobId: string }>;
  getJobStatus(
    repoId: string,
    jobId: string,
  ): Promise<{ status: string; filesProcessed?: number; errorMessage?: string }>;
  getRepoStatus(
    repoId: string,
  ): Promise<{ status: string; lastCommitSha?: string; updatedAt?: string }>;
}

export const codeInsightApiRef = createApiRef<CodeInsightApi>({
  id: 'plugin.codeinsight.api',
});
