import type {
  Artifact,
  ArtifactInput,
  ArtifactType,
  CIGEdge,
  CIGNode,
  IngestionJob,
  JobStatus,
  RepoFile,
  RepoStatus,
  Repository,
  StaleReason,
} from './data';

// ---------------------------------------------------------------------------
// LLM
// ---------------------------------------------------------------------------

export interface LLMOptions {
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
}

export interface LLMClient {
  complete(systemPrompt: string, userPrompt: string, opts?: LLMOptions): Promise<string>;
  stream(systemPrompt: string, userPrompt: string, opts?: LLMOptions): AsyncIterable<string>;
}

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------

export interface EmbeddingClient {
  embed(texts: string[]): Promise<number[][]>;
}

// ---------------------------------------------------------------------------
// Vector Store
// ---------------------------------------------------------------------------

export interface VectorChunk {
  chunkId: string;
  repoId: string;
  content: string;
  contentSha: string;
  embedding?: number[];
  layer: string;
  metadata?: Record<string, unknown>;
}

export interface VectorFilter {
  repoId: string;
  layers?: string[];
  filePaths?: string[];
}

export interface VectorStore {
  upsert(chunks: VectorChunk[]): Promise<void>;
  search(embedding: number[], filter: VectorFilter, topK: number): Promise<VectorChunk[]>;
}

// ---------------------------------------------------------------------------
// Repo Connector
// ---------------------------------------------------------------------------

export interface CloneOptions {
  depth?: number;
  branch?: string;
  authToken?: string;
}

export interface RepoConnector {
  clone(url: string, targetDir: string, opts?: CloneOptions): Promise<void>;
  getFileTree(dir: string): Promise<RepoFile[]>;
  getHeadSha(dir: string): Promise<string>;
  getChangedFiles(dir: string, fromSha: string, toSha: string): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// Storage Adapter
// ---------------------------------------------------------------------------

export interface StorageAdapter {
  // Repository operations
  getRepo(repoId: string): Promise<Repository | null>;
  upsertRepo(repo: Repository): Promise<void>;
  updateRepoStatus(repoId: string, status: RepoStatus, lastCommitSha?: string): Promise<void>;

  // File tracking
  upsertRepoFiles(files: RepoFile[]): Promise<void>;
  getRepoFiles(repoId: string): Promise<RepoFile[]>;
  getChangedRepoFiles(repoId: string): Promise<RepoFile[]>;

  // CIG
  upsertCIGNodes(nodes: CIGNode[]): Promise<void>;
  upsertCIGEdges(edges: CIGEdge[]): Promise<void>;
  deleteCIGForFiles(repoId: string, filePaths: string[]): Promise<void>;
  getCIGNodes(repoId: string): Promise<CIGNode[]>;
  getCIGEdges(repoId: string): Promise<CIGEdge[]>;

  // File tracking (extended)
  deleteRepoFilesNotIn(repoId: string, currentFilePaths: string[]): Promise<void>;

  // Artifacts (Phase 2+)
  upsertArtifact(artifact: Artifact): Promise<void>;
  getArtifact(artifactId: string, repoId: string): Promise<Artifact | null>;
  getArtifactsByType(repoId: string, type: ArtifactType): Promise<Artifact[]>;
  getStaleArtifacts(repoId: string): Promise<Artifact[]>;
  markArtifactsStale(repoId: string, artifactIds: string[], reason: StaleReason): Promise<void>;

  // Artifact inputs (Phase 2+)
  upsertArtifactInputs(inputs: ArtifactInput[]): Promise<void>;
  getArtifactInputs(repoId: string, artifactId: string): Promise<ArtifactInput[]>;

  // Artifact inputs — staleness queries (Phase 2.6)
  getArtifactIdsByFilePaths(repoId: string, filePaths: string[]): Promise<string[]>;
  getArtifactDependents(repoId: string, artifactIds: string[]): Promise<string[]>;

  // Jobs
  createJob(job: IngestionJob): Promise<string>;
  updateJob(jobId: string, update: Partial<IngestionJob>): Promise<void>;
  getJob(jobId: string): Promise<IngestionJob | null>;
  getActiveJobForRepo(repoId: string): Promise<IngestionJob | null>;
}

// ---------------------------------------------------------------------------
// Job Queue
// ---------------------------------------------------------------------------

export interface Job {
  repoId: string;
  repoUrl: string;
  trigger: IngestionJob['trigger'];
}

export interface JobQueue {
  enqueue(job: Job): Promise<string>;
  getStatus(jobId: string): Promise<JobStatus>;
}

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}
