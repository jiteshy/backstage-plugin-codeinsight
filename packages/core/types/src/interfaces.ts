import type {
  ActiveContext,
  Artifact,
  ArtifactFeedback,
  ArtifactInput,
  ArtifactType,
  CIGEdge,
  CIGNode,
  IngestionJob,
  JobStatus,
  QnAMessage,
  QnASession,
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
  /** Abort signal — when triggered the stream/completion should terminate early. */
  signal?: AbortSignal;
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
  /** Full-text keyword search over chunk content. */
  searchKeyword(repoId: string, query: string, topK: number, layers?: string[]): Promise<VectorChunk[]>;
  /** Return existing chunk IDs + content SHAs for delta detection. */
  listChunks(repoId: string): Promise<Array<{ chunkId: string; contentSha: string }>>;
  /** Remove specific chunks by ID (used when source chunks are deleted). */
  deleteChunks(repoId: string, chunkIds: string[]): Promise<void>;
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
  /** Hard-delete a repo and all associated data (artifacts, QnA, jobs). Cascades via FK. */
  deleteRepo(repoId: string): Promise<void>;
  saveFeedback(feedback: ArtifactFeedback): Promise<void>;

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

  // QnA Sessions (Phase 5.6)
  createSession(session: QnASession): Promise<string>;
  getSession(sessionId: string): Promise<QnASession | null>;
  updateSessionActiveContext(sessionId: string, activeContext: ActiveContext): Promise<void>;
  touchSession(sessionId: string): Promise<void>;

  // QnA Messages (Phase 5.6)
  addMessage(message: QnAMessage): Promise<string>;
  getSessionMessages(sessionId: string, limit?: number, offset?: number): Promise<QnAMessage[]>;
  getSessionMessageCount(sessionId: string): Promise<number>;
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
