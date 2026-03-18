// ---------------------------------------------------------------------------
// Enums / Union Types
// ---------------------------------------------------------------------------

export type RepoProvider = 'github' | 'gitlab' | 'bitbucket';

export type RepoStatus = 'idle' | 'processing' | 'ready' | 'error';

export type FileType = 'source' | 'config' | 'schema' | 'infra' | 'ci' | 'test';

export type ParseStatus = 'pending' | 'parsed' | 'skipped' | 'error';

export type SymbolType =
  | 'function'
  | 'class'
  | 'interface'
  | 'variable'
  | 'type'
  | 'enum'
  | 'route'
  | 'schema';

export type EdgeType = 'calls' | 'imports' | 'extends' | 'implements' | 'references';

export type ArtifactType = 'doc' | 'diagram' | 'qna_chunk';

export type StaleReason = 'file_changed' | 'prompt_updated' | 'dependency_stale';

export type ArtifactDepType = 'content' | 'structural';

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'partial';

export type JobTrigger = 'manual' | 'webhook' | 'schedule';

// ---------------------------------------------------------------------------
// Data Types — mirror the DB schema
// ---------------------------------------------------------------------------

export interface Repository {
  repoId: string;
  name: string;
  url: string;
  provider: RepoProvider;
  status: RepoStatus;
  lastCommitSha?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RepoFile {
  repoId: string; // PK: (repoId, filePath) — matches DB composite key
  filePath: string;
  currentSha: string;
  lastProcessedSha?: string | null;
  fileType: FileType;
  language?: string | null;
  parseStatus: ParseStatus;
}

export interface CIGNode {
  nodeId: string;
  repoId: string;
  filePath: string;
  symbolName: string;
  symbolType: SymbolType;
  startLine: number;
  endLine: number;
  exported: boolean;
  extractedSha: string;
  metadata?: Record<string, unknown> | null;
}

export interface CIGEdge {
  edgeId: string;
  repoId: string;
  fromNodeId: string;
  toNodeId: string;
  edgeType: EdgeType;
}

// ---------------------------------------------------------------------------
// Artifact content — discriminated union per artifact kind
// ---------------------------------------------------------------------------

export interface DocContent {
  kind: 'doc';
  module: string;    // e.g. 'overview', 'api-reference', 'getting-started'
  markdown: string;  // generated markdown text
}

export interface DiagramContent {
  kind: 'diagram';
  diagramType: string;  // e.g. 'flowchart', 'sequenceDiagram', 'erDiagram'
  mermaid: string;      // raw Mermaid DSL
  title?: string;
}

export interface QnAChunkContent {
  kind: 'qna_chunk';
  text: string;
  chunkIndex: number;
  totalChunks: number;
  sourceFile?: string;
}

export type ArtifactContent = DocContent | DiagramContent | QnAChunkContent;

export interface Artifact {
  repoId: string;
  artifactId: string;
  artifactType: ArtifactType;
  content?: ArtifactContent | null;
  inputSha: string;
  promptVersion?: string | null;
  isStale: boolean;
  staleReason?: StaleReason | null;
  tokensUsed: number;
  llmUsed: boolean;
  generatedAt: Date;
}

export interface ArtifactInput {
  repoId: string;
  artifactId: string;
  filePath: string;
  fileSha: string;
}

export interface ArtifactDependency {
  repoId: string;
  dependentId: string;
  dependencyId: string;
  depType: ArtifactDepType;
}

export interface IngestionJob {
  jobId: string;
  repoId: string;
  trigger: JobTrigger;
  status: JobStatus;
  fromCommit?: string | null;
  toCommit?: string | null;
  changedFiles?: string[] | null;
  artifactsStale?: string[] | null;
  filesProcessed: number;
  filesSkipped: number;
  tokensConsumed: number;
  errorMessage?: string | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  createdAt: Date;
}
