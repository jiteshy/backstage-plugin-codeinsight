import type { Artifact, VectorChunk } from '@codeinsight/types';

// ---------------------------------------------------------------------------
// Fixture types — what lives on disk in fixtures/<slug>/
// ---------------------------------------------------------------------------

export interface RepoFixtureMeta {
  slug: string;
  gitUrl: string;
  commitSha: string;
  description: string;
  sizeCategory: 'small' | 'medium' | 'complex';
  fileCountApprox: number;
}

export interface ExpectedOverview {
  bullets: string[];
}

export interface ExpectedSubsystem {
  name: string;
  mustMentionFiles: string[];
}

export interface ExpectedArchitecture {
  subsystems: ExpectedSubsystem[];
  externalDependencies: string[];
}

export interface ExpectedDiagramEdge {
  from: string;
  to: string;
}

export interface ExpectedSystemArchDiagram {
  mustContainLabels: string[];
  mustContainEdges: ExpectedDiagramEdge[];
}

export interface ExpectedDataModelDiagram {
  mustContainEntities: string[];
}

export interface ExpectedKeyFlow {
  name: string;
  mustContainSteps: string[];
}

export interface ExpectedDiagrams {
  systemArchitecture: ExpectedSystemArchDiagram;
  dataModel: ExpectedDataModelDiagram | null;
  keyFlows: ExpectedKeyFlow[];
}

export interface QaPair {
  question: string;
  expectedFiles: string[];
  mustIncludeFacts: string[];
  shouldNotHallucinate: string[];
}

export interface RepoFixture {
  meta: RepoFixtureMeta;
  expectedOverview: ExpectedOverview;
  expectedArchitecture: ExpectedArchitecture;
  expectedDiagrams: ExpectedDiagrams;
  qaPairs: QaPair[];
}

// ---------------------------------------------------------------------------
// Report types — what runner + reportWriter emit
// ---------------------------------------------------------------------------

export interface FactScore {
  fact: string;
  score: 0 | 0.5 | 1;
  reason: string;
}

export interface DocScore {
  module: 'overview' | 'architecture' | 'reference';
  overall: number;
  factScores: FactScore[];
}

export interface DiagramCheck {
  type: 'systemArchitecture' | 'dataModel' | 'keyFlows';
  passed: number;
  total: number;
  missing: string[];
}

export interface QaScoreDetail {
  question: string;
  recallAt10: number;
  completeness: number;
  hallucinationCount: number;
  retrievedFilePaths: string[];
  answer: string;
}

export interface QaScore {
  overall: number;
  details: QaScoreDetail[];
}

export interface CostSummary {
  chatRequests: number;
  chatInputTokens: number;
  chatOutputTokens: number;
  chatUsd: number;
  embeddingRequests: number;
  embeddingInputTokens: number;
  embeddingUsd: number;
  totalUsd: number;
}

export interface RepoReport {
  fixtureSlug: string;
  commitSha: string;
  pipelineVersion: string;
  doc: DocScore[];
  diagram: DiagramCheck[];
  qna: QaScore;
  cost: CostSummary;
  wallClockSeconds: number;
  timestamp: string;
}

export interface EvalReport {
  generatedAt: string;
  pipelineVersion: string;
  repos: RepoReport[];
}

// ---------------------------------------------------------------------------
// PipelineAdapter — version-agnostic interface runner talks to
// ---------------------------------------------------------------------------

export interface PipelineAdapter {
  /** Register + ingest the repo. Returns when artifacts exist and indexing is done. */
  ingest(meta: RepoFixtureMeta, cloneDir: string): Promise<void>;
  /** Retrieve the doc artifacts that ingestion produced. */
  getDocArtifacts(repoSlug: string): Promise<Artifact[]>;
  /** Retrieve the diagram artifacts that ingestion produced. */
  getDiagramArtifacts(repoSlug: string): Promise<Artifact[]>;
  /** Ask a QnA question and return the answer + the chunks that grounded it. */
  askQna(repoSlug: string, question: string): Promise<{ answer: string; retrievedChunks: VectorChunk[] }>;
  /** Stable string for the pipeline version — goes into RepoReport.pipelineVersion. */
  readonly version: string;
}
