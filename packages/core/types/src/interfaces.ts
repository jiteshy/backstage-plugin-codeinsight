import type {
  Artifact,
  CIGEdge,
  CIGNode,
  IngestionJob,
  JobStatus,
  RepoFile,
  RepoStatus,
  Repository,
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
  tenantId: string;
  chunkId: string;
  repoId: string;
  content: string;
  contentSha: string;
  embedding?: number[];
  layer: string;
  metadata?: Record<string, unknown>;
}

export interface VectorFilter {
  tenantId: string;
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
  getRepo(tenantId: string, repoId: string): Promise<Repository | null>;
  upsertRepo(repo: Repository): Promise<void>;
  updateRepoStatus(
    tenantId: string,
    repoId: string,
    status: RepoStatus,
    lastCommitSha?: string,
  ): Promise<void>;

  // File tracking
  upsertRepoFiles(files: RepoFile[]): Promise<void>;
  getRepoFiles(tenantId: string, repoId: string): Promise<RepoFile[]>;
  getChangedRepoFiles(tenantId: string, repoId: string): Promise<RepoFile[]>;

  // CIG
  upsertCIGNodes(nodes: CIGNode[]): Promise<void>;
  upsertCIGEdges(edges: CIGEdge[]): Promise<void>;
  deleteCIGForFiles(tenantId: string, repoId: string, filePaths: string[]): Promise<void>;
  getCIGNodes(tenantId: string, repoId: string): Promise<CIGNode[]>;
  getCIGEdges(tenantId: string, repoId: string): Promise<CIGEdge[]>;

  // Artifacts (Phase 2+)
  upsertArtifact(artifact: Artifact): Promise<void>;
  getArtifact(tenantId: string, artifactId: string, repoId: string): Promise<Artifact | null>;
  getStaleArtifacts(tenantId: string, repoId: string): Promise<Artifact[]>;

  // Jobs
  createJob(job: IngestionJob): Promise<string>;
  updateJob(tenantId: string, jobId: string, update: Partial<IngestionJob>): Promise<void>;
  getJob(tenantId: string, jobId: string): Promise<IngestionJob | null>;
  getActiveJobForRepo(tenantId: string, repoId: string): Promise<IngestionJob | null>;
}

// ---------------------------------------------------------------------------
// Job Queue
// ---------------------------------------------------------------------------

export interface Job {
  tenantId: string;
  repoId: string;
  repoUrl: string;
  trigger: IngestionJob['trigger'];
}

export interface JobQueue {
  enqueue(job: Job): Promise<string>;
  getStatus(tenantId: string, jobId: string): Promise<JobStatus>;
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
