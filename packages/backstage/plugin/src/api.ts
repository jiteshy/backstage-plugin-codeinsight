import { createApiRef } from '@backstage/core-plugin-api';

export interface QnASource {
  filePath: string;
  symbol?: string;
  startLine?: number;
  endLine?: number;
  layer?: string;
  snippet?: string;
}

export interface DocSection {
  artifactId: string;
  markdown: string;
  isStale: boolean;
  staleReason?: string | null;
  fileCount: number;
  generatedAt: string;
  tokensUsed: number;
}

export interface DiagramSection {
  artifactId: string;
  title: string;
  description?: string | null;
  diagramType: string;
  mermaid: string;
  isStale: boolean;
  staleReason?: string | null;
  llmUsed: boolean;
  nodeMap?: Record<string, string> | null;
  generatedAt: string;
  tokensUsed: number;
}

export interface CodeInsightApi {
  triggerIngestion(repoId: string, repoUrl: string): Promise<{ jobId: string }>;
  /** Returns null when the job is not found (e.g. server restarted and lost in-memory state). */
  getJobStatus(
    repoId: string,
    jobId: string,
  ): Promise<{ status: string; filesProcessed?: number; errorMessage?: string; indexingStatus?: string; indexingError?: string } | null>;
  getRepoStatus(
    repoId: string,
  ): Promise<{ status: string; lastCommitSha?: string; updatedAt?: string }>;
  getDocs(repoId: string): Promise<DocSection[]>;
  getDiagrams(repoId: string): Promise<DiagramSection[]>;
  /** Hard-delete all data for a repo. The UI should trigger fresh ingestion after this. */
  deleteRepo(repoId: string): Promise<void>;
  submitFeedback(
    repoId: string,
    artifactId: string,
    artifactType: 'doc' | 'diagram' | 'qna',
    rating: 1 | -1,
  ): Promise<void>;
  createQnASession(repoId: string): Promise<{ sessionId: string }>;
  askQnAStream(
    repoId: string,
    sessionId: string,
    question: string,
    onToken: (token: string) => void,
  ): Promise<QnASource[]>;
}

export const codeInsightApiRef = createApiRef<CodeInsightApi>({
  id: 'plugin.codeinsight.api',
});
